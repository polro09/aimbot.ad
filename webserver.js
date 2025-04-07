// 상단에 로거 모듈 추가
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const config = require('./config');
const bot = require('./bot');
const storage = require('./storage');
const logger = require('./utils/logger');

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
    
    // _createServer 함수 내 console.log를 logger로 대체
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
            // 기존: console.log('HTTPS가 활성화되었습니다.');
            // 변경:
            logger.info('HTTPS가 활성화되었습니다.', 'WEB');
        } catch (error) {
            // 기존: console.error(`HTTPS 서버 생성 중 오류 발생: ${error.message}`);
            // 기존: console.log('HTTP 모드로 대체합니다.');
            // 변경:
            logger.error(`HTTPS 서버 생성 중 오류 발생: ${error.message}`, 'WEB');
            logger.info('HTTP 모드로 대체합니다.', 'WEB');
            this.server = http.createServer(this.app);
        }
    } else {
        // HTTP 서버 생성
        this.server = http.createServer(this.app);
        // 기존: console.log('HTTP 모드로 실행 중입니다.');
        // 변경:
        logger.info('HTTP 모드로 실행 중입니다.', 'WEB');
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
    
    // log 함수 수정
    log(type, message) {
        // 통합 로거 사용
        switch(type) {
            case 'ERROR':
                logger.error(message, null, 'WEB');
                break;
            case 'WARN':
                logger.warn(message, null, 'WEB');
                break;
            case 'INFO':
                logger.info(message, null, 'WEB');
                break;
            default:
                logger.info(message, type, 'WEB');
        }
    }
    
    // _handleWebSocketConnection 함수 내 console.log를 logger로 대체
_handleWebSocketConnection(ws) {
    // 연결 카운트 증가
    this.activeConnections++;
    // 기존: console.log(`웹 대시보드 연결됨 (총 연결: ${this.activeConnections})`);
    // 변경:
    logger.info(`웹 대시보드 연결됨 (총 연결: ${this.activeConnections})`, 'WEB');
        
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
    // 기존: console.log(`웹 대시보드 연결 종료됨 (남은 연결: ${this.activeConnections})`);
    // 변경:
    logger.info(`웹 대시보드 연결 종료됨 (남은 연결: ${this.activeConnections})`, 'WEB');
            
            // 사용자가 로그인 상태였다면 온라인 관리자 목록 업데이트
            if (ws.userSession && ws.userSession.isLoggedIn) {
                this._broadcastOnlineAdmins();
            }
        });
        
        // 봇 로그 이벤트 수신기 등록 - 이 부분은 중요하게 수정
    bot.onLog = (logEntry) => {
        // 이 부분에 logger.setWebSocketHandler 연결을 고려할 수 있음
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
        
        // ping 명령어 처리 추가
        if (command === 'ping') {
            // ping 요청에 즉시 pong으로 응답
            this._sendMessage(ws, {
                type: 'pong',
                timestamp: Date.now()
            });
            return; // 다른 처리 중단
        }
        
        // 명령어 로깅
        logger.info(`클라이언트로부터 받은 웹소켓 명령: ${command}`, 'WEB');
        
        // 관리자 권한이 필요한 명령어 목록
        const adminCommands = ['start', 'stop', 'restart', 'moduleAction', 'assignServer', 'unassignServer'];
        
        // 관리자 권한 확인 (단일 지점에서 모든 권한 검증)
        if (adminCommands.includes(command) && !ws.userSession.isAdmin) {
            return this._sendMessage(ws, {
                type: 'error',
                message: '관리자 권한이 필요합니다.'
            });
        }
        
        // 로그인이 필요한 명령어 목록
        const authCommands = [
            'getModuleStatus', 'getUserSettings', 'saveUserSettings', 
            'sendEmbed', 'getChannels', 'assignServer', 'unassignServer',
            'getUserChannels', 'getUserServers'
        ];
        
        // 로그인 확인 (단일 지점에서 모든 인증 검증)
        if (authCommands.includes(command) && !ws.userSession.isLoggedIn) {
            return this._sendMessage(ws, {
                type: 'error',
                message: '로그인이 필요합니다.'
            });
        }
        
        switch (command) {
            // ping/pong 처리 (통신 연결 확인용)
            case 'ping':
                // 연결 활성 상태 확인 (pong 응답)
                this._sendMessage(ws, {
                    type: 'pong',
                    timestamp: Date.now()
                });
                break;
                
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
                            const assignedChannels = storage.getUserChannels ? storage.getUserChannels(username) : [];
                            
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
                    
                    this.log('INFO', `회원가입 요청: ${username}, 초대 코드: ${inviteCode}`);
                    
                    // 유효성 검사
                    if (!username || typeof username !== 'string') {
                        this._sendMessage(ws, {
                            type: 'registerResult',
                            success: false,
                            message: '유효한 사용자명을 입력해주세요.'
                        });
                        return;
                    }
                    
                    if (!password || typeof password !== 'string') {
                        this._sendMessage(ws, {
                            type: 'registerResult',
                            success: false,
                            message: '유효한 비밀번호를 입력해주세요.'
                        });
                        return;
                    }
                    
                    if (!inviteCode || typeof inviteCode !== 'string') {
                        this._sendMessage(ws, {
                            type: 'registerResult',
                            success: false,
                            message: '유효한 초대 코드를 입력해주세요.'
                        });
                        return;
                    }
                    
                    // 초대 코드 유효성 확인
                    const isValidCode = await storage.isValidInviteCode(inviteCode);
                    if (!isValidCode) {
                        this.log('WARN', `유효하지 않은 초대 코드 사용 시도: ${inviteCode}, 사용자: ${username}`);
                        this._sendMessage(ws, {
                            type: 'registerResult',
                            success: false,
                            message: '유효하지 않은 초대 코드입니다. 다른 코드를 사용하거나 관리자에게 문의하세요.'
                        });
                        return;
                    }
                    
                    try {
                        // 사용자 생성
                        const user = await storage.createUser(username, password);
                        
                        // 초대 코드 사용 처리
                        await storage.useInviteCode(inviteCode, username);
                        
                        this.log('INFO', `회원가입 성공: ${username}, 초대 코드: ${inviteCode}`);
                        
                        // 등록 결과 전송 - 명확한 성공 상태 포함
                        this._sendMessage(ws, {
                            type: 'registerResult',
                            success: true,
                            message: '회원가입이 완료되었습니다. 로그인 해주세요.'
                        });
                    } catch (createError) {
                        this.log('ERROR', `사용자 생성 오류: ${createError.message}`);
                        this._sendMessage(ws, {
                            type: 'registerResult',
                            success: false,
                            message: createError.message || '회원가입에 실패했습니다. 다시 시도해주세요.'
                        });
                    }
                } catch (error) {
                    this.log('ERROR', `회원가입 처리 중 예외 발생: ${error.message}`);
                    this._sendMessage(ws, {
                        type: 'registerResult',
                        success: false,
                        message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
                    });
                }
                break;
                
            // 사용자 목록 요청 처리
            case 'getUsers':
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
                try {
                    const customCode = data.code || null;
                    const inviteCode = await storage.createInviteCode(customCode);
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '초대 코드가 생성되었습니다.',
                        inviteCode: inviteCode
                    });
                    
                    // 약간의 지연 후에 초대 코드 목록 업데이트 전송
                    setTimeout(() => {
                        this._broadcastInviteCodes();
                    }, 500);
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `초대 코드 생성 중 오류 발생: ${error.message}`
                    });
                }
                break;
                // 초대 코드 삭제 처리
            case 'deleteInviteCode':
                try {
                    const { code } = data;
                    await storage.deleteInviteCode(code);
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '초대 코드가 삭제되었습니다.'
                    });
                    
                    // 약간의 지연 후에 초대 코드 목록 업데이트 전송
                    setTimeout(() => {
                        this._broadcastInviteCodes();
                    }, 500);
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `초대 코드 삭제 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 사용자 추가 처리
            case 'addUser':
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
            
            // 서버 할당 처리 (이전의 채널 할당 대체)
            case 'assignServer':
                try {
                    const { username, serverId } = data;
                    
                    // 서버 이름 조회
                    let serverName = '알 수 없음';
                    
                    const botStatus = bot.getStatus();
                    if (botStatus.servers) {
                        const server = botStatus.servers.find(s => s.id === serverId);
                        if (server) {
                            serverName = server.name;
                        }
                    }
                    
                    // storage.js에 assignServerToUser 함수 호출
                    const assignedServers = storage.assignServerToUser ? 
                        await storage.assignServerToUser(username, serverId, serverName) : [];
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '서버가 할당되었습니다.',
                        servers: assignedServers
                    });
                    
                    // 서버 목록 업데이트
                    this._sendMessage(ws, {
                        type: 'userServers',
                        username,
                        servers: assignedServers
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `서버 할당 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 서버 할당 해제 처리
            case 'unassignServer':
                try {
                    const { username, serverId } = data;
                    
                    // storage.js에 구현된 함수 호출
                    const assignedServers = storage.unassignServerFromUser ? 
                        await storage.unassignServerFromUser(username, serverId) : [];
                    
                    this._sendMessage(ws, {
                        type: 'info',
                        message: '서버 할당이 해제되었습니다.',
                        servers: assignedServers
                    });
                    
                    // 서버 목록 업데이트
                    this._sendMessage(ws, {
                        type: 'userServers',
                        username,
                        servers: assignedServers
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `서버 할당 해제 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 사용자 서버 목록 요청 처리
            case 'getUserServers':
                try {
                    const { username } = data;
                    
                    // 관리자가 아니면 자신의 서버만 볼 수 있음
                    if (!ws.userSession.isAdmin && ws.userSession.username !== username) {
                        this._sendMessage(ws, {
                            type: 'error',
                            message: '권한이 없습니다.'
                        });
                        return;
                    }
                    
                    // storage.js에 구현된 함수 호출
                    const servers = storage.getUserServers ? storage.getUserServers(username) : [];
                    
                    this._sendMessage(ws, {
                        type: 'userServers',
                        username,
                        servers
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `사용자 서버 목록 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;

            // 채널 할당 처리
            case 'assignChannel':
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
                    
                    // 채널 할당 함수가 있는지 확인
                    if (typeof storage.assignChannelToUser === 'function') {
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
                    } else {
                        this._sendMessage(ws, {
                            type: 'error',
                            message: '채널 할당 기능이 구현되지 않았습니다.'
                        });
                    }
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `채널 할당 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 채널 할당 해제 처리
            case 'unassignChannel':
                try {
                    const { username, channelId } = data;
                    
                    // 채널 할당 해제 함수가 있는지 확인
                    if (typeof storage.unassignChannelFromUser === 'function') {
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
                    } else {
                        this._sendMessage(ws, {
                            type: 'error',
                            message: '채널 할당 해제 기능이 구현되지 않았습니다.'
                        });
                    }
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'error',
                        message: `채널 할당 해제 중 오류 발생: ${error.message}`
                    });
                }
                break;
            
            // 사용자 채널 목록 요청 처리
            case 'getUserChannels':
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
                    
                    // 채널 목록 가져오기 함수가 있는지 확인
                    const channels = typeof storage.getUserChannels === 'function' ? 
                        storage.getUserChannels(username) : [];
                    
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
                    // 상세 정보 여부 결정 (기본값: 상세)
                    const detailed = data.detailed !== false;
                    const moduleStatus = bot.getModuleStatus(detailed);
                    
                    this._sendMessage(ws, {
                        type: 'moduleStatus',
                        moduleStatus: moduleStatus
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
                try {
                    const { serverId } = data;
                    
                    // 봇을 통해 서버의 채널 목록 가져오기 (실제 구현 필요)
                    // 임시 응답으로 기본 채널 목록 반환
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
                try {
                    // 봇이 이미 실행 중인지 확인
                    if (bot.status.isRunning) {
                        // 조용히 무시하거나 성공 메시지 전송
                        this._sendMessage(ws, {
                            type: 'info',
                            message: '봇이 실행 중입니다.'
                        });
                        
                        // 상태 업데이트 전송
                        this._sendStatus(ws);
                        return;
                    }
                    
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
                // 봇 종료 처리
            case 'stop':
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
    }
    
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
    
    // start 함수에서 웹 서버 시작 메시지를 logger.startup으로 대체
async start() {
    // ... 기존 코드 ...
    
    return new Promise((resolve, reject) => {
        this.server.listen(PORT, config.host || '0.0.0.0', () => {
            const protocol = config.https && config.https.enabled ? 'https' : 'http';
            const host = config.host || '0.0.0.0';
            const localUrl = `${protocol}://localhost:${PORT}`;
            const domainUrl = config.domain ? 
                `${protocol}://${config.domain}` : 
                `${protocol}://${host === '0.0.0.0' ? '<서버IP>' : host}:${PORT}`;
            
            // 기존의 console.log 메시지들을 대체
            logger.startup({
                local: localUrl,
                domain: domainUrl,
                protocol: protocol.toUpperCase(),
                port: PORT
            });
            
            resolve(true);
        });
        
        this.server.on('error', (error) => {
            // 기존: console.error(`웹 서버 시작 중 오류 발생: ${error.message}`);
            // 변경:
            logger.error(`웹 서버 시작 중 오류 발생: ${error.message}`, 'WEB');
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
}

// 인스턴스 생성
const webServer = new WebServer();

module.exports = webServer;