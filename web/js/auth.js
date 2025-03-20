/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 인증 관리 시스템
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
                
                // 토큰 유효성 확인 (실제로는 서버와 통신해야 함)
                if (this.user.expiry && new Date(this.user.expiry) < new Date()) {
                    console.log('세션 만료됨, 로그아웃 처리');
                    this.logout();
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
        
        // 모달 닫기 버튼
        const closeBtn = document.querySelector('.modal .close');
        if (closeBtn) {
            closeBtn.addEventListener('click', this.hideLoginModal.bind(this));
        }
        
        // 로그인 모달 외부 클릭 시 닫기
        const modal = document.getElementById('login-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideLoginModal();
                }
            });
        }
    },
    
    // 로그인 상태 확인
    isLoggedIn: function() {
        return this.user !== null;
    },
    
    // 관리자 권한 확인
    isAdmin: function() {
        return this.user !== null && this.user.role === 'admin';
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
        
        // 이벤트 발생
        const event = new CustomEvent('auth:login', { detail: userData });
        document.dispatchEvent(event);
        
        return userData;
    },
    
    // 로그아웃 처리
    logout: function() {
        this.user = null;
        localStorage.removeItem('auth_user');
        
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
        
        // 로그인 응답 처리는 websocket.js에서 구현
    },
    
    // 로그인 응답 처리
    handleLoginResponse: function(response) {
        const messageElement = document.querySelector('.login-message');
        
        if (response.success) {
            // 로그인 성공
            this.login({
                username: document.getElementById('username').value,
                role: response.role || 'user'
            });
            
            // 모달 닫기
            this.hideLoginModal();
            
            // 알림 표시
            Utilities.showNotification(`${response.message}`, 'success');
            
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
    
    // 로그인 모달 표시
    showLoginModal: function(callback) {
        const modal = document.getElementById('login-modal');
        if (modal) {
            // 이전 메시지 초기화
            document.querySelector('.login-message').textContent = '';
            // 이전 입력값 초기화
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            
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
    }
};

// 페이지 로드 시 인증 시스템 초기화
document.addEventListener('DOMContentLoaded', function() {
    AuthManager.init();
});
