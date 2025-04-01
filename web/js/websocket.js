/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 개선된 웹소켓 통신 관리 시스템
 */

const WebSocketManager = {
    socket: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10, // 최대 재연결 시도 횟수 증가
    reconnectTimeout: null,
    requestCallbacks: {}, // 요청에 대한 콜백 함수 저장
    messageHandlers: {}, // 메시지 타입별 핸들러
    isInitialized: false, // 초기화 상태 추적
    pendingCommands: {}, // 중복 요청 방지를 위한 커맨드 추적
    commandThrottles: {}, // 명령어 쓰로틀링
    isReconnecting: false, // 재연결 진행 상태
    baseReconnectDelay: 1000, // 기본 재연결 지연 시간 (1초)
    heartbeatInterval: null, // 하트비트 인터벌
    
    // 초기화
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
        
        // 페이지 가시성 변경 이벤트 리스너 (탭 전환 감지)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                // 페이지가 다시 보일 때 연결 확인
                this.checkConnection();
            }
        });
        
        // 네트워크 연결 상태 변경 이벤트 리스너
        window.addEventListener('online', () => {
            console.log('네트워크 연결 감지됨');
            this.checkConnection();
        });
        
        // 로딩 화면이 종료된 후 연결 상태 확인
        document.addEventListener('loadingComplete', () => {
            // 약간의 지연 후 연결 상태 확인 (로딩 애니메이션과 충돌 방지)
            setTimeout(() => {
                this.checkConnection();
            }, 500);
        });
        
        // 페이지 변경 이벤트 리스너
        document.addEventListener('page_changed', (e) => {
            // 페이지가 변경되면 새 페이지에 필요한 데이터 요청
            setTimeout(() => {
                this.requestDashboardData();
            }, 300);
        });
        
        console.log('WebSocketManager 초기화 완료');
    },
    
    // 연결 상태 확인 함수 - 개선됨
    checkConnection: function() {
        // 연결이 끊어진 상태에서 네트워크가 복구되면 재연결 시도
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.log('연결이 끊어진 상태 감지. 재연결 시도...');
            
            // 로그인/회원가입 모달이 열려있으면 메시지 표시
            const loginModal = document.getElementById('login-modal');
            const registerModal = document.getElementById('register-modal');
            
            if ((loginModal && loginModal.style.display === 'block') ||
                (registerModal && registerModal.style.display === 'block')) {
                
                const loginMsg = document.querySelector('.login-message');
                const registerMsg = document.querySelector('.register-message');
                
                if (loginModal && loginModal.style.display === 'block' && loginMsg) {
                    loginMsg.textContent = '서버 연결이 끊어졌습니다. 재연결 중...';
                }
                
                if (registerModal && registerModal.style.display === 'block' && registerMsg) {
                    registerMsg.textContent = '서버 연결이 끊어졌습니다. 재연결 중...';
                }
            }
            
            this.reconnect();
        } else {
            // 연결 상태이면 상태 요청으로 활성 상태 유지
            this.sendMessage({ command: 'ping' });
            
            // 로그인/회원가입 모달 메시지 초기화
            const loginMsg = document.querySelector('.login-message');
            const registerMsg = document.querySelector('.register-message');
            
            if (loginMsg && loginMsg.textContent.includes('서버 연결이 끊어졌습니다')) {
                loginMsg.textContent = '';
            }
            
            if (registerMsg && registerMsg.textContent.includes('서버 연결이 끊어졌습니다')) {
                registerMsg.textContent = '';
            }
            
            // 대시보드 데이터도 요청
            if (window.location.hash === '#dashboard') {
                this.sendMessage({ command: 'getBotStatus' });
            }
        }
    },

    connect: function() {
        // 이미 재연결 중이면 중복 연결 방지
        if (this.isReconnecting) {
            console.log('이미 재연결 진행 중입니다.');
            return;
        }
        
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
    
    // 웹소켓 재연결 - 지수 백오프 적용
    reconnect: function() {
        // 이미 재연결 중이면 중복 처리 방지
        if (this.isReconnecting) {
            console.log('이미 재연결 진행 중입니다.');
            return;
        }
        
        this.isReconnecting = true;
        
        if (this.socket) {
            try {
                this.socket.close();
            } catch (e) {
                console.error('소켓 닫기 오류:', e);
            }
        }
        
        // 지수 백오프 방식으로 재연결 지연 시간 계산
        // 1초, 2초, 4초, 8초, 16초... 최대 2분까지
        const delay = Math.min(
            this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
            120000 // 최대 2분
        );
        
        console.log(`재연결 대기 중... ${delay/1000}초 후 시도 (시도 ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
        
        // 사용자에게 재연결 시도 중임을 알림 (첫 시도에만)
        if (this.reconnectAttempts === 0 && typeof Utilities !== 'undefined' && Utilities.showNotification) {
            Utilities.showNotification('서버 연결이 끊어졌습니다. 재연결을 시도합니다...', 'warning');
        }
        
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                this.connect();
                this.isReconnecting = false; // 재연결 시도 플래그 초기화
            } else {
                console.error('최대 재연결 시도 횟수 초과');
                // 사용자에게 새로고침 요청
                if (typeof Utilities !== 'undefined' && Utilities.showNotification) {
                    Utilities.showNotification('서버 연결에 실패했습니다. 페이지를 새로고침 해주세요.', 'error');
                }
                // 1분 후 재시도 로직 초기화 (완전 포기하지 않음)
                setTimeout(() => {
                    this.reconnectAttempts = 0;
                    this.isReconnecting = false;
                    this.connect();
                }, 60000);
            }
        }, delay);
    },
    
    scheduleReconnect: function() {
        if (this.isReconnecting) return;
        
        this.isReconnecting = true;
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
            this.reconnect();
            this.isReconnecting = false;
        }, 1000); // 첫 시도는 1초 후
    },
    
    handleOpen: function() {
        console.log('웹소켓 연결 성공');
        this.reconnectAttempts = 0; // 재연결 성공 시 카운터 초기화
        this.pendingCommands = {}; // 명령 추적 초기화
        this.commandThrottles = {}; // 쓰로틀 초기화
        this.isReconnecting = false; // 재연결 상태 초기화
        
        // 연결 성공 알림 (재연결인 경우에만)
        if (this.reconnectAttempts > 0 && typeof Utilities !== 'undefined' && Utilities.showNotification) {
            Utilities.showNotification('서버에 다시 연결되었습니다.', 'success');
        }
        
        // 초기 상태 요청 - 필요한 기본 정보만 요청
        this.requestInitialStatus();
        
        // 실패했던 펜딩 명령 재시도
        this.retryPendingCommands();
    },
    
    // 실패했던 명령 재시도
    retryPendingCommands: function() {
        // 로컬 스토리지에서 저장된 실패 명령 가져오기
        const pendingCommandsStr = localStorage.getItem('pendingCommands');
        if (!pendingCommandsStr) return;
        
        try {
            const pendingCommands = JSON.parse(pendingCommandsStr);
            console.log(`재연결 후 ${pendingCommands.length}개의 실패 명령 재시도`);
            
            // 명령 재전송 (간격을 두고)
            pendingCommands.forEach((cmd, index) => {
                setTimeout(() => {
                    this.sendMessage(cmd);
                }, index * 300); // 300ms 간격으로 재시도
            });
            
            // 실패 명령 목록 초기화
            localStorage.removeItem('pendingCommands');
        } catch (error) {
            console.error('실패 명령 재시도 중 오류:', error);
            localStorage.removeItem('pendingCommands');
        }
    },
    
    // 중요 명령 저장 (연결 끊김 시 재시도용)
    savePendingCommand: function(command) {
        // 중요 명령만 저장 (예: 설정 저장, 모듈 활성화/비활성화)
        const importantCommands = [
            'saveUserSettings', 'moduleAction', 'start', 'stop', 
            'restart', 'assignServer', 'unassignServer', 'sendEmbed'
        ];
        
        if (!importantCommands.includes(command.command)) return;
        
        try {
            let pendingCommands = [];
            const pendingCommandsStr = localStorage.getItem('pendingCommands');
            
            if (pendingCommandsStr) {
                pendingCommands = JSON.parse(pendingCommandsStr);
            }
            
            // 같은 명령이 있으면 제거 (중복 방지)
            pendingCommands = pendingCommands.filter(cmd => 
                cmd.command !== command.command || 
                JSON.stringify(cmd) !== JSON.stringify(command)
            );
            
            // 명령 추가
            pendingCommands.push(command);
            
            // 최대 10개까지만 저장
            if (pendingCommands.length > 10) {
                pendingCommands = pendingCommands.slice(-10);
            }
            
            // 로컬 스토리지에 저장
            localStorage.setItem('pendingCommands', JSON.stringify(pendingCommands));
        } catch (error) {
            console.error('명령 저장 중 오류:', error);
        }
    },
    
    handleMessage: function(event) {
        try {
            const message = JSON.parse(event.data);
            
            // 로깅 (디버깅용 - 메시지 타입만 로그)
            if (message.type && message.type !== 'serverStatus') {
                console.log('웹소켓 메시지 수신:', message.type);
            }
            
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
    
    // 명령어 쓰로틀 체크 - 수정: 봇 제어 명령어는 쓰로틀링 없앰
    isThrottled: function(command) {
        // 봇 제어 관련 명령은 쓰로틀링하지 않음
        if (['start', 'stop', 'restart'].includes(command)) {
            return false;
        }
        
        const now = Date.now();
        const throttleTime = {
            'getBotStatus': 2000,   // 상태 요청 (2초)
            'getModuleStatus': 2000, // 모듈 상태 요청 (2초)
            'moduleAction': 2000,   // 모듈 작업 (2초)
            'sendEmbed': 3000       // 임베드 전송 (3초)
        };
        
        // 명령어에 대한 쓰로틀 시간 설정
        const throttleMs = throttleTime[command] || 1000; // 기본 1초
        
        // 이전 요청 시간 확인
        const lastTime = this.commandThrottles[command] || 0;
        
        // 쓰로틀 검사
        if (now - lastTime < throttleMs) {
            return true; // 쓰로틀링 필요
        }
        
        // 시간 갱신
        this.commandThrottles[command] = now;
        return false; // 쓰로틀링 필요 없음
    },
    
    sendMessage: function(message, callback) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.error('웹소켓이 연결되지 않았습니다. 연결 상태:', this.socket ? this.socket.readyState : '소켓 없음');
            
            // 중요 명령어 저장 (재연결 후 재시도)
            this.savePendingCommand(message);
            
            // 재연결 시도
            if (!this.isReconnecting) {
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
        
        // 명령어 쓰로틀 검사 (시간 기반) - 봇 제어 명령어는 무시
        if (this.isThrottled(message.command)) {
            console.log(`명령어 쓰로틀링 적용: ${message.command}`);
            
            // 콜백 강제 호출 (가짜 응답)
            if (callback && ['getBotStatus', 'getModuleStatus'].includes(message.command)) {
                // 로컬 스토리지에서 최근 상태 가져오기
                const cachedStatus = localStorage.getItem('botStatus');
                if (cachedStatus) {
                    setTimeout(() => {
                        callback(JSON.parse(cachedStatus));
                    }, 100);
                }
            }
            
            return false;
        }
        
        // 중복 요청 방지 - 봇 제어 명령어는 중복 검사 무시
        const commandKey = message.command;
        if (commandKey && !['start', 'stop', 'restart'].includes(commandKey) && this.isCommandPending(commandKey, message)) {
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
            // 봇 제어 명령어의 경우만 따로 로깅
            if (['start', 'stop', 'restart'].includes(commandKey)) {
                console.log(`봇 제어 명령 전송: ${commandKey}`);
            }
            
            this.socket.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('메시지 전송 오류:', error);
            
            // 중요 명령어 저장
            this.savePendingCommand(message);
            
            // 명령 추적에서 제거
            if (commandKey) {
                this.untrackCommand(commandKey, requestId);
            }
            
            // 연결 오류인 경우 재연결 시도
            if (error.name === 'NetworkError' || error.message.includes('network')) {
                this.scheduleReconnect();
            }
            
            return false;
        }
    },
    
    // 명령이 이미 처리 중인지 확인
    isCommandPending: function(command, message) {
        // 특정 명령은 항상 허용 (중복 검사 안함)
        const alwaysAllowCommands = ['login', 'register', 'getUserChannels', 'assignChannel', 'unassignChannel', 'start', 'stop', 'restart'];
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
        
        // 회원가입 결과 - 개선됨
    this.messageHandlers['registerResult'] = (message) => {
        console.log('회원가입 응답 수신:', message);
        
        if (typeof AuthManager !== 'undefined' && AuthManager.handleRegisterResponse) {
            AuthManager.handleRegisterResponse(message);
        } else {
            console.warn('AuthManager가 정의되지 않았거나 handleRegisterResponse 함수가 없습니다.');
            
            // 기본 알림 표시
            if (typeof Utilities !== 'undefined' && Utilities.showNotification) {
                if (message.success) {
                    Utilities.showNotification(
                        message.message || '회원가입이 완료되었습니다. 로그인 해주세요.', 
                        'success'
                    );
                } else {
                    Utilities.showNotification(
                        message.message || '회원가입에 실패했습니다.', 
                        'error'
                    );
                }
            }
        }
    };
        
        // 온라인 관리자 목록
    this.messageHandlers['onlineAdmins'] = (message) => {
        if (message.admins && typeof updateOnlineAdmins === 'function') {
            updateOnlineAdmins(message.admins);
        }
    };
    
    // 초대 코드 관련 응답 - 추가됨
    this.messageHandlers['inviteCodeResult'] = (message) => {
        console.log('초대 코드 응답 수신:', message);
        
        if (typeof Utilities !== 'undefined' && Utilities.showNotification) {
            if (message.success) {
                Utilities.showNotification(
                    message.message || '초대 코드 작업이 완료되었습니다.', 
                    'success'
                );
            } else {
                Utilities.showNotification(
                    message.message || '초대 코드 작업 실패', 
                    'error'
                );
            }
        }
    };
        
       // 사용자 정보 업데이트
    this.messageHandlers['userInfoUpdate'] = (message) => {
        if (message.success && message.user && typeof AuthManager !== 'undefined') {
            // 사용자 정보 업데이트
            AuthManager.login(message.user);
            
            // 알림 표시
            if (typeof Utilities !== 'undefined' && Utilities.showNotification) {
                Utilities.showNotification(
                    message.message || '사용자 정보가 업데이트되었습니다.', 
                    'success'
                );
            }
        } else {
            if (typeof Utilities !== 'undefined' && Utilities.showNotification) {
                Utilities.showNotification(
                    message.message || '사용자 정보 업데이트 실패', 
                    'error'
                );
            }
        }
    };
        
        // 서버 상태 메시지 핸들러 - 수정: 봇 상태 메시지 중복 알림 제거
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
            
            // 재연결 시도 후 성공한 경우 성공 메시지 표시
            if (this.reconnectAttempts > 0) {
                this.reconnectAttempts = 0; // 재연결 성공 시 카운터 초기화
                if (typeof Utilities !== 'undefined' && Utilities.showNotification) {
                    Utilities.showNotification('서버 연결이 복원되었습니다', 'success');
                }
            }
        };
        
        // 오류 메시지 - 개선됨
    this.messageHandlers['error'] = (message) => {
        const errorMsg = message.message || '';
        
        // 무시할 오류 메시지 패턴
        const ignorePatterns = [
            '봇 시작에 실패했습니다',
            '봇이 이미 실행 중입니다',
            '이미 할당된 채널입니다',
            '모듈 재로드 중',
            '봇이 실행 중입니다',
            '봇이 실행 중이 아닙니다',
            '권한이 필요합니다'
        ];
        
        // 해당 패턴이 있으면 무시
        if (ignorePatterns.some(pattern => errorMsg.includes(pattern))) {
            console.log('무시된 오류 메시지:', errorMsg);
            return;
        }
        
        // 인증 관련 오류는 특별히 처리
        if (errorMsg.includes('로그인') || 
            errorMsg.includes('비밀번호') || 
            errorMsg.includes('회원가입') || 
            errorMsg.includes('초대 코드')) {
            
            // 로그인 모달이 열려있는 경우
            const loginModal = document.getElementById('login-modal');
            const registerModal = document.getElementById('register-modal');
            
            if ((loginModal && loginModal.style.display === 'block') ||
                (registerModal && registerModal.style.display === 'block')) {
                
                // 모달 메시지 업데이트 (중복 알림 방지)
                const loginMsg = document.querySelector('.login-message');
                const registerMsg = document.querySelector('.register-message');
                
                if (loginModal && loginModal.style.display === 'block' && loginMsg) {
                    loginMsg.textContent = errorMsg;
                    return;
                }
                
                if (registerModal && registerModal.style.display === 'block' && registerMsg) {
                    registerMsg.textContent = errorMsg;
                    return;
                }
            }
        }
        
        if (typeof Utilities !== 'undefined' && Utilities.showNotification) {
            Utilities.showNotification(errorMsg, 'error');
        }
    };
        
        // 기본 정보 메시지 - 중복 처리 방지 개선
        this.messageHandlers['info'] = (message) => {
            if (message.message) {
                // 무시할 메시지 패턴
                const ignorePatterns = [
                    '봇이 실행 중입니다',
                    '봇이 시작되었습니다',
                    '봇이 이미 실행',
                    '봇이 정지되었습니다',
                    '봇이 재시작되었습니다'
                ];
                
                // 해당 패턴이 있으면 무시
                if (ignorePatterns.some(pattern => message.message.includes(pattern))) {
                    console.log('무시된 정보 메시지:', message.message);
                    
                    // 봇 상태 요청
                    setTimeout(() => {
                        this.sendMessage({ command: 'getBotStatus' });
                    }, 500);
                    
                    return;
                }
                
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
        
        // 모듈 상태 정보 - 응답 속도 개선
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
        
        // 사용자 서버 목록
        this.messageHandlers['userServers'] = (message) => {
            // 사용자 서버 목록 이벤트 발생
            if (typeof updateServersList === 'function' && message.username && message.servers) {
                updateServersList(message.username, message.servers);
            }
        };
        
        // 연결 전환 감지
        this.messageHandlers['pong'] = (message) => {
            // 서버로부터 pong 응답 받음 - 연결 활성 상태 확인
            console.log('서버 연결 확인됨 (pong 응답)');
            // 연결 상태 정상화 시 재연결 시도 카운터 초기화
            this.reconnectAttempts = 0;
        };
    },

    // 초기 상태 요청 - 최적화
    requestInitialStatus: function() {
        // 온라인 관리자 요청
        this.sendMessage({ command: 'getOnlineAdmins' });
        
        // 봇 상태 요청 - 페이지에 관계없이 항상 요청
        setTimeout(() => {
            this.sendMessage({ command: 'getBotStatus' });
        }, 200);
        
        // 주기적 연결 상태 확인 설정 (ping/pong)
        this.setupHeartbeat();
    },
    
    // 서버 연결 상태 확인을 위한 하트비트 설정
    setupHeartbeat: function() {
        // 기존 인터벌 제거
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        // 매 30초마다 서버에 상태 요청 (간단한 ping/pong)
        this.heartbeatInterval = setInterval(() => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.sendMessage({ command: 'ping' });
            } else {
                // 연결이 끊어진 경우 재연결 시도
                this.checkConnection();
            }
        }, 30000);
    },

    // 대시보드 데이터 요청 (최적화)
    requestDashboardData: function() {
        if (typeof AuthManager !== 'undefined' && !AuthManager.isLoggedIn()) return;
        
        // 현재 활성 페이지 확인
        const currentPage = window.location.hash.substring(1) || 'main';
        
        // 페이지별 필요한 데이터만 요청
        switch (currentPage) {
            case 'dashboard':
                // 서버 상태 요청
                setTimeout(() => {
                    this.sendMessage({ command: 'getBotStatus' });
                }, 200);
                break;
                
            case 'module-mgmt':
                // 모듈 상태 요청
                setTimeout(() => {
                    this.sendMessage({ command: 'getModuleStatus' });
                }, 200);
                
                // 사용자 설정 요청
                setTimeout(() => {
                    this.sendMessage({ command: 'getUserSettings' });
                }, 500);
                break;
                
            case 'embed':
                // 서버 상태 요청 (서버 목록 용도)
                setTimeout(() => {
                    this.sendMessage({ command: 'getBotStatus' });
                }, 200);
                break;
                
            case 'admin':
                // 사용자 목록 요청
                setTimeout(() => {
                    this.sendMessage({ command: 'getUsers' });
                }, 200);
                
                // 초대 코드 목록 요청
                setTimeout(() => {
                    this.sendMessage({ command: 'getInviteCodes' });
                }, 400);
                break;
                
            default:
                // 기본 정보만 요청
                setTimeout(() => {
                    this.sendMessage({ command: 'getOnlineAdmins' });
                }, 200);
                break;
        }
    }
};

// 페이지 로드 시 WebSocketManager 초기화
document.addEventListener('DOMContentLoaded', function() {
    // 로딩 화면이 종료된 후 초기화하도록 타이밍 조정
    setTimeout(() => {
        WebSocketManager.init();
        
        // 로딩 화면 종료 이벤트 발생 설정
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(() => {
                const loadingContainer = document.getElementById('loading-container');
                if (loadingContainer && loadingContainer.style.display === 'none') {
                    // 로딩 화면이 사라진 후 이벤트 발생
                    const event = new CustomEvent('loadingComplete');
                    document.dispatchEvent(event);
                }
            }, 500);
        });
    }, 2000); // 로딩 화면보다 빠르게 초기화 (2초 후)
});