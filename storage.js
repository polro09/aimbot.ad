// storage.js - 데이터 저장소 관리

const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcrypt');
const config = require('./config');

class Storage {
    constructor() {
        this.initialized = false;
        this.stores = {
            'users': {},
            'invite-codes': {},
            'user-settings': {}
        };
        this.storeFiles = {
            'users': path.join(__dirname, config.dirs.data, 'users.json'),
            'invite-codes': path.join(__dirname, config.dirs.data, 'invite-codes.json'),
            'user-settings': path.join(__dirname, config.dirs.data, 'user-settings.json')
        };
    }

    // 초기화 함수
    async init(logFn) {
        try {
            // 데이터 디렉토리 확인
            try {
                await fs.access(config.dirs.data);
            } catch (error) {
                await fs.mkdir(config.dirs.data, { recursive: true });
                if (logFn) logFn('INFO', `데이터 디렉토리 생성: ${config.dirs.data}`);
            }

            // 각 저장소 파일 로드
            for (const [storeName, filePath] of Object.entries(this.storeFiles)) {
                try {
                    // 파일 존재 여부 확인
                    await fs.access(filePath);
                    
                    // 파일 읽기
                    const data = await fs.readFile(filePath, 'utf8');
                    this.stores[storeName] = JSON.parse(data || '{}');
                    
                    if (logFn) logFn('INFO', `저장소 로드됨: ${storeName}`);
                } catch (error) {
                    // 파일이 없으면 빈 객체로 초기화
                    this.stores[storeName] = {};
                    
                    // 파일 생성
                    await fs.writeFile(filePath, '{}', 'utf8');
                    
                    if (logFn) logFn('INFO', `저장소 파일 생성됨: ${storeName}`);
                }
            }

            this.initialized = true;
            if (logFn) logFn('INFO', '저장소 초기화 완료');
            
            // 자동 저장 설정
            if (config.storage && config.storage.autoSave) {
                const interval = config.storage.saveInterval || 300000; // 기본 5분
                this.autoSaveInterval = setInterval(() => {
                    this.saveAll();
                }, interval);
                
                if (logFn) logFn('INFO', `자동 저장 활성화: ${interval / 1000}초 간격`);
            }
        } catch (error) {
            if (logFn) logFn('ERROR', `저장소 초기화 중 오류 발생: ${error.message}`);
            throw error;
        }
    }

    // 저장소 가져오기
    getStore(storeName) {
        if (!this.stores[storeName]) {
            throw new Error(`저장소 ${storeName}이(가) 존재하지 않습니다.`);
        }
        
        return this.stores[storeName];
    }

    // 저장소 전체 가져오기
    getAll(storeName) {
        return this.getStore(storeName);
    }

    // 항목 가져오기
    get(storeName, key) {
        const store = this.getStore(storeName);
        return store[key];
    }

    // 모든 항목 설정
    setAll(storeName, data) {
        if (!this.stores[storeName]) {
            throw new Error(`저장소 ${storeName}이(가) 존재하지 않습니다.`);
        }
        
        this.stores[storeName] = data;
    }

    // 항목 설정
    set(storeName, key, value) {
        if (!this.stores[storeName]) {
            throw new Error(`저장소 ${storeName}이(가) 존재하지 않습니다.`);
        }
        
        this.stores[storeName][key] = value;
    }

    // 항목 삭제
    delete(storeName, key) {
        if (!this.stores[storeName]) {
            throw new Error(`저장소 ${storeName}이(가) 존재하지 않습니다.`);
        }
        
        delete this.stores[storeName][key];
    }

    // 모든 저장소 저장
    async saveAll() {
        for (const storeName of Object.keys(this.storeFiles)) {
            await this.save(storeName);
        }
    }

    // 저장소 저장
    async save(storeName) {
        if (!this.storeFiles[storeName]) {
            throw new Error(`저장소 파일 ${storeName}이(가) 존재하지 않습니다.`);
        }
        
        try {
            const filePath = this.storeFiles[storeName];
            const data = JSON.stringify(this.stores[storeName], null, 2);
            
            await fs.writeFile(filePath, data, 'utf8');
            return true;
        } catch (error) {
            console.error(`저장소 ${storeName} 저장 중 오류 발생:`, error);
            throw error;
        }
    }

    // 사용자 인증
    authenticateUser(username, password) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            return null; // 사용자 없음
        }
        
        const user = users[username];
        
        // 비밀번호 확인
        if (bcrypt.compareSync(password, user.passwordHash)) {
            // 마지막 로그인 시간 업데이트
            user.lastLogin = new Date().toISOString();
            
            return {
                username: user.username,
                role: user.role || 'user',
                created: user.created
            };
        }
        
        return null; // 비밀번호 불일치
    }

    // 사용자 생성
    async createUser(username, password, role = 'user') {
        const users = this.getStore('users');
        
        // 사용자명 중복 확인
        if (users[username]) {
            throw new Error('이미 존재하는 사용자명입니다.');
        }
        
        // 비밀번호 해시 생성
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        // 사용자 정보 생성
        users[username] = {
            username,
            passwordHash,
            role,
            created: new Date().toISOString(),
            lastLogin: null
        };
        
        // 저장
        await this.save('users');
        
        return {
            username,
            role,
            created: users[username].created
        };
    }

    // 사용자 삭제
    async deleteUser(username) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        // 사용자 삭제
        delete users[username];
        
        // 저장
        await this.save('users');
        
        return { success: true };
    }

    // 비밀번호 재설정
    async resetUserPassword(username, newPassword) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        // 새 비밀번호 해시 생성
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);
        
        // 비밀번호 업데이트
        users[username].passwordHash = passwordHash;
        
        // 저장
        await this.save('users');
        
        return { success: true };
    }

    // 초대 코드 생성
    async createInviteCode(customCode = null) {
        const inviteCodes = this.getStore('invite-codes');
        
        // 커스텀 코드가 있으면 사용, 없으면 랜덤 생성
        let code = customCode;
        if (!code) {
            // 랜덤 코드 생성 (8자리)
            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            code = '';
            for (let i = 0; i < 8; i++) {
                code += characters.charAt(Math.floor(Math.random() * characters.length));
            }
        }
        
        // 코드 중복 확인
        if (inviteCodes[code]) {
            throw new Error('이미 존재하는 초대 코드입니다.');
        }
        
        // 초대 코드 정보 생성
        inviteCodes[code] = {
            code,
            created: new Date().toISOString(),
            used: false,
            usedBy: null,
            usedAt: null
        };
        
        // 저장
        await this.save('invite-codes');
        
        return inviteCodes[code];
    }

    // 초대 코드 삭제
    async deleteInviteCode(code) {
        const inviteCodes = this.getStore('invite-codes');
        
        if (!inviteCodes[code]) {
            throw new Error('초대 코드를 찾을 수 없습니다.');
        }
        
        // 초대 코드 삭제
        delete inviteCodes[code];
        
        // 저장
        await this.save('invite-codes');
        
        return { success: true };
    }

    // 초대 코드 사용
    async useInviteCode(code, username) {
        const inviteCodes = this.getStore('invite-codes');
        
        if (!inviteCodes[code]) {
            throw new Error('유효하지 않은 초대 코드입니다.');
        }
        
        if (inviteCodes[code].used) {
            throw new Error('이미 사용된 초대 코드입니다.');
        }
        
        // 초대 코드 사용 처리
        inviteCodes[code].used = true;
        inviteCodes[code].usedBy = username;
        inviteCodes[code].usedAt = new Date().toISOString();
        
        // 저장
        await this.save('invite-codes');
        
        return { success: true };
    }

    // 초대 코드 유효성 확인
    isValidInviteCode(code) {
        const inviteCodes = this.getStore('invite-codes');
        return inviteCodes[code] && !inviteCodes[code].used;
    }

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
    }

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
    }

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
    }

    // 사용자 채널 목록 가져오기
    getUserChannels(username) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        return users[username].assignedChannels || [];
    }
}

// 인스턴스 생성
const storage = new Storage();
module.exports = storage;