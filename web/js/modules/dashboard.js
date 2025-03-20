/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 대시보드 기능 개선
 */

// 대시보드 업데이트 함수
function updateDashboardStatus(data) {
    // 봇 상태 표시 업데이트
    const botStatusIndicator = document.getElementById('bot-status-indicator');
    const botStatusText = document.getElementById('bot-status-text');
    
    if (botStatusIndicator && botStatusText) {
        // 봇이 실행 중인지 확인
        const isRunning = data.isRunning || false;
        
        if (isRunning) {
            botStatusIndicator.className = 'status-indicator online';
            botStatusText.textContent = '온라인';
        } else {
            botStatusIndicator.className = 'status-indicator offline';
            botStatusText.textContent = '오프라인';
        }
        
        // 버튼 활성화/비활성화
        const startBtn = document.getElementById('start-bot-btn');
        const stopBtn = document.getElementById('stop-bot-btn');
        
        if (startBtn && stopBtn) {
            startBtn.disabled = isRunning;
            stopBtn.disabled = !isRunning;
        }
    }
    
    // 시스템 정보 업데이트
    updateSystemInfo(data);
    
    // 서버 목록 업데이트
    if (data.servers) {
        updateServersList(data.servers);
    }
    
    // 로그 업데이트
    if (data.logs) {
        updateBotLogs(data.logs);
    }
}

// 시스템 정보 업데이트 함수
function updateSystemInfo(data) {
    // 가동 시간 표시
    const webUptimeElement = document.getElementById('web-uptime');
    const botUptimeElement = document.getElementById('bot-uptime');
    
    if (webUptimeElement) {
        webUptimeElement.textContent = data.serverUptime || '정보 없음';
    }
    
    if (botUptimeElement) {
        botUptimeElement.textContent = data.botUptime || '정보 없음';
    }
    
    // 모듈 수 표시
    const loadedModulesElement = document.getElementById('loaded-modules');
    if (loadedModulesElement && data.modules) {
        loadedModulesElement.textContent = Array.isArray(data.modules) ? 
            `${data.modules.length} 모듈` : 
            typeof data.modules === 'number' ? 
                `${data.modules} 모듈` : 
                '정보 없음';
    }
}

// 서버 목록 업데이트 함수
function updateServersList(servers) {
    const serversContainer = document.getElementById('servers-container');
    if (!serversContainer) return;
    
    // 컨테이너 비우기
    serversContainer.innerHTML = '';
    
    // 서버가 없을 경우
    if (!servers || servers.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '<i class="fas fa-network-wired"></i><p>서버가 없습니다.</p>';
        serversContainer.appendChild(emptyState);
        return;
    }
    
    // 서버 목록 생성
    servers.forEach(server => {
        const serverItem = document.createElement('div');
        serverItem.className = 'server-item';
        
        const serverName = document.createElement('div');
        serverName.className = 'server-name';
        serverName.textContent = server.name || '이름 없음';
        
        const serverInfo = document.createElement('div');
        serverInfo.className = 'server-info';
        serverInfo.innerHTML = `<span>ID: ${server.id}</span><span>멤버: ${server.memberCount || 0}</span>`;
        
        serverItem.appendChild(serverName);
        serverItem.appendChild(serverInfo);
        serversContainer.appendChild(serverItem);
    });
}

// 봇 로그 업데이트 함수
function updateBotLogs(logs) {
    const logsContainer = document.getElementById('logs-container');
    if (!logsContainer) return;
    
    // 빈 상태 메시지 제거
    const emptyState = logsContainer.querySelector('.empty-state');
    if (emptyState) {
        logsContainer.removeChild(emptyState);
    }
    
    // 이전 로그 엔트리 수
    const prevEntryCount = logsContainer.querySelectorAll('.log-entry').length;
    
    // 각 로그 타입별 색상
    const typeColors = {
        'INFO': '#3498db',
        'ERROR': '#e74c3c',
        'COMMAND': '#9b59b6',
        'MODULE': '#2ecc71'
    };
    
    // 새로운 로그만 추가 (최신 로그가 맨 위에 표시)
    const newLogs = logs.slice(0, logs.length - prevEntryCount);
    
    newLogs.forEach(log => {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${log.type}`;
        logEntry.setAttribute('data-type', log.type);
        
        // 타임스탬프 포맷팅
        let formattedTime = '';
        try {
            const timestamp = new Date(log.timestamp);
            formattedTime = timestamp.toLocaleTimeString();
        } catch (e) {
            console.warn('로그 타임스탬프 파싱 오류:', e);
            formattedTime = '00:00:00';
        }
        
        logEntry.innerHTML = `
            <span class="timestamp">[${formattedTime}]</span>
            <span class="type" style="color: ${typeColors[log.type] || '#666'}">${log.type}</span>
            <span class="message">${log.message}</span>
        `;
        
        // 로그 컨테이너의 맨 앞에 추가 (최신 로그가 위에 표시)
        if (logsContainer.firstChild) {
            logsContainer.insertBefore(logEntry, logsContainer.firstChild);
        } else {
            logsContainer.appendChild(logEntry);
        }
    });
    
    // 로그 필터 적용
    const logFilterSelect = document.getElementById('log-filter-select');
    if (logFilterSelect && logFilterSelect.value !== 'all') {
        filterLogs(logFilterSelect.value);
    }
}

// 로그 필터링 함수
function filterLogs(filterValue) {
    // DOM에서 로그 엔트리 모두 가져오기
    const logEntries = document.querySelectorAll('.log-entry');
    
    // 필터링 적용
    logEntries.forEach(entry => {
        if (filterValue === 'all') {
            entry.style.display = 'block';
        } else {
            const logType = entry.getAttribute('data-type');
            entry.style.display = (logType === filterValue) ? 'block' : 'none';
        }
    });
}

// 대시보드 모듈 초기화 함수
function initDashboardModule() {
    console.log('대시보드 모듈 초기화');
    
    // 이벤트 리스너 등록
    registerDashboardEventListeners();
    
    // 로그 필터 초기화
    initLogFilter();
    
    // 최초 업데이트 요청
    WebSocketManager.sendMessage({ command: 'start' });
}

// 이벤트 리스너 등록 함수
function registerDashboardEventListeners() {
    // 봇 제어 버튼 이벤트
    const startBtn = document.getElementById('start-bot-btn');
    const stopBtn = document.getElementById('stop-bot-btn');
    const restartBtn = document.getElementById('restart-bot-btn');
    const clearLogsBtn = document.getElementById('clear-logs-btn');
    
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            startBtn.disabled = true; // 중복 클릭 방지
            WebSocketManager.sendMessage({ command: 'start' });
            Utilities.showNotification('봇 시작 요청 중...', 'info');
        });
    }
    
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (confirm('정말 봇을 종료하시겠습니까?')) {
                stopBtn.disabled = true; // 중복 클릭 방지
                WebSocketManager.sendMessage({ command: 'stop' });
                Utilities.showNotification('봇 종료 요청 중...', 'info');
            }
        });
    }
    
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            if (confirm('봇을 재시작하시겠습니까?')) {
                restartBtn.disabled = true; // 중복 클릭 방지
                WebSocketManager.sendMessage({ command: 'restart' });
                Utilities.showNotification('봇 재시작 요청 중...', 'info');
                
                // 3초 후 버튼 다시 활성화
                setTimeout(() => {
                    restartBtn.disabled = false;
                }, 3000);
            }
        });
    }
    
    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', () => {
            clearLogs();
        });
    }
    
    // 로그 필터 변경 이벤트
    const logFilterSelect = document.getElementById('log-filter-select');
    if (logFilterSelect) {
        logFilterSelect.addEventListener('change', () => {
            filterLogs(logFilterSelect.value);
            // 필터 선택 저장
            localStorage.setItem('dashboard_log_filter', logFilterSelect.value);
        });
    }
}

// 로그 필터 초기화
function initLogFilter() {
    // 로컬 스토리지에서 저장된 필터 값 불러오기
    const savedFilter = localStorage.getItem('dashboard_log_filter');
    if (savedFilter) {
        const logFilterSelect = document.getElementById('log-filter-select');
        if (logFilterSelect) {
            logFilterSelect.value = savedFilter;
            filterLogs(savedFilter);
        }
    }
}

// 로그 초기화 함수
function clearLogs() {
    const logsContainer = document.getElementById('logs-container');
    if (logsContainer) {
        // 모든 로그 엔트리 제거
        logsContainer.innerHTML = '';
        
        // 빈 상태 메시지 추가
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '<i class="fas fa-file-alt"></i><p>로그가 없습니다.</p>';
        logsContainer.appendChild(emptyState);
    }
}

// 모듈 정보 갱신 함수 - 모듈 관리 페이지용
function updateModulesList(moduleStatus) {
    console.log('모듈 정보 업데이트 시작');
    const modulesContainer = document.getElementById('modules-container');
    if (!modulesContainer) {
        console.log('모듈 컨테이너가 존재하지 않습니다.');
        return;
    }
    
    // 컨테이너 비우기
    modulesContainer.innerHTML = '';
    
    // 모듈이 없을 경우
    if (!moduleStatus || Object.keys(moduleStatus).length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '<i class="fas fa-puzzle-piece"></i><p>등록된 모듈이 없습니다.</p>';
        modulesContainer.appendChild(emptyState);
        console.log('모듈이 없습니다.');
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
            // 모듈 모달 표시 함수 호출
            if (typeof showModuleModal === 'function') {
                showModuleModal(fileName, module);
            } else {
                console.log('showModuleModal 함수가 정의되지 않았습니다.');
            }
        });
        
        modulesContainer.appendChild(moduleItem);
    });
    
    console.log('모듈 정보 업데이트 완료');
}

// 온라인 관리자 목록 업데이트 함수
function updateOnlineAdmins(admins) {
    const onlineAdminsList = document.getElementById('online-admins-list');
    if (!onlineAdminsList) return;
    
    // 목록 초기화
    onlineAdminsList.innerHTML = '';
    
    if (!admins || admins.length === 0) {
        onlineAdminsList.innerHTML = '<div class="no-admins">온라인 관리자가 없습니다.</div>';
        return;
    }
    
    // 관리자 목록 생성
    admins.forEach(admin => {
        const adminItem = document.createElement('div');
        adminItem.className = 'admin-item';
        
        let roleIcon = 'fa-user';
        let roleClass = 'role-user';
        
        if (admin.role === 'admin' || admin.role === 'level1') {
            roleIcon = 'fa-crown';
            roleClass = 'role-admin';
        } else if (admin.role === 'level2') {
            roleIcon = 'fa-shield-alt';
            roleClass = 'role-mod';
        } else if (admin.role === 'level3') {
            roleIcon = 'fa-user-shield';
            roleClass = 'role-helper';
        }
        
        adminItem.innerHTML = `
            <div class="admin-name">
                <i class="fas ${roleIcon} ${roleClass}"></i>
                ${admin.username}
            </div>
            <div class="admin-status">온라인</div>
        `;
        
        onlineAdminsList.appendChild(adminItem);
    });
}

// 임베드 모듈 개선 - 서버/채널 선택 기능
function fixEmbedServerSelection() {
    const serverSelect = document.getElementById('server-select');
    const channelSelect = document.getElementById('channel-select');
    
    if (!serverSelect || !channelSelect) return;
    
    // 서버 목록 로드
    loadServersList();
    
    // 서버 선택 이벤트
    serverSelect.addEventListener('change', () => {
        if (serverSelect.value) {
            loadChannelsList(serverSelect.value);
        }
    });
    
    // 서버 목록 로드 함수
    function loadServersList() {
        // 기존 옵션 초기화 (첫 번째 옵션 제외)
        while (serverSelect.options.length > 1) {
            serverSelect.remove(1);
        }
        
        // 상태 업데이트 요청
        WebSocketManager.sendMessage({ command: 'start' }, () => {
            // 로컬 스토리지에서 봇 상태 정보 가져오기
            const botStatus = localStorage.getItem('botStatus');
            if (!botStatus) return;
            
            try {
                const status = JSON.parse(botStatus);
                if (status.servers && status.servers.length > 0) {
                    // 서버 목록 옵션 추가
                    status.servers.forEach(server => {
                        const option = document.createElement('option');
                        option.value = server.id;
                        option.textContent = server.name;
                        serverSelect.appendChild(option);
                    });
                } else {
                    // 서버가 없을 경우
                    const option = document.createElement('option');
                    option.disabled = true;
                    option.textContent = '등록된 서버가 없습니다';
                    serverSelect.appendChild(option);
                }
            } catch (e) {
                console.error('서버 목록 파싱 오류:', e);
            }
        });
    }
    
    // 채널 목록 로드 함수
    function loadChannelsList(serverId) {
        // 기존 옵션 초기화
        while (channelSelect.options.length > 1) {
            channelSelect.remove(1);
        }
        
        // 로딩 옵션 추가
        const loadingOption = document.createElement('option');
        loadingOption.disabled = true;
        loadingOption.textContent = '채널 목록 로딩 중...';
        channelSelect.appendChild(loadingOption);
        
        // 채널 목록 요청
        WebSocketManager.sendMessage({
            command: 'getChannels',
            serverId: serverId
        }, (response) => {
            // 기존 옵션 초기화 (첫 번째 옵션 제외)
            while (channelSelect.options.length > 1) {
                channelSelect.remove(1);
            }
            
            if (!response.channels || response.channels.length === 0) {
                // 채널이 없을 경우
                const option = document.createElement('option');
                option.disabled = true;
                option.textContent = response.error || '등록된 채널이 없습니다';
                channelSelect.appendChild(option);
                return;
            }
            
            // 텍스트 채널만 필터링 (type 0은 텍스트 채널)
            const textChannels = response.channels.filter(channel => channel.type === 0);
            
            if (textChannels.length === 0) {
                // 텍스트 채널이 없을 경우
                const option = document.createElement('option');
                option.disabled = true;
                option.textContent = '텍스트 채널이 없습니다';
                channelSelect.appendChild(option);
                return;
            }
            
            // 채널 목록 옵션 추가
            textChannels.forEach(channel => {
                const option = document.createElement('option');
                option.value = channel.id;
                option.textContent = '#' + channel.name;
                channelSelect.appendChild(option);
            });
        });
    }
}

// 페이지 로드 완료 후 실행
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        // 모듈 초기화가 완료된 후 개선 기능 적용
        const currentModule = window.location.hash.substring(1);
        if (currentModule === 'embed') {
            fixEmbedServerSelection();
        }
    }, 6500); // 로딩 애니메이션 완료 시간 기준
});

// 모듈 초기화 시 엠베드 모듈 개선 적용
document.addEventListener('module_loaded', function(e) {
    if (e.detail === 'embed') {
        setTimeout(() => {
            fixEmbedServerSelection();
        }, 500);
    }
});