/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 웹소켓 통신 관리 (개선 버전)
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
            
            // 온라인 관리자 목록 요청
            this.sendMessage({ command: 'getOnlineAdmins' });
        });
        
        document.addEventListener('auth:logout', () => {
            // 로그아웃 시 웹소켓 재연결 (세션 초기화)
            this.reconnect();
        });
        
        // 기본 메시지 핸들러 등록
        this.registerMessageHandlers();
        
        // WebSocketManager 준비 완료 이벤트 발행
        const event = new CustomEvent('websocket_ready');
        document.dispatchEvent(event);
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
            if (message.type !== 'serverStatus') { // 상태 업데이트는 너무 많아서 로깅에서 제외
                console.log('웹소켓 메시지 수신:', message);
            }
            
            // 등록된 핸들러 호출
            if (this.messageHandlers[message.type]) {
                this.messageHandlers[message.type](message);
            }
            
            // 요청 ID가 있으면 콜백 실행
            if (message.requestId && this.requestCallbacks[message.requestId]) {
                this.requestCallbacks[message.requestId](message);
                delete this.requestCallbacks[message.requestId]; // 콜백 제거
            }
            
            // 범용 상태 업데이트 처리
            this.updateDashboardIfNeeded(message);
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
            AuthManager.handleLoginResponse(message);
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
        
        // 모듈 상태 업데이트
        this.messageHandlers['moduleStatusUpdate'] = (message) => {
            Utilities.showNotification(message.message, 'info');
            
            // 모듈 관리 페이지 업데이트
            if (typeof updateModulesList === 'function') {
                updateModulesList(message.moduleStatus);
            }
        };
        
        // 온라인 관리자 목록
        this.messageHandlers['onlineAdmins'] = (message) => {
            if (message.admins && typeof updateOnlineAdmins === 'function') {
                updateOnlineAdmins(message.admins);
            }
        };
        
        // 봇 시작/종료/재시작 응답
        this.messageHandlers['start-complete'] = (message) => {
            Utilities.showNotification(message.message, 'success');
        };
        
        this.messageHandlers['stop-complete'] = (message) => {
            Utilities.showNotification(message.message, 'info');
        };
        
        this.messageHandlers['restart-complete'] = (message) => {
            Utilities.showNotification(message.message, 'success');
        };
        
        // 실패 메시지들
        this.messageHandlers['start-failed'] = 
        this.messageHandlers['stop-failed'] = 
        this.messageHandlers['restart-failed'] = (message) => {
            Utilities.showNotification(message.message, 'error');
        };
        
        // 회원가입 결과
        this.messageHandlers['registerResult'] = (message) => {
            if (AuthManager.handleRegisterResponse) {
                AuthManager.handleRegisterResponse(message);
            }
        };
    },
    
    // 초기 상태 요청
    requestInitialStatus: function() {
        // 인증 설정 확인
        this.sendMessage({ command: 'getAuthConfig' });
        
        // 서버 상태 요청 (getBotInfo 대체)
        this.sendMessage({ command: 'start' });
    },
    
    // 대시보드 데이터 요청
    requestDashboardData: function() {
        if (!AuthManager.isLoggedIn()) return;
        
        // 모듈 상태 요청
        this.sendMessage({ command: 'getModuleStatus' });
        
        // 사용자 설정 요청
        this.sendMessage({ command: 'getUserSettings' });
        
        // 서버 상태 요청 (getBotInfo 대체)
        this.sendMessage({ command: 'start' });
        
        // 온라인 관리자 목록 요청
        this.sendMessage({ command: 'getOnlineAdmins' });
    },
    
    // 범용 상태 업데이트 처리
    updateDashboardIfNeeded: function(message) {
        // 봇 로그 업데이트가 포함된 경우
        if (message.logs) {
            // 로그 업데이트 함수가 있으면 호출
            if (typeof updateBotLogs === 'function') {
                updateBotLogs(message.logs);
            }
        }
        
        // 서버 목록이 포함된 경우
        if (message.servers) {
            // 서버 목록 업데이트 함수가 있으면 호출
            if (typeof updateServersList === 'function') {
                updateServersList(message.servers);
            }
        }
    }
};

// 페이지 로드 시 웹소켓 관리자 초기화
document.addEventListener('DOMContentLoaded', function() {
    // 로딩 완료 후 초기화
    setTimeout(() => {
        WebSocketManager.init();
    }, 6000); // 로딩 애니메이션이 끝난 후
});