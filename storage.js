// storage.js - 개선된 데이터 저장소 관리 시스템
// v2.0.0 - 성능, 안정성, 보안성 강화

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require('./config');

/**
 * 데이터 저장소 관리 클래스
 * - 데이터 저장, 로드, 암호화 및 백업 기능
 * - 확장된 사용자 관리 및 초대 코드 시스템
 * - 캐싱 및 트랜잭션 처리
 */
class Storage {
    constructor() {
        // 초기화 상태
        this.initialized = false;
        
        // 메모리 캐시 저장소
        this.stores = {
            'users': {},
            'invite-codes': {},
            'user-settings': {},
            'bot-config': {},
            'server-settings': {},
            'module-settings': {}
        };
        
        // 파일 경로 맵핑
        this.storeFiles = {};
        
        // 캐시 타임스탬프 (캐시 유효성 검사용)
        this.cacheTimestamps = {};
        
        // 로그 함수 저장
        this.logFunction = null;
        
        // 백업 타이머
        this.backupTimer = null;
        
        // 저장 트랜잭션 추적
        this.pendingSaves = new Map();
        
        // 자동 저장 타이머
        this.autoSaveInterval = null;
        
        // 암호화 키 (설정에서 로드하거나 생성)
        this.encryptionKey = null;
    }

    /**
     * 저장소 시스템 초기화
     * @param {Function} logFn 로깅 함수
     * @returns {Promise<boolean>} 초기화 성공 여부
     */
    async init(logFn) {
        // 이미 초기화된 경우 바로 반환
        if (this.initialized) return true;
        
        try {
            // 로그 함수 저장
            this.logFunction = logFn || console.log;
            
            // 데이터 디렉토리 초기화
            await this._initDataDirectory();
            
            // 암호화 키 설정
            await this._setupEncryptionKey();
            
            // 저장소 파일 경로 설정
            this._setupStorePaths();
            
            // 각 저장소 파일 로드
            await this._loadAllStores();
            
            // 자동 저장 설정
            this._setupAutoSave();
            
            // 정기 백업 설정
            this._setupBackupSystem();
            
            this.initialized = true;
            this.log('INFO', '저장소 초기화 완료');
            return true;
        } catch (error) {
            this.log('ERROR', `저장소 초기화 중 오류 발생: ${error.message}`);
            this.log('ERROR', error.stack);
            
            // 부분적으로 초기화 상태 확인
            if (Object.keys(this.stores).some(store => Object.keys(this.stores[store]).length > 0)) {
                this.initialized = true;
                this.log('WARN', '저장소가 부분적으로 초기화되었습니다. 일부 기능이 제한될 수 있습니다.');
                return true;
            }
            
            throw error;
        }
    }
    
    /**
     * 데이터 디렉토리 초기화
     * @private
     */
    async _initDataDirectory() {
        try {
            // 데이터 디렉토리 확인 및 생성
            await fs.access(config.dirs.data).catch(async () => {
                await fs.mkdir(config.dirs.data, { recursive: true });
                this.log('INFO', `데이터 디렉토리 생성: ${config.dirs.data}`);
            });
            
            // 백업 디렉토리 확인 및 생성
            const backupDir = path.join(config.dirs.data, 'backups');
            await fs.access(backupDir).catch(async () => {
                await fs.mkdir(backupDir, { recursive: true });
                this.log('INFO', `백업 디렉토리 생성: ${backupDir}`);
            });
        } catch (error) {
            this.log('ERROR', `데이터 디렉토리 초기화 중 오류: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 암호화 키 설정
     * @private
     */
    async _setupEncryptionKey() {
        const keyPath = path.join(config.dirs.data, '.encryption_key');
        
        try {
            // 기존 키 파일 확인
            const keyExists = await fs.access(keyPath).then(() => true).catch(() => false);
            
            if (keyExists) {
                // 기존 키 로드
                this.encryptionKey = await fs.readFile(keyPath, 'utf8');
                this.log('INFO', '암호화 키를 로드했습니다.');
            } else {
                // 새 키 생성 (32바이트 랜덤 문자열)
                this.encryptionKey = crypto.randomBytes(32).toString('hex');
                await fs.writeFile(keyPath, this.encryptionKey, 'utf8');
                this.log('INFO', '새 암호화 키를 생성했습니다.');
            }
        } catch (error) {
            this.log('ERROR', `암호화 키 설정 중 오류: ${error.message}`);
            
            // 비상용 키 생성 (복구 목적)
            this.encryptionKey = 'emergency_fallback_key_' + Date.now();
            this.log('WARN', '비상용 임시 암호화 키를 사용합니다. 데이터 보안이 저하될 수 있습니다.');
        }
    }
    
    /**
     * 저장소 파일 경로 설정
     * @private
     */
    _setupStorePaths() {
        // 기본 저장소 파일
        const basicStores = [
            'users', 'invite-codes', 'user-settings',
            'bot-config', 'server-settings'
        ];
        
        // 기본 저장소 경로 설정
        basicStores.forEach(store => {
            this.storeFiles[store] = path.join(config.dirs.data, `${store}.json`);
        });
        
        // 모듈 설정 저장소
        const moduleStores = [
            'welcome-settings', 'ticket-system-config', 'voice-channels-config',
            'vacation-system-config', 'raid-call-config'
        ];
        
        // 모듈 저장소 경로 설정
        moduleStores.forEach(store => {
            this.storeFiles[store] = path.join(config.dirs.data, `${store}.json`);
            // 저장소 객체 초기화
            this.stores[store] = {};
        });
    }
    
    /**
     * 모든 저장소 파일 로드
     * @private
     */
    async _loadAllStores() {
        const loadPromises = Object.keys(this.storeFiles).map(async storeName => {
            try {
                await this.load(storeName);
                return { name: storeName, success: true };
            } catch (error) {
                return { name: storeName, success: false, error: error.message };
            }
        });
        
        const results = await Promise.all(loadPromises);
        
        // 로드 결과 로깅
        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;
        
        this.log('INFO', `저장소 로드 완료: ${successCount}개 성공, ${failCount}개 실패`);
        
        // 실패한 저장소 목록
        if (failCount > 0) {
            const failedStores = results.filter(r => !r.success);
            this.log('WARN', `로드 실패한 저장소: ${failedStores.map(s => s.name).join(', ')}`);
        }
    }
    
    /**
     * 자동 저장 설정
     * @private
     */
    _setupAutoSave() {
        // 기존 타이머 제거
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
        }
        
        // 자동 저장 활성화 확인
        if (config.storage && config.storage.autoSave) {
            const interval = config.storage.saveInterval || 300000; // 기본 5분
            
            this.autoSaveInterval = setInterval(async () => {
                try {
                    await this.saveAll();
                    this.log('INFO', `자동 저장 완료 (간격: ${interval / 1000}초)`);
                } catch (error) {
                    this.log('ERROR', `자동 저장 중 오류: ${error.message}`);
                }
            }, interval);
            
            this.log('INFO', `자동 저장 활성화: ${interval / 1000}초 간격`);
        }
    }
    
    /**
     * 백업 시스템 설정
     * @private
     */
    _setupBackupSystem() {
        // 기존 타이머 제거
        if (this.backupTimer) {
            clearInterval(this.backupTimer);
        }
        
        // 백업 간격 설정 (기본 24시간)
        const backupInterval = (config.storage && config.storage.backupInterval) || 24 * 60 * 60 * 1000;
        
        this.backupTimer = setInterval(async () => {
            try {
                await this.createBackup();
                this.log('INFO', `정기 백업 완료 (간격: ${backupInterval / (60 * 60 * 1000)}시간)`);
            } catch (error) {
                this.log('ERROR', `정기 백업 중 오류: ${error.message}`);
            }
        }, backupInterval);
        
        this.log('INFO', `백업 시스템 활성화: ${backupInterval / (60 * 60 * 1000)}시간 간격`);
    }

    /**
     * 로그 메시지 출력
     * @param {string} type 로그 타입 (INFO, WARN, ERROR 등)
     * @param {string} message 로그 메시지
     * @private
     */
    log(type, message) {
        if (this.logFunction) {
            this.logFunction(type, `[Storage] ${message}`);
        } else {
            console.log(`[${type}] [Storage] ${message}`);
        }
    }
    
    /**
     * 데이터 암호화
     * @param {Object} data 암호화할 데이터
     * @returns {string} 암호화된 문자열
     * @private
     */
    _encrypt(data) {
        try {
            // 32바이트 랜덤 초기화 벡터 생성
            const iv = crypto.randomBytes(16);
            
            // 암호화 키에서 파생된 32바이트 키 생성
            const key = crypto.createHash('sha256').update(this.encryptionKey).digest();
            
            // 암호화 알고리즘 생성
            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            
            // 데이터 직렬화 및 암호화
            const serializedData = JSON.stringify(data);
            let encrypted = cipher.update(serializedData, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            
            // IV와 암호화된 데이터 결합 (IV는 복호화에 필요)
            return iv.toString('hex') + ':' + encrypted;
        } catch (error) {
            this.log('ERROR', `데이터 암호화 중 오류: ${error.message}`);
            throw new Error('데이터 암호화 실패');
        }
    }
    
    /**
     * 데이터 복호화
     * @param {string} encryptedData 암호화된 문자열
     * @returns {Object} 복호화된 데이터 객체
     * @private
     */
    _decrypt(encryptedData) {
        try {
            // IV와 암호화된 데이터 분리
            const [ivHex, encrypted] = encryptedData.split(':');
            
            // IV 복원
            const iv = Buffer.from(ivHex, 'hex');
            
            // 암호화 키에서 파생된 32바이트 키 생성
            const key = crypto.createHash('sha256').update(this.encryptionKey).digest();
            
            // 복호화 알고리즘 생성
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            
            // 데이터 복호화 및 역직렬화
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return JSON.parse(decrypted);
        } catch (error) {
            this.log('ERROR', `데이터 복호화 중 오류: ${error.message}`);
            throw new Error('데이터 복호화 실패');
        }
    }
    
    /**
     * 저장소 파일이 암호화되었는지 확인
     * @param {string} data 파일 데이터
     * @returns {boolean} 암호화 여부
     * @private
     */
    _isEncrypted(data) {
        // 암호화된 데이터는 IV:암호화데이터 형식
        return typeof data === 'string' && data.includes(':') && /^[0-9a-f]+:[0-9a-f]+$/.test(data);
    }

    /**
     * 저장소 파일 불러오기
     * @param {string} storeName 저장소 이름
     * @returns {Promise<boolean>} 로드 성공 여부
     */
    async load(storeName) {
        try {
            // 파일 경로 확인
            const filePath = this.storeFiles[storeName];
            if (!filePath) {
                throw new Error(`저장소 파일 ${storeName}이(가) 존재하지 않습니다.`);
            }
            
            // 파일 존재 여부 확인
            try {
                await fs.access(filePath);
                
                // 파일 읽기
                const data = await fs.readFile(filePath, 'utf8');
                
                // 비어있는 파일 처리
                if (!data || data.trim() === '') {
                    this.stores[storeName] = {};
                    this.log('WARN', `저장소 ${storeName}이(가) 비어 있습니다. 빈 객체로 초기화합니다.`);
                    return true;
                }
                
                try {
                    // 암호화 여부 확인 및 처리
                    if (this._isEncrypted(data)) {
                        this.stores[storeName] = this._decrypt(data);
                    } else {
                        this.stores[storeName] = JSON.parse(data);
                    }
                    
                    // 캐시 타임스탬프 갱신
                    this.cacheTimestamps[storeName] = Date.now();
                    this.log('INFO', `저장소 ${storeName}을(를) 로드했습니다.`);
                    return true;
                } catch (parseError) {
                    // 파싱 오류 - 손상된 파일
                    this.log('ERROR', `저장소 ${storeName} 파싱 오류: ${parseError.message}`);
                    
                    // 백업 생성
                    const backupPath = path.join(config.dirs.data, 'backups', `${storeName}_corrupted_${Date.now()}.json`);
                    await fs.copyFile(filePath, backupPath);
                    this.log('WARN', `손상된 저장소 파일 백업: ${backupPath}`);
                    
                    // 빈 객체로 초기화
                    this.stores[storeName] = {};
                    
                    // 새 파일 생성
                    await fs.writeFile(filePath, '{}', 'utf8');
                    this.log('INFO', `저장소 ${storeName} 파일이 새로 생성되었습니다.`);
                    return false;
                }
            } catch (accessError) {
                // 파일이 없으면 빈 객체로 초기화
                this.stores[storeName] = {};
                
                // 파일 생성
                await fs.writeFile(filePath, '{}', 'utf8');
                this.log('INFO', `저장소 ${storeName} 파일이 새로 생성되었습니다.`);
                return true;
            }
        } catch (error) {
            this.log('ERROR', `저장소 ${storeName} 로드 중 오류 발생: ${error.message}`);
            
            // 다른 오류가 발생하면 빈 객체로 초기화
            this.stores[storeName] = {};
            this.log('WARN', `저장소 ${storeName}을(를) 빈 객체로 초기화합니다.`);
            
            throw error;
        }
    }

    /**
     * 저장소 가져오기 (존재 확인 및 초기화)
     * @param {string} storeName 저장소 이름
     * @returns {Object} 저장소 객체
     */
    getStore(storeName) {
        // 저장소가 없으면 빈 객체로 초기화
        if (!this.stores[storeName]) {
            this.stores[storeName] = {};
            this.log('WARN', `저장소 ${storeName}이(가) 없어 빈 객체로 초기화합니다.`);
        }
        
        return this.stores[storeName];
    }

    /**
     * 저장소 전체 가져오기
     * @param {string} storeName 저장소 이름
     * @returns {Object} 저장소 객체
     */
    getAll(storeName) {
        return this.getStore(storeName);
    }

    /**
     * 저장소 항목 가져오기
     * @param {string} storeName 저장소 이름
     * @param {string} key 키
     * @returns {*} 항목 값
     */
    get(storeName, key) {
        const store = this.getStore(storeName);
        return store[key];
    }

    /**
     * 모든 항목 설정
     * @param {string} storeName 저장소 이름
     * @param {Object} data 데이터 객체
     */
    setAll(storeName, data) {
        // 저장소 초기화 확인
        if (!this.stores[storeName]) {
            this.stores[storeName] = {};
        }
        
        // 데이터 검증
        if (typeof data !== 'object' || data === null) {
            throw new Error('저장소 데이터는 객체여야 합니다.');
        }
        
        this.stores[storeName] = data;
        
        // 캐시 타임스탬프 갱신
        this.cacheTimestamps[storeName] = Date.now();
    }

    /**
     * 항목 설정
     * @param {string} storeName 저장소 이름
     * @param {string} key 키
     * @param {*} value 값
     */
    set(storeName, key, value) {
        // 저장소 초기화 확인
        if (!this.stores[storeName]) {
            this.stores[storeName] = {};
        }
        
        // null 값 검증
        if (key === null || key === undefined) {
            throw new Error('키는 null 또는 undefined일 수 없습니다.');
        }
        
        this.stores[storeName][key] = value;
        
        // 캐시 타임스탬프 갱신
        this.cacheTimestamps[storeName] = Date.now();
    }

    /**
     * 항목 삭제
     * @param {string} storeName 저장소 이름
     * @param {string} key 키
     */
    delete(storeName, key) {
        // 저장소 존재 확인
        if (!this.stores[storeName]) {
            throw new Error(`저장소 ${storeName}이(가) 존재하지 않습니다.`);
        }
        
        delete this.stores[storeName][key];
        
        // 캐시 타임스탬프 갱신
        this.cacheTimestamps[storeName] = Date.now();
    }

    /**
     * 모든 저장소 저장
     * @returns {Promise<Object>} 저장 결과
     */
    async saveAll() {
        const results = { success: [], failed: [] };
        
        // 모든 저장소에 대해 저장 작업 병렬 실행
        const savePromises = Object.keys(this.storeFiles).map(async storeName => {
            try {
                await this.save(storeName);
                results.success.push(storeName);
            } catch (error) {
                results.failed.push({ name: storeName, error: error.message });
                this.log('ERROR', `저장소 ${storeName} 저장 실패: ${error.message}`);
            }
        });
        
        await Promise.all(savePromises);
        
        // 결과 로깅
        if (results.failed.length > 0) {
            this.log('WARN', `저장 실패한 저장소: ${results.failed.map(f => f.name).join(', ')}`);
        }
        
        this.log('INFO', `모든 저장소 저장 완료: ${results.success.length}개 성공, ${results.failed.length}개 실패`);
        
        return results;
    }

    /**
     * 저장소 저장
     * @param {string} storeName 저장소 이름
     * @returns {Promise<boolean>} 저장 성공 여부
     */
    async save(storeName) {
        // 저장소 파일 경로 확인
        if (!this.storeFiles[storeName]) {
            throw new Error(`저장소 파일 ${storeName}이(가) 존재하지 않습니다.`);
        }
        
        // 같은 저장소에 대한 중복 저장 방지
        if (this.pendingSaves.has(storeName)) {
            this.log('WARN', `저장소 ${storeName}에 대한 저장 작업이 이미 진행 중입니다. 대기 중...`);
            
            // 이전 저장 작업 완료 대기
            await this.pendingSaves.get(storeName);
        }
        
        // 새 저장 작업 트랜잭션 생성
        const savePromise = (async () => {
            try {
                const filePath = this.storeFiles[storeName];
                
                // 임시 파일에 먼저 저장 (원자적 쓰기 작업)
                const tempFilePath = `${filePath}.temp`;
                
                // 저장할 데이터
                const storeData = this.stores[storeName] || {};
                
                // 데이터 직렬화 (기본) 또는 암호화
                let dataToWrite;
                
                // 민감한 저장소는 항상 암호화
                const sensitiveStores = ['users', 'invite-codes'];
                
                if (sensitiveStores.includes(storeName) || storeName.includes('secret')) {
                    // 민감한 데이터 암호화
                    dataToWrite = this._encrypt(storeData);
                } else {
                    // 일반 데이터는 JSON으로 직렬화
                    dataToWrite = JSON.stringify(storeData, null, 2);
                }
                
                // 임시 파일에 쓰기
                await fs.writeFile(tempFilePath, dataToWrite, 'utf8');
                
                // 임시 파일을 실제 파일로 이동 (원자적 작업)
                await fs.rename(tempFilePath, filePath);
                
                // 캐시 타임스탬프 갱신
                this.cacheTimestamps[storeName] = Date.now();
                
                this.log('INFO', `저장소 ${storeName} 저장 완료`);
                return true;
            } catch (error) {
                this.log('ERROR', `저장소 ${storeName} 저장 중 오류 발생: ${error.message}`);
                throw error;
            } finally {
                // 작업 완료 후 펜딩 목록에서 제거
                this.pendingSaves.delete(storeName);
            }
        })();
        
        // 펜딩 저장 작업 목록에 추가
        this.pendingSaves.set(storeName, savePromise);
        
        return savePromise;
    }
    
    /**
     * 데이터베이스 백업 생성
     * @param {string} [note] 백업 노트
     * @returns {Promise<string>} 백업 파일 경로
     */
    async createBackup(note = '') {
        try {
            // 백업 디렉토리
            const backupDir = path.join(config.dirs.data, 'backups');
            
            // 백업 생성 전 모든 데이터 저장
            await this.saveAll();
            
            // 백업 파일 이름 생성
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupName = `backup_${timestamp}${note ? '_' + note : ''}`;
            const backupPath = path.join(backupDir, `${backupName}.zip`);
            
            // 임시 디렉토리 생성
            const tempDir = path.join(backupDir, `temp_${timestamp}`);
            await fs.mkdir(tempDir, { recursive: true });
            
            // 모든 저장소 파일 복사
            for (const [storeName, filePath] of Object.entries(this.storeFiles)) {
                try {
                    // 파일 존재 확인
                    await fs.access(filePath);
                    
                    // 임시 디렉토리에 복사
                    const targetPath = path.join(tempDir, path.basename(filePath));
                    await fs.copyFile(filePath, targetPath);
                } catch (error) {
                    this.log('WARN', `백업 중 파일 복사 실패: ${filePath} - ${error.message}`);
                }
            }
            
            // 백업 정보 파일 생성
            const backupInfo = {
                timestamp: new Date().toISOString(),
                note: note || '정기 백업',
                stores: Object.keys(this.storeFiles)
            };
            
            await fs.writeFile(
                path.join(tempDir, 'backup_info.json'),
                JSON.stringify(backupInfo, null, 2),
                'utf8'
            );
            
            // TODO: ZIP 파일 생성 로직 추가
            // 현재는 임시 디렉토리만 생성됨
            
            this.log('INFO', `백업 생성 완료: ${backupPath}`);
            
            // 오래된 백업 정리 (최대 10개만 유지)
            await this._cleanupOldBackups();
            
            return backupPath;
        } catch (error) {
            this.log('ERROR', `백업 생성 중 오류 발생: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 오래된 백업 정리
     * @private
     */
    async _cleanupOldBackups() {
        try {
            // 백업 디렉토리
            const backupDir = path.join(config.dirs.data, 'backups');
            
            // 백업 파일 목록 가져오기
            const files = await fs.readdir(backupDir);
            const backupFiles = files.filter(file => file.startsWith('backup_') && file.endsWith('.zip'));
            
            // 최대 백업 파일 수 (기본 10개)
            const maxBackups = (config.storage && config.storage.maxBackups) || 10;
            
            // 백업 파일이 최대 수를 초과하면 오래된 것부터 삭제
            if (backupFiles.length > maxBackups) {
                // 오래된 순으로 정렬
                backupFiles.sort((a, b) => {
                    const aTime = fsSync.statSync(path.join(backupDir, a)).mtime.getTime();
                    const bTime = fsSync.statSync(path.join(backupDir, b)).mtime.getTime();
                    return aTime - bTime;
                });
                
                // 초과분 삭제
                const filesToDelete = backupFiles.slice(0, backupFiles.length - maxBackups);
                
                for (const file of filesToDelete) {
                    await fs.unlink(path.join(backupDir, file));
                    this.log('INFO', `오래된 백업 삭제: ${file}`);
                }
            }
        } catch (error) {
            this.log('ERROR', `백업 정리 중 오류 발생: ${error.message}`);
        }
    }

    /**
     * 사용자 인증
     * @param {string} username 사용자명
     * @param {string} password 비밀번호
     * @returns {Object|null} 사용자 정보 또는 인증 실패 시 null
     */
    authenticateUser(username, password) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            // 로그인 시도 로깅 (보안)
            this.log('INFO', `사용자 인증 실패 (사용자 없음): ${username}`);
            return null; // 사용자 없음
        }
        
        const user = users[username];
        
        try {
            // 비밀번호 확인
            if (bcrypt.compareSync(password, user.passwordHash)) {
                // 마지막 로그인 시간 업데이트
                user.lastLogin = new Date().toISOString();
                
                // 비동기로 저장
                this.save('users').catch(error => {
                    this.log('ERROR', `사용자 로그인 정보 저장 실패: ${error.message}`);
                });
                
                // 로그인 성공 로깅
                this.log('INFO', `사용자 인증 성공: ${username}`);
                
                return {
                    username: user.username,
                    role: user.role || 'user',
                    created: user.created,
                    lastLogin: user.lastLogin
                };
            }
            
            // 로그인 실패 로깅
            this.log('INFO', `사용자 인증 실패 (비밀번호 불일치): ${username}`);
            return null; // 비밀번호 불일치
        } catch (error) {
            this.log('ERROR', `사용자 인증 중 오류: ${error.message}`);
            return null;
        }
    }

    /**
     * 사용자 생성
     * @param {string} username 사용자명
     * @param {string} password 비밀번호
     * @param {string} [role='user'] 권한
     * @returns {Promise<Object>} 생성된 사용자 정보
     */
    async createUser(username, password, role = 'user') {
        const users = this.getStore('users');
        
        // 사용자명 검증
        if (!username || typeof username !== 'string') {
            throw new Error('유효한 사용자명을 입력해주세요.');
        }
        
        // 비밀번호 검증
        if (!password || typeof password !== 'string' || password.length < 6) {
            throw new Error('비밀번호는 최소 6자 이상이어야 합니다.');
        }
        
        // 권한 검증
        const validRoles = ['admin', 'level1', 'level2', 'level3', 'user'];
        if (!validRoles.includes(role)) {
            throw new Error('유효하지 않은 역할입니다.');
        }
        
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
            lastLogin: null,
            assignedChannels: [],
            settings: {}
        };
        
        // 저장
        await this.save('users');
        
        // 사용자 생성 로깅
        this.log('INFO', `새 사용자 생성: ${username}, 역할: ${role}`);
        
        return {
            username,
            role,
            created: users[username].created
        };
    }

    /**
     * 사용자 삭제
     * @param {string} username 사용자명
     * @returns {Promise<Object>} 삭제 결과
     */
    async deleteUser(username) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        // 관리자 계정 삭제 방지
        if (users[username].role === 'admin' && Object.values(users).filter(u => u.role === 'admin').length <= 1) {
            throw new Error('마지막 관리자 계정은 삭제할 수 없습니다.');
        }
        
        // 사용자 정보 백업
        const userBackup = { ...users[username] };
        
        // 사용자 삭제
        delete users[username];
        
        // 저장
        await this.save('users');
        
        // 사용자 삭제 로깅
        this.log('INFO', `사용자 삭제: ${username}`);
        
        return { 
            success: true, 
            message: '사용자가 삭제되었습니다.',
            userBackup
        };
    }

    /**
     * 비밀번호 재설정
     * @param {string} username 사용자명
     * @param {string} newPassword 새 비밀번호
     * @returns {Promise<Object>} 결과
     */
    async resetUserPassword(username, newPassword) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        // 비밀번호 유효성 검사
        if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
            throw new Error('비밀번호는 최소 6자 이상이어야 합니다.');
        }
        
        // 새 비밀번호 해시 생성
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);
        
        // 비밀번호 업데이트
        users[username].passwordHash = passwordHash;
        users[username].passwordChangedAt = new Date().toISOString();
        
        // 저장
        await this.save('users');
        
        // 비밀번호 변경 로깅
        this.log('INFO', `사용자 비밀번호 변경: ${username}`);
        
        return { 
            success: true, 
            message: '비밀번호가 재설정되었습니다.'
        };
    }

    /**
     * 초대 코드 생성
     * @param {string} [customCode=null] 커스텀 코드
     * @returns {Promise<Object>} 생성된 초대 코드
     */
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
        
        // 코드 포맷 검증
        if (!/^[A-Z0-9]+$/.test(code)) {
            throw new Error('초대 코드는 대문자와 숫자만 포함할 수 있습니다.');
        }
        
        // 코드 중복 확인
        if (inviteCodes[code]) {
            throw new Error('이미 존재하는 초대 코드입니다.');
        }
        
        // 초대 코드 정보 생성
        inviteCodes[code] = {
            code,
            created: new Date().toISOString(),
            createdBy: '시스템', // 생성자 정보 추가 가능
            used: false,
            usedBy: null,
            usedAt: null
        };
        
        // 저장
        await this.save('invite-codes');
        
        // 초대 코드 생성 로깅
        this.log('INFO', `새 초대 코드 생성: ${code}`);
        
        return inviteCodes[code];
    }

    /**
     * 초대 코드 삭제
     * @param {string} code 초대 코드
     * @returns {Promise<Object>} 삭제 결과
     */
    async deleteInviteCode(code) {
        const inviteCodes = this.getStore('invite-codes');
        
        if (!inviteCodes[code]) {
            throw new Error('초대 코드를 찾을 수 없습니다.');
        }
        
        // 초대 코드 정보 백업
        const codeInfo = { ...inviteCodes[code] };
        
        // 초대 코드 삭제
        delete inviteCodes[code];
        
        // 저장
        await this.save('invite-codes');
        
        // 초대 코드 삭제 로깅
        this.log('INFO', `초대 코드 삭제: ${code}`);
        
        return { 
            success: true, 
            message: '초대 코드가 삭제되었습니다.',
            codeInfo
        };
    }

    /**
     * 초대 코드 사용
     * @param {string} code 초대 코드
     * @param {string} username 사용자명
     * @returns {Promise<Object>} 결과
     */
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
        
        // 초대 코드 사용 로깅
        this.log('INFO', `초대 코드 사용: ${code}, 사용자: ${username}`);
        
        return { 
            success: true, 
            message: '초대 코드가 사용되었습니다.'
        };
    }

    /**
     * 초대 코드 유효성 확인
     * @param {string} code 초대 코드
     * @returns {boolean} 유효 여부
     */
    isValidInviteCode(code) {
        const inviteCodes = this.getStore('invite-codes');
        return inviteCodes[code] && !inviteCodes[code].used;
    }

    /**
     * 사용자 역할 업데이트
     * @param {string} username 사용자명
     * @param {string} role 역할
     * @returns {Promise<Object>} 업데이트된 사용자 정보
     */
    async updateUserRole(username, role) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        // 역할 검증
        const validRoles = ['level1', 'level2', 'level3', 'user', 'admin'];
        if (!validRoles.includes(role)) {
            throw new Error('유효하지 않은 역할입니다.');
        }
        
        // 관리자 권한 변경 제한 (마지막 관리자 계정 검사)
        if (users[username].role === 'admin' && role !== 'admin') {
            const adminCount = Object.values(users).filter(u => u.role === 'admin').length;
            if (adminCount <= 1) {
                throw new Error('마지막 관리자 계정의 권한은 변경할 수 없습니다.');
            }
        }
        
        // 이전 역할
        const previousRole = users[username].role;
        
        // 사용자 역할 업데이트
        users[username].role = role;
        users[username].roleUpdatedAt = new Date().toISOString();
        
        // 저장
        await this.save('users');
        
        // 사용자 역할 업데이트 로깅
        this.log('INFO', `사용자 역할 변경: ${username}, ${previousRole} → ${role}`);
        
        return {
            username,
            role,
            previousRole
        };
    }

    /**
     * 사용자 채널 할당
     * @param {string} username 사용자명
     * @param {string} serverId 서버 ID
     * @param {string} channelId 채널 ID
     * @param {string} [serverName='알 수 없음'] 서버 이름
     * @param {string} [channelName='알 수 없음'] 채널 이름
     * @returns {Promise<Array>} 할당된 채널 목록
     */
    async assignChannelToUser(username, serverId, channelId, serverName = '알 수 없음', channelName = '알 수 없음') {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        // 서버 및 채널 ID 검증
        if (!serverId || !channelId) {
            throw new Error('서버 ID와 채널 ID는 필수입니다.');
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
            channelName: channelName || '알 수 없음',
            assignedAt: new Date().toISOString()
        });
        
        // 저장
        await this.save('users');
        
        // 채널 할당 로깅
        this.log('INFO', `사용자 ${username}에게 채널 할당: ${serverName} / ${channelName} (${channelId})`);
        
        return users[username].assignedChannels;
    }

    /**
     * 사용자 채널 할당 해제
     * @param {string} username 사용자명
     * @param {string} channelId 채널 ID
     * @returns {Promise<Array>} 남은 할당된 채널 목록
     */
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
        
        // 할당 해제할 채널 찾기
        const channelIndex = users[username].assignedChannels.findIndex(ch => ch.channelId === channelId);
        if (channelIndex === -1) {
            throw new Error('할당된 채널을 찾을 수 없습니다.');
        }
        
        // 채널 정보 백업
        const removedChannel = { ...users[username].assignedChannels[channelIndex] };
        
        // 채널 제거
        users[username].assignedChannels.splice(channelIndex, 1);
        
        // 저장
        await this.save('users');
        
        // 채널 할당 해제 로깅
        this.log('INFO', `사용자 ${username}의 채널 할당 해제: ${removedChannel.serverName} / ${removedChannel.channelName} (${channelId})`);
        
        return users[username].assignedChannels;
    }

    /**
     * 사용자 채널 목록 가져오기
     * @param {string} username 사용자명
     * @returns {Array} 할당된 채널 목록
     */
    getUserChannels(username) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        return users[username].assignedChannels || [];
    }
    
    /**
     * 서버 할당 (새로운 기능)
     * @param {string} username 사용자명
     * @param {string} serverId 서버 ID
     * @param {string} [serverName='알 수 없음'] 서버 이름
     * @returns {Promise<Array>} 할당된 서버 목록
     */
    async assignServerToUser(username, serverId, serverName = '알 수 없음') {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        // 서버 ID 검증
        if (!serverId) {
            throw new Error('서버 ID는 필수입니다.');
        }
        
        // 할당된 서버 목록이 없으면 초기화
        if (!users[username].assignedServers) {
            users[username].assignedServers = [];
        }
        
        // 이미 할당된 서버인지 확인
        const existingServer = users[username].assignedServers.find(s => s.serverId === serverId);
        if (existingServer) {
            throw new Error('이미 할당된 서버입니다.');
        }
        
        // 서버 정보 추가
        users[username].assignedServers.push({
            serverId,
            serverName: serverName || '알 수 없음',
            assignedAt: new Date().toISOString()
        });
        
        // 저장
        await this.save('users');
        
        // 서버 할당 로깅
        this.log('INFO', `사용자 ${username}에게 서버 할당: ${serverName} (${serverId})`);
        
        return users[username].assignedServers;
    }
    
    /**
     * 사용자 서버 할당 해제
     * @param {string} username 사용자명
     * @param {string} serverId 서버 ID
     * @returns {Promise<Array>} 남은 할당된 서버 목록
     */
    async unassignServerFromUser(username, serverId) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        // 할당된 서버 목록이 없으면 초기화
        if (!users[username].assignedServers) {
            users[username].assignedServers = [];
            return [];
        }
        
        // 할당 해제할 서버 찾기
        const serverIndex = users[username].assignedServers.findIndex(s => s.serverId === serverId);
        if (serverIndex === -1) {
            throw new Error('할당된 서버를 찾을 수 없습니다.');
        }
        
        // 서버 정보 백업
        const removedServer = { ...users[username].assignedServers[serverIndex] };
        
        // 서버 제거
        users[username].assignedServers.splice(serverIndex, 1);
        
        // 저장
        await this.save('users');
        
        // 서버 할당 해제 로깅
        this.log('INFO', `사용자 ${username}의 서버 할당 해제: ${removedServer.serverName} (${serverId})`);
        
        return users[username].assignedServers;
    }
    
    /**
     * 사용자 서버 목록 가져오기
     * @param {string} username 사용자명
     * @returns {Array} 할당된 서버 목록
     */
    getUserServers(username) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            throw new Error('사용자를 찾을 수 없습니다.');
        }
        
        return users[username].assignedServers || [];
    }
    
    /**
     * 모듈 설정 가져오기
     * @param {string} moduleName 모듈 이름
     * @returns {Object} 모듈 설정
     */
    getModuleSettings(moduleName) {
        // 모듈 이름으로 저장소 이름 생성
        const storeName = `${moduleName}-config`;
        
        // 저장소가 없으면 생성
        if (!this.stores[storeName]) {
            this.stores[storeName] = {};
            
            // 파일 경로 설정
            this.storeFiles[storeName] = path.join(config.dirs.data, `${storeName}.json`);
        }
        
        return this.getStore(storeName);
    }
    
    /**
     * 모듈 설정 저장
     * @param {string} moduleName 모듈 이름
     * @param {Object} settings 모듈 설정
     * @returns {Promise<boolean>} 저장 성공 여부
     */
    async saveModuleSettings(moduleName, settings) {
        // 모듈 이름으로 저장소 이름 생성
        const storeName = `${moduleName}-config`;
        
        // 설정 유효성 검사
        if (!settings || typeof settings !== 'object') {
            throw new Error('설정은 객체여야 합니다.');
        }
        
        // 저장소 업데이트
        this.setAll(storeName, settings);
        
        // 파일 경로 설정 (없는 경우)
        if (!this.storeFiles[storeName]) {
            this.storeFiles[storeName] = path.join(config.dirs.data, `${storeName}.json`);
        }
        
        // 저장
        await this.save(storeName);
        
        this.log('INFO', `모듈 설정 저장: ${moduleName}`);
        
        return true;
    }
    
    /**
     * 봇 설정 가져오기
     * @returns {Object} 봇 설정
     */
    getBotConfig() {
        return this.getStore('bot-config');
    }
    
    /**
     * 봇 설정 저장
     * @param {Object} config 봇 설정
     * @returns {Promise<boolean>} 저장 성공 여부
     */
    async saveBotConfig(config) {
        // 설정 유효성 검사
        if (!config || typeof config !== 'object') {
            throw new Error('설정은 객체여야 합니다.');
        }
        
        // 현재 설정 가져오기
        const currentConfig = this.getStore('bot-config');
        
        // 설정 병합
        const mergedConfig = { ...currentConfig, ...config };
        
        // 저장소 업데이트
        this.setAll('bot-config', mergedConfig);
        
        // 저장
        await this.save('bot-config');
        
        this.log('INFO', '봇 설정이 저장되었습니다.');
        
        return true;
    }
    
    /**
     * 서버 설정 가져오기
     * @param {string} serverId 서버 ID
     * @returns {Object} 서버 설정
     */
    getServerSettings(serverId) {
        const serverSettings = this.getStore('server-settings');
        
        // 서버 설정이 없으면 초기화
        if (!serverSettings[serverId]) {
            serverSettings[serverId] = {
                serverId,
                createdAt: new Date().toISOString(),
                modules: {},
                settings: {}
            };
        }
        
        return serverSettings[serverId];
    }
    
    /**
     * 서버 설정 저장
     * @param {string} serverId 서버 ID
     * @param {Object} settings 서버 설정
     * @returns {Promise<boolean>} 저장 성공 여부
     */
    async saveServerSettings(serverId, settings) {
        // 설정 유효성 검사
        if (!settings || typeof settings !== 'object') {
            throw new Error('설정은 객체여야 합니다.');
        }
        
        // 서버 ID 검증
        if (!serverId) {
            throw new Error('서버 ID는 필수입니다.');
        }
        
        // 서버 설정 가져오기
        const serverSettings = this.getStore('server-settings');
        
        // 기존 설정 백업
        const previousSettings = serverSettings[serverId] ? { ...serverSettings[serverId] } : null;
        
        // 설정 업데이트
        serverSettings[serverId] = {
            ...(previousSettings || { serverId, createdAt: new Date().toISOString() }),
            ...settings,
            updatedAt: new Date().toISOString()
        };
        
        // 저장
        await this.save('server-settings');
        
        this.log('INFO', `서버 설정 저장: ${serverId}`);
        
        return true;
    }
    
    /**
     * 사용자 이름으로 사용자 찾기
     * @param {string} username 사용자명
     * @returns {Object|null} 사용자 정보
     */
    findUserByUsername(username) {
        const users = this.getStore('users');
        
        if (!users[username]) {
            return null;
        }
        
        // 민감 정보 제외한 사용자 정보 반환
        const user = users[username];
        return {
            username: user.username,
            role: user.role || 'user',
            created: user.created,
            lastLogin: user.lastLogin,
            assignedChannels: user.assignedChannels || [],
            assignedServers: user.assignedServers || []
        };
    }
    
    /**
     * 역할별 사용자 목록 가져오기
     * @param {string} [role] 특정 역할 (미지정 시 모든 사용자)
     * @returns {Array} 사용자 목록
     */
    getUsersByRole(role = null) {
        const users = this.getStore('users');
        
        return Object.values(users)
            .filter(user => !role || user.role === role)
            .map(user => ({
                username: user.username,
                role: user.role || 'user',
                created: user.created,
                lastLogin: user.lastLogin
            }));
    }
}

// 인스턴스 생성
const storage = new Storage();
module.exports = storage;