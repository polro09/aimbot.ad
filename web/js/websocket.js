/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 웹소켓 통신 관리 - 수정 버전
 */

const WebSocketManager = {
    socket: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    reconnectTimeout: null,
    requestCallbacks: {}, // 요청에 대한 콜백 함수 저장
    messageHandlers: {}, // 메시지 타입별 핸들러
    isInitialized: false, // 초기화 상태 추적
    pendingCommands: {}, // 중복 요청 방지를 위한 커맨드 추적
    
    init: function() {
        if (this.isInitialized) return; // 중복 초기화 방지
        
        this.isInitialized = true;
        this.connect();
        
        // 인증 이벤트 리스너
        document.addEventListener('auth:login', () => {
            // 로그인 후 필요한 정보 요청
            this.requestDashboardData();
        });
        
        document.addEventListener('auth:logout', () => {
            // 로그아웃 시 웹소켓 재연결 (세션 초기화)
            this.reconnect();
        });
        
        // 기본 메시지 핸들러 등록
        this.registerMessageHandlers();
        
        console.log('WebSocketManager 초기화 완료');
    },
    
    connect: function() {
        // 웹소켓 프로토콜 결정 (HTTPS인 경우 WSS 사용)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        try {
            console.log(`웹소켓 연결 시도: ${wsUrl}`);
            this.socket = new WebSocket(wsUrl);
            
            this.socket.onopen = this.handleOpen.bind(this);
            this.socket.onmessage = this.handleMessage.bind(this);
            this.socket.onclose = this.handleClose.bind(this);
            this.socket.onerror = this.handleError.bind(this);
        } catch (error) {
            console.error('웹소켓 연결 오류:', error);
            this.scheduleReconnect();
        }
    },
    
    // websocket.js 파일의 WebSocketManager 객체 내 reconnect 함수 교체
reconnect: function() {
    if (this.socket) {
        try {
            this.socket.close();
        } catch (e) {
            console.error('소켓 닫기 오류:', e);
        }
    }
    
    // 더 안정적인 지수 백오프 방식 적용
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);
    
    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`웹소켓 재연결 시도 ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
            this.connect();
        } else {
            console.error('최대 재연결 시도 횟수 초과');
            // 사용자에게 새로고침 요청
            if (typeof Utilities !== 'undefined' && Utilities.showNotification) {
                Utilities.showNotification('서버 연결에 실패했습니다. 페이지를 새로고침 해주세요.', 'error');
            }
            // 5초 후 재시도 로직 초기화
            setTimeout(() => {
                this.reconnectAttempts = 0;
                this.connect();
            }, 5000);
        }
    }, delay);
},
    
    scheduleReconnect: function() {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
            this.reconnect();
        }, 3000);
    },
    
    handleOpen: function() {
        console.log('웹소켓 연결 성공');
        this.reconnectAttempts = 0; // 재연결 성공 시 카운터 초기화
        this.pendingCommands = {}; // 명령 추적 초기화
        
        // 초기 상태 요청
        this.requestInitialStatus();
    },
    
    handleMessage: function(event) {
        try {
            const message = JSON.parse(event.data);
            
            // 로깅 (디버깅용 - 메시지 타입만 로그)
            console.log('웹소켓 메시지 수신:', message.type || 'serverStatus');
            
            // 요청 ID가 있는 경우 해당 명령 완료 표시
            if (message.requestId && this.pendingCommands[message.requestId]) {
                delete this.pendingCommands[message.requestId];
            }
            
            // 메시지 타입 확인
            if (!message.type) {
                // 서버 상태 정보인 경우 (type이 없는 경우)
                message.type = 'serverStatus';
            }
            
            // 등록된 핸들러 호출
            if (this.messageHandlers[message.type]) {
                this.messageHandlers[message.type](message);
            } else {
                console.warn(`처리되지 않은 메시지 타입: ${message.type}`);
            }
            
            // 요청 ID가 있으면 콜백 실행
            if (message.requestId && this.requestCallbacks[message.requestId]) {
                this.requestCallbacks[message.requestId](message);
                delete this.requestCallbacks[message.requestId]; // 콜백 제거
            }
        } catch (error) {
            console.error('웹소켓 메시지 처리 오류:', error, event.data);
        }
    },
    
    handleClose: function(event) {
        console.log('웹소켓 연결 종료:', event.code, event.reason);
        
        if (event.code !== 1000) { // 정상 종료가 아닌 경우에만 재연결
            this.scheduleReconnect();
        }
    },
    
    handleError: function(error) {
        console.error('웹소켓 오류:', error);
        this.scheduleReconnect();
    },
    
    sendMessage: function(message, callback) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.error('웹소켓이 연결되지 않았습니다. 연결 상태:', this.socket ? this.socket.readyState : '소켓 없음');
            
            // 재연결 시도
            if (!this.reconnectTimeout) {
                this.scheduleReconnect();
            }
            
            // 연결된 후 메시지 재전송 처리
            const originalMessage = {...message};
            const originalCallback = callback;
            
            setTimeout(() => {
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    console.log('웹소켓 재연결 후 메시지 재전송:', originalMessage.command);
                    this.sendMessage(originalMessage, originalCallback);
                } else {
                    console.warn('재전송 실패: 웹소켓이 여전히 연결되지 않았습니다.');
                }
            }, 3000);
            
            return false;
        }
        
        // 중복 요청 방지
        const commandKey = message.command;
        if (commandKey && this.isCommandPending(commandKey, message)) {
            console.log(`명령 무시 (중복): ${commandKey}`);
            return false;
        }
        
        // 요청 ID 추가 (선택적)
        const requestId = Date.now().toString() + Math.random().toString(36).substring(2, 8);
        message.requestId = requestId;
        
        if (callback) {
            this.requestCallbacks[requestId] = callback;
        }
        
        // 명령 추적 설정
        if (commandKey) {
            this.trackCommand(commandKey, requestId, message);
        }
        
        try {
            console.log('웹소켓으로 메시지 전송:', message.command || 'unknown');
            this.socket.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('메시지 전송 오류:', error);
            
            // 명령 추적에서 제거
            if (commandKey) {
                this.untrackCommand(commandKey, requestId);
            }
            
            return false;
        }
    },
    
    // 명령이 이미 처리 중인지 확인
    isCommandPending: function(command, message) {
        // 특정 명령은 항상 허용 (중복 검사 안함)
        const alwaysAllowCommands = ['login', 'register', 'getUserChannels', 'assignChannel', 'unassignChannel'];
        if (alwaysAllowCommands.includes(command)) {
            return false;
        }
        
        // 초대 코드 생성/삭제는 매개변수로 비교
        if (command === 'generateInviteCode' || command === 'deleteInviteCode') {
            // 배열 형태로 저장된 명령들 체크
            const pendingCommands = this.pendingCommands[command] || [];
            return pendingCommands.some(item => {
                if (command === 'generateInviteCode' && item.message.code === message.code) {
                    return true;
                }
                if (command === 'deleteInviteCode' && item.message.code === message.code) {
                    return true;
                }
                return false;
            });
        }
        
        // 나머지 명령은 단순히 명령 이름으로 확인
        return this.pendingCommands[command] && this.pendingCommands[command].length > 0;
    },
    
    // 명령 추적에 추가
    trackCommand: function(command, requestId, message) {
        if (!this.pendingCommands[command]) {
            this.pendingCommands[command] = [];
        }
        
        this.pendingCommands[command].push({
            requestId,
            timestamp: Date.now(),
            message: message
        });
        
        // 일정 시간 후 명령 자동 제거 (10초)
        setTimeout(() => {
            this.untrackCommand(command, requestId);
        }, 10000);
    },
    
    // 명령 추적에서 제거
    untrackCommand: function(command, requestId) {
        if (this.pendingCommands[command]) {
            this.pendingCommands[command] = this.pendingCommands[command].filter(
                item => item.requestId !== requestId
            );
            
            if (this.pendingCommands[command].length === 0) {
                delete this.pendingCommands[command];
            }
        }
    },
    
    // 기본 메시지 핸들러 등록
    registerMessageHandlers: function() {
        // 로그인 응답
        this.messageHandlers['loginResult'] = (message) => {
            if (typeof AuthManager !== 'undefined' && AuthManager.handleLoginResponse) {
                AuthManager.handleLoginResponse(message);
            }
        };
        
        // 회원가입 결과
        this.messageHandlers['registerResult'] = (message) => {
            if (typeof AuthManager !== 'undefined' && AuthManager.handleRegisterResponse) {
                AuthManager.handleRegisterResponse(message);
            }
        };
        
        // 온라인 관리자 목록
        this.messageHandlers['onlineAdmins'] = (message) => {
            if (message.admins && typeof updateOnlineAdmins === 'function') {
                updateOnlineAdmins(message.admins);
            }
        };
        
        // 사용자 정보 업데이트
        this.messageHandlers['userInfoUpdate'] = (message) => {
            if (message.success && message.user && typeof AuthManager !== 'undefined') {
                // 사용자 정보 업데이트
                AuthManager.login(message.user);
                
                // 알림 표시
                Utilities.showNotification(message.message || '사용자 정보가 업데이트되었습니다.', 'success');
            } else {
                Utilities.showNotification(message.message || '사용자 정보 업데이트 실패', 'error');
            }
        };
        
        // 서버 상태 정보
        this.messageHandlers['serverStatus'] = (message) => {
            // 대시보드 페이지에 정보 업데이트
            if (typeof updateDashboardStatus === 'function') {
                updateDashboardStatus(message);
            }
            
            // 관리자 페이지에서도 봇 정보 업데이트를 위해 사용
            if (typeof updateBotInfo === 'function') {
                updateBotInfo(message);
            }
            
            // 상태 정보를 로컬 스토리지에 저장 (다른 곳에서 사용할 수 있도록)
            localStorage.setItem('botStatus', JSON.stringify(message));
        };
        
        // 에러 메시지 - 중복 메시지 방지 추가
        this.messageHandlers['error'] = (message) => {
            // 특정 오류 메시지 체크를 위한 변수
            const errorMsg = message.message || '';
            
            // 무시할 오류 메시지 패턴
            const ignorePatterns = [
                '봇 시작에 실패했습니다',
                '이미 할당된 채널입니다'
            ];
            
            // 해당 패턴이 있으면 무시
            if (ignorePatterns.some(pattern => errorMsg.includes(pattern))) {
                console.log('무시된 오류 메시지:', errorMsg);
                return;
            }
            
            Utilities.showNotification(errorMsg, 'error');
        };
        
        // 기본 정보 메시지 - 중복 처리 방지
        this.messageHandlers['info'] = (message) => {
            if (message.message) {
                // 최근 표시된 알림과 동일한 경우 무시
                const lastNotification = localStorage.getItem('lastNotification');
                const currentTime = Date.now();
                const lastTime = parseInt(localStorage.getItem('lastNotificationTime') || '0');
                
                // 3초 이내에 동일한 메시지가 표시된 경우 무시
                if (lastNotification === message.message && (currentTime - lastTime) < 3000) {
                    console.log('중복 알림 무시:', message.message);
                    return;
                }
                
                // 알림 표시 및 저장
                Utilities.showNotification(message.message, 'info');
                localStorage.setItem('lastNotification', message.message);
                localStorage.setItem('lastNotificationTime', currentTime.toString());
            }
        };
        
        // 모듈 상태 정보
        this.messageHandlers['moduleStatus'] = (message) => {
            if (message.moduleStatus && typeof updateModulesList === 'function') {
                updateModulesList(message.moduleStatus);
            }
        };
        
        // 사용자 설정 정보
        this.messageHandlers['userSettings'] = (message) => {
            if (message.settings && typeof updateUserSettings === 'function') {
                updateUserSettings(message.settings);
            }
        };
        
        // 채널 정보
        this.messageHandlers['channels'] = (message) => {
            // 채널 목록 로드 이벤트 발생
            const event = new CustomEvent('channels_loaded', { detail: message.channels });
            document.dispatchEvent(event);
        };
    },
    
    // 초기 상태 요청
    requestInitialStatus: function() {
        // 온라인 관리자 요청
        this.sendMessage({ command: 'getOnlineAdmins' });
    },
    
    // 대시보드 데이터 요청
    requestDashboardData: function() {
        if (typeof AuthManager !== 'undefined' && !AuthManager.isLoggedIn()) return;
        
        // 모듈 상태 요청 (1초 간격으로 순차 요청하여 서버 부하 방지)
        setTimeout(() => {
            this.sendMessage({ command: 'getModuleStatus' });
        }, 500);
        
        // 사용자 설정 요청
        setTimeout(() => {
            this.sendMessage({ command: 'getUserSettings' });
        }, 1000);
        
        // 서버 상태 요청
        setTimeout(() => {
            this.sendMessage({ command: 'getBotStatus' });
        }, 1500);
        
        // 온라인 관리자 요청
        setTimeout(() => {
            this.sendMessage({ command: 'getOnlineAdmins' });
        }, 2000);
    }
};

// 페이지 로드 시 웹소켓 관리자 초기화
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        WebSocketManager.init();
    }, 3000); // 로딩 애니메이션보다 일찍 초기화
});