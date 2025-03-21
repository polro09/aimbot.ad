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
            
        // ... 기타 명령어 처리 ...
        
        default:
            console.log(`미구현 명령: ${command}`);
            this._sendMessage(ws, {
                type: 'error',
                message: `지원되지 않는 명령: ${command}`
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

// 인스턴스 생성
const webServer = new WebServer();

module.exports = webServer;