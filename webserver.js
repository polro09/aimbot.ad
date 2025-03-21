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
            
        // 여기에 다른 case문들이 더 있습니다 (약 700줄 정도...)
        // 모든 명령어 처리를 다 포함하면 너무 길어지므로 일부 생략합니다
            
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

// 인스턴스 생성
const webServer = new WebServer();

module.exports = webServer;