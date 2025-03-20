// storage.js - 데이터 지속성 관리 유틸리티
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

// 데이터 저장소 객체
class Storage {
    constructor() {
        // 데이터 저장소
        this.stores = {};
        
        // 데이터 디렉토리 경로
        this.dataDir = config.dirs.data;
        
        // 자동 저장 타이머
        this.saveTimer = null;
        
        // 초기화 완료 여부
        this.initialized = false;
    }
    
    // 초기화 함수
    async init(log = console.log) {
        try {
            // 데이터 디렉토리 생성
            await this._ensureDataDir();
            
            // 초기 사용자 스토어 생성
            await this._initStore('users');
            
            // 초기 초대 코드 스토어 생성
            await this._initStore('invite-codes');
            
            // 자동 저장 설정
            if (config.storage.autoSave) {
                this.startAutoSave(log);
            }
            
            this.initialized = true;
            log('INFO', '데이터 저장소가 초기화되었습니다.');
            return true;
        } catch (error) {
            log('ERROR', `데이터 저장소 초기화 중 오류 발생: ${error.message}`);
            return false;
        }
    }
    
    // 저장소 초기화
    async _initStore(storeName) {
        try {
            await this.load(storeName);
        } catch (error) {
            // 저장소가 없으면 빈 객체 생성
            this.stores[storeName] = {};
            await this.save(storeName);
        }
    }
    
    // 데이터 디렉토리 확인 및 생성
    async _ensureDataDir() {
        try {
            await fs.access(this.dataDir);
        } catch (error) {
            // 디렉토리가 없으면 생성
            await fs.mkdir(this.dataDir, { recursive: true });
        }
    }
    
    // 자동 저장 시작
    startAutoSave(log = console.log) {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
        }
        
        // 설정된 간격으로 자동 저장
        this.saveTimer = setInterval(async () => {
            try {
                await this.saveAll();
                log('INFO', '모든 데이터가 자동 저장되었습니다.');
            } catch (error) {
                log('ERROR', `데이터 자동 저장 중 오류 발생: ${error.message}`);
            }
        }, config.storage.saveInterval);
        
        log('INFO', `데이터 자동 저장이 활성화되었습니다. (간격: ${config.storage.saveInterval}ms)`);
    }
    
    // 자동 저장 중지
    stopAutoSave() {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }
    }
    
    // 저장소 생성 또는 가져오기
    getStore(storeName) {
        if (!this.stores[storeName]) {
            this.stores[storeName] = {};
        }
        return this.stores[storeName];
    }
    
    // 데이터 로드
    async load(storeName) {
        await this._ensureDataDir();
        
        const filePath = path.join(this.dataDir, `${storeName}.json`);
        
        try {
            const data = await fs.readFile(filePath, 'utf8');
            this.stores[storeName] = JSON.parse(data);
            return this.stores[storeName];
        } catch (error) {
            // 파일이 없거나 읽을 수 없는 경우 빈 객체 반환
            if (error.code === 'ENOENT') {
                this.stores[storeName] = {};
                return this.stores[storeName];
            }
            throw error;
        }
    }
    
    // 데이터 저장
    async save(storeName) {
        await this._ensureDataDir();
        
        const filePath = path.join(this.dataDir, `${storeName}.json`);
        const data = JSON.stringify(this.stores[storeName] || {}, null, 2);
        
        // 원자적 저장 (임시 파일에 쓰고 이름 변경)
        const tempPath = `${filePath}.temp`;
        await fs.writeFile(tempPath, data, 'utf8');
        await fs.rename(tempPath, filePath);
        
        return true;
    }
    
    // 모든 저장소 저장
    async saveAll() {
        const storeNames = Object.keys(this.stores);
        const promises = storeNames.map(name => this.save(name));
        await Promise.all(promises);
        return true;
    }
    
    // 데이터 설정
    set(storeName, key, value) {
        const store = this.getStore(storeName);
        store[key] = value;
        return value;
    }
    
    // 데이터 조회
    get(storeName, key, defaultValue = null) {
        const store = this.getStore(storeName);
        return key in store ? store[key] : defaultValue;
    }
    
    // 데이터 삭제
    delete(storeName, key) {
        const store = this.getStore(storeName);
        if (key in store) {
            const value = store[key];
            delete store[key];
            return value;
        }
        return null;
    }
    
    // 저장소 전체 가져오기
    getAll(storeName) {
        return this.getStore(storeName);
    }
    
    // 저장소 전체 설정
    setAll(storeName, data) {
        this.stores[storeName] = data;
        return data;
    }
    
    // 저장소 비우기
    clear(storeName) {
        this.stores[storeName] = {};
        return true;
    }
    
    // 저장소 삭제
    async deleteStore(storeName) {
        delete this.stores[storeName];
        
        const filePath = path.join(this.dataDir, `${storeName}.json`);
        try {
            await fs.unlink(filePath);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return true; // 파일이 이미 없는 경우
            }
            throw error;
        }
    }
    
    // 모든 저장소 목록 가져오기
    getStoreNames() {
        return Object.keys(this.stores);
    }
    
    // 키가 존재하는지 확인
    has(storeName, key) {
        const store = this.getStore(storeName);
        return key in store;
    }
    
    // 비밀번호 해시화
    hashPassword(password, salt = null) {
        if (!salt) {
            salt = crypto.randomBytes(16).toString('hex');
        }
        
        const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
        
        return {
            hash,
            salt
        };
    }
    
    // 비밀번호 검증
    verifyPassword(password, hash, salt) {
        const hashedPassword = this.hashPassword(password, salt);
        return hashedPassword.hash === hash;
    }
    
    // 사용자 생성
    async createUser(username, password) {
        const users = this.getStore('users');
        
        // 이미 존재하는 사용자인지 확인
        if (users[username]) {
            throw new Error('이미 존재하는 사용자명입니다.');
        }
        
        // 비밀번호 해시 생성
        const { hash, salt } = this.hashPassword(password);
        
        // 사용자 정보 저장
        users[username] = {
            username,
            passwordHash: hash,
            salt,
            created: new Date().toISOString(),
            lastLogin: null,
            role: 'user'
        };
        
        // 저장
        await this.save('users');
        
        return { username };
    }
    
    // 사용자 인증
    authenticateUser(username, password) {
        const users = this.getStore('users');
        const user = users[username];
        
        if (!user) {
            return null; // 사용자가 존재하지 않음
        }
        
        const isValid = this.verifyPassword(password, user.passwordHash, user.salt);
        
        if (isValid) {
            // 마지막 로그인 시간 업데이트
            user.lastLogin = new Date().toISOString();
            return { username: user.username, role: user.role };
        }
        
        return null; // 비밀번호가 일치하지 않음
    }
    
    // 사용자 삭제
    async deleteUser(username) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        delete users[username];
        await this.save('users');
        
        return true;
    }
    
    // 사용자 비밀번호 재설정
    async resetUserPassword(username, newPassword) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        // 비밀번호 해시 생성
        const { hash, salt } = this.hashPassword(newPassword);
        
        // 사용자 정보 갱신
        users[username].passwordHash = hash;
        users[username].salt = salt;
        
        // 저장
        await this.save('users');
        
        return true;
    }
    
    // 초대 코드 생성
    async createInviteCode(code = null) {
        const inviteCodes = this.getStore('invite-codes');
        
        // 코드가 제공되지 않은 경우 무작위 코드 생성
        if (!code) {
            code = crypto.randomBytes(6).toString('hex');
        }
        
        // 이미 존재하는 코드인지 확인
        if (inviteCodes[code]) {
            throw new Error('이미 존재하는 초대 코드입니다.');
        }
        
        // 초대 코드 정보 저장
        inviteCodes[code] = {
            code,
            created: new Date().toISOString(),
            used: false,
            usedBy: null,
            usedAt: null
        };
        
        // 저장
        await this.save('invite-codes');
        
        return { code };
    }
    
    // 초대 코드 사용
    async useInviteCode(code, username) {
        const inviteCodes = this.getStore('invite-codes');
        
        // 코드가 존재하는지 확인
        if (!inviteCodes[code]) {
            throw new Error('유효하지 않은 초대 코드입니다.');
        }
        
        // 코드가 이미 사용되었는지 확인
        if (inviteCodes[code].used) {
            throw new Error('이미 사용된 초대 코드입니다.');
        }
        
        // 코드 사용 정보 갱신
        inviteCodes[code].used = true;
        inviteCodes[code].usedBy = username;
        inviteCodes[code].usedAt = new Date().toISOString();
        
        // 저장
        await this.save('invite-codes');
        
        return true;
    }
    
    // 초대 코드 확인
    isValidInviteCode(code) {
        const inviteCodes = this.getStore('invite-codes');
        return inviteCodes[code] && !inviteCodes[code].used;
    }
    
    // 초대 코드 삭제
    async deleteInviteCode(code) {
        const inviteCodes = this.getStore('invite-codes');
        
        if (!inviteCodes[code]) {
            throw new Error('초대 코드를 찾을 수 없습니다.');
        }
        
        delete inviteCodes[code];
        await this.save('invite-codes');
        
        return true;
    }
}

// 싱글톤 인스턴스
const storage = new Storage();

module.exports = storage;