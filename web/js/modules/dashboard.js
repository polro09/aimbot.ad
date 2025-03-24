/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 대시보드 기능 개선 - 수정 버전
 */

// 버튼 상태를 추적하기 위한 변수
let botControlsDisabled = false;

// 대시보드 업데이트 함수
function updateDashboardStatus(data) {
    // 봇 상태 표시 업데이트
    const botStatusIndicator = document.getElementById('bot-status-indicator');
    const botStatusText = document.getElementById('bot-status-text');
    
    if (botStatusIndicator && botStatusText) {
        // 봇이 실행 중인지 확인 (isRunning이 없으면 botStatus 확인)
        const isRunning = data.isRunning !== undefined ? data.isRunning : 
                         (data.botStatus === '실행 중' || data.botStatus === 'online');
        
        if (isRunning) {
            botStatusIndicator.className = 'status-indicator online';
            botStatusText.textContent = '온라인';
        } else {
            botStatusIndicator.className = 'status-indicator offline';
            botStatusText.textContent = '오프라인';
        }
        
        // 버튼 활성화/비활성화
        updateControlButtons(isRunning);
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

// 제어 버튼 상태 업데이트 - 수정된 함수
function updateControlButtons(isRunning) {
    const startBtn = document.getElementById('start-bot-btn');
    const stopBtn = document.getElementById('stop-bot-btn');
    const restartBtn = document.getElementById('restart-bot-btn');
    
    // 버튼이 비활성화 상태인 경우 변경하지 않음
    if (botControlsDisabled) return;
    
    if (startBtn && stopBtn && restartBtn) {
        startBtn.disabled = isRunning;
        stopBtn.disabled = !isRunning;
        restartBtn.disabled = !isRunning;
    }
}

// 시스템 정보 업데이트 함수
function updateSystemInfo(data) {
    // 가동 시간 표시
    const webUptimeElement = document.getElementById('web-uptime');
    const botUptimeElement = document.getElementById('bot-uptime');
    const loadedModulesElement = document.getElementById('loaded-modules');
    
    if (webUptimeElement) {
        webUptimeElement.textContent = data.serverUptime || '정보 없음';
    }
    
    if (botUptimeElement) {
        botUptimeElement.textContent = data.botUptime || '정보 없음';
    }
    
    // 모듈 수 표시
    if (loadedModulesElement) {
        let moduleCount = 0;
        if (data.modules) {
            if (Array.isArray(data.modules)) {
                moduleCount = data.modules.length;
            } else if (typeof data.modules === 'number') {
                moduleCount = data.modules;
            } else if (typeof data.moduleStatus === 'object') {
                moduleCount = Object.keys(data.moduleStatus).length;
            }
        }
        
        loadedModulesElement.textContent = moduleCount > 0 ? 
            `${moduleCount} 모듈` : 
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
    
    // 이미 표시된 로그 ID 추적
    const existingLogIds = new Set();
    logsContainer.querySelectorAll('.log-entry').forEach(entry => {
        if (entry.dataset.logId) {
            existingLogIds.add(entry.dataset.logId);
        }
    });
    
    // 각 로그 타입별 색상
    const typeColors = {
        'INFO': '#3498db',
        'ERROR': '#e74c3c',
        'COMMAND': '#9b59b6',
        'MODULE': '#2ecc71'
    };
    
    // 새로운 로그만 추가 (최신 로그가 맨 위에 표시)
    if (logs && logs.length > 0) {
        let logsAdded = 0;
        
        for (let i = 0; i < logs.length; i++) {
            const log = logs[i];
            // 타임스탬프와 메시지로 고유 ID 생성
            const logId = `${log.timestamp}-${log.message}`.replace(/[^a-zA-Z0-9]/g, '');
            
            // 이미 표시된 로그는 건너뛰기
            if (existingLogIds.has(logId)) {
                continue;
            }
            
            const logEntry = document.createElement('div');
            logEntry.className = `log-entry ${log.type}`;
            logEntry.setAttribute('data-type', log.type);
            logEntry.setAttribute('data-log-id', logId);
            
            // 타임스탬프 포맷팅
            let formattedTime = '';
            try {
                const timestamp = new Date(log.timestamp);
                formattedTime = timestamp.toLocaleTimeString();
            } catch (e) {
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
            
            logsAdded++;
            
            // 최대 100개 로그 유지
            if (logsContainer.childElementCount > 100) {
                logsContainer.removeChild(logsContainer.lastChild);
            }
        }
    }
    
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
    setTimeout(() => {
        WebSocketManager.sendMessage({ command: 'getBotStatus' });
    }, 300);
}

// 이벤트 리스너 등록 함수 - 수정된 버전
function registerDashboardEventListeners() {
    // 봇 제어 버튼 이벤트
    const startBtn = document.getElementById('start-bot-btn');
    const stopBtn = document.getElementById('stop-bot-btn');
    const restartBtn = document.getElementById('restart-bot-btn');
    const clearLogsBtn = document.getElementById('clear-logs-btn');
    
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            // 모든 제어 버튼 비활성화
            startBtn.disabled = true;
            stopBtn.disabled = true;
            restartBtn.disabled = true;
            botControlsDisabled = true;
            
            // 버튼 텍스트 변경
            const originalText = startBtn.innerHTML;
            startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 시작 중...';
            
            // 웹소켓 요청 전송
            WebSocketManager.sendMessage({ command: 'start' });
            
            // 1초 후 상태 업데이트 요청 및 버튼 원상복구
            setTimeout(() => {
                WebSocketManager.sendMessage({ command: 'getBotStatus' });
                startBtn.innerHTML = originalText;
                botControlsDisabled = false;
            }, 1000);
        });
    }
    
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (confirm('정말 봇을 종료하시겠습니까?')) {
                // 모든 제어 버튼 비활성화
                startBtn.disabled = true;
                stopBtn.disabled = true;
                restartBtn.disabled = true;
                botControlsDisabled = true;
                
                // 버튼 텍스트 변경
                const originalText = stopBtn.innerHTML;
                stopBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 정지 중...';
                
                // 웹소켓 요청 전송
                WebSocketManager.sendMessage({ command: 'stop' });
                
                // 1초 후 상태 업데이트 요청 및 버튼 원상복구
                setTimeout(() => {
                    WebSocketManager.sendMessage({ command: 'getBotStatus' });
                    stopBtn.innerHTML = originalText;
                    botControlsDisabled = false;
                }, 1000);
            }
        });
    }
    
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            if (confirm('봇을 재시작하시겠습니까?')) {
                // 모든 제어 버튼 비활성화
                startBtn.disabled = true;
                stopBtn.disabled = true;
                restartBtn.disabled = true;
                botControlsDisabled = true;
                
                // 버튼 텍스트 변경
                const originalText = restartBtn.innerHTML;
                restartBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 재시작 중...';
                
                // 웹소켓 요청 전송
                WebSocketManager.sendMessage({ command: 'restart' });
                
                // 3초 후 상태 업데이트 요청 및 버튼 원상복구
                setTimeout(() => {
                    WebSocketManager.sendMessage({ command: 'getBotStatus' });
                    restartBtn.innerHTML = originalText;
                    botControlsDisabled = false;
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
        WebSocketManager.sendMessage({ command: 'getBotStatus' }, (response) => {
            if (response.servers && response.servers.length > 0) {
                // 서버 목록 옵션 추가
                response.servers.forEach(server => {
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
        });
        
        // 채널 목록 로드 이벤트 리스너
        const loadHandler = function(event) {
            const channels = event.detail;
            
            // 기존 옵션 초기화 (첫 번째 옵션 제외)
            while (channelSelect.options.length > 1) {
                channelSelect.remove(1);
            }
            
            if (channels && channels.length > 0) {
                // 텍스트 채널만 필터링
                const textChannels = channels.filter(channel => channel.type === 0);
                
                if (textChannels.length > 0) {
                    // 채널 목록 옵션 추가
                    textChannels.forEach(channel => {
                        const option = document.createElement('option');
                        option.value = channel.id;
                        option.textContent = '#' + channel.name;
                        channelSelect.appendChild(option);
                    });
                } else {
                    // 텍스트 채널이 없을 경우
                    const option = document.createElement('option');
                    option.disabled = true;
                    option.textContent = '텍스트 채널이 없습니다';
                    channelSelect.appendChild(option);
                }
            } else {
                // 채널이 없을 경우
                const option = document.createElement('option');
                option.disabled = true;
                option.textContent = '등록된 채널이 없습니다';
                channelSelect.appendChild(option);
            }
            
            // 이벤트 리스너 제거 (중복 방지)
            document.removeEventListener('channels_loaded', loadHandler);
        };
        
        document.addEventListener('channels_loaded', loadHandler);
    }
}

// 페이지 로드 완료 후 실행
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(() => {
        // 대시보드 초기 상태 요청
        if (window.location.hash === '#dashboard') {
            WebSocketManager.sendMessage({ command: 'getBotStatus' });
        }
        
        // 임베드 페이지 초기화
        if (window.location.hash === '#embed') {
            fixEmbedServerSelection();
        }
    }, 2000); // 로딩 시간 단축
});

// 모듈 로드 이벤트 리스너
document.addEventListener('module_loaded', function(e) {
    if (e.detail === 'embed') {
        setTimeout(() => {
            fixEmbedServerSelection();
        }, 300);
    }
});