/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 대시보드 모듈 기능
 */

// 대시보드 모듈 초기화 함수
function initDashboardModule() {
    console.log('대시보드 모듈 초기화');
    
    // 이벤트 리스너 등록
    registerDashboardEventListeners();
    
    // 로그 필터 초기화
    initLogFilter();
    
    // 최초 업데이트 요청
    WebSocketManager.requestDashboardData();
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
            WebSocketManager.sendMessage({ command: 'start' });
        });
    }
    
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (confirm('정말 봇을 종료하시겠습니까?')) {
                WebSocketManager.sendMessage({ command: 'stop' });
            }
        });
    }
    
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            if (confirm('봇을 재시작하시겠습니까?')) {
                WebSocketManager.sendMessage({ command: 'restart' });
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

// 로그 필터링 함수
function filterLogs(filterValue) {
    // 필터 값 저장
    localStorage.setItem('dashboard_log_filter', filterValue);
    
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

// 로그 초기화 함수
function clearLogs() {
    const logsContainer = document.getElementById('logs-container');
    if (logsContainer) {
        // 모든 로그 엔트리 제거
        while (logsContainer.firstChild) {
            logsContainer.removeChild(logsContainer.firstChild);
        }
        
        // 빈 상태 메시지 추가
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '<i class="fas fa-file-alt"></i><p>로그가 없습니다.</p>';
        logsContainer.appendChild(emptyState);
    }
}

// 대시보드 상태 업데이트
function updateDashboardStatus(data) {
    // 빈 데이터 처리
    if (!data) return;
    
    // 봇 상태 업데이트
    updateBotStatus(data.botStatus);
    
    // 가동 시간 업데이트
    const webUptimeElement = document.getElementById('web-uptime');
    const botUptimeElement = document.getElementById('bot-uptime');
    
    if (webUptimeElement) {
        webUptimeElement.textContent = data.serverUptime || '-';
    }
    
    if (botUptimeElement) {
        botUptimeElement.textContent = data.botUptime || '-';
    }
    
    // 로드된 모듈 수 업데이트
    const loadedModulesElement = document.getElementById('loaded-modules');
    if (loadedModulesElement && data.modules) {
        loadedModulesElement.textContent = `${data.modules.length} 모듈`;
    }
    
    // 서버 목록 업데이트
    if (data.servers) {
        updateServersList(data.servers);
    }
    
    // 로그 업데이트
    if (data.logs) {
        updateBotLogs(data.logs);
    }
}

// 봇 상태 표시 업데이트
function updateBotStatus(status) {
    const statusIndicator = document.getElementById('bot-status-indicator');
    const statusText = document.getElementById('bot-status-text');
    
    if (statusIndicator && statusText) {
        if (status === '실행 중') {
            statusIndicator.className = 'status-indicator online';
            statusText.textContent = '온라인';
        } else {
            statusIndicator.className = 'status-indicator offline';
            statusText.textContent = '오프라인';
        }
    }
    
    // 버튼 상태 업데이트
    const startBtn = document.getElementById('start-bot-btn');
    const stopBtn = document.getElementById('stop-bot-btn');
    
    if (startBtn && stopBtn) {
        if (status === '실행 중') {
            startBtn.disabled = true;
            stopBtn.disabled = false;
        } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }
    }
}

// 서버 목록 업데이트
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
        serverName.textContent = server.name;
        
        const serverInfo = document.createElement('div');
        serverInfo.className = 'server-info';
        serverInfo.innerHTML = `<span>ID: ${server.id}</span><span>Members: ${server.memberCount}</span>`;
        
        serverItem.appendChild(serverName);
        serverItem.appendChild(serverInfo);
        serversContainer.appendChild(serverItem);
    });
}

// 봇 로그 업데이트
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
    
    // 모든 로그 추가 (최신 로그가 맨 위에 표시)
    logs.forEach((log, index) => {
        // 이미 추가된 로그는 건너뛰기
        if (index < prevEntryCount) return;
        
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${log.type}`;
        logEntry.setAttribute('data-type', log.type);
        
        // 타임스탬프 포맷팅
        const timestamp = new Date(log.timestamp);
        const formattedTime = timestamp.toLocaleTimeString();
        
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
