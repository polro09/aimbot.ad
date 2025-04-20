// config/bot-config.js - 설정 관리 시스템 개선
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

dotenv.config();

/**
 * 봇 설정 관리 클래스 - 자동 저장 및 백업 기능 추가
 */
class BotConfig {
  constructor() {
    this.configPath = path.join(__dirname, 'data');
    this.configFile = path.join(this.configPath, 'config.json');
    this.backupFolder = path.join(this.configPath, 'backups');
    
    // 기본 설정
    this.defaultConfig = {
      // 기본 설정
      prefix: process.env.DEFAULT_PREFIX || '!',
      welcomeChannelId: process.env.DEFAULT_WELCOME_CHANNEL_ID || null,
      
      // 모듈 설정
      modules: {
        welcome: {
          enabled: true,
          joinMessage: '{username}님이 서버에 입장했습니다!',
          leaveMessage: '{username}님이 서버에서 퇴장했습니다!'
        },
        registration: {
          enabled: true,
          channelId: null,
          ticketCategoryId: null,
          approvalRoleId: null,
          form1Fields: ['닉네임', '나이', '성별', '게임 경력'],
          form2Fields: ['지원 동기', '플레이 가능 시간', '소속 길드', '기타 사항']
        }
      },
      
      // 웹 서버 설정
      web: {
        port: process.env.WEB_PORT || 3000,
        host: process.env.WEB_HOST || 'localhost'
      }
    };
    
    // 디렉토리 확인 및 생성
    this.ensureDirectories();
    
    // 설정 로드
    this.config = this.loadConfig();
    
    // 자동 저장 설정 (5분마다)
    this.saveInterval = setInterval(() => this.saveConfig(), 300000);
    
    logger.info('Config', '봇 설정이 로드되었습니다.');
  }
  
  /**
   * 필요한 디렉토리가 있는지 확인하고 생성합니다.
   */
  ensureDirectories() {
    try {
      if (!fs.existsSync(this.configPath)) {
        fs.mkdirSync(this.configPath, { recursive: true });
      }
      
      if (!fs.existsSync(this.backupFolder)) {
        fs.mkdirSync(this.backupFolder, { recursive: true });
      }
    } catch (error) {
      logger.error('Config', `디렉토리 생성 중 오류 발생: ${error.message}`);
    }
  }
  
  /**
   * 설정 파일을 로드합니다.
   * @returns {Object} 로드된 설정 객체
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configFile)) {
        const configData = fs.readFileSync(this.configFile, 'utf8');
        const loadedConfig = JSON.parse(configData);
        // 기본 설정과 로드된 설정을 병합 (누락된 설정은 기본값 사용)
        return this.deepMerge(this.defaultConfig, loadedConfig);
      } else {
        // 설정 파일이 없으면 기본 설정 저장 후 반환
        fs.writeFileSync(this.configFile, JSON.stringify(this.defaultConfig, null, 2), 'utf8');
        return { ...this.defaultConfig };
      }
    } catch (error) {
      logger.error('Config', `설정 로드 중 오류 발생: ${error.message}`);
      return { ...this.defaultConfig };
    }
  }
  
  /**
   * 설정을 파일에 저장합니다.
   */
  saveConfig() {
    try {
      // 백업 생성
      this.createBackup();
      
      // 설정 저장
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf8');
      logger.info('Config', '설정이 저장되었습니다.');
    } catch (error) {
      logger.error('Config', `설정 저장 중 오류 발생: ${error.message}`);
    }
  }
  
  /**
   * 현재 설정의 백업을 생성합니다.
   */
  createBackup() {
    try {
      if (fs.existsSync(this.configFile)) {
        const now = new Date();
        const backupFileName = `config-backup-${now.toISOString().replace(/[:.]/g, '-')}.json`;
        const backupPath = path.join(this.backupFolder, backupFileName);
        
        fs.copyFileSync(this.configFile, backupPath);
        
        // 오래된 백업 파일 정리 (최대 10개 유지)
        const backupFiles = fs.readdirSync(this.backupFolder)
          .filter(file => file.startsWith('config-backup-'))
          .sort()
          .reverse();
        
        if (backupFiles.length > 10) {
          for (let i = 10; i < backupFiles.length; i++) {
            fs.unlinkSync(path.join(this.backupFolder, backupFiles[i]));
          }
        }
      }
    } catch (error) {
      logger.error('Config', `백업 생성 중 오류 발생: ${error.message}`);
    }
  }
  
  /**
   * 두 객체를 깊게 병합합니다.
   * @param {Object} target 대상 객체
   * @param {Object} source 소스 객체
   * @returns {Object} 병합된 객체
   */
  deepMerge(target, source) {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            output[key] = source[key];
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          output[key] = source[key];
        }
      });
    }
    
    return output;
  }
  
  /**
   * 값이 객체인지 확인합니다.
   * @param {*} item 확인할 값
   * @returns {boolean} 객체 여부
   */
  isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
  }

  /**
   * 설정 값을 가져옵니다.
   * @param {string} key 설정 키
   * @param {*} defaultValue 기본값
   * @returns {*} 설정 값
   */
  get(key, defaultValue = null) {
    try {
      const keys = key.split('.');
      let value = this.config;
      
      for (const k of keys) {
        if (value[k] === undefined) {
          return defaultValue;
        }
        value = value[k];
      }
      
      return value;
    } catch (error) {
      logger.error('Config', `설정 값 가져오기 오류: ${error.message}`);
      return defaultValue;
    }
  }

  /**
   * 설정 값을 설정합니다.
   * @param {string} key 설정 키
   * @param {*} value 설정 값
   * @returns {BotConfig} 체이닝을 위한 인스턴스
   */
  set(key, value) {
    try {
      const keys = key.split('.');
      let target = this.config;
      
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (target[k] === undefined) {
          target[k] = {};
        }
        target = target[k];
      }
      
      target[keys[keys.length - 1]] = value;
      logger.info('Config', `설정 '${key}'가 업데이트되었습니다.`);
      return this;
    } catch (error) {
      logger.error('Config', `설정 값 설정 오류: ${error.message}`);
      return this;
    }
  }

  /**
   * 모듈 설정을 가져옵니다.
   * @param {string} moduleName 모듈 이름
   * @returns {object} 모듈 설정
   */
  getModuleConfig(moduleName) {
    return this.get(`modules.${moduleName}`, {});
  }

  /**
   * 모듈 설정을 업데이트합니다.
   * @param {string} moduleName 모듈 이름
   * @param {object} config 업데이트할 설정
   * @returns {BotConfig} 체이닝을 위한 인스턴스
   */
  updateModuleConfig(moduleName, config) {
    const currentConfig = this.getModuleConfig(moduleName);
    this.set(`modules.${moduleName}`, { ...currentConfig, ...config });
    return this;
  }

  /**
   * 전체 설정을 가져옵니다.
   * @returns {object} 전체 설정
   */
  getAllConfig() {
    return { ...this.config };
  }
  
  /**
   * 모든 설정을 리셋합니다.
   * @returns {BotConfig} 체이닝을 위한 인스턴스
   */
  resetConfig() {
    try {
      // 백업 생성
      this.createBackup();
      
      // 기본 설정으로 리셋
      this.config = { ...this.defaultConfig };
      
      // 설정 저장
      this.saveConfig();
      
      logger.info('Config', '모든 설정이 기본값으로 리셋되었습니다.');
      return this;
    } catch (error) {
      logger.error('Config', `설정 리셋 중 오류 발생: ${error.message}`);
      return this;
    }
  }
  
  /**
   * 설정 백업을 불러옵니다.
   * @param {string} backupName 백업 파일 이름
   * @returns {boolean} 성공 여부
   */
  loadBackup(backupName) {
    try {
      const backupPath = path.join(this.backupFolder, backupName);
      
      if (!fs.existsSync(backupPath)) {
        logger.error('Config', `백업 파일 '${backupName}'을 찾을 수 없습니다.`);
        return false;
      }
      
      // 현재 설정 백업
      this.createBackup();
      
      // 백업 불러오기
      const backupData = fs.readFileSync(backupPath, 'utf8');
      this.config = JSON.parse(backupData);
      
      // 설정 저장
      this.saveConfig();
      
      logger.info('Config', `백업 '${backupName}'에서 설정이 복원되었습니다.`);
      return true;
    } catch (error) {
      logger.error('Config', `백업 불러오기 오류: ${error.message}`);
      return false;
    }
  }
  
  /**
   * 사용 가능한 백업 목록을 가져옵니다.
   * @returns {string[]} 백업 파일 이름 배열
   */
  getBackupList() {
    try {
      if (!fs.existsSync(this.backupFolder)) {
        return [];
      }
      
      return fs.readdirSync(this.backupFolder)
        .filter(file => file.startsWith('config-backup-'))
        .sort()
        .reverse();
    } catch (error) {
      logger.error('Config', `백업 목록 가져오기 오류: ${error.message}`);
      return [];
    }
  }
}

module.exports = new BotConfig();