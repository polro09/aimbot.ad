/**
 * Sea Dogs Tavern Discord Bot WebUI
 * 관리자 모듈 기능 - 수정 버전
 */

// 전역 변수 - 중복 요청 방지
let isGeneratingInviteCode = false;
let isDeletingInviteCode = false;
let isUpdatingUserRole = false;
let isAssigningServer = false;

// 관리자 모듈 초기화
function initAdminModule() {
    console.log('관리자 모듈 초기화');
    
    // 관리자 권한 확인
    if (!AuthManager.isAdmin()) {
        showAdminAccessError();
        return;
    }
    
    // 이벤트 리스너 등록
    registerAdminEventListeners();
    
    // 사용자 목록 로드
    loadUsersList();
    
    // 초대 코드 목록 로드
    loadInviteCodes();
}

// 관리자 접근 오류 표시
function showAdminAccessError() {
    const adminContainer = document.querySelector('.admin-container');
    if (adminContainer) {
        adminContainer.innerHTML = `
            <div class="admin-header">
                <h1>접근 권한 없음</h1>
                <p class="admin-description">이 페이지에 접근하려면 관리자 권한이 필요합니다.</p>
            </div>
            <div class="empty-state">
                <i class="fas fa-lock"></i>
                <p>관리자로 로그인 후 이용해주세요.</p>
            </div>
        `;
    }
}

// 이벤트 리스너 등록
function registerAdminEventListeners() {
    // 사용자 관리 이벤트
    const addUserBtn = document.getElementById('add-user-btn');
    const refreshUsersBtn = document.getElementById('refresh-users-btn');
    
    if (addUserBtn) {
        addUserBtn.addEventListener('click', () => {
            showAddUserModal();
        });
    }
    
    if (refreshUsersBtn) {
        refreshUsersBtn.addEventListener('click', () => {
            loadUsersList();
            Utilities.showNotification('사용자 목록을 새로고침 중입니다...', 'info');
        });
    }
    
    // 초대 코드 관리 이벤트
    const generateInviteBtn = document.getElementById('generate-invite-btn');
    const refreshInvitesBtn = document.getElementById('refresh-invites-btn');
    
    if (generateInviteBtn) {
        generateInviteBtn.addEventListener('click', () => {
            // 중복 요청 방지
            if (isGeneratingInviteCode) return;
            generateInviteCode();
        });
    }
    
    if (refreshInvitesBtn) {
        refreshInvitesBtn.addEventListener('click', () => {
            loadInviteCodes();
            Utilities.showNotification('초대 코드 목록을 새로고침 중입니다...', 'info');
        });
    }
    
    // 사용자 권한 관리 이벤트
    const updateRoleBtn = document.getElementById('update-role-btn');
    const assignChannelBtn = document.getElementById('assign-channel-btn');
    
    if (updateRoleBtn) {
        updateRoleBtn.addEventListener('click', () => {
            // 중복 요청 방지
            if (isUpdatingUserRole) return;
            updateUserRole();
        });
    }
    
    if (assignChannelBtn) {
        assignChannelBtn.addEventListener('click', () => {
            // 중복 요청 방지
            if (isAssigningServer) return;
            assignServer();
        });
    }
    
    // 서버 선택 이벤트
    const serverSelect = document.getElementById('server-select-assign');
    if (serverSelect) {
        serverSelect.addEventListener('change', () => {
            if (serverSelect.value) {
                loadChannelsList(serverSelect.value);
            }
        });
    }
    
    // 사용자 추가 모달
    const addUserForm = document.getElementById('add-user-form');
    if (addUserForm) {
        addUserForm.addEventListener('submit', (e) => {
            e.preventDefault();
            addUser();
        });
    }
    
    // 사용자 수정 모달
    const editUserForm = document.getElementById('edit-user-form');
    if (editUserForm) {
        editUserForm.addEventListener('submit', (e) => {
            e.preventDefault();
            updateUser();
        });
    }
    
    // 사용자 삭제 버튼
    const deleteUserBtn = document.getElementById('delete-user-btn');
    if (deleteUserBtn) {
        deleteUserBtn.addEventListener('click', () => {
            deleteUser();
        });
    }
    
    // 모달 닫기 버튼들
    document.querySelectorAll('.modal .close').forEach(closeBtn => {
        closeBtn.addEventListener('click', () => {
            closeModals();
        });
    });
    
    // 모달 외부 클릭 시 닫기
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModals();
            }
        });
    });
}

// 모달 닫기
function closeModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
    });
}

// 사용자 목록 로드
function loadUsersList() {
    const usersContainer = document.getElementById('users-container');
    if (!usersContainer) return;
    
    // 로딩 상태 표시
    usersContainer.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-spinner fa-spin"></i>
            <p>사용자 정보를 불러오는 중입니다...</p>
        </div>
    `;
    
    // 사용자 목록 요청
    WebSocketManager.sendMessage({ command: 'getUsers' });
}

// 사용자 목록 업데이트
function updateUsersList(users) {
    const usersContainer = document.getElementById('users-container');
    if (!usersContainer) return;
    
    // 컨테이너 비우기
    usersContainer.innerHTML = '';
    
    // 사용자가 없을 경우
    if (!users || users.length === 0) {
        usersContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users"></i>
                <p>등록된 사용자가 없습니다.</p>
            </div>
        `;
        return;
    }
    
    // 사용자 목록 생성
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'user-item';
        
        // 생성 및 로그인 시간 포맷팅
        const createdDate = user.created ? Utilities.formatDate(user.created) : '알 수 없음';
        const lastLoginDate = user.lastLogin ? Utilities.formatDate(user.lastLogin) : '로그인 기록 없음';
        
        userItem.innerHTML = `
            <div class="user-info">
                <div class="user-name">
                    <i class="fas fa-user"></i>
                    ${user.username}
                </div>
                <div class="user-meta">
                    <span>생성: ${createdDate}</span>
                    <span>최근 로그인: ${lastLoginDate}</span>
                </div>
            </div>
            <div class="user-role ${user.role === 'admin' || user.role === 'level1' ? 'admin' : 'user'}">
                ${getRoleText(user.role)}
            </div>
        `;
        
        // 사용자 클릭 이벤트
        userItem.addEventListener('click', () => {
            handleUserItemClick(user);
        });
        
        usersContainer.appendChild(userItem);
    });
}

// 권한 레벨 텍스트 가져오기
function getRoleText(role) {
    if (role === 'admin' || role === 'level1') {
        return '1등급 관리자';
    } else if (role === 'level2') {
        return '2등급 관리자';
    } else if (role === 'level3') {
        return '3등급 관리자';
    } else {
        return '일반 사용자';
    }
}

// 사용자 항목 클릭 처리
function handleUserItemClick(user) {
    // 선택된 사용자 정보 표시
    showSelectedUserInfo(user);
    
    // 선택된 사용자의 권한 설정
    const userRoleSelect = document.getElementById('user-role');
    if (userRoleSelect) {
        userRoleSelect.value = user.role || 'user';
    }
    
    // 서버 목록 로드
    loadServersList();
}

// 선택된 사용자 정보 표시
function showSelectedUserInfo(user) {
    const selectedUserInfo = document.getElementById('selected-user-info');
    const noUserSelected = document.getElementById('no-user-selected');
    
    if (selectedUserInfo && noUserSelected) {
        // 선택된 사용자 정보 표시
        selectedUserInfo.style.display = 'block';
        noUserSelected.style.display = 'none';
        
        // 사용자 정보 업데이트
        document.getElementById('selected-username').textContent = user.username || '-';
        document.getElementById('selected-created').textContent = user.created ? new Date(user.created).toLocaleString() : '-';
        document.getElementById('selected-last-login').textContent = user.lastLogin ? new Date(user.lastLogin).toLocaleString() : '로그인 기록 없음';
    }
}

// 초대 코드 목록 로드
function loadInviteCodes() {
    const inviteCodesContainer = document.getElementById('invite-codes-container');
    if (!inviteCodesContainer) return;
    
    // 로딩 상태 표시
    inviteCodesContainer.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-spinner fa-spin"></i>
            <p>초대 코드를 불러오는 중입니다...</p>
        </div>
    `;
    
    // 초대 코드 목록 요청
    WebSocketManager.sendMessage({ command: 'getInviteCodes' });
}

// 초대 코드 목록 업데이트
function updateInviteCodesList(inviteCodes) {
    const inviteCodesContainer = document.getElementById('invite-codes-container');
    if (!inviteCodesContainer) return;
    
    // 컨테이너 비우기
    inviteCodesContainer.innerHTML = '';
    
    // 초대 코드가 없을 경우
    if (!inviteCodes || inviteCodes.length === 0) {
        inviteCodesContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-key"></i>
                <p>등록된 초대 코드가 없습니다.</p>
            </div>
        `;
        return;
    }
    
    // 초대 코드 목록 생성
    inviteCodes.forEach(invite => {
        const inviteItem = document.createElement('div');
        inviteItem.className = 'invite-code-item';
        
        // 생성 시간 포맷팅
        const createdDate = invite.created ? Utilities.formatDate(invite.created) : '알 수 없음';
        const usedDate = invite.usedAt ? Utilities.formatDate(invite.usedAt) : '';
        
        // 초대 코드 상태
        const isActive = !invite.used;
        
        inviteItem.innerHTML = `
            <div class="invite-code-info">
                <div class="invite-code">
                    <span class="invite-code-status ${isActive ? 'active' : 'used'}">
                        ${isActive ? '활성' : '사용됨'}
                    </span>
                    <span>${invite.code}</span>
                    ${isActive ? `<button class="copy-btn" onclick="copyToClipboard('${invite.code}', event)">
                        <i class="fas fa-copy"></i> 복사
                    </button>` : ''}
                </div>
                <div class="invite-code-meta">
                    생성: ${createdDate}
                    ${invite.used ? `| 사용자: ${invite.usedBy || '알 수 없음'} | 사용일: ${usedDate}` : ''}
                </div>
            </div>
            <div class="invite-code-actions">
                <button onclick="deleteInviteCode('${invite.code}', event)" title="삭제">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        
        inviteCodesContainer.appendChild(inviteItem);
    });
}

// 서버 목록 로드
function loadServersList() {
    const serverSelect = document.getElementById('server-select-assign');
    if (!serverSelect) return;
    
    // 기존 옵션 초기화 (첫 번째 옵션 제외)
    while (serverSelect.options.length > 1) {
        serverSelect.remove(1);
    }
    
    // 서버 목록 요청
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

// 채널 목록 로드
function loadChannelsList(serverId) {
    // 대시보드 서버 기능으로 변경되어 이 함수는 사용하지 않음
    console.log("서버 목록 로드 중");
}

// 사용자 추가 모달 표시
function showAddUserModal() {
    const modal = document.getElementById('add-user-modal');
    if (modal) {
        // 폼 초기화
        const form = document.getElementById('add-user-form');
        if (form) form.reset();
        
        // 모달 표시
        modal.style.display = 'block';
    }
}

// 사용자 편집 모달 표시
function showEditUserModal(user) {
    const modal = document.getElementById('edit-user-modal');
    if (modal) {
        // 사용자 정보 설정
        document.getElementById('edit-username-title').textContent = user.username;
        document.getElementById('edit-username-hidden').value = user.username;
        document.getElementById('reset-password').value = '';
        document.getElementById('edit-user-admin').checked = user.role === 'admin' || user.role === 'level1';
        
        // 삭제 버튼 활성화 (자기 자신은 삭제 불가)
        const deleteBtn = document.getElementById('delete-user-btn');
        if (deleteBtn) {
            const currentUser = AuthManager.user?.username;
            deleteBtn.disabled = (user.username === currentUser);
            deleteBtn.title = (user.username === currentUser) ? 
                '현재 로그인한 사용자는 삭제할 수 없습니다' : '사용자 삭제';
        }
        
        // 모달 표시
        modal.style.display = 'block';
    }
}

// 사용자 추가
function addUser() {
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;
    const isAdmin = document.getElementById('new-user-admin').checked;
    
    if (!username || !password) {
        Utilities.showNotification('아이디와 비밀번호를 입력해주세요.', 'error');
        return;
    }
    
    // 사용자 추가 요청
    WebSocketManager.sendMessage({
        command: 'addUser',
        username: username,
        password: password,
        role: isAdmin ? 'level1' : 'user'
    });
    
    // 모달 닫기
    closeModals();
    
    Utilities.showNotification('사용자를 추가하는 중입니다...', 'info');
}

// 사용자 업데이트
function updateUser() {
    const username = document.getElementById('edit-username-hidden').value;
    const newPassword = document.getElementById('reset-password').value;
    const isAdmin = document.getElementById('edit-user-admin').checked;
    
    if (!username) return;
    
    // 사용자 업데이트 요청
    WebSocketManager.sendMessage({
        command: 'updateUser',
        username: username,
        newPassword: newPassword || null, // 비밀번호가 비어있으면 null 전송
        role: isAdmin ? 'level1' : 'user'
    });
    
    // 모달 닫기
    closeModals();
    
    Utilities.showNotification('사용자 정보를 업데이트하는 중입니다...', 'info');
}

// 사용자 삭제
function deleteUser() {
    const username = document.getElementById('edit-username-hidden').value;
    
    if (!username) return;
    
    if (confirm(`정말로 사용자 "${username}"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
        // 사용자 삭제 요청
        WebSocketManager.sendMessage({
            command: 'deleteUser',
            username: username
        });
        
        // 모달 닫기
        closeModals();
        
        Utilities.showNotification('사용자를 삭제하는 중입니다...', 'info');
    }
}

// 초대 코드 생성
function generateInviteCode() {
    // 중복 요청 방지
    if (isGeneratingInviteCode) return;
    isGeneratingInviteCode = true;
    
    const customCode = document.getElementById('new-invite-code').value.trim();
    
    // 초대 코드 생성 버튼 비활성화
    const generateBtn = document.getElementById('generate-invite-btn');
    if (generateBtn) {
        generateBtn.disabled = true;
    }
    
    // 초대 코드 생성 요청
    WebSocketManager.sendMessage({
        command: 'generateInviteCode',
        code: customCode || null // 빈 문자열이면 null 전송
    });
    
    // 입력 필드 초기화
    document.getElementById('new-invite-code').value = '';
    
    Utilities.showNotification('초대 코드를 생성하는 중입니다...', 'info');
    
    // 3초 후에 버튼 다시 활성화
    setTimeout(() => {
        isGeneratingInviteCode = false;
        if (generateBtn) {
            generateBtn.disabled = false;
        }
    }, 3000);
}

// 초대 코드 삭제
function deleteInviteCode(code, event) {
    // 이벤트 버블링 중지
    if (event) {
        event.stopPropagation();
    }
    
    // 중복 요청 방지
    if (isDeletingInviteCode) return;
    isDeletingInviteCode = true;
    
    if (!code) return;
    
    if (confirm(`초대 코드 "${code}"를 삭제하시겠습니까?`)) {
        // 초대 코드 삭제 요청
        WebSocketManager.sendMessage({
            command: 'deleteInviteCode',
            code: code
        });
        
        Utilities.showNotification('초대 코드를 삭제하는 중입니다...', 'info');
        
        // 버튼 비활성화
        if (event && event.target) {
            const button = event.target.closest('button');
            if (button) {
                button.disabled = true;
            }
        }
        
        // 3초 후에 플래그 초기화
        setTimeout(() => {
            isDeletingInviteCode = false;
        }, 3000);
    } else {
        isDeletingInviteCode = false;
    }
}

// 사용자 권한 업데이트
function updateUserRole() {
    // 중복 요청 방지
    if (isUpdatingUserRole) return;
    isUpdatingUserRole = true;
    
    const username = document.getElementById('selected-username').textContent;
    const role = document.getElementById('user-role').value;
    
    if (!username || username === '-') {
        Utilities.showNotification('사용자를 선택해주세요.', 'error');
        isUpdatingUserRole = false;
        return;
    }
    
    // 버튼 비활성화
    const updateRoleBtn = document.getElementById('update-role-btn');
    if (updateRoleBtn) {
        updateRoleBtn.disabled = true;
    }
    
    // 사용자 권한 업데이트 요청
    WebSocketManager.sendMessage({
        command: 'updateUserRole',
        username: username,
        role: role
    });
    
    Utilities.showNotification('사용자 권한을 업데이트하는 중입니다...', 'info');
    
    // 3초 후에 버튼 다시 활성화
    setTimeout(() => {
        isUpdatingUserRole = false;
        if (updateRoleBtn) {
            updateRoleBtn.disabled = false;
        }
    }, 3000);
}

// 서버 할당
function assignServer() {
    // 중복 요청 방지
    if (isAssigningServer) return;
    isAssigningServer = true;
    
    const username = document.getElementById('selected-username').textContent;
    const serverId = document.getElementById('server-select-assign').value;
    
    if (!username || username === '-') {
        Utilities.showNotification('사용자를 선택해주세요.', 'error');
        isAssigningServer = false;
        return;
    }
    
    if (!serverId) {
        Utilities.showNotification('서버를 선택해주세요.', 'error');
        isAssigningServer = false;
        return;
    }
    
    // 버튼 비활성화
    const assignBtn = document.getElementById('assign-channel-btn');
    if (assignBtn) {
        assignBtn.disabled = true;
    }
    
    // 서버 할당 요청 (채널 ID는 더이상 사용하지 않음)
    WebSocketManager.sendMessage({
        command: 'assignServer',
        username: username,
        serverId: serverId
    });
    
    Utilities.showNotification('서버를 할당하는 중입니다...', 'info');
    
    // 3초 후에 버튼 다시 활성화
    setTimeout(() => {
        isAssigningServer = false;
        if (assignBtn) {
            assignBtn.disabled = false;
        }
    }, 3000);
}

// 서버 할당 해제
function unassignServer(username, serverId, event) {
    // 이벤트 버블링 중지
    if (event) {
        event.stopPropagation();
    }
    
    if (!username || !serverId) return;
    
    if (confirm('이 서버 할당을 해제하시겠습니까?')) {
        // 서버 할당 해제 요청
        WebSocketManager.sendMessage({
            command: 'unassignServer',
            username: username,
            serverId: serverId
        });
        
        Utilities.showNotification('서버 할당을 해제하는 중입니다...', 'info');
        
        // 버튼 비활성화
        if (event && event.target) {
            const button = event.target.closest('button');
            if (button) {
                button.disabled = true;
            }
        }
    }
}

// 클립보드에 복사
function copyToClipboard(text, event) {
    // 이벤트 버블링 중지
    if (event) {
        event.stopPropagation();
    }
    
    if (!text) return;
    
    // 클립보드에 복사
    navigator.clipboard.writeText(text)
        .then(() => {
            Utilities.showNotification('초대 코드가 클립보드에 복사되었습니다.', 'success');
        })
        .catch(err => {
            console.error('클립보드 복사 오류:', err);
            Utilities.showNotification('클립보드 복사에 실패했습니다.', 'error');
        });
}

// 서버 목록 업데이트
function updateServersList(username, servers) {
    const serversListElement = document.getElementById('assigned-servers-list');
    if (!serversListElement) return;
    
    if (!servers || servers.length === 0) {
        serversListElement.innerHTML = `
            <div class="empty-state">
                <p>할당된 서버가 없습니다.</p>
            </div>
        `;
        return;
    }
    
    // 서버 목록 생성
    serversListElement.innerHTML = '';
    servers.forEach(server => {
        const serverItem = document.createElement('div');
        serverItem.className = 'server-item';
        
        serverItem.innerHTML = `
            <div class="server-info">
                <span class="server-name">
                    <i class="fas fa-server"></i> ${server.serverName || server.name || '알 수 없는 서버'}
                </span>
                <span class="server-id">${server.serverId || server.id || '-'}</span>
            </div>
            <div class="server-actions">
                <button class="btn-remove" onclick="unassignServer('${username}', '${server.serverId || server.id}', event)">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        serversListElement.appendChild(serverItem);
    });
}

// 웹소켓 메시지 핸들러
WebSocketManager.messageHandlers['usersList'] = (message) => {
    if (message.users) {
        updateUsersList(message.users);
    }
};

WebSocketManager.messageHandlers['inviteCodesList'] = (message) => {
    if (message.inviteCodes) {
        updateInviteCodesList(message.inviteCodes);
    }
};

WebSocketManager.messageHandlers['userServers'] = (message) => {
    const serversListElement = document.getElementById('assigned-servers-list');
    if (!serversListElement) return;
    
    if (!message.servers || message.servers.length === 0) {
        serversListElement.innerHTML = `
            <div class="empty-state">
                <p>할당된 서버가 없습니다.</p>
            </div>
        `;
        return;
    }
    
    // 서버 목록 생성
    updateServersList(message.username, message.servers);
};