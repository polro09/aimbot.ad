// 사용자 역할 업데이트
async updateUserRole(username, role) {
    const users = this.getStore('users');
    
    if (!users[username]) {
        throw new Error('사용자를 찾을 수 없습니다.');
    }
    
    // 역할 검증
    const validRoles = ['level1', 'level2', 'level3', 'user'];
    if (!validRoles.includes(role)) {
        throw new Error('유효하지 않은 역할입니다.');
    }
    
    // 사용자 역할 업데이트
    users[username].role = role;
    
    // 저장
    await this.save('users');
    
    return {
        username,
        role
    };
},

// 사용자 채널 할당
async assignChannelToUser(username, serverId, channelId, serverName, channelName) {
    const users = this.getStore('users');
    
    if (!users[username]) {
        throw new Error('사용자를 찾을 수 없습니다.');
    }
    
    // 할당된 채널 목록이 없으면 초기화
    if (!users[username].assignedChannels) {
        users[username].assignedChannels = [];
    }
    
    // 이미 할당된 채널인지 확인
    const existingChannel = users[username].assignedChannels.find(ch => ch.channelId === channelId);
    if (existingChannel) {
        throw new Error('이미 할당된 채널입니다.');
    }
    
    // 채널 정보 추가
    users[username].assignedChannels.push({
        serverId,
        channelId,
        serverName: serverName || '알 수 없음',
        channelName: channelName || '알 수 없음'
    });
    
    // 저장
    await this.save('users');
    
    return users[username].assignedChannels;
},

// 사용자 채널 할당 해제
async unassignChannelFromUser(username, channelId) {
    const users = this.getStore('users');
    
    if (!users[username]) {
        throw new Error('사용자를 찾을 수 없습니다.');
    }
    
    // 할당된 채널 목록이 없으면 초기화
    if (!users[username].assignedChannels) {
        users[username].assignedChannels = [];
        return [];
    }
    
    // 채널 필터링 (제거)
    users[username].assignedChannels = users[username].assignedChannels.filter(ch => ch.channelId !== channelId);
    
    // 저장
    await this.save('users');
    
    return users[username].assignedChannels;
},

// 사용자 채널 목록 가져오기
getUserChannels(username) {
    const users = this.getStore('users');
    
    if (!users[username]) {
        throw new Error('사용자를 찾을 수 없습니다.');
    }
    
    return users[username].assignedChannels || [];
}