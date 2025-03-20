/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 임베드 모듈 기능
 */

// 임베드 모듈 초기화
function initEmbedModule() {
    console.log('임베드 모듈 초기화');
    
    // 이벤트 리스너 등록
    registerEmbedEventListeners();
    
    // 서버 목록 로드
    loadServersList();
    
    // 색상 입력 필드 동기화
    setupColorPicker();
    
    // 미리보기 초기화
    updateEmbedPreview();
}

// 이벤트 리스너 등록
function registerEmbedEventListeners() {
    // 서버 선택 시 채널 목록 로드
    const serverSelect = document.getElementById('server-select');
    if (serverSelect) {
        serverSelect.addEventListener('change', () => {
            loadChannelsList(serverSelect.value);
        });
    }
    
    // 임베드 폼 필드 변경 시 미리보기 업데이트
    const embedForm = document.getElementById('embed-form');
    if (embedForm) {
        // 모든 입력 필드에 이벤트 리스너 추가
        const inputFields = embedForm.querySelectorAll('input, textarea, select');
        inputFields.forEach(field => {
            field.addEventListener('input', updateEmbedPreview);
        });
    }
    
    // 필드 추가 버튼
    const addFieldBtn = document.getElementById('add-field-btn');
    if (addFieldBtn) {
        addFieldBtn.addEventListener('click', addNewField);
    }
    
    // 미리보기 버튼
    const previewBtn = document.getElementById('preview-btn');
    if (previewBtn) {
        previewBtn.addEventListener('click', () => {
            updateEmbedPreview();
            // 미리보기 영역으로 스크롤
            const previewElement = document.querySelector('.embed-preview');
            if (previewElement) {
                previewElement.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }
    
    // 전송 버튼
    const sendEmbedBtn = document.getElementById('send-embed-btn');
    if (sendEmbedBtn) {
        embedForm.addEventListener('submit', (e) => {
            e.preventDefault();
            sendEmbed();
        });
    }
}

// 서버 목록 로드
function loadServersList() {
    const serverSelect = document.getElementById('server-select');
    if (!serverSelect) return;
    
    // 기존 옵션 초기화 (첫 번째 옵션 제외)
    while (serverSelect.options.length > 1) {
        serverSelect.remove(1);
    }
    
    // 상태 업데이트 요청
    WebSocketManager.sendMessage({ command: 'start' }, (response) => {
        // 서버 목록 수신 시 처리할 부분
    });
    
    // 서버 목록 가져오기
    const botStatus = localStorage.getItem('botStatus');
    if (botStatus) {
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
    }
}

// 채널 목록 로드
function loadChannelsList(serverId) {
    const channelSelect = document.getElementById('channel-select');
    if (!channelSelect) return;
    
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
        // 채널 목록 수신 시 처리 (미구현)
    });
    
    // 웹소켓 응답 처리 이벤트 리스너
    document.addEventListener('channels_loaded', function handleChannelsLoaded(event) {
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
        
        // 이벤트 리스너 제거
        document.removeEventListener('channels_loaded', handleChannelsLoaded);
    });
}

// 색상 선택기 설정
function setupColorPicker() {
    const colorPicker = document.getElementById('embed-color');
    const colorHex = document.getElementById('embed-color-hex');
    
    if (colorPicker && colorHex) {
        // 색상 선택기 변경 시 HEX 값 업데이트
        colorPicker.addEventListener('input', () => {
            colorHex.value = colorPicker.value;
            updateEmbedPreview();
        });
        
        // HEX 값 변경 시 색상 선택기 업데이트
        colorHex.addEventListener('input', () => {
            // 유효한 HEX 값인지 확인
            if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(colorHex.value)) {
                colorPicker.value = colorHex.value;
                updateEmbedPreview();
            }
        });
    }
}

// 새 필드 추가
function addNewField() {
    const fieldsContainer = document.getElementById('fields-container');
    if (!fieldsContainer) return;
    
    // 필드 ID 생성
    const fieldId = 'field-' + Date.now();
    
    // 필드 요소 생성
    const fieldItem = document.createElement('div');
    fieldItem.className = 'field-item';
    fieldItem.dataset.fieldId = fieldId;
    
    fieldItem.innerHTML = `
        <button type="button" class="field-delete" onclick="removeField('${fieldId}')">
            <i class="fas fa-times"></i>
        </button>
        <div class="form-group">
            <label for="${fieldId}-name">필드 이름</label>
            <input type="text" id="${fieldId}-name" class="field-name" placeholder="필드 이름">
        </div>
        <div class="form-group">
            <label for="${fieldId}-value">필드 값</label>
            <textarea id="${fieldId}-value" class="field-value" placeholder="필드 값" rows="2"></textarea>
        </div>
        <div class="field-inline">
            <input type="checkbox" id="${fieldId}-inline" class="field-inline-check">
            <label for="${fieldId}-inline">인라인 필드</label>
        </div>
    `;
    
    fieldsContainer.appendChild(fieldItem);
    
    // 새 필드의 입력 요소에 이벤트 리스너 추가
    const inputElements = fieldItem.querySelectorAll('input, textarea');
    inputElements.forEach(element => {
        element.addEventListener('input', updateEmbedPreview);
    });
}

// 필드 제거
function removeField(fieldId) {
    const fieldItem = document.querySelector(`.field-item[data-field-id="${fieldId}"]`);
    if (fieldItem) {
        fieldItem.remove();
        updateEmbedPreview();
    }
}

// 임베드 미리보기 업데이트
function updateEmbedPreview() {
    const previewContainer = document.getElementById('embed-preview-content');
    if (!previewContainer) return;
    
    // 필수 정보 가져오기
    const title = document.getElementById('embed-title').value;
    const description = document.getElementById('embed-description').value;
    const color = document.getElementById('embed-color').value;
    const author = document.getElementById('embed-author').value;
    const footer = document.getElementById('embed-footer').value;
    const thumbnail = document.getElementById('embed-thumbnail').value;
    const image = document.getElementById('embed-image').value;
    
    // 임베드가 비어있는지 확인
    const isEmpty = !title && !description && !author && !footer && !thumbnail && !image;
    if (isEmpty) {
        previewContainer.innerHTML = `
            <div class="embed-placeholder">
                <i class="fas fa-eye"></i>
                <p>임베드를 작성하면 이곳에 미리보기가 표시됩니다.</p>
            </div>
        `;
        return;
    }
    
    // 필드 정보 가져오기
    const fields = [];
    const fieldItems = document.querySelectorAll('.field-item');
    fieldItems.forEach(item => {
        const fieldName = item.querySelector('.field-name').value;
        const fieldValue = item.querySelector('.field-value').value;
        const fieldInline = item.querySelector('.field-inline-check').checked;
        
        if (fieldName && fieldValue) {
            fields.push({
                name: fieldName,
                value: fieldValue,
                inline: fieldInline
            });
        }
    });
    
    // 임베드 HTML 생성
    let embedHTML = `
        <div class="discord-embed" style="border-left-color: ${color};">
    `;
    
    // 작성자
    if (author) {
        embedHTML += `
            <div class="discord-embed-author">
                <div class="discord-embed-author-name">${escapeHTML(author)}</div>
            </div>
        `;
    }
    
    // 썸네일
    if (thumbnail) {
        embedHTML += `
            <img class="discord-embed-thumbnail" src="${thumbnail}" onerror="this.style.display='none'" alt="Thumbnail">
        `;
    }
    
    // 제목
    if (title) {
        embedHTML += `
            <div class="discord-embed-title">${escapeHTML(title)}</div>
        `;
    }
    
    // 설명
    if (description) {
        embedHTML += `
            <div class="discord-embed-description">${escapeHTML(description).replace(/\n/g, '<br>')}</div>
        `;
    }
    
    // 필드
    if (fields.length > 0) {
        embedHTML += '<div class="discord-embed-fields">';
        
        fields.forEach(field => {
            embedHTML += `
                <div class="discord-embed-field ${field.inline ? 'inline' : ''}">
                    <div class="discord-embed-field-name">${escapeHTML(field.name)}</div>
                    <div class="discord-embed-field-value">${escapeHTML(field.value).replace(/\n/g, '<br>')}</div>
                </div>
            `;
        });
        
        embedHTML += '</div>';
    }
    
    // 이미지
    if (image) {
        embedHTML += `
            <img class="discord-embed-image" src="${image}" onerror="this.style.display='none'" alt="Image">
        `;
    }
    
    // 푸터
    if (footer) {
        embedHTML += `
            <div class="discord-embed-footer">${escapeHTML(footer)}</div>
        `;
    }
    
    embedHTML += '</div>';
    
    // 미리보기 업데이트
    previewContainer.innerHTML = embedHTML;
}

// 임베드 전송
function sendEmbed() {
    // 서버 및 채널 선택 확인
    const serverId = document.getElementById('server-select').value;
    const channelId = document.getElementById('channel-select').value;
    
    if (!serverId || !channelId) {
        Utilities.showNotification('서버와 채널을 선택해주세요.', 'error');
        return;
    }
    
    // 임베드 데이터 수집
    const embedData = {
        title: document.getElementById('embed-title').value,
        description: document.getElementById('embed-description').value,
        color: document.getElementById('embed-color').value.replace('#', ''),
        author: document.getElementById('embed-author').value,
        footer: {
            text: document.getElementById('embed-footer').value
        },
        thumbnail: {
            url: document.getElementById('embed-thumbnail').value
        },
        image: {
            url: document.getElementById('embed-image').value
        }
    };
    
    // 필드 추가
    const fields = [];
    const fieldItems = document.querySelectorAll('.field-item');
    fieldItems.forEach(item => {
        const fieldName = item.querySelector('.field-name').value;
        const fieldValue = item.querySelector('.field-value').value;
        const fieldInline = item.querySelector('.field-inline-check').checked;
        
        if (fieldName && fieldValue) {
            fields.push({
                name: fieldName,
                value: fieldValue,
                inline: fieldInline
            });
        }
    });
    
    if (fields.length > 0) {
        embedData.fields = fields;
    }
    
    // 웹소켓으로 전송
    WebSocketManager.sendMessage({
        command: 'sendEmbed',
        serverId: serverId,
        channelId: channelId,
        embed: embedData
    });
}

// HTML 이스케이프 함수
function escapeHTML(str) {
    if (!str) return '';
    
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// 웹소켓 응답 처리 함수 등록
WebSocketManager.messageHandlers['channels'] = (message) => {
    // 채널 목록 로드 이벤트 발생
    const event = new CustomEvent('channels_loaded', { detail: message.channels });
    document.dispatchEvent(event);
};

WebSocketManager.messageHandlers['embedSent'] = (message) => {
    Utilities.showNotification(message.message, 'success');
};

WebSocketManager.messageHandlers['embedError'] = (message) => {
    Utilities.showNotification(message.message, 'error');
};
