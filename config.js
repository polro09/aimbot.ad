// config.js - 봇 설정 파일
require('dotenv').config(); // .env 파일에서 환경 변수 로드

module.exports = {
    // 디스코드 봇 토큰 (환경 변수 또는 기본값)
    token: process.env.DISCORD_BOT_TOKEN || '',
    
    // 봇 커맨드 접두사
    prefix: process.env.BOT_PREFIX || '',
    
    // 웹 인터페이스 포트
    webPort: parseInt(process.env.WEB_PORT || ''),
    
    // 웹서버 호스트
    host: process.env.HOST || '',
    
    // 도메인 설정
    domain: process.env.DOMAIN || '',
    
    // HTTPS 설정
    https: {
        enabled: process.env.HTTPS_ENABLED === '' || false,
        keyPath: process.env.HTTPS_KEY_PATH || '',
        certPath: process.env.HTTPS_CERT_PATH || '',
        caPath: process.env.HTTPS_CA_PATH || ''
    },
    
    // 디렉토리 경로
    dirs: {
        modules: process.env.MODULES_DIR || '',
        web: process.env.WEB_DIR || '',
        data: process.env.DATA_DIR || ''
    },
    
    // 인증 설정
    auth: {
        enabled: process.env.AUTH_ENABLED !== '',
        username: process.env.AUTH_USERNAME || '',
        password: process.env.AUTH_PASSWORD || ''
    },
    
    // 사용자 설정
    userSettings: {
        prefix: process.env.BOT_PREFIX || '',
        notifyErrors: true,
        notifyJoins: true,
        notifyCommands: true
    },
    
    // 데이터 저장소 설정
    storage: {
        // 데이터 저장 간격 (밀리초)
        saveInterval: parseInt(process.env.SAVE_INTERVAL || ''),
        // 자동 저장 활성화
        autoSave: process.env.AUTO_SAVE !== ''
    },
    
    // 봇 자동 시작 (true/false)
    autoStartBot: process.env.AUTO_START_BOT !== ''
};