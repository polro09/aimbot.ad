/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 웹소켓 통신 관리
 */

const WebSocketManager = {
    socket: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    reconnectTimeout: null,
    requestCallbacks: {}, // 요청에 대한 콜백 함수 저장
    messageHandlers: {}, // 메시지 타입별 핸들러
    isInitialized: false, // 초기화 상태 추적
    
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
    
    reconnect: function() {
        if (this.socket) {
            try {
                this.socket.close();
            } catch (e) {
                console.error('소켓 닫기 오류:', e);
            }
        }
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`웹소켓 재연결 시도 ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
            
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = setTimeout(() => {
                this.connect();
            }, Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)); // 지수 백오프 (최대 30초)
        } else {
            console.error('최대 재연결 시도 횟수 초과');
            Utilities.showNotification('서버 연결에 실패했습니다. 페이지를 새로고침 해주세요.', 'error');
        }
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
        
        // 초기 상태 요청
        this.requestInitialStatus();
    },
    
    handleMessage: function(event) {
        try {
            const message = JSON.parse(event.data);
            
            // 로깅 (디버깅용)
            console.log('웹소켓 메시지 수신:', message);
            
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
                    console.log('웹소켓 재연결 후 메시지 재전송:', originalMessage);
                    this.sendMessage(originalMessage, originalCallback);
                } else {
                    console.warn('재전송 실패: 웹소켓이 여전히 연결되지 않았습니다.');
                }
            }, 3000);
            
            return false;
        }
        
        // 요청 ID 추가 (선택적)
        if (callback) {
            const requestId = Date.now().toString() + Math.random().toString(36).substring(2, 8);
            message.requestId = requestId;
            this.requestCallbacks[requestId] = callback;
        }
        
        try {
            console.log('웹소켓으로 메시지 전송:', message);
            this.socket.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('메시지 전송 오류:', error);
            return false;
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
        
        // 에러 메시지
        this.messageHandlers['error'] = (message) => {
            Utilities.showNotification(message.message, 'error');
        };
        
        // 기본 정보 메시지
        this.messageHandlers['info'] = (message) => {
            if (message.message) {
                Utilities.showNotification(message.message, 'info');
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
        
        // 모듈 상태 요청
        this.sendMessage({ command: 'getModuleStatus' });
        
        // 사용자 설정 요청
        this.sendMessage({ command: 'getUserSettings' });
        
        // 서버 상태 요청
        this.sendMessage({ command: 'getBotStatus' });
        
        // 온라인 관리자 요청
        this.sendMessage({ command: 'getOnlineAdmins' });
    }
};

// 페이지 로드 시 웹소켓 관리자 초기화
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        WebSocketManager.init();
    }, 3000); // 로딩 애니메이션보다 일찍 초기화
});