/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 개선된 인증 관리 시스템
 */

const AuthManager = {
    user: null,
    
    init: function() {
        // 저장된 세션 확인
        const savedUser = localStorage.getItem('auth_user');
        if (savedUser) {
            try {
                this.user = JSON.parse(savedUser);
                console.log('세션에서 사용자 정보 복원됨:', this.user.username);
                
                // 토큰 유효성 확인
                if (this.user.expiry && new Date(this.user.expiry) < new Date()) {
                    console.log('세션 만료됨, 로그아웃 처리');
                    this.logout();
                } else {
                    // 세션이 유효하면 사용자 정보 표시 갱신
                    this.updateUserInfoDisplay();
                }
            } catch (e) {
                console.error('저장된 사용자 정보 파싱 오류:', e);
                localStorage.removeItem('auth_user');
            }
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
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const messageElement = document.querySelector('.login-message');
        
        if (!username || !password) {
            messageElement.textContent = '아이디와 비밀번호를 입력해주세요.';
            return;
        }
        
        // 로딩 메시지
        messageElement.textContent = '로그인 중...';
        
        // 웹소켓으로 로그인 요청
        WebSocketManager.sendMessage({
            command: 'login',
            username: username,
            password: password
        });
    },
    
    // 회원가입 처리
    handleRegister: function(e) {
        e.preventDefault();
        
        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        const passwordConfirm = document.getElementById('register-password-confirm').value;
        const inviteCode = document.getElementById('register-invite-code').value;
        const messageElement = document.querySelector('.register-message');
        
        // 입력 검증
        if (!username || !password || !passwordConfirm || !inviteCode) {
            messageElement.textContent = '모든 필드를 입력해주세요.';
            return;
        }
        
        if (password !== passwordConfirm) {
            messageElement.textContent = '비밀번호가 일치하지 않습니다.';
            return;
        }
        
        // 로딩 메시지
        messageElement.textContent = '회원가입 중...';
        
        // 웹소켓으로 회원가입 요청
        WebSocketManager.sendMessage({
            command: 'register',
            username: username,
            password: password,
            inviteCode: inviteCode
        });
    },
    
    // 로그인 응답 처리
    handleLoginResponse: function(response) {
        const messageElement = document.querySelector('.login-message');
        if (!messageElement) return;
        
        if (response.success) {
            // 로그인 성공
            this.login({
                username: document.getElementById('username').value,
                role: response.role || 'user',
                servers: response.servers || [],
                assignedChannels: response.assignedChannels || []
            });
            
            // 모달 닫기
            this.hideLoginModal();
            
            // 알림 표시
            Utilities.showNotification(`${response.message || '로그인 성공'}`, 'success');
            
            // 콜백 실행
            if (typeof this.loginCallback === 'function') {
                this.loginCallback();
                this.loginCallback = null;
            }
        } else {
            // 로그인 실패
            messageElement.textContent = response.message || '로그인에 실패했습니다.';
        }
    },
    
    // 회원가입 응답 처리
    handleRegisterResponse: function(response) {
        const messageElement = document.querySelector('.register-message');
        if (!messageElement) return;
        
        if (response.success) {
            // 회원가입 성공
            messageElement.textContent = response.message || '회원가입이 완료되었습니다.';
            
            // 알림 표시
            Utilities.showNotification('회원가입이 완료되었습니다. 로그인 해주세요.', 'success');
            
            // 회원가입 모달 닫기
            setTimeout(() => {
                this.hideRegisterModal();
                
                // 로그인 모달 표시
                setTimeout(() => {
                    this.showLoginModal();
                }, 500);
            }, 1500);
        } else {
            // 회원가입 실패
            messageElement.textContent = response.message || '회원가입에 실패했습니다.';
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
            if (msgEl) msgEl.textContent = '';
            
            // 이전 입력값 초기화
            const usernameEl = document.getElementById('register-username');
            const passwordEl = document.getElementById('register-password');
            const passwordConfirmEl = document.getElementById('register-password-confirm');
            const inviteCodeEl = document.getElementById('register-invite-code');
            
            if (usernameEl) usernameEl.value = '';
            if (passwordEl) passwordEl.value = '';
            if (passwordConfirmEl) passwordConfirmEl.value = '';
            if (inviteCodeEl) inviteCodeEl.value = '';
            
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
        const adminMenuItem = document.querySelector('.side-bar a[href="#admin"]');
        const moduleMenuItem = document.querySelector('.side-bar a[href="#module-mgmt"]');
        const embedMenuItem = document.querySelector('.side-bar a[href="#embed"]');
        
        if (this.isLoggedIn()) {
            // 로그인 상태
            if (loginMenuItem) loginMenuItem.style.display = 'none';
            if (userInfoArea) userInfoArea.style.display = 'flex';
            if (onlineAdminsArea) onlineAdminsArea.style.display = 'flex';
            
            // 권한에 따른 메뉴 표시/숨김
            if (adminMenuItem) {
                adminMenuItem.parentElement.style.display = this.hasPermission(1) ? 'block' : 'none';
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
            
            // 메뉴 접근 제한
            if (adminMenuItem) adminMenuItem.parentElement.style.display = 'none';
            if (moduleMenuItem) moduleMenuItem.parentElement.style.display = 'none';
            if (embedMenuItem) embedMenuItem.parentElement.style.display = 'none';
        }
    },
    
    // 사용자 정보 표시 업데이트
    updateUserInfoDisplay: function() {
        if (!this.user) return;
        
        const userInfoName = document.getElementById('user-info-name');
        const userInfoRole = document.getElementById('user-info-role');
        const userInfoServer = document.getElementById('user-info-server');
        
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
        
        if (userInfoServer && this.user.assignedChannels) {
            if (this.user.assignedChannels.length > 0) {
                userInfoServer.textContent = this.user.assignedChannels.join(', ');
            } else {
                userInfoServer.textContent = '할당된 서버 없음';
            }
        }
    },
    
    // 사용자 정보 표시 숨기기
    hideUserInfoDisplay: function() {
        const userInfoName = document.getElementById('user-info-name');
        const userInfoRole = document.getElementById('user-info-role');
        const userInfoServer = document.getElementById('user-info-server');
        
        if (userInfoName) userInfoName.textContent = '';
        if (userInfoRole) userInfoRole.textContent = '';
        if (userInfoServer) userInfoServer.textContent = '';
    }
};

// 페이지 로드 시 인증 시스템 초기화
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        AuthManager.init();
    }, 6000); // 로딩 애니메이션이 끝난 후
});