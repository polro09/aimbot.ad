/**
 * Storage - 개선된 데이터 저장소 관리 시스템
 * v3.0.0 - 성능, 안정성, 보안 강화 및 완전한 백업 메커니즘 구현
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require('./config'); // config 파일: 데이터 디렉토리, 저장소 설정 등을 포함해야 함
const zlib = require('zlib');
const util = require('util');
const gzip = util.promisify(zlib.gzip);
const gunzip = util.promisify(zlib.gunzip);

class Storage {
  constructor() {
    this.initialized = false;
    this.stores = {
      'users': {},
      'invite-codes': {},
      'user-settings': {},
      'bot-config': {},
      'server-settings': {},
      'module-settings': {},
      'raid-calls': {},
      'raid-call-config': {},
      'voice-channels': {},
      'voice-channels-config': {},
      'ticket-system-config': {},
      'vacation-system-config': {},
      'welcome-settings': {},
      'clan-applications': {},
      'raid-dungeons': {}
    };
    this.storeFiles = {};
    this.cacheTimestamps = {};
    this.cacheTTL = 5 * 60 * 1000;
    this.logFunction = null;
    this.backupTimer = null;
    this.pendingSaves = new Map();
    this.autoSaveInterval = null;
    this.lastSaveTime = {};
    this.encryptionKey = null;
    this.recoveryAttempts = new Map();
    this.lastBackupTime = null;
    this.backupStats = {
      successCount: 0,
      failureCount: 0,
      lastSuccess: null,
      lastFailure: null
    };
    this.corruptionStats = {
      detectedCount: 0,
      recoveredCount: 0,
      failedRecoveries: 0
    };
    this.locks = new Map();
  }

  /* ----------------------- 초기화 및 설정 ----------------------- */

  /**
   * 저장소 시스템 초기화
   * @param {Function} logFn 로깅 함수
   * @returns {Promise<boolean>}
   */
  async init(logFn) {
    if (this.initialized) return true;
    try {
      this.logFunction = logFn || console.log;
      await this._initDataDirectory();
      await this._setupEncryptionKey();
      this._setupStorePaths();
      await this._loadAllStores();
      this._setupAutoSave();
      this._setupBackupSystem();
      await this._createInitialBackup();
      this.initialized = true;
      this.log('INFO', '저장소 초기화 완료');
      return true;
    } catch (error) {
      this.log('ERROR', `저장소 초기화 중 오류: ${error.message}`);
      if (Object.keys(this.stores).some(store => Object.keys(this.stores[store]).length > 0)) {
        this.initialized = true;
        this.log('WARN', '저장소가 부분적으로 초기화되었습니다. 일부 기능이 제한될 수 있습니다.');
        return true;
      }
      throw error;
    }
  }

  async _initDataDirectory() {
    try {
      await fs.access(config.dirs.data).catch(async () => {
        await fs.mkdir(config.dirs.data, { recursive: true });
        this.log('INFO', `데이터 디렉토리 생성: ${config.dirs.data}`);
      });
      const backupDir = path.join(config.dirs.data, 'backups');
      await fs.access(backupDir).catch(async () => {
        await fs.mkdir(backupDir, { recursive: true });
        this.log('INFO', `백업 디렉토리 생성: ${backupDir}`);
      });
      const recoveryDir = path.join(config.dirs.data, 'recovery');
      await fs.access(recoveryDir).catch(async () => {
        await fs.mkdir(recoveryDir, { recursive: true });
        this.log('INFO', `복구 디렉토리 생성: ${recoveryDir}`);
      });
      const tempDir = path.join(config.dirs.data, 'temp');
      await fs.access(tempDir).catch(async () => {
        await fs.mkdir(tempDir, { recursive: true });
        this.log('INFO', `임시 디렉토리 생성: ${tempDir}`);
      });
    } catch (error) {
      this.log('ERROR', `데이터 디렉토리 초기화 중 오류: ${error.message}`);
      throw error;
    }
  }

  async _setupEncryptionKey() {
    const keyPath = path.join(config.dirs.data, '.encryption_key');
    try {
      const keyExists = await fs.access(keyPath).then(() => true).catch(() => false);
      if (keyExists) {
        this.encryptionKey = await fs.readFile(keyPath, 'utf8');
        this.log('INFO', '암호화 키를 로드했습니다.');
      } else {
        this.encryptionKey = crypto.randomBytes(32).toString('hex');
        await fs.writeFile(keyPath, this.encryptionKey, 'utf8');
        await fs.chmod(keyPath, 0o600);
        this.log('INFO', '새 암호화 키를 생성했습니다.');
      }
      if (!this.encryptionKey || this.encryptionKey.length < 32) {
        throw new Error('유효하지 않은 암호화 키');
      }
    } catch (error) {
      this.log('ERROR', `암호화 키 설정 중 오류: ${error.message}`);
      this.encryptionKey = 'emergency_fallback_key_' + crypto.randomBytes(16).toString('hex');
      this.log('WARN', '비상용 임시 암호화 키를 사용합니다. 데이터 보안이 저하될 수 있습니다.');
      try {
        await fs.writeFile(keyPath, this.encryptionKey, 'utf8');
        await fs.chmod(keyPath, 0o600);
        this.log('INFO', '비상용 암호화 키를 저장했습니다.');
      } catch (saveError) {
        this.log('ERROR', `비상용 암호화 키 저장 실패: ${saveError.message}`);
      }
    }
  }

  _setupStorePaths() {
    const basicStores = [
      'users', 'invite-codes', 'user-settings',
      'bot-config', 'server-settings'
    ];
    basicStores.forEach(store => {
      this.storeFiles[store] = path.join(config.dirs.data, `${store}.json`);
    });
    const moduleStores = [
      'welcome-settings', 'ticket-system-config', 'voice-channels-config',
      'vacation-system-config', 'raid-call-config', 'raid-calls',
      'voice-channels', 'clan-applications', 'raid-dungeons'
    ];
    moduleStores.forEach(store => {
      this.storeFiles[store] = path.join(config.dirs.data, `${store}.json`);
      if (!this.stores[store]) this.stores[store] = {};
    });
  }

  async _loadAllStores() {
    const loadOrder = [
      'users', 'invite-codes', 'user-settings', 'bot-config', 'server-settings',
      'voice-channels-config', 'welcome-settings', 'ticket-system-config',
      'raid-call-config', 'raid-calls', 'voice-channels', 'vacation-system-config',
      'clan-applications', 'raid-dungeons'
    ];
    const remainingStores = Object.keys(this.storeFiles).filter(store => !loadOrder.includes(store));
    const orderedStores = [...loadOrder, ...remainingStores];
    const results = { success: [], fail: [] };
    for (const storeName of orderedStores) {
      try {
        await this.load(storeName);
        results.success.push(storeName);
      } catch (error) {
        results.fail.push({ name: storeName, error: error.message });
        this.log('WARN', `저장소 ${storeName} 로드 실패: ${error.message}`);
      }
    }
    this.log('INFO', `저장소 로드 완료: ${results.success.length}개 성공, ${results.fail.length}개 실패`);
    if (results.fail.length > 0) {
      const failedStores = results.fail.map(f => f.name).join(', ');
      this.log('WARN', `로드 실패한 저장소: ${failedStores}`);
      for (const failed of results.fail) {
        await this._attemptRecovery(failed.name);
      }
    }
    return results;
  }

  async _createInitialBackup() {
    try {
      const backupDir = path.join(config.dirs.data, 'backups');
      const files = await fs.readdir(backupDir);
      const backupFiles = files.filter(file => file.startsWith('backup_') && file.endsWith('.zip'));
      const needsInitialBackup = backupFiles.length === 0 ||
        !this.lastBackupTime ||
        (Date.now() - this.lastBackupTime > 24 * 60 * 60 * 1000);
      if (needsInitialBackup) {
        this.log('INFO', '초기 백업을 생성합니다...');
        await this.createBackup('initial');
        this.log('INFO', '초기 백업이 생성되었습니다.');
      }
    } catch (error) {
      this.log('WARN', `초기 백업 생성 중 오류: ${error.message}`);
    }
  }

  _setupAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    if (config.storage && config.storage.autoSave) {
      const interval = config.storage.saveInterval || 300000;
      this.autoSaveInterval = setInterval(async () => {
        try {
          const changedStores = this._getChangedStores();
          if (changedStores.length > 0) {
            for (const store of changedStores) {
              await this.save(store);
            }
            this.log('INFO', `자동 저장 완료 (${changedStores.length}개 저장소 업데이트)`);
          }
        } catch (error) {
          this.log('ERROR', `자동 저장 중 오류: ${error.message}`);
        }
      }, interval);
      this.log('INFO', `자동 저장 활성화: ${interval / 1000}초 간격`);
    }
  }

  _getChangedStores() {
    const changedStores = [];
    for (const [storeName, timestamp] of Object.entries(this.cacheTimestamps)) {
      const lastSave = this.lastSaveTime[storeName] || 0;
      if (timestamp > lastSave) {
        changedStores.push(storeName);
      }
    }
    return changedStores;
  }

  _setupBackupSystem() {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }
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

  log(type, message) {
    if (this.logFunction) {
      this.logFunction(type, `[Storage] ${message}`);
    } else {
      console.log(`[${type}] [Storage] ${message}`);
    }
  }

  /* ----------------------- 암호화/복호화 ----------------------- */

  _encrypt(data) {
    try {
      const key = crypto.createHash('sha256').update(this.encryptionKey).digest();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      const serializedData = JSON.stringify(data);
      let encrypted = cipher.update(serializedData, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      this.log('ERROR', `데이터 암호화 중 오류: ${error.message}`);
      throw new Error('데이터 암호화 실패');
    }
  }

  _isEncrypted(data) {
    return typeof data === 'string' &&
           data.includes(':') &&
           /^[0-9a-f]{32}:[0-9a-f]+$/.test(data);
  }

  _decrypt(encryptedData) {
    try {
      const [ivHex, encrypted] = encryptedData.split(':');
      if (!ivHex || !encrypted) {
        throw new Error('잘못된 암호화 데이터 형식');
      }
      const iv = Buffer.from(ivHex, 'hex');
      const key = crypto.createHash('sha256').update(this.encryptionKey).digest();
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    } catch (error) {
      this.log('ERROR', `데이터 복호화 중 오류: ${error.message}`);
      throw new Error('데이터 복호화 실패');
    }
  }

  _isValidJSON(str) {
    if (typeof str !== 'string') return false;
    str = str.trim();
    if (!str) return false;
    if (!str.startsWith('{') || !str.endsWith('}')) return false;
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ----------------------- 저장소 관리 ----------------------- */

  async ensureStorage(storeKey, defaultData = {}) {
    try {
      await this.load(storeKey);
      return true;
    } catch (error) {
      this.log('INFO', `저장소 ${storeKey}이(가) 없어 새로 생성합니다.`);
      this.setAll(storeKey, defaultData);
      await this.save(storeKey);
      return true;
    }
  }

  async load(storeName) {
    try {
      const filePath = this.storeFiles[storeName];
      if (!filePath) {
        this.storeFiles[storeName] = path.join(config.dirs.data, `${storeName}.json`);
        this.stores[storeName] = {};
        await fs.writeFile(this.storeFiles[storeName], '{}', 'utf8');
        this.log('INFO', `저장소 ${storeName} 파일이 새로 생성되었습니다.`);
        return true;
      }
      try {
        await fs.access(filePath);
        const data = await fs.readFile(filePath, 'utf8');
        if (!data || data.trim() === '') {
          this.stores[storeName] = {};
          this.log('WARN', `저장소 ${storeName}이(가) 비어 있습니다. 빈 객체로 초기화합니다.`);
          return true;
        }
        try {
          if (this._isEncrypted(data)) {
            const decryptedData = this._decrypt(data);
            this.stores[storeName] = decryptedData;
          } else {
            this.stores[storeName] = JSON.parse(data);
          }
          this.cacheTimestamps[storeName] = Date.now();
          this.log('INFO', `저장소 ${storeName}을(를) 로드했습니다.`);
          this.recoveryAttempts.delete(storeName);
          return true;
        } catch (parseError) {
          this.log('ERROR', `저장소 ${storeName} 파싱 오류: ${parseError.message}`);
          this.corruptionStats.detectedCount++;
          const recoveryDir = path.join(config.dirs.data, 'recovery');
          const backupPath = path.join(recoveryDir, `${storeName}_corrupted_${Date.now()}.json`);
          await fs.copyFile(filePath, backupPath);
          this.log('WARN', `손상된 저장소 파일 백업: ${backupPath}`);
          return await this._attemptRecovery(storeName);
        }
      } catch (accessError) {
        this.stores[storeName] = {};
        await fs.writeFile(filePath, '{}', 'utf8');
        this.log('INFO', `저장소 ${storeName} 파일이 새로 생성되었습니다.`);
        return true;
      }
    } catch (error) {
      this.log('ERROR', `저장소 ${storeName} 로드 중 오류: ${error.message}`);
      this.stores[storeName] = {};
      this.log('WARN', `저장소 ${storeName}을(를) 빈 객체로 초기화합니다.`);
      throw error;
    }
  }

  getStore(storeName) {
    if (!this.stores[storeName]) {
      this.stores[storeName] = {};
      this.log('WARN', `저장소 ${storeName}이(가) 없어 빈 객체로 초기화합니다.`);
      if (!this.storeFiles[storeName]) {
        this.storeFiles[storeName] = path.join(config.dirs.data, `${storeName}.json`);
      }
    }
    return this.stores[storeName];
  }

  getAll(storeName) {
    return this.getStore(storeName);
  }

  get(storeName, key) {
    const store = this.getStore(storeName);
    return store[key];
  }

  setAll(storeName, data) {
    if (!this.stores[storeName]) {
      this.stores[storeName] = {};
    }
    if (typeof data !== 'object' || data === null) {
      throw new Error('저장소 데이터는 객체여야 합니다.');
    }
    this.stores[storeName] = data;
    this.cacheTimestamps[storeName] = Date.now();
  }

  set(storeName, key, value) {
    if (!this.stores[storeName]) {
      this.stores[storeName] = {};
    }
    if (key === null || key === undefined) {
      throw new Error('키는 null 또는 undefined일 수 없습니다.');
    }
    this.stores[storeName][key] = value;
    this.cacheTimestamps[storeName] = Date.now();
  }

  delete(storeName, key) {
    if (!this.stores[storeName]) {
      throw new Error(`저장소 ${storeName}이(가) 존재하지 않습니다.`);
    }
    delete this.stores[storeName][key];
    this.cacheTimestamps[storeName] = Date.now();
  }

  async saveAll() {
    const results = { success: [], failed: [] };
    const storeNames = Object.keys(this.storeFiles);
    const batchSize = 5;
    for (let i = 0; i < storeNames.length; i += batchSize) {
      const batch = storeNames.slice(i, i + batchSize);
      const savePromises = batch.map(async storeName => {
        try {
          await this.save(storeName);
          results.success.push(storeName);
        } catch (error) {
          results.failed.push({ name: storeName, error: error.message });
          this.log('ERROR', `저장소 ${storeName} 저장 실패: ${error.message}`);
        }
      });
      await Promise.all(savePromises);
    }
    if (results.failed.length > 0) {
      this.log('WARN', `저장 실패한 저장소: ${results.failed.map(f => f.name).join(', ')}`);
    }
    this.log('INFO', `모든 저장소 저장 완료: ${results.success.length}개 성공, ${results.failed.length}개 실패`);
    return results;
  }

  async _acquireLock(storeName, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (!this.locks.has(storeName)) {
        this.locks.set(storeName, Date.now());
        return true;
      }
      const lockTime = this.locks.get(storeName);
      if (Date.now() - lockTime > 5000) {
        this.log('WARN', `저장소 ${storeName}의 오래된 락을 강제 해제합니다.`);
        this.locks.delete(storeName);
        continue;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  _releaseLock(storeName) {
    this.locks.delete(storeName);
  }

  async save(storeName) {
    if (!this.storeFiles[storeName]) {
      throw new Error(`저장소 파일 ${storeName}이(가) 존재하지 않습니다.`);
    }
    if (this.pendingSaves.has(storeName)) {
      this.log('WARN', `저장소 ${storeName}에 대한 저장 작업이 이미 진행 중입니다. 대기 중...`);
      try {
        await this.pendingSaves.get(storeName);
      } catch (error) {}
    }
    const lockAcquired = await this._acquireLock(storeName);
    if (!lockAcquired) {
      throw new Error(`저장소 ${storeName} 락 획득 타임아웃`);
    }
    const savePromise = (async () => {
      try {
        const filePath = this.storeFiles[storeName];
        try {
          await fs.access(filePath);
          const tempBackupPath = `${filePath}.bak`;
          await fs.copyFile(filePath, tempBackupPath);
        } catch (backupError) {
          this.log('WARN', `저장소 ${storeName}의 임시 백업 실패: ${backupError.message}`);
        }
        const tempFilePath = `${filePath}.temp`;
        const storeData = this.stores[storeName] || {};
        let dataToWrite;
        const sensitiveStores = ['users', 'invite-codes'];
        if (sensitiveStores.includes(storeName) || storeName.includes('secret')) {
          dataToWrite = this._encrypt(storeData);
        } else {
          dataToWrite = JSON.stringify(storeData, null, 2);
        }
        await fs.writeFile(tempFilePath, dataToWrite, 'utf8');
        const checkData = await fs.readFile(tempFilePath, 'utf8');
        if (!checkData || (!sensitiveStores.includes(storeName) && !storeName.includes('secret') && !this._isValidJSON(checkData))) {
          throw new Error('임시 파일 쓰기 검증 실패');
        }
        await fs.rename(tempFilePath, filePath);
        try {
          await fs.unlink(`${filePath}.bak`);
        } catch (cleanupError) {}
        this.lastSaveTime[storeName] = Date.now();
        this.log('INFO', `저장소 ${storeName} 저장 완료`);
        return true;
      } catch (error) {
        this.log('ERROR', `저장소 ${storeName} 저장 중 오류: ${error.message}`);
        try {
          const filePath = this.storeFiles[storeName];
          const backupPath = `${filePath}.bak`;
          await fs.access(backupPath);
          await fs.copyFile(backupPath, filePath);
          this.log('INFO', `저장소 ${storeName}을(를) 백업에서 복원했습니다.`);
          await fs.unlink(backupPath);
        } catch (recoveryError) {
          this.log('ERROR', `저장소 ${storeName} 복원 실패: ${recoveryError.message}`);
        }
        throw error;
      } finally {
        this._releaseLock(storeName);
        this.pendingSaves.delete(storeName);
      }
    })();
    this.pendingSaves.set(storeName, savePromise);
    return savePromise;
  }

  async createBackup(note = '') {
    try {
      const backupDir = path.join(config.dirs.data, 'backups');
      await this.saveAll();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = `backup_${timestamp}${note ? '_' + note : ''}`;
      const backupPath = path.join(backupDir, `${backupName}.zip`);
      const tempDir = path.join(config.dirs.data, 'temp', `backup_${timestamp}`);
      await fs.mkdir(tempDir, { recursive: true });
      try {
        for (const [storeName, filePath] of Object.entries(this.storeFiles)) {
          try {
            await fs.access(filePath);
            const targetPath = path.join(tempDir, path.basename(filePath));
            await fs.copyFile(filePath, targetPath);
          } catch (error) {
            this.log('WARN', `백업 중 파일 복사 실패: ${filePath} - ${error.message}`);
          }
        }
        const backupInfo = {
          timestamp: new Date().toISOString(),
          note: note || '정기 백업',
          stores: Object.keys(this.storeFiles),
          stats: {
            storeCount: Object.keys(this.storeFiles).length,
            totalItems: Object.values(this.stores).reduce((sum, store) => sum + Object.keys(store).length, 0),
            corruptionStats: { ...this.corruptionStats }
          }
        };
        await fs.writeFile(
          path.join(tempDir, 'backup_info.json'),
          JSON.stringify(backupInfo, null, 2),
          'utf8'
        );
        try {
          const AdmZip = require('adm-zip');
          const zip = new AdmZip();
          const tempDirFiles = await fs.readdir(tempDir);
          for (const file of tempDirFiles) {
            const filePath = path.join(tempDir, file);
            zip.addLocalFile(filePath);
          }
          zip.writeZip(backupPath);
          this.log('INFO', `백업 ZIP 파일 생성 완료: ${backupPath}`);
        } catch (zipError) {
          throw new Error(`ZIP 파일 생성 실패: ${zipError.message}`);
        }
        this.log('INFO', `백업 생성 완료: ${backupPath}`);
        this.lastBackupTime = Date.now();
        this.backupStats.successCount++;
        this.backupStats.lastSuccess = new Date();
        await this._cleanupOldBackups();
        return backupPath;
      } finally {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          this.log('WARN', `임시 디렉토리 정리 실패: ${cleanupError.message}`);
        }
      }
    } catch (error) {
      this.log('ERROR', `백업 생성 중 오류: ${error.message}`);
      this.backupStats.failureCount++;
      this.backupStats.lastFailure = new Date();
      throw error;
    }
  }

  async _cleanupOldBackups() {
    try {
      const backupDir = path.join(config.dirs.data, 'backups');
      const files = await fs.readdir(backupDir);
      const backupFiles = files.filter(file => file.startsWith('backup_') && file.endsWith('.zip'));
      const maxBackups = (config.storage && config.storage.maxBackups) || 10;
      if (backupFiles.length > maxBackups) {
        backupFiles.sort((a, b) => {
          const aTime = fsSync.statSync(path.join(backupDir, a)).mtime.getTime();
          const bTime = fsSync.statSync(path.join(backupDir, b)).mtime.getTime();
          return aTime - bTime;
        });
        const filesToDelete = backupFiles.slice(0, backupFiles.length - maxBackups);
        for (const file of filesToDelete) {
          await fs.unlink(path.join(backupDir, file));
          this.log('INFO', `오래된 백업 삭제: ${file}`);
        }
      }
    } catch (error) {
      this.log('ERROR', `백업 정리 중 오류: ${error.message}`);
    }
  }

  async _attemptRecovery(storeName) {
    const attempts = this.recoveryAttempts.get(storeName) || 0;
    if (attempts >= 3) {
      this.log('ERROR', `저장소 ${storeName} 복구 실패: 최대 재시도 횟수 초과`);
      return false;
    }
    this.recoveryAttempts.set(storeName, attempts + 1);
    this.log('INFO', `저장소 ${storeName} 복구 시도 중... (시도 ${attempts + 1}/3)`);
    try {
      const recoveredFromBackup = await this._recoverFromBackup(storeName);
      if (recoveredFromBackup) {
        this.log('INFO', `저장소 ${storeName} 백업 복구 성공`);
        this.corruptionStats.recoveredCount++;
        return true;
      }
      const recoveredFromRecovery = await this._recoverFromRecoveryDir(storeName);
      if (recoveredFromRecovery) {
        this.log('INFO', `저장소 ${storeName} 복구 디렉토리 복구 성공`);
        this.corruptionStats.recoveredCount++;
        return true;
      }
      this.stores[storeName] = {};
      const filePath = this.storeFiles[storeName];
      await fs.writeFile(filePath, '{}', 'utf8');
      this.log('WARN', `저장소 ${storeName} 빈 객체로 초기화`);
      this.corruptionStats.failedRecoveries++;
      return false;
    } catch (error) {
      this.log('ERROR', `저장소 ${storeName} 복구 시도 오류: ${error.message}`);
      this.corruptionStats.failedRecoveries++;
      return false;
    }
  }

  async _recoverFromBackup(storeName) {
    try {
      const backupDir = path.join(config.dirs.data, 'backups');
      const files = await fs.readdir(backupDir);
      const backupFiles = files.filter(file => file.startsWith('backup_') && file.endsWith('.zip'))
        .sort((a, b) => {
          const timeA = fsSync.statSync(path.join(backupDir, a)).mtime.getTime();
          const timeB = fsSync.statSync(path.join(backupDir, b)).mtime.getTime();
          return timeB - timeA;
        });
      if (backupFiles.length === 0) {
        this.log('WARN', '복구 가능한 백업 파일이 없습니다.');
        return false;
      }
      const latestBackup = backupFiles[0];
      const backupPath = path.join(backupDir, latestBackup);
      this.log('INFO', `백업 파일 ${latestBackup}에서 ${storeName} 복원 시도`);
      const tempDir = path.join(config.dirs.data, 'temp', `recovery_${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });
      try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(backupPath);
        zip.extractAllTo(tempDir, true);
        const storeFileName = path.basename(this.storeFiles[storeName]);
        const extractedPath = path.join(tempDir, storeFileName);
        const fileExists = await fs.access(extractedPath).then(() => true).catch(() => false);
        if (!fileExists) {
          this.log('WARN', `백업에서 ${storeName} 파일을 찾을 수 없습니다.`);
          return false;
        }
        const data = await fs.readFile(extractedPath, 'utf8');
        try {
          if (this._isEncrypted(data)) {
            const decrypted = this._decrypt(data);
            this.stores[storeName] = decrypted;
          } else {
            this.stores[storeName] = JSON.parse(data);
          }
          await this.save(storeName);
          this.log('INFO', `저장소 ${storeName} 백업 복원 성공`);
          return true;
        } catch (parseError) {
          this.log('ERROR', `백업 파일 파싱 실패: ${parseError.message}`);
          return false;
        }
      } finally {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          this.log('WARN', `임시 디렉토리 정리 실패: ${cleanupError.message}`);
        }
      }
    } catch (error) {
      this.log('ERROR', `백업 복원 중 오류: ${error.message}`);
      return false;
    }
  }

  async _recoverFromRecoveryDir(storeName) {
    try {
      const recoveryDir = path.join(config.dirs.data, 'recovery');
      const files = await fs.readdir(recoveryDir);
      const recoveryFiles = files.filter(file => file.startsWith(`${storeName}_`))
        .sort((a, b) => {
          const timeA = fsSync.statSync(path.join(recoveryDir, a)).mtime.getTime();
          const timeB = fsSync.statSync(path.join(recoveryDir, b)).mtime.getTime();
          return timeB - timeA;
        });
      if (recoveryFiles.length === 0) {
        this.log('WARN', `${storeName} 복구 파일을 찾을 수 없습니다.`);
        return false;
      }
      const latestRecovery = recoveryFiles[0];
      const recoveryPath = path.join(recoveryDir, latestRecovery);
      this.log('INFO', `복구 파일 ${latestRecovery}에서 ${storeName} 복원 시도`);
      const data = await fs.readFile(recoveryPath, 'utf8');
      try {
        if (this._isEncrypted(data)) {
          const decrypted = this._decrypt(data);
          this.stores[storeName] = decrypted;
        } else {
          this.stores[storeName] = JSON.parse(data);
        }
        await this.save(storeName);
        this.log('INFO', `저장소 ${storeName} 복구 디렉토리 복원 성공`);
        return true;
      } catch (parseError) {
        this.log('ERROR', `복구 파일 파싱 실패: ${parseError.message}`);
        return false;
      }
    } catch (error) {
      this.log('ERROR', `복구 디렉토리 복원 중 오류: ${error.message}`);
      return false;
    }
  }

  /* ----------------------- 사용자 및 모듈 관리 ----------------------- */
  // 사용자 관리
  async createUser(username, password, role = 'user') {
    try {
      if (!this.stores['users'] || Object.keys(this.stores['users']).length === 0) {
        try {
          await this.load('users');
        } catch (loadError) {
          this.log('WARN', `사용자 저장소 로드 실패: ${loadError.message}`);
          this.stores['users'] = {};
        }
      }
      const users = this.stores['users'];
      if (!username || typeof username !== 'string') {
        throw new Error('유효한 사용자명을 입력해주세요.');
      }
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        throw new Error('사용자명은 3-20자의 영문자, 숫자, 언더스코어만 사용 가능합니다.');
      }
      if (!password || typeof password !== 'string' || password.length < 6) {
        throw new Error('비밀번호는 최소 6자 이상이어야 합니다.');
      }
      if (!/(?=.*[a-z])(?=.*[A-Z])|(?=.*[a-zA-Z])(?=.*[0-9])|(?=.*[a-zA-Z])(?=.*[^a-zA-Z0-9])/.test(password)) {
        throw new Error('비밀번호는 최소한 숫자와 문자 또는 특수문자가 포함되어야 합니다.');
      }
      const validRoles = ['admin', 'level1', 'level2', 'level3', 'user'];
      if (!validRoles.includes(role)) {
        throw new Error('유효하지 않은 역할입니다.');
      }
      if (users[username]) {
        throw new Error('이미 존재하는 사용자명입니다.');
      }
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      users[username] = {
        username,
        passwordHash,
        role,
        created: new Date().toISOString(),
        lastLogin: null,
        assignedChannels: [],
        assignedServers: [],
        settings: {}
      };
      await this.save('users');
      this.log('INFO', `새 사용자 생성: ${username}, 역할: ${role}`);
      return {
        username,
        role,
        created: users[username].created
      };
    } catch (error) {
      this.log('ERROR', `사용자 생성 중 오류: ${error.message}`);
      throw error;
    }
  }

  async deleteUser(username) {
    const users = this.getStore('users');
    if (!users[username]) {
      throw new Error('사용자를 찾을 수 없습니다.');
    }
    if (users[username].role === 'admin' && Object.values(users).filter(u => u.role === 'admin').length <= 1) {
      throw new Error('마지막 관리자 계정은 삭제할 수 없습니다.');
    }
    const userBackup = { ...users[username] };
    delete users[username];
    await this.save('users');
    this.log('INFO', `사용자 삭제: ${username}`);
    return { success: true, message: '사용자가 삭제되었습니다.', userBackup };
  }

  async resetUserPassword(username, newPassword) {
    const users = this.getStore('users');
    if (!users[username]) {
      throw new Error('사용자를 찾을 수 없습니다.');
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      throw new Error('비밀번호는 최소 6자 이상이어야 합니다.');
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])|(?=.*[a-zA-Z])(?=.*[0-9])|(?=.*[a-zA-Z])(?=.*[^a-zA-Z0-9])/.test(newPassword)) {
      throw new Error('비밀번호는 최소한 숫자와 문자 또는 특수문자가 포함되어야 합니다.');
    }
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);
    users[username].passwordHash = passwordHash;
    users[username].passwordChangedAt = new Date().toISOString();
    await this.save('users');
    this.log('INFO', `사용자 비밀번호 변경: ${username}`);
    return { success: true, message: '비밀번호가 재설정되었습니다.' };
  }

  async updateUserRole(username, role) {
    const users = this.getStore('users');
    if (!users[username]) {
      throw new Error('사용자를 찾을 수 없습니다.');
    }
    const validRoles = ['level1', 'level2', 'level3', 'user', 'admin'];
    if (!validRoles.includes(role)) {
      throw new Error('유효하지 않은 역할입니다.');
    }
    if ((users[username].role === 'admin' || users[username].role === 'level1') && role !== 'admin' && role !== 'level1') {
      const adminCount = Object.values(users).filter(u => u.role === 'admin' || u.role === 'level1').length;
      if (adminCount <= 1) {
        throw new Error('마지막 관리자 계정의 권한은 변경할 수 없습니다.');
      }
    }
    const previousRole = users[username].role;
    users[username].role = role;
    users[username].roleUpdatedAt = new Date().toISOString();
    await this.save('users');
    this.log('INFO', `사용자 역할 변경: ${username}, ${previousRole} → ${role}`);
    return { username, role, previousRole };
  }

  async assignServerToUser(username, serverId, serverName = '알 수 없음') {
    try {
      const users = this.getStore('users');
      if (!users[username]) {
        throw new Error('사용자를 찾을 수 없습니다.');
      }
      if (!Array.isArray(users[username].assignedServers)) {
        users[username].assignedServers = [];
      }
      const existingServer = users[username].assignedServers.find(s => s.serverId === serverId || s.id === serverId);
      if (existingServer) {
        throw new Error('이미 할당된 서버입니다.');
      }
      const serverInfo = {
        serverId,
        serverName,
        assignedAt: new Date().toISOString()
      };
      users[username].assignedServers.push(serverInfo);
      await this.save('users');
      this.log('INFO', `사용자 ${username}에게 서버 할당: ${serverName} (${serverId})`);
      return users[username].assignedServers;
    } catch (error) {
      this.log('ERROR', `서버 할당 중 오류: ${error.message}`);
      throw error;
    }
  }

  async unassignServerFromUser(username, serverId) {
    try {
      const users = this.getStore('users');
      if (!users[username]) {
        throw new Error('사용자를 찾을 수 없습니다.');
      }
      if (!Array.isArray(users[username].assignedServers)) {
        users[username].assignedServers = [];
        return [];
      }
      const serverIndex = users[username].assignedServers.findIndex(s => s.serverId === serverId || s.id === serverId);
      if (serverIndex === -1) {
        throw new Error('해당 서버는 할당되어 있지 않습니다.');
      }
      users[username].assignedServers.splice(serverIndex, 1);
      await this.save('users');
      this.log('INFO', `사용자 ${username}의 서버 할당 해제: ${serverId}`);
      return users[username].assignedServers;
    } catch (error) {
      this.log('ERROR', `서버 할당 해제 중 오류: ${error.message}`);
      throw error;
    }
  }

  getUserServers(username) {
    try {
      const users = this.getStore('users');
      if (!users[username]) {
        throw new Error('사용자를 찾을 수 없습니다.');
      }
      return Array.isArray(users[username].assignedServers) ? users[username].assignedServers : [];
    } catch (error) {
      this.log('ERROR', `사용자 서버 조회 중 오류: ${error.message}`);
      return [];
    }
  }

  async assignChannelToUser(username, serverId, channelId, serverName = '알 수 없음', channelName = '알 수 없음') {
    try {
      const users = this.getStore('users');
      if (!users[username]) {
        throw new Error('사용자를 찾을 수 없습니다.');
      }
      if (!Array.isArray(users[username].assignedChannels)) {
        users[username].assignedChannels = [];
      }
      const existingChannel = users[username].assignedChannels.find(c => c.serverId === serverId && c.channelId === channelId);
      if (existingChannel) {
        throw new Error('이미 할당된 채널입니다.');
      }
      const channelInfo = {
        serverId,
        channelId,
        serverName,
        channelName,
        assignedAt: new Date().toISOString()
      };
      users[username].assignedChannels.push(channelInfo);
      await this.save('users');
      this.log('INFO', `사용자 ${username}에게 채널 할당: ${channelName} (${channelId})`);
      return users[username].assignedChannels;
    } catch (error) {
      this.log('ERROR', `채널 할당 중 오류: ${error.message}`);
      throw error;
    }
  }

  async unassignChannelFromUser(username, channelId) {
    try {
      const users = this.getStore('users');
      if (!users[username]) {
        throw new Error('사용자를 찾을 수 없습니다.');
      }
      if (!Array.isArray(users[username].assignedChannels)) {
        users[username].assignedChannels = [];
        return [];
      }
      const channelIndex = users[username].assignedChannels.findIndex(c => c.channelId === channelId);
      if (channelIndex === -1) {
        throw new Error('해당 채널은 할당되어 있지 않습니다.');
      }
      users[username].assignedChannels.splice(channelIndex, 1);
      await this.save('users');
      this.log('INFO', `사용자 ${username}의 채널 할당 해제: ${channelId}`);
      return users[username].assignedChannels;
    } catch (error) {
      this.log('ERROR', `채널 할당 해제 중 오류: ${error.message}`);
      throw error;
    }
  }

  getUserChannels(username) {
    try {
      const users = this.getStore('users');
      if (!users[username]) {
        throw new Error('사용자를 찾을 수 없습니다.');
      }
      return Array.isArray(users[username].assignedChannels) ? users[username].assignedChannels : [];
    } catch (error) {
      this.log('ERROR', `사용자 채널 조회 중 오류: ${error.message}`);
      return [];
    }
  }

  // 초대 코드 관리
  async isValidInviteCode(code) {
    try {
      if (!this.stores['invite-codes'] || Object.keys(this.stores['invite-codes']).length === 0) {
        try {
          await this.load('invite-codes');
        } catch (loadError) {
          this.log('ERROR', `초대 코드 저장소 로드 실패: ${loadError.message}`);
          return false;
        }
      }
      const inviteCodes = this.stores['invite-codes'];
      if (!code || !inviteCodes[code]) {
        return false;
      }
      return !inviteCodes[code].used;
    } catch (error) {
      this.log('ERROR', `초대 코드 유효성 확인 중 오류: ${error.message}`);
      return false;
    }
  }

  async createInviteCode(customCode = null) {
    try {
      if (!this.stores['invite-codes'] || Object.keys(this.stores['invite-codes']).length === 0) {
        try {
          await this.load('invite-codes');
        } catch (loadError) {
          this.log('WARN', `초대 코드 저장소 로드 실패: ${loadError.message}`);
          this.stores['invite-codes'] = {};
        }
      }
      const inviteCodes = this.stores['invite-codes'];
      let code = customCode;
      if (!code) {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        code = '';
        for (let i = 0; i < 8; i++) {
          code += characters.charAt(Math.floor(Math.random() * characters.length));
        }
      }
      if (!/^[A-Z0-9]+$/.test(code)) {
        throw new Error('초대 코드는 대문자와 숫자만 포함할 수 있습니다.');
      }
      if (inviteCodes[code]) {
        throw new Error('이미 존재하는 초대 코드입니다.');
      }
      inviteCodes[code] = {
        code,
        created: new Date().toISOString(),
        createdBy: '시스템',
        used: false,
        usedBy: null,
        usedAt: null
      };
      await this.save('invite-codes');
      this.log('INFO', `새 초대 코드 생성: ${code}`);
      return inviteCodes[code];
    } catch (error) {
      this.log('ERROR', `초대 코드 생성 중 오류: ${error.message}`);
      throw error;
    }
  }

  async useInviteCode(code, username) {
    try {
      if (!this.stores['invite-codes'] || Object.keys(this.stores['invite-codes']).length === 0) {
        try {
          await this.load('invite-codes');
        } catch (loadError) {
          throw new Error('초대 코드 저장소를 로드할 수 없습니다.');
        }
      }
      const inviteCodes = this.stores['invite-codes'];
      if (!inviteCodes[code]) {
        throw new Error('유효하지 않은 초대 코드입니다.');
      }
      if (inviteCodes[code].used) {
        throw new Error('이미 사용된 초대 코드입니다.');
      }
      inviteCodes[code].used = true;
      inviteCodes[code].usedBy = username;
      inviteCodes[code].usedAt = new Date().toISOString();
      await this.save('invite-codes');
      this.log('INFO', `초대 코드 사용: ${code}, 사용자: ${username}`);
      return { success: true, message: '초대 코드가 사용되었습니다.' };
    } catch (error) {
      this.log('ERROR', `초대 코드 사용 중 오류: ${error.message}`);
      throw error;
    }
  }

  async deleteInviteCode(code) {
    const inviteCodes = this.getStore('invite-codes');
    if (!inviteCodes[code]) {
      throw new Error('초대 코드를 찾을 수 없습니다.');
    }
    const codeInfo = { ...inviteCodes[code] };
    delete inviteCodes[code];
    await this.save('invite-codes');
    this.log('INFO', `초대 코드 삭제: ${code}`);
    return { success: true, message: '초대 코드가 삭제되었습니다.', codeInfo };
  }

  // 레이드 호출 관리
  async initRaidCallStore() {
    try {
      await this.ensureStorage('raid-call-config', {});
      await this.ensureStorage('raid-calls', {});
      await this.ensureStorage('raid-dungeons', {});
      return true;
    } catch (error) {
      this.log('ERROR', `레이드 호출 저장소 초기화 중 오류: ${error.message}`);
      throw error;
    }
  }

  async createRaidCall(serverId, raidCallData) {
    try {
      await this.ensureStorage('raid-calls', {});
      const raidCalls = this.getStore('raid-calls');
      if (!raidCalls[serverId]) {
        raidCalls[serverId] = {};
      }
      const raidCallId = Date.now().toString();
      raidCalls[serverId][raidCallId] = {
        id: raidCallId,
        dungeonName: raidCallData.dungeonName || '알 수 없음',
        date: raidCallData.date || '1970-01-01',
        time: raidCallData.time || '00:00',
        requiredLevel: raidCallData.requiredLevel || '0',
        description: raidCallData.description || '',
        createdBy: raidCallData.createdBy || 'unknown',
        createdAt: new Date().toISOString(),
        participants: [],
        messageId: raidCallData.messageId || null
      };
      await this.save('raid-calls');
      this.log('INFO', `레이드 호출 생성: ${raidCallId}, 서버: ${serverId}, 던전: ${raidCallData.dungeonName}`);
      return raidCalls[serverId][raidCallId];
    } catch (error) {
      this.log('ERROR', `레이드 호출 생성 중 오류: ${error.message}`);
      throw error;
    }
  }

  async updateRaidCall(serverId, raidCallId, updateData) {
    try {
      const raidCalls = this.getStore('raid-calls');
      if (!raidCalls[serverId] || !raidCalls[serverId][raidCallId]) {
        throw new Error('레이드 호출을 찾을 수 없습니다.');
      }
      const protectedFields = ['id', 'createdBy', 'createdAt'];
      protectedFields.forEach(field => {
        if (updateData[field] !== undefined) {
          delete updateData[field];
        }
      });
      raidCalls[serverId][raidCallId] = {
        ...raidCalls[serverId][raidCallId],
        ...updateData,
        updatedAt: new Date().toISOString()
      };
      await this.save('raid-calls');
      this.log('INFO', `레이드 호출 업데이트: ${raidCallId}, 서버: ${serverId}`);
      return raidCalls[serverId][raidCallId];
    } catch (error) {
      this.log('ERROR', `레이드 호출 업데이트 중 오류: ${error.message}`);
      throw error;
    }
  }

  async deleteRaidCall(serverId, raidCallId) {
    try {
      const raidCalls = this.getStore('raid-calls');
      if (!raidCalls[serverId] || !raidCalls[serverId][raidCallId]) {
        throw new Error('레이드 호출을 찾을 수 없습니다.');
      }
      delete raidCalls[serverId][raidCallId];
      if (Object.keys(raidCalls[serverId]).length === 0) {
        delete raidCalls[serverId];
      }
      await this.save('raid-calls');
      this.log('INFO', `레이드 호출 삭제: ${raidCallId}, 서버: ${serverId}`);
      return true;
    } catch (error) {
      this.log('ERROR', `레이드 호출 삭제 중 오류: ${error.message}`);
      throw error;
    }
  }

  async addRaidCallParticipant(serverId, raidCallId, participant) {
    try {
      const raidCalls = this.getStore('raid-calls');
      if (!raidCalls[serverId] || !raidCalls[serverId][raidCallId]) {
        throw new Error('레이드 호출을 찾을 수 없습니다.');
      }
      if (!participant.userId) {
        throw new Error('참가자 ID는 필수입니다.');
      }
      const existingIndex = raidCalls[serverId][raidCallId].participants.findIndex(p => p.userId === participant.userId);
      if (existingIndex >= 0) {
        throw new Error('이미 참가 중인 사용자입니다.');
      }
      const participantInfo = {
        userId: participant.userId,
        username: participant.username || '알 수 없음',
        joinedAt: new Date().toISOString(),
        role: participant.role || 'member'
      };
      raidCalls[serverId][raidCallId].participants.push(participantInfo);
      await this.save('raid-calls');
      this.log('INFO', `레이드 호출 참가자 추가: ${participant.userId}, 레이드: ${raidCallId}, 서버: ${serverId}`);
      return raidCalls[serverId][raidCallId];
    } catch (error) {
      this.log('ERROR', `레이드 호출 참가자 추가 중 오류: ${error.message}`);
      throw error;
    }
  }

  async removeRaidCallParticipant(serverId, raidCallId, userId) {
    try {
      const raidCalls = this.getStore('raid-calls');
      if (!raidCalls[serverId] || !raidCalls[serverId][raidCallId]) {
        throw new Error('레이드 호출을 찾을 수 없습니다.');
      }
      const participants = raidCalls[serverId][raidCallId].participants;
      const participantIndex = participants.findIndex(p => p.userId === userId);
      if (participantIndex === -1) {
        throw new Error('참가자를 찾을 수 없습니다.');
      }
      participants.splice(participantIndex, 1);
      await this.save('raid-calls');
      this.log('INFO', `레이드 호출 참가자 제거: ${userId}, 레이드: ${raidCallId}, 서버: ${serverId}`);
      return raidCalls[serverId][raidCallId];
    } catch (error) {
      this.log('ERROR', `레이드 호출 참가자 제거 중 오류: ${error.message}`);
      throw error;
    }
  }

  // 휴가 시스템 관리
  async initVacationSystem() {
    try {
      await this.ensureStorage('vacation-system-config', {});
      await this.ensureStorage('vacation-requests', {});
      return true;
    } catch (error) {
      this.log('ERROR', `휴가 신청 시스템 초기화 중 오류: ${error.message}`);
      throw error;
    }
  }

  async createVacationRequest(serverId, vacationData) {
    try {
      await this.ensureStorage('vacation-requests', {});
      const vacationRequests = this.getStore('vacation-requests');
      if (!vacationRequests[serverId]) {
        vacationRequests[serverId] = {};
      }
      const requestId = Date.now().toString();
      vacationRequests[serverId][requestId] = {
        id: requestId,
        userId: vacationData.userId,
        username: vacationData.username || '알 수 없음',
        startDate: vacationData.startDate,
        endDate: vacationData.endDate,
        reason: vacationData.reason || '',
        status: 'pending',
        createdAt: new Date().toISOString(),
        messageId: vacationData.messageId || null
      };
      await this.save('vacation-requests');
      this.log('INFO', `휴가 신청 생성: ${requestId}, 서버: ${serverId}, 사용자: ${vacationData.userId}`);
      return vacationRequests[serverId][requestId];
    } catch (error) {
      this.log('ERROR', `휴가 신청 생성 중 오류: ${error.message}`);
      throw error;
    }
  }

  async updateVacationRequestStatus(serverId, requestId, status, updatedBy) {
    try {
      const vacationRequests = this.getStore('vacation-requests');
      if (!vacationRequests[serverId] || !vacationRequests[serverId][requestId]) {
        throw new Error('휴가 신청을 찾을 수 없습니다.');
      }
      const validStatuses = ['pending', 'approved', 'rejected'];
      if (!validStatuses.includes(status)) {
        throw new Error('유효하지 않은 상태입니다.');
      }
      vacationRequests[serverId][requestId].status = status;
      vacationRequests[serverId][requestId].updatedAt = new Date().toISOString();
      if (updatedBy) {
        vacationRequests[serverId][requestId].updatedBy = updatedBy;
      }
      await this.save('vacation-requests');
      this.log('INFO', `휴가 신청 상태 업데이트: ${requestId}, 서버: ${serverId}, 상태: ${status}`);
      return vacationRequests[serverId][requestId];
    } catch (error) {
      this.log('ERROR', `휴가 신청 상태 업데이트 중 오류: ${error.message}`);
      throw error;
    }
  }

  // 음성 채널 설정
  async saveVoiceChannelConfig(serverId, channels) {
    try {
      await this.ensureStorage('voice-channels-config', {});
      const configStore = this.getStore('voice-channels-config');
      configStore[serverId] = channels;
      await this.save('voice-channels-config');
      this.log('INFO', `음성 채널 설정 저장: 서버 ${serverId}, ${channels.length}개 채널`);
      return configStore[serverId];
    } catch (error) {
      this.log('ERROR', `음성 채널 설정 저장 중 오류: ${error.message}`);
      throw error;
    }
  }

  getVoiceChannelConfig(serverId) {
    try {
      const configStore = this.getStore('voice-channels-config');
      return configStore[serverId] || [];
    } catch (error) {
      this.log('ERROR', `음성 채널 설정 가져오기 중 오류: ${error.message}`);
      return [];
    }
  }

  // 티켓 시스템 설정
  async saveTicketSystemConfig(serverId, configData) {
    try {
      await this.ensureStorage('ticket-system-config', {});
      const ticketConfig = this.getStore('ticket-system-config');
      ticketConfig[serverId] = {
        ...configData,
        updatedAt: new Date().toISOString()
      };
      await this.save('ticket-system-config');
      this.log('INFO', `티켓 시스템 설정 저장: 서버 ${serverId}`);
      return ticketConfig[serverId];
    } catch (error) {
      this.log('ERROR', `티켓 시스템 설정 저장 중 오류: ${error.message}`);
      throw error;
    }
  }

  getTicketSystemConfig(serverId) {
    try {
      const ticketConfig = this.getStore('ticket-system-config');
      return ticketConfig[serverId] || null;
    } catch (error) {
      this.log('ERROR', `티켓 시스템 설정 가져오기 중 오류: ${error.message}`);
      return null;
    }
  }

  // 환영 메시지 설정
  async saveWelcomeSettings(serverId, configData) {
    try {
      await this.ensureStorage('welcome-settings', {});
      const welcomeSettings = this.getStore('welcome-settings');
      welcomeSettings[serverId] = {
        ...configData,
        updatedAt: new Date().toISOString()
      };
      await this.save('welcome-settings');
      this.log('INFO', `환영 메시지 설정 저장: 서버 ${serverId}`);
      return welcomeSettings[serverId];
    } catch (error) {
      this.log('ERROR', `환영 메시지 설정 저장 중 오류: ${error.message}`);
      throw error;
    }
  }

  getWelcomeSettings(serverId) {
    try {
      const welcomeSettings = this.getStore('welcome-settings');
      return welcomeSettings[serverId] || null;
    } catch (error) {
      this.log('ERROR', `환영 메시지 설정 가져오기 중 오류: ${error.message}`);
      return null;
    }
  }

  // 클랜 지원서 관리
  async createClanApplication(serverId, applicationData) {
    try {
      await this.ensureStorage('clan-applications', {});
      const applications = this.getStore('clan-applications');
      if (!applications[serverId]) {
        applications[serverId] = {};
      }
      const applicationId = Date.now().toString();
      applications[serverId][applicationId] = {
        id: applicationId,
        userId: applicationData.userId,
        username: applicationData.username || '알 수 없음',
        discordTag: applicationData.discordTag || '알 수 없음',
        characterInfo: applicationData.characterInfo || {},
        questions: applicationData.questions || [],
        status: 'pending',
        createdAt: new Date().toISOString(),
        messageId: applicationData.messageId || null
      };
      await this.save('clan-applications');
      this.log('INFO', `클랜 지원서 생성: ${applicationId}, 서버: ${serverId}, 사용자: ${applicationData.userId}`);
      return applications[serverId][applicationId];
    } catch (error) {
      this.log('ERROR', `클랜 지원서 생성 중 오류: ${error.message}`);
      throw error;
    }
  }

  async updateClanApplicationStatus(serverId, applicationId, status, updatedBy, comment) {
    try {
      const applications = this.getStore('clan-applications');
      if (!applications[serverId] || !applications[serverId][applicationId]) {
        throw new Error('클랜 지원서를 찾을 수 없습니다.');
      }
      const validStatuses = ['pending', 'approved', 'rejected', 'interview'];
      if (!validStatuses.includes(status)) {
        throw new Error('유효하지 않은 상태입니다.');
      }
      applications[serverId][applicationId].status = status;
      applications[serverId][applicationId].updatedAt = new Date().toISOString();
      if (updatedBy) {
        applications[serverId][applicationId].updatedBy = updatedBy;
      }
      if (comment) {
        applications[serverId][applicationId].comment = comment;
      }
      await this.save('clan-applications');
      this.log('INFO', `클랜 지원서 상태 업데이트: ${applicationId}, 서버: ${serverId}, 상태: ${status}`);
      return applications[serverId][applicationId];
    } catch (error) {
      this.log('ERROR', `클랜 지원서 상태 업데이트 중 오류: ${error.message}`);
      throw error;
    }
  }

  // 레이드 호출 채널 설정
  async saveRaidCallConfig(serverId, configData) {
    try {
      await this.ensureStorage('raid-call-config', {});
      const raidCallConfig = this.getStore('raid-call-config');
      raidCallConfig[serverId] = {
        ...configData,
        updatedAt: new Date().toISOString()
      };
      await this.save('raid-call-config');
      this.log('INFO', `레이드 호출 설정 저장: 서버 ${serverId}`);
      return raidCallConfig[serverId];
    } catch (error) {
      this.log('ERROR', `레이드 호출 설정 저장 중 오류: ${error.message}`);
      throw error;
    }
  }

  getRaidCallConfig(serverId) {
    try {
      const raidCallConfig = this.getStore('raid-call-config');
      return raidCallConfig[serverId] || null;
    } catch (error) {
      this.log('ERROR', `레이드 호출 설정 가져오기 중 오류: ${error.message}`);
      return null;
    }
  }

  // 휴가 시스템 설정 (중복 제거)
  async saveVacationSystemConfig(serverId, configData) {
    try {
      await this.ensureStorage('vacation-system-config', {});
      const vacationConfig = this.getStore('vacation-system-config');
      vacationConfig[serverId] = {
        ...configData,
        updatedAt: new Date().toISOString()
      };
      await this.save('vacation-system-config');
      this.log('INFO', `휴가 시스템 설정 저장: 서버 ${serverId}`);
      return vacationConfig[serverId];
    } catch (error) {
      this.log('ERROR', `휴가 시스템 설정 저장 중 오류: ${error.message}`);
      throw error;
    }
  }

  getVacationSystemConfig(serverId) {
    try {
      const vacationConfig = this.getStore('vacation-system-config');
      return vacationConfig[serverId] || null;
    } catch (error) {
      this.log('ERROR', `휴가 시스템 설정 가져오기 중 오류: ${error.message}`);
      return null;
    }
  }

  // 서버 설정 관리
  async saveServerSettings(serverId, settings) {
    try {
      await this.ensureStorage('server-settings', {});
      const serverSettings = this.getStore('server-settings');
      serverSettings[serverId] = {
        ...serverSettings[serverId],
        ...settings,
        updatedAt: new Date().toISOString()
      };
      await this.save('server-settings');
      this.log('INFO', `서버 설정 저장: 서버 ${serverId}`);
      return serverSettings[serverId];
    } catch (error) {
      this.log('ERROR', `서버 설정 저장 중 오류: ${error.message}`);
      throw error;
    }
  }

  getServerSettings(serverId) {
    try {
      const serverSettings = this.getStore('server-settings');
      return serverSettings[serverId] || {};
    } catch (error) {
      this.log('ERROR', `서버 설정 가져오기 중 오류: ${error.message}`);
      return {};
    }
  }

  // 사용자 인증
  authenticateUser(username, password) {
    const users = this.getStore('users');
    if (!users[username]) {
      this.log('INFO', `사용자 인증 실패 (사용자 없음): ${username}`);
      return null;
    }
    const user = users[username];
    try {
      if (bcrypt.compareSync(password, user.passwordHash)) {
        user.lastLogin = new Date().toISOString();
        this.save('users').catch(error => {
          this.log('ERROR', `사용자 로그인 정보 저장 실패: ${error.message}`);
        });
        this.log('INFO', `사용자 인증 성공: ${username}`);
        return {
          username: user.username,
          role: user.role || 'user',
          created: user.created,
          lastLogin: user.lastLogin,
          assignedServers: user.assignedServers || [],
          assignedChannels: user.assignedChannels || []
        };
      }
      this.log('INFO', `사용자 인증 실패 (비밀번호 불일치): ${username}`);
      return null;
    } catch (error) {
      this.log('ERROR', `사용자 인증 중 오류: ${error.message}`);
      return null;
    }
  }
}

const storage = new Storage();
module.exports = storage;
