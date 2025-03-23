/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 메인 JavaScript 파일
 */

// 모듈 관리 시스템
const ModuleManager = {
    modules: {
        'main': {
            loaded: true, // 메인 페이지는 기본적으로 로드됨
            path: null // 메인 페이지는 index.html에 내장되어 있음
        },
        'dashboard': {
            loaded: false,
            path: 'modules/dashboard.html',
            css: 'css/modules/dashboard.css',
            js: 'js/modules/dashboard.js'
        },
        'module-mgmt': {
            loaded: false,
            path: 'modules/module-mgmt.html',
            css: 'css/modules/module-mgmt.css',
            js: 'js/modules/module-mgmt.js'
        },
        'embed': {
            loaded: false,
            path: 'modules/embed.html',
            css: 'css/modules/embed.css',
            js: 'js/modules/embed.js'
        },
        'admin': {
            loaded: false,
            path: 'modules/admin.html',
            css: 'css/modules/admin.css',
            js: 'js/modules/admin.js'
        }
    },
    
    // 모듈 로드 함수
loadModule: function(moduleName) {
    return new Promise((resolve, reject) => {
        const module = this.modules[moduleName];
        
        if (!module) {
            reject(new Error(`모듈 ${moduleName}를 찾을 수 없습니다.`));
            return;
        }
        
        if (module.loaded) {
            resolve(); // 이미 로드됐으면 바로 완료
            return;
        }
        
        // 리소스 병렬 로딩
        const promises = [];
        
        // HTML 콘텐츠 로드
        promises.push(
            fetch(module.path)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`모듈 ${moduleName} HTML을 로드할 수 없습니다.`);
                    }
                    return response.text();
                })
                .then(html => {
                    const moduleContent = document.getElementById('module-content');
                    
                    // 모듈 HTML 컨테이너 생성
                    const moduleContainer = document.createElement('div');
                    moduleContainer.id = `${moduleName}-page`;
                    moduleContainer.className = 'content-page module-page';
                    moduleContainer.innerHTML = html;
                    
                    // 이전에 같은 모듈이 있으면 제거 후 추가
                    const existingModule = document.getElementById(`${moduleName}-page`);
                    if (existingModule) {
                        moduleContent.removeChild(existingModule);
                    }
                    
                    moduleContent.appendChild(moduleContainer);
                })
        );
        
        // CSS 파일 로드 (비동기)
        if (module.css) {
            promises.push(new Promise((cssResolve) => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = module.css;
                link.onload = () => cssResolve();
                link.onerror = () => cssResolve(); // 실패해도 진행
                document.head.appendChild(link);
            }));
        }
        
        // 모든 리소스 로딩 완료 후 JS 로드
        Promise.all(promises)
            .then(() => {
                if (module.js) {
                    const script = document.createElement('script');
                    script.src = module.js;
                    script.onload = () => {
                        module.loaded = true;
                        resolve();
                    };
                    script.onerror = () => {
                        reject(new Error(`모듈 ${moduleName} 스크립트를 로드할 수 없습니다.`));
                    };
                    document.body.appendChild(script);
                } else {
                    module.loaded = true;
                    resolve();
                }
            })
            .catch(error => {
                console.error(`모듈 ${moduleName} 로드 중 오류:`, error);
                reject(error);
            });
    });
},
    
    // 현재 모듈 활성화 함수
    activateModule: function(moduleName) {
        // 모든 페이지 비활성화
        document.querySelectorAll('.content-page').forEach(page => {
            page.classList.remove('active-page');
        });
        
        // 현재 모듈 활성화
        if (moduleName === 'main') {
            document.getElementById('main-page').classList.add('active-page');
        } else {
            const modulePage = document.getElementById(`${moduleName}-page`);
            if (modulePage) {
                modulePage.classList.add('active-page');
            }
        }
        
        // 사이드바 메뉴 활성화 표시
        document.querySelectorAll('.side-bar a').forEach(link => {
            link.classList.remove('active');
        });
        
        const activeLink = document.querySelector(`.side-bar a[href="#${moduleName}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
        }
    }
};

// 로딩 화면 관리
const LoadingManager = {
    steps: [
        { message: "안녕하세요", delay: 500 },
        { message: "메인 불러오는중", delay: 500 },
        { message: "대시보드 불러오는중", delay: 500 },
        { message: "임베드 설정중", delay: 500 },
        { message: "사용자 불러오는중", delay: 500 },
        { message: "환영합니다", delay: 500 }
    ],
    currentStep: 0,
    progressElement: null,
    messageElement: null,
    
    init: function() {
        this.progressElement = document.getElementById('loading-progress');
        this.messageElement = document.getElementById('loading-message');
        this.nextStep();
    },
    
    nextStep: function() {
        if (this.currentStep >= this.steps.length) {
            this.complete();
            return;
        }
        
        const step = this.steps[this.currentStep];
        this.messageElement.style.animation = 'none';
        void this.messageElement.offsetWidth; // 리플로우 강제
        this.messageElement.style.animation = 'fadeTextIn 0.5s forwards';
        this.messageElement.textContent = step.message;
        
        // 진행바 업데이트
        const progress = ((this.currentStep + 1) / this.steps.length) * 100;
        this.progressElement.style.width = `${progress}%`;
        
        this.currentStep++;
        
        setTimeout(() => {
            this.nextStep();
        }, step.delay);
    },
    
    complete: function() {
        // 로딩 화면 페이드 아웃
        const loadingContainer = document.getElementById('loading-container');
        loadingContainer.classList.add('fade-out');
        
        // 메인 컨테이너 표시
        setTimeout(() => {
            loadingContainer.style.display = 'none';
            document.getElementById('main-container').style.display = 'block';
            
            // 애니메이션 트리거
            document.querySelectorAll('.animate-item').forEach((item, index) => {
                item.style.animationDelay = `${0.2 + (index * 0.4)}s`;
            });
        }, 500);
    }
};

// 라우터 - 해시 기반 라우팅
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
        
        // 권한 확인
        if (hash === 'admin' && !AuthManager.isAdmin()) {
            alert('관리자 권한이 필요합니다.');
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
            })
            .catch(error => {
                console.error('모듈 로드 오류:', error);
                // 오류 시 메인으로 이동
                window.location.hash = '#main';
            });
    }
};

// 전역 유틸리티 함수들
const Utilities = {
    // 날짜 포맷팅
    formatDate: function(dateString) {
        const date = new Date(dateString);
        return date.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    },
    
    // 알림 표시
    showNotification: function(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // 애니메이션 효과
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // 자동 제거
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
};

// 페이지 초기화
document.addEventListener('DOMContentLoaded', function() {
    // 로딩 애니메이션 시작
    LoadingManager.init();
    
    // 라우터 초기화 - 시간 단축
    setTimeout(() => {
        Router.init();
    }, 3000); // 로딩 애니메이션 시간 단축 (6000ms -> 3000ms)
});
