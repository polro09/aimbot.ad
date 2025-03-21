handleHashChange: function() {
    const hash = window.location.hash.substring(1);
    
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
    
    // 로그인 확인 (admin, dashboard, module-mgmt, embed는 로그인 필요)
    if (['admin', 'dashboard', 'module-mgmt', 'embed'].includes(hash) && !AuthManager.isLoggedIn()) {
        AuthManager.showLoginModal(() => {
            this.loadModuleAndActivate(hash);
        });
        return;
    }
    
    this.loadModuleAndActivate(hash);
}