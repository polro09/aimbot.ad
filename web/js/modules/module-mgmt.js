/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 모듈 관리 기능
 */

// 현재 선택된 모듈
let currentModule = null;

// 모듈 관리 초기화
function initModuleMgmtModule() {
    console.log('모듈 관리 페이지 초기화');
    
    // 이벤트 리스너 등록
    registerModuleMgmtEvents();
    
    // 모듈 목록 로드
    WebSocketManager.sendMessage({ command: 'getModuleStatus' });
    
    // 사용자 설정 로드
    WebSocketManager.sendMessage({ command: 'getUserSettings' });
}

// 모듈 관리 이벤트 리스너 등록
function registerModuleMgmtEvents() {
    // 모듈 새로고침 버튼
    const refreshBtn = document.getElementById('refresh-modules-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            WebSocketManager.sendMessage({ command: 'getModuleStatus' });
            Utilities.showNotification('모듈 목록을 새로고침 중입니다...', 'info');
        });
    }
    
    // 사용자 설정 폼 제출
    const settingsForm = document.getElementById('user-settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveUserSettings();
        });
    }
    
    // 모달 닫기 버튼
    const closeBtn = document.querySelector('#module-info-modal .close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeModuleModal();
        });
    }
    
    // 모달 외부 클릭 시 닫기
    const modal = document.getElementById('module-info-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModuleModal();
            }
        });
    }
    
    // 모듈 버튼 이벤트
    setupModuleButtons();
}

// 모듈 버튼 이벤트 설정
function setupModuleButtons() {
    // 활성화 버튼
    const enableBtn = document.getElementById('modal-enable-btn');
    if (enableBtn) {
        enableBtn.addEventListener('click', () => {
            if (!currentModule) return;
            
            WebSocketManager.sendMessage({
                command: 'moduleAction',
                action: 'enable',
                moduleName: currentModule
            });
        });
    }
    
    // 비활성화 버튼
    const disableBtn = document.getElementById('modal-disable-btn');
    if (disableBtn) {
        disableBtn.addEventListener('click', () => {
            if (!currentModule) return;
            
            if (confirm(`${currentModule} 모듈을 비활성화하시겠습니까?`)) {
                WebSocketManager.sendMessage({
                    command: 'moduleAction',
                    action: 'disable',
                    moduleName: currentModule
                });
            }
        });
    }
    
    // 재로드 버튼
    const reloadBtn = document.getElementById('modal-reload-btn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
            if (!currentModule) return;
            
            if (confirm(`${currentModule} 모듈을 재로드하시겠습니까?`)) {
                WebSocketManager.sendMessage({
                    command: 'moduleAction',
                    action: 'reload',
                    moduleName: currentModule
                });
            }
        });
    }
}

// 모듈 목록 업데이트
function updateModulesList(moduleStatus) {
    const modulesContainer = document.getElementById('modules-container');
    if (!modulesContainer) return;
    
    // 컨테이너 비우기
    modulesContainer.innerHTML = '';
    
    // 모듈이 없을 경우
    if (!moduleStatus || Object.keys(moduleStatus).length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '<i class="fas fa-puzzle-piece"></i><p>등록된 모듈이 없습니다.</p>';
        modulesContainer.appendChild(emptyState);
        return;
    }
    
    // 모듈 목록 생성
    Object.entries(moduleStatus).forEach(([fileName, module]) => {
        const moduleItem = document.createElement('div');
        moduleItem.className = `module-item ${module.enabled ? 'enabled' : 'disabled'}`;
        moduleItem.dataset.module = fileName;
        
        // 모듈 정보
        const moduleInfo = document.createElement('div');
        moduleInfo.className = 'module-info';
        
        const moduleName = document.createElement('div');
        moduleName.className = 'module-name';
        moduleName.innerHTML = `<i class="fas fa-puzzle-piece"></i>${module.name || fileName}`;
        
        const moduleDescription = document.createElement('div');
        moduleDescription.className = 'module-description';
        moduleDescription.textContent = module.description || '설명 없음';
        
        moduleInfo.appendChild(moduleName);
        moduleInfo.appendChild(moduleDescription);
        
        // 모듈 상태
        const moduleStatus = document.createElement('div');
        moduleStatus.className = `module-status ${module.enabled ? 'enabled' : 'disabled'}`;
        moduleStatus.innerHTML = module.enabled ? 
            '<i class="fas fa-check-circle"></i> 활성화' : 
            '<i class="fas fa-times-circle"></i> 비활성화';
        
        moduleItem.appendChild(moduleInfo);
        moduleItem.appendChild(moduleStatus);
        
        // 모듈 클릭 이벤트
        moduleItem.addEventListener('click', () => {
            showModuleModal(fileName, module);
        });
        
        modulesContainer.appendChild(moduleItem);
    });
}

// 모듈 모달 표시
function showModuleModal(fileName, module) {
    currentModule = fileName;
    
    // 모달 내용 업데이트
    document.getElementById('modal-module-name').textContent = module.name || fileName;
    document.getElementById('modal-module-description').textContent = module.description || '설명 없음';
    document.getElementById('modal-module-version').textContent = module.version || '1.0.0';
    document.getElementById('modal-module-status').textContent = module.enabled ? '활성화' : '비활성화';
    
    // 명령어 목록
    const commandsContainer = document.getElementById('modal-module-commands');
    if (module.commands && module.commands.length > 0) {
        let commandsHTML = '';
        module.commands.forEach(command => {
            commandsHTML += `<span class="command-tag">${command}</span>`;
        });
        commandsContainer.innerHTML = commandsHTML;
    } else {
        commandsContainer.textContent = '등록된 명령어가 없습니다.';
    }
    
    // 버튼 상태 업데이트
    const enableBtn = document.getElementById('modal-enable-btn');
    const disableBtn = document.getElementById('modal-disable-btn');
    
    if (module.enabled) {
        enableBtn.disabled = true;
        disableBtn.disabled = false;
    } else {
        enableBtn.disabled = false;
        disableBtn.disabled = true;
    }
    
    // 모달 표시
    document.getElementById('module-info-modal').style.display = 'block';
}

// 모듈 모달 닫기
function closeModuleModal() {
    document.getElementById('module-info-modal').style.display = 'none';
    currentModule = null;
}

// 사용자 설정 업데이트
function updateUserSettings(settings) {
    if (!settings) return;
    
    // 폼 필드 업데이트
    const prefixInput = document.getElementById('setting-prefix');
    const notifyErrorsCheck = document.getElementById('setting-notify-errors');
    const notifyJoinsCheck = document.getElementById('setting-notify-joins');
    const notifyCommandsCheck = document.getElementById('setting-notify-commands');
    
    if (prefixInput) prefixInput.value = settings.prefix || '!';
    if (notifyErrorsCheck) notifyErrorsCheck.checked = settings.notifyErrors !== false;
    if (notifyJoinsCheck) notifyJoinsCheck.checked = settings.notifyJoins !== false;
    if (notifyCommandsCheck) notifyCommandsCheck.checked = settings.notifyCommands !== false;
}

// 사용자 설정 저장
function saveUserSettings() {
    const settings = {
        prefix: document.getElementById('setting-prefix').value,
        notifyErrors: document.getElementById('setting-notify-errors').checked,
        notifyJoins: document.getElementById('setting-notify-joins').checked,
        notifyCommands: document.getElementById('setting-notify-commands').checked
    };
    
    WebSocketManager.sendMessage({
        command: 'saveUserSettings',
        settings: settings
    });
    
    Utilities.showNotification('설정을 저장 중입니다...', 'info');
}

// 웹소켓 응답 핸들러 등록
WebSocketManager.messageHandlers['moduleStatus'] = (message) => {
    if (message.moduleStatus) {
        updateModulesList(message.moduleStatus);
    }
};

WebSocketManager.messageHandlers['userSettings'] = (message) => {
    if (message.settings) {
        updateUserSettings(message.settings);
    }
};

WebSocketManager.messageHandlers['userSettingsUpdate'] = (message) => {
    Utilities.showNotification(message.message, 'success');
    if (message.userSettings) {
        updateUserSettings(message.userSettings);
    }
};

WebSocketManager.messageHandlers['userSettingsError'] = (message) => {
    Utilities.showNotification(message.message, 'error');
};
