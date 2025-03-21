// webserver.js - Express.js와 WebSocket 기반 웹 서버

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const config = require('./config');
const bot = require('./bot');
const storage = require('./storage');

class WebServer {
    constructor() {
        // Express 애플리케이션 생성
        this.app = express();
        
        // 서버 상태 변수
        this.serverStatus = {
            startTime: new Date()
        };
        
        // 활성 웹소켓 연결 카운트
        this.activeConnections = 0;
        
        // 웹소켓 서버
        this.wss = null;
        
        // 서버 인스턴스
        this.server = null;
        
        // 초기화
        this._setupMiddleware();
        this._setupRoutes();
    }
    
    // 미들웨어 설정
    _setupMiddleware() {
        // 정적 파일 제공
        this.app.use(express.static(path.join(__dirname, config.dirs.web)));
        this.app.use(express.json());
    }
    
    // 라우트 설정
    _setupRoutes() {
        // 메인 라우트
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, config.dirs.web, 'index.html'));
        });
        
        // 404 처리
        this.app.use((req, res) => {
            res.status(404).send('페이지를 찾을 수 없습니다');
        });
    }
    
    // 서버 생성
    _createServer() {
        // HTTPS 활성화 확인
        if (config.https && config.https.enabled) {
            try {
                // SSL 인증서 읽기
                const sslOptions = {
                    key: fs.readFileSync(config.https.keyPath),
                    cert: fs.readFileSync(config.https.certPath)
                };
                
                // 중간 인증서가 있는 경우
                if (config.https.caPath) {
                    sslOptions.ca = fs.readFileSync(config.https.caPath);
                }
                
                // HTTPS 서버 생성
                this.server = https.createServer(sslOptions, this.app);
                console.log('HTTPS가 활성화되었습니다.');
            } catch (error) {
                console.error(`HTTPS 서버 생성 중 오류 발생: ${error.message}`);
                console.log('HTTP 모드로 대체합니다.');
                this.server = http.createServer(this.app);
            }
        } else {
            // HTTP 서버 생성
            this.server = http.createServer(this.app);
            console.log('HTTP 모드로 실행 중입니다.');
        }
    }
    
    // 웹소켓 서버 설정
    _setupWebSocketServer() {
        // 웹소켓 서버 생성
        this.wss = new WebSocket.Server({ server: this.server });
        
        // 웹소켓 연결 처리
        this.wss.on('connection', this._handleWebSocketConnection.bind(this));
    }
    
    // 웹 서버 가동 시간 계산 함수
    _getServerUptime() {
        const now = new Date();
        const diff = now - this.serverStatus.startTime;
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        return `${days}일 ${hours}시간 ${minutes}분 ${seconds}초`;
    }
    
    // 웹소켓 연결 처리
    _handleWebSocketConnection(ws) {
        // 연결 카운트 증가
        this.activeConnections++;
        console.log(`웹 대시보드 연결됨 (총 연결: ${this.activeConnections})`);
        
        // 사용자 세션 정보
        ws.userSession = {
            isLoggedIn: false,
            isAdmin: false,
            username: null,
            role: null
        };
        
        // 클라이언트가 연결되면 초기 상태 정보 전송
        this._sendStatus(ws);
        
        // 매 5초마다 상태 업데이트
        const interval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                this._sendStatus(ws);
            } else {
                clearInterval(interval);
            }
        }, 5000);
        
        // 클라이언트 메시지 처리
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                await this._handleWebSocketMessage(ws, data);
            } catch (error) {
                console.error(`클라이언트 메시지 처리 중 오류 발생: ${error.message}`);
                this._sendErrorMessage(ws, error.message);
            }
        });
        
        // 연결 종료 시 처리
        ws.on('close', () => {
            clearInterval(interval);
            this.activeConnections--;
            console.log(`웹 대시보드 연결 종료됨 (남은 연결: ${this.activeConnections})`);
            
            // 사용자가 로그인 상태였다면 온라인 관리자 목록 업데이트
            if (ws.userSession && ws.userSession.isLoggedIn) {
                this._broadcastOnlineAdmins();
            }
        });
        
        // 봇 로그 이벤트 수신기 등록
        bot.onLog = (logEntry) => {
            // 모든 웹소켓 클라이언트에 로그 전송
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    this._sendStatus(client);
                }
            });
        };
    }

    // 웹소켓 메시지 처리
    async _handleWebSocketMessage(ws, data) {
        const { command } = data;
        
        // 명령어 로깅
        console.log(`클라이언트로부터 받은 웹소켓 명령:`, command);
        
        switch (command) {
            // 온라인 관리자 목록 요청 처리 (로그인 필요 없음)
            case 'getOnlineAdmins':
                try {
                    // 온라인 관리자 목록 생성
                    const onlineAdmins = [];
                    
                    this.wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN && 
                            client.userSession && 
                            client.userSession.isLoggedIn && 
                            (client.userSession.isAdmin || ['level1', 'level2', 'level3'].includes(client.userSession.role))) {
                            
                            onlineAdmins.push({
                                username: client.userSession.username,
                                role: client.userSession.role
                            });
                        }
                    });
                    
                    this._sendMessage(ws, {
                        type: 'onlineAdmins',
                        admins: onlineAdmins
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `온라인 관리자 목록 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 로그인 인증 요청 처리
            case 'login':
                try {
                    const username = data.username;
                    const password = data.password;
                    
                    console.log(`로그인 요청: ${username}`);
                    
                    // 기본 관리자 계정 체크
                    if (username === config.auth.username && password === config.auth.password) {
                        ws.userSession.isLoggedIn = true;
                        ws.userSession.isAdmin = true;
                        ws.userSession.username = username;
                        ws.userSession.role = 'admin';
                        
                        // 응답 전송
                        this._sendMessage(ws, {
                            type: 'loginResult',
                            success: true,
                            message: '관리자 로그인 성공',
                            role: 'admin',
                            assignedChannels: []
                        });
                        
                        // 온라인 관리자 목록 업데이트
                        this._broadcastOnlineAdmins();
                        return;
                    }
                    
                    // 일반 사용자 계정 체크
                    try {
                        const user = storage.authenticateUser(username, password);
                        if (user) {
                            ws.userSession.isLoggedIn = true;
                            ws.userSession.isAdmin = user.role === 'admin' || user.role === 'level1';
                            ws.userSession.username = username;
                            ws.userSession.role = user.role;
                            
                            // 사용자 정보에서 할당된 채널 가져오기
                            const assignedChannels = storage.getUserChannels(username);
                            
                            this._sendMessage(ws, {
                                type: 'loginResult',
                                success: true,
                                message: '로그인 성공',
                                role: user.role,
                                assignedChannels: assignedChannels
                            });
                            
                            // 온라인 관리자 목록 업데이트
                            this._broadcastOnlineAdmins();
                        } else {
                            this._sendMessage(ws, {
                                type: 'loginResult',
                                success: false,
                                message: '아이디 또는 비밀번호가 올바르지 않습니다.'
                            });
                        }
                    } catch (error) {
                        this._sendMessage(ws, {
                            type: 'loginResult',
                            success: false,
                            message: `로그인 처리 중 오류 발생: ${error.message}`
                        });
                    }
                } catch (error) {
                    console.error('로그인 처리 중 예외 발생:', error);
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `로그인 처리 중 오류가 발생했습니다.`
                    });
                }
                break;
                
            // 회원가입 처리
            case 'register':
                try {
                    const { username, password, inviteCode } = data;
                    
                    // 초대 코드 유효성 확인
                    if (!storage.isValidInviteCode(inviteCode)) {
                        this._sendMessage(ws, {
                            type: 'registerResult',
                            success: false,
                            message: '유효하지 않은 초대 코드입니다.'
                        });
                        return;
                    }
                    
                    // 사용자 생성
                    const user = await storage.createUser(username, password);
                    
                    // 초대 코드 사용 처리
                    await storage.useInviteCode(inviteCode, username);
                    
                    this._sendMessage(ws, {
                        type: 'registerResult',
                        success: true,
                        message: '회원가입이 완료되었습니다.'
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'registerResult',
                        success: false,
                        message: `회원가입 처리 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 사용자 목록 요청 처리
            case 'getUsers':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const users = storage.getAll('users');
                    
                    // 민감한 정보 제거
                    const usersList = Object.values(users).map(user => ({
                        username: user.username,
                        created: user.created,
                        lastLogin: user.lastLogin,
                        role: user.role
                    }));
                    
                    this._sendMessage(ws, {
                        type: 'usersList',
                        users: usersList
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `사용자 목록 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 초대 코드 목록 요청 처리
            case 'getInviteCodes':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const inviteCodes = storage.getAll('invite-codes');
                    
                    this._sendMessage(ws, {
                        type: 'inviteCodesList',
                        inviteCodes: Object.values(inviteCodes)
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `초대 코드 목록 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 초대 코드 생성 처리
            case 'generateInviteCode':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const customCode = data.code || null;
                    const inviteCode = await storage.createInviteCode(customCode);
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '초대 코드가 생성되었습니다.',
                        inviteCode: inviteCode
                    });
                    
                    // 모든 관리자에게 초대 코드 목록 업데이트
                    this._broadcastInviteCodes();
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `초대 코드 생성 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 초대 코드 삭제 처리
            case 'deleteInviteCode':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { code } = data;
                    await storage.deleteInviteCode(code);
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '초대 코드가 삭제되었습니다.'
                    });
                    
                    // 모든 관리자에게 초대 코드 목록 업데이트
                    this._broadcastInviteCodes();
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `초대 코드 삭제 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 사용자 추가 처리
            case 'addUser':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { username, password, role } = data;
                    const user = await storage.createUser(username, password, role);
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '사용자가 추가되었습니다.',
                        user: {
                            username: user.username,
                            role: user.role,
                            created: user.created
                        }
                    });
                    
                    // 모든 관리자에게 사용자 목록 업데이트
                    this._broadcastUsersList();
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `사용자 추가 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 사용자 업데이트 처리
            case 'updateUser':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { username, newPassword, role } = data;
                    
                    // 역할 업데이트
                    if (role) {
                        await storage.updateUserRole(username, role);
                    }
                    
                    // 비밀번호 업데이트
                    if (newPassword) {
                        await storage.resetUserPassword(username, newPassword);
                    }
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '사용자 정보가 업데이트되었습니다.'
                    });
                    
                    // 모든 관리자에게 사용자 목록 업데이트
                    this._broadcastUsersList();
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `사용자 정보 업데이트 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 사용자 삭제 처리
            case 'deleteUser':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { username } = data;
                    await storage.deleteUser(username);
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '사용자가 삭제되었습니다.'
                    });
                    
                    // 모든 관리자에게 사용자 목록 업데이트
                    this._broadcastUsersList();
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `사용자 삭제 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 사용자 권한 업데이트 처리
            case 'updateUserRole':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { username, role } = data;
                    const updatedUser = await storage.updateUserRole(username, role);
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '사용자 권한이 업데이트되었습니다.',
                        user: updatedUser
                    });
                    
                    // 모든 관리자에게 사용자 목록 업데이트
                    this._broadcastUsersList();
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `사용자 권한 업데이트 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 채널 할당 처리
            case 'assignChannel':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { username, serverId, channelId } = data;
                    
                    // 서버/채널 이름 조회
                    let serverName = '알 수 없음';
                    let channelName = '알 수 없음';
                    
                    const botStatus = bot.getStatus();
                    if (botStatus.servers) {
                        const server = botStatus.servers.find(s => s.id === serverId);
                        if (server) {
                            serverName = server.name;
                        }
                    }
                    
                    // TODO: 채널 이름 가져오기 구현
                    
                    const assignedChannels = await storage.assignChannelToUser(
                        username, serverId, channelId, serverName, channelName
                    );
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '채널이 할당되었습니다.',
                        assignedChannels
                    });
                    
                    // 사용자 채널 목록 업데이트
                    this._sendMessage(ws, {
                        type: 'userChannels',
                        username,
                        channels: assignedChannels
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `채널 할당 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 채널 할당 해제 처리
            case 'unassignChannel':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { username, channelId } = data;
                    const assignedChannels = await storage.unassignChannelFromUser(username, channelId);
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '채널 할당이 해제되었습니다.',
                        assignedChannels
                    });
                    
                    // 사용자 채널 목록 업데이트
                    this._sendMessage(ws, {
                        type: 'userChannels',
                        username,
                        channels: assignedChannels
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `채널 할당 해제 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 사용자 채널 목록 요청 처리
            case 'getUserChannels':
                if (!ws.userSession.isLoggedIn) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '로그인이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { username } = data;
                    
                    // 관리자가 아니면 자신의 채널만 볼 수 있음
                    if (!ws.userSession.isAdmin && ws.userSession.username !== username) {
                        this._sendMessage(ws, {
                            type: 'error',
                            message: '권한이 없습니다.'
                        });
                        return;
                    }
                    
                    const channels = storage.getUserChannels(username);
                    
                    this._sendMessage(ws, {
                        type: 'userChannels',
                        username,
                        channels
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `사용자 채널 목록 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 모듈 상태 요청 처리
            case 'getModuleStatus':
                try {
                    const moduleStatus = bot.getModuleStatus();
                    
                    this._sendMessage(ws, {
                        type: 'moduleStatus',
                        moduleStatus
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `모듈 상태 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 사용자 설정 요청 처리
            case 'getUserSettings':
                try {
                    const settings = bot.getUserSettings();
                    
                    this._sendMessage(ws, {
                        type: 'userSettings',
                        settings
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `사용자 설정 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 사용자 설정 저장 처리
            case 'saveUserSettings':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { settings } = data;
                    const success = await bot.saveUserSettings(settings);
                    
                    if (success) {
                        this._sendMessage(ws, {
                            type: 'userSettingsUpdate',
                            message: '사용자 설정이 저장되었습니다.',
                            userSettings: bot.getUserSettings()
                        });
                    } else {
                        this._sendMessage(ws, {
                            type: 'userSettingsError',
                            message: '사용자 설정 저장에 실패했습니다.'
                        });
                    }
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'userSettingsError',
                        message: `사용자 설정 저장 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 임베드 전송 처리
            case 'sendEmbed':
                if (!ws.userSession.isLoggedIn) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '로그인이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { serverId, channelId, embed } = data;
                    
                    // 임베드 전송 로직 구현 (별도의 모듈 사용)
                    // TODO: 봇을 통해 채널에 임베드 전송 기능 구현
                    
                    this._sendMessage(ws, {
                        type: 'embedSent',
                        message: '임베드가 전송되었습니다.'
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'embedError',
                        message: `임베드 전송 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 채널 목록 요청 처리
            case 'getChannels':
                if (!ws.userSession.isLoggedIn) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '로그인이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { serverId } = data;
                    
                    // TODO: 봇을 통해 서버의 채널 목록 가져오기
                    // 임시 응답으로 몇 가지 채널 목록 반환
                    const channels = [
                        { id: 'channel1', name: '일반', type: 0 },
                        { id: 'channel2', name: '공지사항', type: 0 },
                        { id: 'channel3', name: '음성채널', type: 2 }
                    ];
                    
                    this._sendMessage(ws, {
                        type: 'channels',
                        channels
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `채널 목록 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 봇 상태 요청 처리
            case 'getBotStatus':
                try {
                    const status = bot.getStatus();
                    
                    this._sendMessage(ws, {
                        type: 'serverStatus',
                        serverUptime: this._getServerUptime(),
                        botStatus: status.isRunning ? '실행 중' : '종료됨',
                        botUptime: status.uptime,
                        servers: status.servers,
                        modules: status.modules,
                        logs: status.logs,
                        moduleStatus: status.moduleStatus
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `봇 상태 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 봇 시작 처리
            case 'start':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const success = await bot.start();
                    
                    if (success) {
                        this._sendMessage(ws, {
                            type: 'info',
                            message: '봇이 시작되었습니다.'
                        });
                        
                        // 모든 클라이언트에 상태 업데이트
                        this.wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                this._sendStatus(client);
                            }
                        });
                    } else {
                        this._sendMessage(ws, {
                            type: 'error',
                            message: '봇 시작에 실패했습니다.'
                        });
                    }
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `봇 시작 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 봇 정지 처리
            case 'stop':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const success = await bot.stop();
                    
                    if (success) {
                        this._sendMessage(ws, {
                            type: 'info',
                            message: '봇이 정지되었습니다.'
                        });
                        
                        // 모든 클라이언트에 상태 업데이트
                        this.wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                this._sendStatus(client);
                            }
                        });
                    } else {
                        this._sendMessage(ws, {
                            type: 'error',
                            message: '봇 정지에 실패했습니다.'
                        });
                    }
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `봇 정지 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 봇 재시작 처리
            case 'restart':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const success = await bot.restart();
                    
                    if (success) {
                        this._sendMessage(ws, {
                            type: 'info',
                            message: '봇이 재시작되었습니다.'
                        });
                        
                        // 모든 클라이언트에 상태 업데이트
                        this.wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                this._sendStatus(client);
                            }
                        });
                    } else {
                        this._sendMessage(ws, {
                            type: 'error',
                            message: '봇 재시작에 실패했습니다.'
                        });
                    }
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `봇 재시작 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 모듈 작업 처리 (활성화/비활성화/재로드)
            case 'moduleAction':
                if (!ws.userSession.isAdmin) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: '관리자 권한이 필요합니다.'
                    });
                    return;
                }
                
                try {
                    const { action, moduleName } = data;
                    const success = await bot.moduleAction(action, moduleName);
                    
                    if (success) {
                        this._sendMessage(ws, {
                            type: 'info',
                            message: `모듈 ${moduleName}이(가) ${action} 되었습니다.`
                        });
                        
                        // 모듈 상태 업데이트
                        const moduleStatus = bot.getModuleStatus();
                        this._sendMessage(ws, {
                            type: 'moduleStatus',
                            moduleStatus
                        });
                    } else {
                        this._sendMessage(ws, {
                            type: 'error',
                            message: `모듈 ${action} 작업에 실패했습니다.`
                        });
                    }
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `모듈 작업 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            default:
                console.log(`미구현 명령: ${command}`);
                this._sendMessage(ws, {
                    type: 'error',
                    message: `지원되지 않는 명령: ${command}`
                });
                break;
        } // switch 문 닫기
    } // _handleWebSocketMessage 함수 닫기
    
    // 초대 코드 목록 브로드캐스트
    _broadcastInviteCodes() {
        try {
            const inviteCodes = storage.getAll('invite-codes');
            
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && client.userSession && client.userSession.isAdmin) {
                    this._sendMessage(client, {
                        type: 'inviteCodesList',
                        inviteCodes: Object.values(inviteCodes)
                    });
                }
            });
        } catch (error) {
            console.error(`초대 코드 목록 브로드캐스트 중 오류 발생: ${error.message}`);
        }
    }
    
    // 사용자 목록 브로드캐스트
    _broadcastUsersList() {
        try {
            const users = storage.getAll('users');
            
            // 민감한 정보 제거
            const usersList = Object.values(users).map(user => ({
                username: user.username,
                created: user.created,
                lastLogin: user.lastLogin,
                role: user.role
            }));
            
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && client.userSession && client.userSession.isAdmin) {
                    this._sendMessage(client, {
                        type: 'usersList',
                        users: usersList
                    });
                }
            });
        } catch (error) {
            console.error(`사용자 목록 브로드캐스트 중 오류 발생: ${error.message}`);
        }
    }
    
    // 온라인 관리자 목록 브로드캐스트
    _broadcastOnlineAdmins() {
        try {
            // 온라인 관리자 목록 생성
            const onlineAdmins = [];
            
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && 
                    client.userSession && 
                    client.userSession.isLoggedIn && 
                    (client.userSession.isAdmin || ['level1', 'level2', 'level3'].includes(client.userSession.role))) {
                    
                    onlineAdmins.push({
                        username: client.userSession.username,
                        role: client.userSession.role
                    });
                }
            });
            
            // 모든 접속자에게 온라인 관리자 목록 전송
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    this._sendMessage(client, {
                        type: 'onlineAdmins',
                        admins: onlineAdmins
                    });
                }
            });
        } catch (error) {
            console.error(`온라인 관리자 목록 브로드캐스트 중 오류 발생: ${error.message}`);
        }
    }
    
    // 상태 정보 전송 함수
    _sendStatus(ws) {
        // 기본 상태 정보 수집
        const botStatus = bot.getStatus();
        
        const status = {
            serverUptime: this._getServerUptime(),
            botStatus: botStatus.isRunning ? '실행 중' : '종료됨',
            botUptime: botStatus.uptime,
            servers: botStatus.servers,
            modules: botStatus.modules,
            logs: botStatus.logs,
            moduleStatus: botStatus.moduleStatus,
            userSettings: bot.getUserSettings()
        };
        
        // 웹소켓으로 전송
        this._sendMessage(ws, status);
    }
    
    // 메시지 전송 함수
    _sendMessage(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }
    
    // 오류 메시지 전송 함수
    _sendErrorMessage(ws, errorMessage) {
        this._sendMessage(ws, {
            type: 'error',
            message: errorMessage
        });
    }
    
    // 모든 클라이언트에 메시지 브로드캐스트
    _broadcastMessage(message) {
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                this._sendMessage(client, message);
            }
        });
    }
    
    // 서버 시작 함수
    async start() {
        // 서버 생성
        this._createServer();
        
        // 웹소켓 서버 설정
        this._setupWebSocketServer();
        
        // 서버 시작
        const PORT = config.webPort || (config.https && config.https.enabled ? 443 : 80);
        
        return new Promise((resolve, reject) => {
            this.server.listen(PORT, config.host || '0.0.0.0', () => {
                const protocol = config.https && config.https.enabled ? 'https' : 'http';
                const host = config.host || '0.0.0.0';
                const localUrl = `${protocol}://localhost:${PORT}`;
                const domainUrl = config.domain ? 
                    `${protocol}://${config.domain}` : 
                    `${protocol}://${host === '0.0.0.0' ? '<서버IP>' : host}:${PORT}`;
                
                console.log(`웹 인터페이스 시작됨:`);
                console.log(`- 로컬 접속: ${localUrl}`);
                console.log(`- 도메인 접속: ${domainUrl}`);
                console.log(`- 프로토콜: ${protocol.toUpperCase()}`);
                console.log(`- 포트: ${PORT}`);
                
                resolve(true);
            });
            
            this.server.on('error', (error) => {
                console.error(`웹 서버 시작 중 오류 발생: ${error.message}`);
                reject(error);
            });
        });
    }
    
    // 서버 종료 함수
    async stop() {
        return new Promise((resolve, reject) => {
            if (!this.server) {
                resolve(true);
                return;
            }
            
            // 웹소켓 서버 종료
            if (this.wss) {
                this.wss.close(() => {
                    console.log('웹소켓 서버가 종료되었습니다.');
                });
            }
            
            // HTTP 서버 종료
            this.server.close((err) => {
                if (err) {
                    console.error(`웹 서버 종료 중 오류 발생: ${err.message}`);
                    reject(err);
                } else {
                    console.log('웹 서버가 종료되었습니다.');
                    resolve(true);
                }
            });
        });
    }
} // WebServer 클래스 닫기

// 인스턴스 생성
const webServer = new WebServer();

module.exports = webServer;