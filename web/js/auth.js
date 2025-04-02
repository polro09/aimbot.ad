/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 개선된 인증 관리 시스템
 */

const AuthManager = {
    user: null,
    loginCallback: null,
    registerCallback: null,
    
    init: function() {
        // 페이지 새로고침/재접속 시 항상 로그아웃 상태로 시작
        localStorage.removeItem('auth_user');
        this.user = null;
        
        // 로그인 버튼 이벤트 리스너
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.addEventListener('click', this.showLoginModal.bind(this));
        }
        
        // 로그인 모달 이벤트 리스너
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', this.handleLogin.bind(this));
        }
        
        // 로그아웃 버튼 이벤트 리스너
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', this.logout.bind(this));
        }
        
        // 사이드바 로그아웃 버튼 리스너
        const sidebarLogoutBtn = document.getElementById('sidebar-logout-btn');
        if (sidebarLogoutBtn) {
            sidebarLogoutBtn.addEventListener('click', this.logout.bind(this));
        }
        
        // 회원가입 모달 이벤트 리스너
        const registerForm = document.getElementById('register-form');
        if (registerForm) {
            registerForm.addEventListener('submit', this.handleRegister.bind(this));
        }
        
        // 회원가입 버튼 이벤트 리스너
        const registerBtn = document.getElementById('register-btn');
        if (registerBtn) {
            registerBtn.addEventListener('click', this.showRegisterModal.bind(this));
        }
        
        // 모달 닫기 버튼들
        document.querySelectorAll('.modal .close').forEach(closeBtn => {
            closeBtn.addEventListener('click', () => {
                document.querySelectorAll('.modal').forEach(modal => {
                    modal.style.display = 'none';
                });
            });
        });
        
        // 모달 외부 클릭 시 닫기
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            });
        });
        
        // 초기 UI 업데이트
        this.updateAuthUI();
        
        console.log('AuthManager 초기화 완료');
    },
    
    // 로그인 상태 확인
    isLoggedIn: function() {
        return this.user !== null;
    },
    
    // 관리자 권한 확인
    isAdmin: function() {
        return this.user !== null && (this.user.role === 'admin' || this.user.role === 'level1');
    },
    
    // 권한 레벨 확인
    hasPermission: function(level) {
        if (!this.user) return false;
        
        const roleToLevel = {
            'admin': 1,
            'level1': 1,
            'level2': 2,
            'level3': 3,
            'user': 4
        };
        
        const userLevel = roleToLevel[this.user.role] || 4;
        return userLevel <= level;
    },
    
    // 로그인 처리
    login: function(userData) {
        this.user = userData;
        
        // 만료 시간 설정 (예: 8시간)
        const expiry = new Date();
        expiry.setHours(expiry.getHours() + 8);
        this.user.expiry = expiry.toISOString();
        
        // 로컬 스토리지에 저장
        localStorage.setItem('auth_user', JSON.stringify(this.user));
        
        // UI 업데이트
        this.updateAuthUI();
        this.updateUserInfoDisplay();
        
        // 이벤트 발생
        const event = new CustomEvent('auth:login', { detail: userData });
        document.dispatchEvent(event);
        
        return userData;
    },
    
    // 로그아웃 처리
    logout: function() {
        this.user = null;
        localStorage.removeItem('auth_user');
        
        // UI 업데이트
        this.updateAuthUI();
        this.hideUserInfoDisplay();
        
        // 이벤트 발생
        const event = new CustomEvent('auth:logout');
        document.dispatchEvent(event);
        
        // 메인 페이지로 이동
        window.location.hash = '#main';
    },
    
    // 로그인 폼 제출 처리
    handleLogin: function(e) {
        e.preventDefault();
        
        // 폼 입력값 가져오기
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const messageElement = document.querySelector('.login-message');
        
        // 입력값 검증
        if (!username || !password) {
            messageElement.textContent = '아이디와 비밀번호를 입력해주세요.';
            return;
        }
        
        // 로딩 메시지
        messageElement.textContent = '로그인 중...';
        
        // 로그인 버튼 비활성화
        const loginButton = document.querySelector('#login-form button[type="submit"]');
        if (loginButton) loginButton.disabled = true;
        
        // 웹소켓으로 로그인 요청
        if (typeof WebSocketManager !== 'undefined' && WebSocketManager.sendMessage) {
            WebSocketManager.sendMessage({
                command: 'login',
                username: username,
                password: password
            });
        } else {
            messageElement.textContent = '웹소켓 연결이 준비되지 않았습니다. 페이지를 새로고침 해주세요.';
            if (loginButton) loginButton.disabled = false;
        }
    },
    
    // 회원가입 처리 - 개선됨
    handleRegister: function(e) {
        e.preventDefault();
        
        // 폼 입력값 가져오기
        const username = document.getElementById('register-username').value.trim();
        const password = document.getElementById('register-password').value;
        const passwordConfirm = document.getElementById('register-password-confirm').value;
        const inviteCode = document.getElementById('register-invite-code').value.trim();
        const messageElement = document.querySelector('.register-message');
        
        // 입력값 검증
        if (!username || !password || !passwordConfirm || !inviteCode) {
            messageElement.textContent = '모든 필드를 입력해주세요.';
            return;
        }
        
        // 아이디 유효성 검사
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
            messageElement.textContent = '아이디는 3-20자의 영문, 숫자, 언더스코어(_)만 사용할 수 있습니다.';
            return;
        }
        
        // 비밀번호 복잡성 검사
        if (password.length < 6) {
            messageElement.textContent = '비밀번호는 최소 6자 이상이어야 합니다.';
            return;
        }
        
        // 비밀번호 일치 확인
        if (password !== passwordConfirm) {
            messageElement.textContent = '비밀번호가 일치하지 않습니다.';
            return;
        }
        
        // 초대 코드 형식 검사
        if (!/^[A-Z0-9]{8}$/.test(inviteCode) && !/^[A-Z0-9]{10}$/.test(inviteCode)) {
            messageElement.textContent = '유효하지 않은 초대 코드 형식입니다.';
            return;
        }
        
        // 로딩 메시지
        messageElement.textContent = '회원가입 중...';
        
        // 등록 버튼 비활성화
        const registerButton = document.querySelector('#register-form button[type="submit"]');
        if (registerButton) registerButton.disabled = true;
        
        console.log('회원가입 요청 전송:', username, inviteCode);
        
        // 웹소켓으로 회원가입 요청
        if (typeof WebSocketManager !== 'undefined' && WebSocketManager.sendMessage) {
            WebSocketManager.sendMessage({
                command: 'register',
                username: username,
                password: password,
                inviteCode: inviteCode
            });
            
            // 콜백 저장 (응답 처리용)
            this.registerCallback = function(success) {
                if (registerButton) registerButton.disabled = false;
                
                if (success) {
                    // 성공 메시지를 표시하고 로그인 모달로 전환
                    setTimeout(() => {
                        this.hideRegisterModal();
                        setTimeout(() => {
                            this.showLoginModal();
                        }, 500);
                    }, 1500);
                }
            }.bind(this);
        } else {
            messageElement.textContent = '웹소켓 연결이 준비되지 않았습니다. 페이지를 새로고침 해주세요.';
            if (registerButton) registerButton.disabled = false;
        }
    },
    
    // 로그인 응답 처리
    handleLoginResponse: function(message) {
        const messageElement = document.querySelector('.login-message');
        const loginButton = document.querySelector('#login-form button[type="submit"]');
        
        if (loginButton) loginButton.disabled = false;
        
        if (!messageElement) return;
        
        if (message.success) {
            // 로그인 성공
            this.login({
                username: document.getElementById('username').value,
                role: message.role || 'user',
                servers: message.servers || [],
                assignedChannels: message.assignedChannels || []
            });
            
            // 모달 닫기
            this.hideLoginModal();
            
            // 알림 표시
            if (typeof Utilities !== 'undefined' && Utilities.showNotification) {
                Utilities.showNotification(`${message.message || '로그인 성공'}`, 'success');
            }
            
            // 콜백 실행
            if (typeof this.loginCallback === 'function') {
                this.loginCallback();
                this.loginCallback = null;
            }
        } else {
            // 로그인 실패
            messageElement.textContent = message.message || '로그인에 실패했습니다.';
        }
    },
    
    // 회원가입 응답 처리 - 개선됨
    handleRegisterResponse: function(message) {
        const messageElement = document.querySelector('.register-message');
        const registerButton = document.querySelector('#register-form button[type="submit"]');
        
        if (registerButton) registerButton.disabled = false;
        
        if (!messageElement) return;
        
        if (message.success) {
            // 회원가입 성공
            messageElement.textContent = message.message || '회원가입이 완료되었습니다.';
            messageElement.style.color = '#27ae60'; // 성공 메시지 색상을 녹색으로 변경
            
            // 알림 표시
            if (typeof Utilities !== 'undefined' && Utilities.showNotification) {
                Utilities.showNotification('회원가입이 완료되었습니다. 로그인 해주세요.', 'success');
            }
            
            console.log('회원가입 성공 응답 수신');
            
            // 콜백 실행
            if (typeof this.registerCallback === 'function') {
                this.registerCallback(true);
                this.registerCallback = null;
            }
            
            // 성공 시 모달 닫고 로그인 모달 표시
            setTimeout(() => {
                this.hideRegisterModal();
                setTimeout(() => {
                    this.showLoginModal();
                }, 500);
            }, 1500);
        } else {
            // 회원가입 실패
            messageElement.textContent = message.message || '회원가입에 실패했습니다.';
            messageElement.style.color = '#e74c3c'; // 실패 메시지 색상을 빨간색으로 변경
            
            console.log('회원가입 실패 응답 수신:', message.message);
            
            // 콜백 실행 (실패)
            if (typeof this.registerCallback === 'function') {
                this.registerCallback(false);
                this.registerCallback = null;
            }
        }
    },
    
    // 로그인 모달 표시
    showLoginModal: function(callback) {
        const modal = document.getElementById('login-modal');
        if (modal) {
            // 이전 메시지 초기화
            const msgEl = document.querySelector('.login-message');
            if (msgEl) msgEl.textContent = '';
            
            // 이전 입력값 초기화
            const usernameEl = document.getElementById('username');
            const passwordEl = document.getElementById('password');
            if (usernameEl) usernameEl.value = '';
            if (passwordEl) passwordEl.value = '';
            
            // 버튼 활성화
            const loginButton = document.querySelector('#login-form button[type="submit"]');
            if (loginButton) loginButton.disabled = false;
            
            // 콜백 저장
            this.loginCallback = callback;
            
            // 모달 표시
            modal.style.display = 'block';
        }
    },
    
    // 로그인 모달 숨기기
    hideLoginModal: function() {
        const modal = document.getElementById('login-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    },
    
    // 회원가입 모달 표시
    showRegisterModal: function() {
        const modal = document.getElementById('register-modal');
        if (modal) {
            // 이전 메시지 초기화
            const msgEl = document.querySelector('.register-message');
            if (msgEl) {
                msgEl.textContent = '';
                msgEl.style.color = '#e74c3c'; // 기본 색상 초기화
            }
            
            // 이전 입력값 초기화
            const usernameEl = document.getElementById('register-username');
            const passwordEl = document.getElementById('register-password');
            const passwordConfirmEl = document.getElementById('register-password-confirm');
            const inviteCodeEl = document.getElementById('register-invite-code');
            
            if (usernameEl) usernameEl.value = '';
            if (passwordEl) passwordEl.value = '';
            if (passwordConfirmEl) passwordConfirmEl.value = '';
            if (inviteCodeEl) inviteCodeEl.value = '';
            
            // 버튼 활성화
            const registerButton = document.querySelector('#register-form button[type="submit"]');
            if (registerButton) registerButton.disabled = false;
            
            // 모달 표시
            modal.style.display = 'block';
            
            // 로그인 모달 숨기기
            this.hideLoginModal();
        }
    },
    
    // 회원가입 모달 숨기기
    hideRegisterModal: function() {
        const modal = document.getElementById('register-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    },
    
    // 인증 UI 업데이트
    updateAuthUI: function() {
        const loginMenuItem = document.querySelector('.login-menu-item');
        const userInfoArea = document.getElementById('user-info-area');
        const onlineAdminsArea = document.getElementById('online-admins-area');
        const sidebarUserInfo = document.querySelector('.sidebar-user-info');
        const sidebarOnlineAdmins = document.querySelector('.sidebar-online-admins');
        
        // 메뉴 항목 가져오기
        const adminMenuItem = document.querySelector('.side-bar a[href="#admin"]');
        const dashboardMenuItem = document.querySelector('.side-bar a[href="#dashboard"]');
        const moduleMenuItem = document.querySelector('.side-bar a[href="#module-mgmt"]');
        const embedMenuItem = document.querySelector('.side-bar a[href="#embed"]');
        
        if (this.isLoggedIn()) {
            // 로그인 상태
            if (loginMenuItem) loginMenuItem.style.display = 'none';
            if (userInfoArea) userInfoArea.style.display = 'flex';
            if (onlineAdminsArea) onlineAdminsArea.style.display = 'flex';
            if (sidebarUserInfo) sidebarUserInfo.classList.add('active');
            if (sidebarOnlineAdmins) sidebarOnlineAdmins.classList.add('active');
            
            // 사이드바 사용자 정보 업데이트
            this.updateSidebarUserInfo();
            
            // 권한에 따른 메뉴 표시/숨김
            if (adminMenuItem) {
                adminMenuItem.parentElement.style.display = this.hasPermission(1) ? 'block' : 'none';
            }
            
            if (dashboardMenuItem) {
                dashboardMenuItem.parentElement.style.display = this.hasPermission(4) ? 'block' : 'none';
            }
            
            if (moduleMenuItem) {
                moduleMenuItem.parentElement.style.display = this.hasPermission(2) ? 'block' : 'none';
            }
            
            if (embedMenuItem) {
                embedMenuItem.parentElement.style.display = this.hasPermission(3) ? 'block' : 'none';
            }
        } else {
            // 로그아웃 상태
            if (loginMenuItem) loginMenuItem.style.display = 'block';
            if (userInfoArea) userInfoArea.style.display = 'none';
            if (onlineAdminsArea) onlineAdminsArea.style.display = 'none';
            if (sidebarUserInfo) sidebarUserInfo.classList.remove('active');
            if (sidebarOnlineAdmins) sidebarOnlineAdmins.classList.remove('active');
            
            // 메뉴 접근 제한
            if (adminMenuItem) adminMenuItem.parentElement.style.display = 'none';
            if (dashboardMenuItem) dashboardMenuItem.parentElement.style.display = 'none';
            if (moduleMenuItem) moduleMenuItem.parentElement.style.display = 'none';
            if (embedMenuItem) embedMenuItem.parentElement.style.display = 'none';
        }
    },
    
    // 사이드바 사용자 정보 업데이트
    updateSidebarUserInfo: function() {
        if (!this.user) return;
        
        const usernameEl = document.getElementById('sidebar-username');
        const roleEl = document.getElementById('sidebar-role');
        const serverEl = document.getElementById('sidebar-server');
        
        if (usernameEl) {
            usernameEl.textContent = this.user.username;
        }
        
        if (roleEl) {
            let roleText = '일반 사용자';
            if (this.user.role === 'admin' || this.user.role === 'level1') {
                roleText = '관리자 (1등급)';
            } else if (this.user.role === 'level2') {
                roleText = '관리자 (2등급)';
            } else if (this.user.role === 'level3') {
                roleText = '관리자 (3등급)';
            }
            
            roleEl.textContent = roleText;
        }
        
        if (serverEl) {
            if (this.user.assignedServers && this.user.assignedServers.length > 0) {
                serverEl.textContent = Array.isArray(this.user.assignedServers) ? 
                    this.user.assignedServers.map(server => server.serverName || server.name).join(', ') : 
                    '할당된 서버 있음';
            } else if (this.user.assignedChannels && this.user.assignedChannels.length > 0) {
                serverEl.textContent = Array.isArray(this.user.assignedChannels) ? 
                    this.user.assignedChannels.join(', ') : 
                    '할당된 서버 있음';
            } else {
                serverEl.textContent = '할당된 서버 없음';
            }
        }
    },
    
    // 사용자 정보 표시 업데이트
    updateUserInfoDisplay: function() {
        if (!this.user) return;
        
        const userInfoName = document.getElementById('user-info-name');
        const userInfoRole = document.getElementById('user-info-role');
        const userInfoServer = document.getElementById('user-info-server');
        
        // 헤더 영역 사용자 정보
        if (userInfoName) {
            userInfoName.textContent = this.user.username;
        }
        
        if (userInfoRole) {
            let roleText = '일반 사용자';
            if (this.user.role === 'admin' || this.user.role === 'level1') {
                roleText = '관리자 (1등급)';
            } else if (this.user.role === 'level2') {
                roleText = '관리자 (2등급)';
            } else if (this.user.role === 'level3') {
                roleText = '관리자 (3등급)';
            }
            
            userInfoRole.textContent = roleText;
        }
        
        if (userInfoServer) {
            if (this.user.assignedServers && this.user.assignedServers.length > 0) {
                userInfoServer.textContent = Array.isArray(this.user.assignedServers) ? 
                    this.user.assignedServers.map(server => server.serverName || server.name).join(', ') : 
                    '할당된 서버 있음';
            } else if (this.user.assignedChannels && this.user.assignedChannels.length > 0) {
                userInfoServer.textContent = Array.isArray(this.user.assignedChannels) ? 
                    this.user.assignedChannels.join(', ') : 
                    '할당된 서버 있음';
            } else {
                userInfoServer.textContent = '할당된 서버 없음';
            }
        }
        
        // 사이드바 사용자 정보도 업데이트
        this.updateSidebarUserInfo();
    },
    
    // 사용자 정보 표시 숨기기
    hideUserInfoDisplay: function() {
        const userInfoName = document.getElementById('user-info-name');
        const userInfoRole = document.getElementById('user-info-role');
        const userInfoServer = document.getElementById('user-info-server');
        
        // 헤더 영역 사용자 정보 초기화
        if (userInfoName) userInfoName.textContent = '';
        if (userInfoRole) userInfoRole.textContent = '';
        if (userInfoServer) userInfoServer.textContent = '';
        
        // 사이드바 사용자 정보 초기화
        const sidebarUsername = document.getElementById('sidebar-username');
        const sidebarRole = document.getElementById('sidebar-role');
        const sidebarServer = document.getElementById('sidebar-server');
        
        if (sidebarUsername) sidebarUsername.textContent = '사용자';
        if (sidebarRole) sidebarRole.textContent = '-';
        if (sidebarServer) sidebarServer.textContent = '-';
    }
};

// 페이지 로드 시 인증 시스템 초기화
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        AuthManager.init();
        
        // 웹소켓 메시지 핸들러 등록
        if (typeof WebSocketManager !== 'undefined') {
            // 로그인 응답 처리
            WebSocketManager.messageHandlers['loginResult'] = (message) => {
                AuthManager.handleLoginResponse(message);
            };
            
            // 회원가입 응답 처리
            WebSocketManager.messageHandlers['registerResult'] = (message) => {
                AuthManager.handleRegisterResponse(message);
            };
        }
        
        // 웹소켓 준비 이벤트 발생
        const event = new CustomEvent('websocket_ready');
        document.dispatchEvent(event);
    }, 3000); // 로딩 애니메이션보다 일찍 초기화
});