/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 라우터 - 해시 기반 라우팅
 */

const Router = {
    init: function() {
        window.addEventListener('hashchange', this.handleHashChange.bind(this));
        
        // 초기 해시 처리
        if (window.location.hash) {
            this.handleHashChange();
        } else {
            window.location.hash = '#main';
        }
    },
    
    handleHashChange: function() {
        const hash = window.location.hash.substring(1);
        const previousHash = this.currentHash;
        this.currentHash = hash;
        
        // 페이지별 권한 확인
        if (hash === 'admin' && !AuthManager.hasPermission(1)) {
            Utilities.showNotification('1등급 관리자 권한이 필요합니다.', 'error');
            window.location.hash = '#main';
            return;
        }
        
        if (hash === 'module-mgmt' && !AuthManager.hasPermission(2)) {
            Utilities.showNotification('2등급 이상의 관리자 권한이 필요합니다.', 'error');
            window.location.hash = '#main';
            return;
        }
        
        if (hash === 'embed' && !AuthManager.hasPermission(3)) {
            Utilities.showNotification('3등급 이상의 관리자 권한이 필요합니다.', 'error');
            window.location.hash = '#main';
            return;
        }
        
        // 대시보드는 로그인만 되어 있으면 접근 가능 (모든 등급 접근 가능)
        if (hash === 'dashboard' && !AuthManager.isLoggedIn()) {
            AuthManager.showLoginModal(() => {
                this.loadModuleAndActivate(hash);
            });
            return;
        }
        
        // 로그인 확인 (admin, dashboard, module-mgmt, embed는 로그인 필요)
        if (['admin', 'dashboard', 'module-mgmt', 'embed'].includes(hash) && !AuthManager.isLoggedIn()) {
            AuthManager.showLoginModal(() => {
                this.loadModuleAndActivate(hash);
            });
            return;
        }
        
        // 모듈이 변경될 때 이전 모듈의 데이터 요청 중단
        if (previousHash && previousHash !== hash) {
            this.clearModuleRequests(previousHash);
        }
        
        this.loadModuleAndActivate(hash);
        
        // 페이지 변경 완료 이벤트 발생
        const event = new CustomEvent('page_changed', { 
            detail: { previous: previousHash, current: hash } 
        });
        document.dispatchEvent(event);
    },
    
    // 모듈 관련 요청 정리
    clearModuleRequests: function(moduleName) {
        if (moduleName === 'module-mgmt') {
            // 모듈 관리 페이지에서 나갈 때 필요한 작업
            const isLoadingModules = window.isLoadingModules;
            if (isLoadingModules) {
                window.isLoadingModules = false;
            }
        }
    },
    
    loadModuleAndActivate: function(moduleName) {
        if (!ModuleManager.modules[moduleName]) {
            console.error(`모듈 ${moduleName}가 존재하지 않습니다.`);
            window.location.hash = '#main';
            return;
        }
        
        ModuleManager.loadModule(moduleName)
            .then(() => {
                ModuleManager.activateModule(moduleName);
                
                // 모듈 초기화 함수가 있으면 호출
                if (window[`init${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Module`]) {
                    window[`init${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}Module`]();
                }
                
                // 모듈 로드 이벤트 발생
                const event = new CustomEvent('module_loaded', {
                    detail: moduleName
                });
                document.dispatchEvent(event);
                
                // 웹소켓 데이터 요청 최적화
                if (typeof WebSocketManager !== 'undefined') {
                    WebSocketManager.requestDashboardData();
                }
            })
            .catch(error => {
                console.error('모듈 로드 오류:', error);
                // 오류 시 메인으로 이동
                window.location.hash = '#main';
            });
    }
};