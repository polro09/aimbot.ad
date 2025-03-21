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
    
    init: function() {
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
    },
    
    connect: function() {
        // 웹소켓 프로토콜 결정 (HTTPS인 경우 WSS 사용)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        try {
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
            this.socket.close();
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
            
            // 등록된 핸들러 호출
            if (this.messageHandlers[message.type]) {
                this.messageHandlers[message.type](message);
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
            console.error('웹소켓이 연결되지 않았습니다.');
            this.scheduleReconnect();
            return false;
        }
        
        // 요청 ID 추가 (선택적)
        if (callback) {
            const requestId = Date.now().toString();
            message.requestId = requestId;
            this.requestCallbacks[requestId] = callback;
        }
        
        try {
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
    }, 6000); // 로딩 애니메이션이 끝난 후
});