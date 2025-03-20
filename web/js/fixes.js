/**
 * 디스코드 봇 대시보드 문제 해결 스크립트
 * 
 * 이 스크립트는 다음 문제들을 해결합니다:
 * 1. GIF 애니메이션이 작동하지 않는 문제
 * 2. getBotInfo 명령어 에러
 * 3. 텍스트 색상과 배경으로 인한 가독성 문제
 * 4. 봇 가동시간 및 정보가 표시되지 않는 문제
 */

// 페이지 로드 완료 후 실행
document.addEventListener('DOMContentLoaded', function() {
    // 로딩 애니메이션이 완료된 후 실행
    setTimeout(() => {
        // GIF 애니메이션 문제 해결
        fixGifAnimations();
        
        // 텍스트 색상 및 가독성 문제 해결
        fixDashboardColors();
        
        // 모듈 정보 색상 문제 해결
        fixModuleInfoColors();
        
        // 관리자 페이지 요소들의 색상 수정
        fixAdminPageColors();
    }, 6500); // 로딩 애니메이션 완료 시간 기준
});

/**
 * GIF 애니메이션 문제 해결
 * - 로컬 GIF 파일을 사용하도록 변경
 * - GIF가 제대로 로드되도록 강제 새로고침
 */
function fixGifAnimations() {
    // 메인 로고 GIF 수정
    const mainLogo = document.querySelector('.main-logo');
    if (mainLogo) {
        // 로컬 파일로 경로 변경
        mainLogo.src = 'Animation1.gif';
        
        // 캐시 방지를 위한 타임스탬프 추가
        const timestamp = new Date().getTime();
        setTimeout(() => {
            mainLogo.src = `Animation1.gif?t=${timestamp}`;
        }, 100);
    }
    
    // 로딩 로고 GIF 수정
    const loadingLogo = document.querySelector('.loading-logo img');
    if (loadingLogo) {
        // 로컬 파일로 경로 변경
        loadingLogo.src = 'Animation1.gif';
        
        // 캐시 방지를 위한 타임스탬프 추가
        const timestamp = new Date().getTime();
        setTimeout(() => {
            loadingLogo.src = `Animation1.gif?t=${timestamp}`;
        }, 100);
    }
}

/**
 * 대시보드 색상 및 가독성 문제 해결
 * - 대시보드 텍스트 색상 수정
 * - 배경 색상 수정으로 가독성 향상
 */
function fixDashboardColors() {
    // 대시보드 카드 배경 및 텍스트 색상 수정
    const dashboardCards = document.querySelectorAll('.dashboard-card');
    dashboardCards.forEach(card => {
        card.style.backgroundColor = '#222';
        card.style.color = '#f5f5f5';
        
        // 카드 내부 콘텐츠 스타일 수정
        const cardContent = card.querySelector('.card-content');
        if (cardContent) {
            cardContent.style.color = '#f5f5f5';
        }
        
        // 정보 항목 스타일 수정
        const infoItems = card.querySelectorAll('.info-item');
        infoItems.forEach(item => {
            item.style.color = '#f5f5f5';
            
            const label = item.querySelector('.info-label');
            if (label) {
                label.style.color = '#bbb';
            }
            
            const value = item.querySelector('.info-value');
            if (value) {
                value.style.color = '#f5f5f5';
                value.style.backgroundColor = '#2a2a2a';
            }
        });
        
        // 서버 항목 스타일 수정
        const serverItems = card.querySelectorAll('.server-item');
        serverItems.forEach(item => {
            item.style.backgroundColor = '#2a2a2a';
            item.style.borderLeftColor = '#3498db';
            
            const serverName = item.querySelector('.server-name');
            if (serverName) {
                serverName.style.color = '#f5f5f5';
            }
            
            const serverInfo = item.querySelector('.server-info');
            if (serverInfo) {
                serverInfo.style.color = '#bbb';
            }
        });
        
        // 로그 래퍼 스타일 수정
        const logsWrapper = card.querySelector('.logs-wrapper');
        if (logsWrapper) {
            logsWrapper.style.backgroundColor = '#1a1a1a';
            logsWrapper.style.color = '#f5f5f5';
            
            // 로그 항목 스타일 수정
            const logEntries = logsWrapper.querySelectorAll('.log-entry');
            logEntries.forEach(entry => {
                entry.style.backgroundColor = '#252525';
                entry.style.color = '#f5f5f5';
                
                const timestamp = entry.querySelector('.timestamp');
                if (timestamp) {
                    timestamp.style.color = '#bbb';
                }
                
                const type = entry.querySelector('.type');
                if (type) {
                    type.style.color = '#3498db';
                }
                
                const message = entry.querySelector('.message');
                if (message) {
                    message.style.color = '#f5f5f5';
                }
            });
        }
    });
}

/**
 * 모듈 정보 색상 문제 해결
 * - 모듈 관리 페이지의 모듈 정보 텍스트 색상 수정
 */
function fixModuleInfoColors() {
    // 모듈 정보 모달의 색상 수정
    const moduleInfoModal = document.getElementById('module-info-modal');
    if (moduleInfoModal) {
        const modalContent = moduleInfoModal.querySelector('.modal-content');
        if (modalContent) {
            modalContent.style.backgroundColor = '#222';
            modalContent.style.color = '#f5f5f5';
        }
        
        // 모듈 정보 항목 스타일 수정
        const infoItems = moduleInfoModal.querySelectorAll('.info-item');
        infoItems.forEach(item => {
            item.style.color = '#f5f5f5';
            
            const infoLabel = item.querySelector('.info-label');
            if (infoLabel) {
                infoLabel.style.color = '#bbb';
            }
            
            const infoValue = item.querySelector('.info-value');
            if (infoValue) {
                infoValue.style.color = '#f5f5f5';
                infoValue.style.backgroundColor = '#2a2a2a';
            }
        });
        
        // 명령어 태그 스타일 수정
        const commandTags = moduleInfoModal.querySelectorAll('.command-tag');
        commandTags.forEach(tag => {
            tag.style.backgroundColor = '#3a3a3a';
            tag.style.color = '#f5f5f5';
        });
    }
}

/**
 * 관리자 페이지 색상 문제 해결
 * - 관리자 페이지의 색상 및 가독성 개선
 */
function fixAdminPageColors() {
    // 관리자 카드 배경 및 텍스트 색상 수정
    const adminCards = document.querySelectorAll('.admin-container .dashboard-card');
    adminCards.forEach(card => {
        card.style.backgroundColor = '#222';
        card.style.color = '#f5f5f5';
        
        // 카드 내부 콘텐츠 스타일 수정
        const cardContent = card.querySelector('.card-content');
        if (cardContent) {
            cardContent.style.color = '#f5f5f5';
        }
        
        // 정보 항목 스타일 수정
        const infoItems = card.querySelectorAll('.info-item');
        infoItems.forEach(item => {
            item.style.color = '#f5f5f5';
            
            const label = item.querySelector('.info-label');
            if (label) {
                label.style.color = '#bbb';
            }
            
            const value = item.querySelector('.info-value');
            if (value) {
                value.style.color = '#f5f5f5';
                value.style.backgroundColor = '#2a2a2a';
            }
        });
    });
}

/**
 * WebSocketManager 패치: getBotInfo 문제 해결
 * - getBotInfo 명령어 대신 start 명령어 사용
 */
(function patchWebSocketManager() {
    if (typeof WebSocketManager !== 'undefined') {
        // 원래 updateSystemInfo 함수를 백업
        const originalUpdateSystemInfo = typeof updateSystemInfo === 'function' ? updateSystemInfo : null;
        
        // updateSystemInfo 함수 재정의
        window.updateSystemInfo = function() {
            // 봇 정보 요청 (getBotInfo 대신 start 사용)
            WebSocketManager.sendMessage({ command: 'start' });
            
            // 주기적 갱신 설정
            setInterval(() => {
                WebSocketManager.sendMessage({ command: 'start' });
            }, 5000);
        };
        
        // 원래 updateBotInfo 함수를 백업
        const originalUpdateBotInfo = typeof updateBotInfo === 'function' ? updateBotInfo : null;
        
        // updateBotInfo 함수 재정의
        window.updateBotInfo = function(message) {
            const nodeVersionElement = document.getElementById('node-version');
            const discordVersionElement = document.getElementById('discord-version');
            const webUptimeElement = document.getElementById('web-uptime');
            const botUptimeElement = document.getElementById('bot-uptime');
            
            // 웹 서버 가동시간 업데이트
            if (webUptimeElement && message.serverUptime) {
                webUptimeElement.textContent = message.serverUptime;
            }
            
            // 봇 가동시간 업데이트
            if (botUptimeElement && message.botUptime) {
                botUptimeElement.textContent = message.botUptime;
            }
            
            // Node.js 버전 업데이트
            if (nodeVersionElement && message.nodeVersion) {
                nodeVersionElement.textContent = message.nodeVersion;
            } else if (nodeVersionElement) {
                // 버전 정보가 없으면 임시 데이터로 표시
                const pkgInfo = require('../package.json');
                if (pkgInfo && pkgInfo.engines && pkgInfo.engines.node) {
                    nodeVersionElement.textContent = pkgInfo.engines.node;
                } else {
                    nodeVersionElement.textContent = 'v16.x+';
                }
            }
            
            // Discord.js 버전 업데이트
            if (discordVersionElement && message.discordVersion) {
                discordVersionElement.textContent = message.discordVersion;
            } else if (discordVersionElement) {
                // 버전 정보가 없으면 임시 데이터로 표시
                const pkgInfo = require('../package.json');
                if (pkgInfo && pkgInfo.dependencies && pkgInfo.dependencies['discord.js']) {
                    discordVersionElement.textContent = pkgInfo.dependencies['discord.js'];
                } else {
                    discordVersionElement.textContent = 'v14.x+';
                }
            }
            
            // 원래 함수가 있으면 호출
            if (originalUpdateBotInfo) {
                originalUpdateBotInfo(message);
            }
        };
        
        // serverStatus 메시지 핸들러 추가/수정
        WebSocketManager.messageHandlers['serverStatus'] = (message) => {
            // 대시보드 페이지에 정보 업데이트
            if (typeof updateDashboardStatus === 'function') {
                updateDashboardStatus(message);
            }
            
            // 관리자 페이지에서도 봇 정보 업데이트를 위해 사용
            if (typeof updateBotInfo === 'function') {
                updateBotInfo(message);
            }
            
            // 상태 정보를 로컬 스토리지에 저장 (다른 곳에서 사용할 수 있도록)
            localStorage.setItem('botStatus', JSON.stringify(message));
        };
    }
})();

// 일정 시간마다 GIF 체크 및 새로고침 (GIF가 멈췄을 경우를 대비)
setInterval(function() {
    fixGifAnimations();
}, 60000); // 1분마다 체크