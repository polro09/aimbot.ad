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
        

// 인스턴스 생성
const webServer = new WebServer();

module.exports = webServer;;
        
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
        
        switch (command) {
            // 봇 재시작 명령 처리
            case 'restart':
                // 로그인 상태 확인
                if (!ws.userSession.isLoggedIn) {
                    this._sendErrorMessage(ws, '인증이 필요합니다.');
                    return;
                }
                
                console.log('웹 대시보드에서 봇 재시작 명령을 받았습니다.');
                this._broadcastMessage({ 
                    type: 'restart',
                    message: '봇을 재시작 중입니다. 잠시 후 페이지를 새로고침 해주세요.'
                });
                
                try {
                    const success = await bot.restart();
                    
                    if (success) {
                        this._broadcastMessage({ 
                            type: 'restart-complete',
                            message: '봇이 성공적으로 재시작되었습니다.'
                        });
                    } else {
                        this._broadcastMessage({ 
                            type: 'restart-failed',
                            message: '봇 재시작에 실패했습니다.'
                        });
                    }
                } catch (error) {
                    this._broadcastMessage({ 
                        type: 'restart-failed',
                        message: `봇 재시작 실패: ${error.message}`
                    });
                }
                break;
                
            // 봇 시작 명령 처리
            case 'start':
                // 로그인 상태 확인
                if (!ws.userSession.isLoggedIn) {
                    this._sendErrorMessage(ws, '인증이 필요합니다.');
                    return;
                }
                
                console.log('웹 대시보드에서 봇 시작 명령을 받았습니다.');
                
                try {
                    // 봇이 실행 중이 아니면 시작
                    if (!bot.status.isRunning) {
                        const success = await bot.start();
                        
                        if (success) {
                            this._broadcastMessage({ 
                                type: 'start-complete',
                                message: '봇이 성공적으로 시작되었습니다.'
                            });
                        } else {
                            this._sendMessage(ws, { 
                                type: 'start-failed',
                                message: '봇 시작에 실패했습니다.'
                            });
                        }
                    } else {
                        this._sendMessage(ws, { 
                            type: 'info',
                            message: '봇이 이미 실행 중입니다.'
                        });
                    }
                } catch (error) {
                    this._sendMessage(ws, { 
                        type: 'start-failed',
                        message: `봇 시작 실패: ${error.message}`
                    });
                }
                break;
                
            // 봇 종료 명령 처리
            case 'stop':
                // 로그인 상태 확인
                if (!ws.userSession.isLoggedIn) {
                    this._sendErrorMessage(ws, '인증이 필요합니다.');
                    return;
                }
                
                console.log('웹 대시보드에서 봇 종료 명령을 받았습니다.');
                
                try {
                    // 봇이 실행 중이면 종료
                    if (bot.status.isRunning) {
                        const success = await bot.stop();
                        
                        if (success) {
                            this._broadcastMessage({ 
                                type: 'stop-complete',
                                message: '봇이 성공적으로 종료되었습니다.'
                            });
                        } else {
                            this._sendMessage(ws, { 
                                type: 'stop-failed',
                                message: '봇 종료에 실패했습니다.'
                            });
                        }
                    } else {
                        this._sendMessage(ws, { 
                            type: 'info',
                            message: '봇이 이미 종료되었습니다.'
                        });
                    }
                } catch (error) {
                    this._sendMessage(ws, { 
                        type: 'stop-failed',
                        message: `봇 종료 실패: ${error.message}`
                    });
                }
                break;
                
            // 채널 정보 요청 처리
            case 'getChannels':
                // 로그인 상태 확인
                if (!ws.userSession.isLoggedIn) {
                    this._sendErrorMessage(ws, '인증이 필요합니다.');
                    return;
                }
                
                console.log(`웹 대시보드에서 채널 정보 요청: 서버 ID ${data.serverId}`);
                
                try {
                    if (!data.serverId) {
                        throw new Error('서버 ID가 제공되지 않았습니다.');
                    }
                    
                    if (!bot.client) {
                        throw new Error('봇이 실행 중이 아닙니다.');
                    }
                    
                    // Guild 객체 가져오기
                    const guild = bot.client.guilds.cache.get(data.serverId);
                    if (!guild) {
                        throw new Error('해당 서버를 찾을 수 없습니다.');
                    }
                    
                    // 채널 목록 생성
                    const channels = guild.channels.cache.map(channel => ({
                        id: channel.id,
                        name: channel.name,
                        type: channel.type
                    }));
                    
                    // 채널 정보 전송
                    this._sendMessage(ws, {
                        type: 'channels',
                        serverId: data.serverId,
                        channels: channels
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'channels',
                        serverId: data.serverId,
                        channels: [],
                        error: error.message
                    });
                }
                break;
                
            // 임베드 전송 요청 처리
            case 'sendEmbed':
                // 로그인 상태 확인
                if (!ws.userSession.isLoggedIn) {
                    this._sendErrorMessage(ws, '인증이 필요합니다.');
                    return;
                }
                
                console.log(`웹 대시보드에서 임베드 전송 요청: 서버 ID ${data.serverId}, 채널 ID ${data.channelId}`);
                
                try {
                    if (!data.serverId || !data.channelId || !data.embed) {
                        throw new Error('필수 정보가 누락되었습니다.');
                    }
                    
                    if (!bot.client) {
                        throw new Error('봇이 실행 중이 아닙니다.');
                    }
                    
                    // Guild와 Channel 객체 가져오기
                    const guild = bot.client.guilds.cache.get(data.serverId);
                    if (!guild) {
                        throw new Error('해당 서버를 찾을 수 없습니다.');
                    }
                    
                    const channel = guild.channels.cache.get(data.channelId);
                    if (!channel) {
                        throw new Error('해당 채널을 찾을 수 없습니다.');
                    }
                    
                    // 임베드 객체 생성
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder();
                    
                    // 임베드 속성 설정
                    if (data.embed.title) embed.setTitle(data.embed.title);
                    if (data.embed.description) embed.setDescription(data.embed.description);
                    if (data.embed.color) embed.setColor(data.embed.color);
                    
                    // 작성자 설정
                    if (data.embed.author) {
                        embed.setAuthor({ name: data.embed.author });
                    }
                    
                    // 푸터 설정
                    if (data.embed.footer) {
                        embed.setFooter({ text: data.embed.footer.text });
                    }
                    
                    // 썸네일 설정
                    if (data.embed.thumbnail && data.embed.thumbnail.url) {
                        embed.setThumbnail(data.embed.thumbnail.url);
                    }
                    
                    // 이미지 설정
                    if (data.embed.image && data.embed.image.url) {
                        embed.setImage(data.embed.image.url);
                    }
                    
                    // 필드 추가
                    if (data.embed.fields && Array.isArray(data.embed.fields)) {
                        data.embed.fields.forEach(field => {
                            embed.addFields({ 
                                name: field.name, 
                                value: field.value, 
                                inline: field.inline 
                            });
                        });
                    }
                    
                    // 임베드 전송
                    await channel.send({ embeds: [embed] });
                    
                    // 성공 메시지 전송
                    this._sendMessage(ws, {
                        type: 'embedSent',
                        message: `채널 #${channel.name}에 임베드가 전송되었습니다.`
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'embedError',
                        message: error.message
                    });
                }
                break;
                
            // 인증 설정 요청 처리
            case 'getAuthConfig':
                // 인증 설정 정보 전송
                this._sendMessage(ws, {
                    type: 'authConfig',
                    config: {
                        username: config.auth.username,
                        password: config.auth.password
                    }
                });
                break;
                
            // 로그인 인증 요청 처리
            case 'login':
                const username = data.username;
                const password = data.password;
                
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
                break;
                
            // 회원가입 요청 처리
            case 'register':
                try {
                    const { inviteCode, username, password } = data;
                    
                    // 초대 코드 확인
                    if (!storage.isValidInviteCode(inviteCode)) {
                        throw new Error('유효하지 않은 초대 코드입니다.');
                    }
                    
                    // 사용자 생성
                    await storage.createUser(username, password);
                    
                    // 초대 코드 사용 처리
                    await storage.useInviteCode(inviteCode, username);
                    
                    this._sendMessage(ws, {
                        type: 'registerResult',
                        success: true,
                        message: '회원가입이 완료되었습니다. 로그인하여 서비스를 이용해주세요.'
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'registerResult',
                        success: false,
                        message: `회원가입 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 초대 코드 생성 요청 처리
            case 'generateInviteCode':
                // 관리자 권한 확인
                if (!ws.userSession.isAdmin) {
                    this._sendErrorMessage(ws, '관리자 권한이 필요합니다.');
                    return;
                }
                
                try {
                    const customCode = data.code || null;
                    const result = await storage.createInviteCode(customCode);
                    
                    this._sendMessage(ws, {
                        type: 'inviteCodeGenerated',
                        success: true,
                        code: result.code,
                        message: '초대 코드가 생성되었습니다.'
                    });
                    
                    // 초대 코드 목록 업데이트
                    this._broadcastInviteCodes();
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'inviteCodeError',
                        success: false,
                        message: `초대 코드 생성 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 초대 코드 삭제 요청 처리
            case 'deleteInviteCode':
                // 관리자 권한 확인
                if (!ws.userSession.isAdmin) {
                    this._sendErrorMessage(ws, '관리자 권한이 필요합니다.');
                    return;
                }
                
                try {
                    const { code } = data;
                    await storage.deleteInviteCode(code);
                    
                    this._sendMessage(ws, {
                        type: 'inviteCodeDeleted',
                        success: true,
                        message: '초대 코드가 삭제되었습니다.'
                    });
                    
                    // 초대 코드 목록 업데이트
                    this._broadcastInviteCodes();
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'inviteCodeError',
                        success: false,
                        message: `초대 코드 삭제 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 초대 코드 목록 요청 처리
            case 'getInviteCodes':
                // 관리자 권한 확인
                if (!ws.userSession.isAdmin) {
                    this._sendErrorMessage(ws, '관리자 권한이 필요합니다.');
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
                        type: 'inviteCodeError',
                        success: false,
                        message: `초대 코드 목록 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 사용자 목록 요청 처리
            case 'getUsers':
                // 관리자 권한 확인
                if (!ws.userSession.isAdmin) {
                    this._sendErrorMessage(ws, '관리자 권한이 필요합니다.');
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
                        type: 'usersError',
                        success: false,
                        message: `사용자 목록 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 사용자 삭제 요청 처리
            case 'deleteUser':
                // 관리자 권한 확인
                if (!ws.userSession.isAdmin) {
                    this._sendErrorMessage(ws, '관리자 권한이 필요합니다.');
                    return;
                }
                
                try {
                    const { username } = data;
                    
                    // 자기 자신은 삭제 불가
                    if (username === config.auth.username) {
                        throw new Error('기본 관리자 계정은 삭제할 수 없습니다.');
                    }
                    
                    await storage.deleteUser(username);
                    
                    this._sendMessage(ws, {
                        type: 'userDeleted',
                        success: true,
                        message: '사용자가 삭제되었습니다.'
                    });
                    
                    // 사용자 목록 업데이트
                    this._broadcastUsersList();
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'usersError',
                        success: false,
                        message: `사용자 삭제 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 사용자 비밀번호 초기화 요청 처리
            case 'resetUserPassword':
                // 관리자 권한 확인
                if (!ws.userSession.isAdmin) {
                    this._sendErrorMessage(ws, '관리자 권한이 필요합니다.');
                    return;
                }
                
                try {
                    const { username, newPassword } = data;
                    
                    await storage.resetUserPassword(username, newPassword);
                    
                    this._sendMessage(ws, {
                        type: 'passwordReset',
                        success: true,
                        message: '사용자 비밀번호가 초기화되었습니다.'
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'usersError',
                        success: false,
                        message: `비밀번호 초기화 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 모듈 작업 요청 처리
            case 'moduleAction':
                // 로그인 상태 확인
                if (!ws.userSession.isLoggedIn) {
                    this._sendErrorMessage(ws, '인증이 필요합니다.');
                    return;
                }
                
                console.log(`웹 대시보드에서 모듈 작업 요청: ${data.action} - ${data.moduleName}`);
                
                try {
                    if (!data.action || !data.moduleName) {
                        throw new Error('작업 유형과 모듈 이름은 필수입니다.');
                    }
                    
                    const success = await bot.moduleAction(data.action, data.moduleName);
                    
                    if (success) {
                        this._broadcastMessage({
                            type: 'moduleStatusUpdate',
                            message: `모듈 ${data.moduleName}에 대한 ${data.action} 작업이 성공했습니다.`,
                            moduleStatus: bot.getModuleStatus()
                        });
                    } else {
                        this._sendMessage(ws, {
                            type: 'moduleError',
                            message: `모듈 ${data.moduleName}에 대한 ${data.action} 작업이 실패했습니다.`
                        });
                    }
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'moduleError',
                        message: error.message
                    });
                }
                break;
                
            // 사용자 설정 가져오기
            case 'getUserSettings':
                const userSettings = bot.getUserSettings();
                this._sendMessage(ws, {
                    type: 'userSettings',
                    settings: userSettings
                });
                break;
                
            // 사용자 설정 저장
            case 'saveUserSettings':
                // 로그인 상태 확인
                if (!ws.userSession.isLoggedIn) {
                    this._sendErrorMessage(ws, '인증이 필요합니다.');
                    return;
                }
                
                console.log('웹 대시보드에서 사용자 설정 저장 요청');
                
                try {
                    if (!data.settings) {
                        throw new Error('설정 정보가 제공되지 않았습니다.');
                    }
                    
                    const success = await bot.saveUserSettings(data.settings);
                    
                    if (success) {
                        this._broadcastMessage({
                            type: 'userSettingsUpdate',
                            message: '사용자 설정이 성공적으로 저장되었습니다.',
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
                        message: error.message
                    });
                }
                break;
            
            // 모듈 상태 가져오기
            case 'getModuleStatus':
                console.log('웹 대시보드에서 모듈 상태 요청');
                try {
                    const moduleStatus = bot.getModuleStatus();
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
                
            // 사용자 역할 업데이트 요청 처리
            case 'updateUserRole':
                // 관리자 권한 확인
                if (!ws.userSession.isAdmin) {
                    this._sendErrorMessage(ws, '관리자 권한이 필요합니다.');
                    return;
                }
                
                console.log(`웹 대시보드에서 사용자 역할 업데이트 요청: ${data.username} -> ${data.role}`);
                
                try {
                    if (!data.username || !data.role) {
                        throw new Error('사용자명과 역할은 필수입니다.');
                    }
                    
                    // 역할 검증
                    const validRoles = ['level1', 'level2', 'level3', 'user'];
                    if (!validRoles.includes(data.role)) {
                        throw new Error('유효하지 않은 역할입니다.');
                    }
                    
                    // 사용자 역할 업데이트
                    await storage.updateUserRole(data.username, data.role);
                    
                    this._sendMessage(ws, {
                        type: 'userRoleUpdated',
                        success: true,
                        message: '사용자 역할이 업데이트되었습니다.',
                        username: data.username,
                        role: data.role
                    });
                    
                    // 사용자 목록 새로고침
                    this._broadcastUsersList();
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'userRoleError',
                        success: false,
                        message: `역할 업데이트 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 채널 할당 요청 처리
            case 'assignChannel':
                // 관리자 권한 확인
                if (!ws.userSession.isAdmin) {
                    this._sendErrorMessage(ws, '관리자 권한이 필요합니다.');
                    return;
                }
                
                console.log(`웹 대시보드에서 채널 할당 요청: ${data.username} -> ${data.channelId}`);
                
                try {
                    if (!data.username || !data.serverId || !data.channelId) {
                        throw new Error('사용자명, 서버 ID, 채널 ID는 필수입니다.');
                    }
                    
                    // 채널 정보 가져오기
                    const guild = bot.client.guilds.cache.get(data.serverId);
                    const channel = guild.channels.cache.get(data.channelId);
                    
                    if (!guild || !channel) {
                        throw new Error('서버 또는 채널을 찾을 수 없습니다.');
                    }
                    
                    // 채널 할당
                    await storage.assignChannelToUser(
                        data.username, 
                        data.serverId, 
                        data.channelId, 
                        guild.name, 
                        channel.name
                    );
                    
                    this._sendMessage(ws, {
                        type: 'channelAssigned',
                        success: true,
                        message: '채널이 성공적으로 할당되었습니다.',
                        username: data.username
                    });
                    
                    // 할당된 채널 목록 새로고침
                    const userChannels = storage.getUserChannels(data.username);
                    this._sendMessage(ws, {
                        type: 'userChannels',
                        username: data.username,
                        channels: userChannels
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'channelAssignError',
                        success: false,
                        message: `채널 할당 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 채널 할당 해제 요청 처리
            case 'unassignChannel':
                // 관리자 권한 확인
                if (!ws.userSession.isAdmin) {
                    this._sendErrorMessage(ws, '관리자 권한이 필요합니다.');
                    return;
                }
                
                console.log(`웹 대시보드에서 채널 할당 해제 요청: ${data.username} -> ${data.channelId}`);
                
                try {
                    if (!data.username || !data.channelId) {
                        throw new Error('사용자명과 채널 ID는 필수입니다.');
                    }
                    
                    // 채널 할당 해제
                    await storage.unassignChannelFromUser(data.username, data.channelId);
                    
                    this._sendMessage(ws, {
                        type: 'channelUnassigned',
                        success: true,
                        message: '채널 할당이 해제되었습니다.',
                        username: data.username
                    });
                    
                    // 할당된 채널 목록 새로고침
                    const userChannels = storage.getUserChannels(data.username);
                    this._sendMessage(ws, {
                        type: 'userChannels',
                        username: data.username,
                        channels: userChannels
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'channelUnassignError',
                        success: false,
                        message: `채널 할당 해제 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 사용자 채널 목록 요청 처리
            case 'getUserChannels':
                try {
                    if (!data.username) {
                        throw new Error('사용자명은 필수입니다.');
                    }
                    
                    // 사용자 채널 목록 가져오기
                    const userChannels = storage.getUserChannels(data.username);
                    
                    this._sendMessage(ws, {
                        type: 'userChannels',
                        username: data.username,
                        channels: userChannels
                    });
                } catch (error) {
                    this._sendMessage(ws, {
                        type: 'userChannelsError',
                        success: false,
                        message: `채널 목록 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            // 온라인 관리자 목록 요청 처리
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
                        type: 'onlineAdminsError',
                        success: false,
                        message: `온라인 관리자 목록 조회 중 오류 발생: ${error.message}`
                    });
                }
                break;
                
            default:
                console.log(`알 수 없는 명령: ${command}`);
                this._sendMessage(ws, {
                    type: 'error',
                    message: `알 수 없는 명령: ${command}`
                });
                break;
        }
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
}