/**
 * winston-logger.js - Winston 기반 고급 로깅 시스템
 */

const winston = require('winston');
const { createLogger, format, transports } = winston;
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// 로그 디렉토리 생성
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// 로그 포맷 정의
const logFormat = format.printf(({ level, message, timestamp, module, type }) => {
    const moduleInfo = module ? `[${module}] ` : '';
    const typeInfo = type && type !== level ? `[${type}] ` : '';
    return `${timestamp} [${level.toUpperCase()}] ${typeInfo}${moduleInfo}${message}`;
});

// 이모지 매핑
const emojis = {
    debug: '🔍',
    info: 'ℹ️',
    warn: '⚠️',
    error: '❌',
    fatal: '💀',
    module: '📦',
    system: '🤖',
    config: '⚙️',
    database: '💾',
    network: '🌐',
    command: '🧩',
    slash: '📝',
    web: '🌍',
    user: '👤',
    server: '🖥️',
    webhook: '🔗',
    storage: '📂',
    api: '🔌',
    event: '📅',
    voice: '🎤',
    success: '✅',
    fail: '❌'
};

// 로그 레벨 정의
const levels = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4
};

// 로그 레벨 컬러 정의
const colors = {
    debug: 'gray',
    info: 'green',
    warn: 'yellow',
    error: 'red',
    fatal: 'magenta'
};

// Winston 로거 생성
const logger = createLogger({
    levels,
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        logFormat
    ),
    defaultMeta: { service: 'aimbot-discord' },
    transports: [
        // 콘솔 출력
        new transports.Console({
            format: format.combine(
                format.colorize({ all: true }),
                format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                format.printf(info => {
                    const { level, message, timestamp, module, type } = info;
                    const emoji = (type && emojis[type.toLowerCase()]) || emojis[level] || '';
                    const moduleInfo = module ? `[${module}] ` : '';
                    const typeInfo = type && type !== level ? `[${type}] ` : '';
                    return `${timestamp} ${level} ${typeInfo}${moduleInfo}${emoji} ${message}`;
                })
            )
        }),
        
        // 모든 로그 파일 출력
        new DailyRotateFile({
            filename: path.join(logDir, 'aimbot-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxFiles: '14d',
            maxSize: '20m',
            zippedArchive: true
        }),
        
        // 에러 로그만 따로 파일 출력
        new DailyRotateFile({
            filename: path.join(logDir, 'aimbot-error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxFiles: '30d',
            maxSize: '20m',
            zippedArchive: true
        })
    ]
});

// 웹소켓 전송용 로그 버퍼
const logBuffer = [];
const MAX_BUFFER_SIZE = 200;
let wsHandler = null;

// 로그 버퍼에 로그 추가
function addToBuffer(logEntry) {
    logBuffer.push(logEntry);
    if (logBuffer.length > MAX_BUFFER_SIZE) {
        logBuffer.shift();
    }
    
    // 웹소켓 핸들러가 있으면 로그 전송
    if (wsHandler) {
        wsHandler(logEntry);
    }
}

// 로그 메시지 확장 함수
function logWithMeta(level, message, type = null, module = null) {
    const logObject = {
        level,
        message,
        type: type || level,
        module,
        timestamp: new Date().toISOString()
    };
    
    logger[level](message, { type, module });
    
    // 로그 버퍼에 추가
    addToBuffer(logObject);
    
    return logObject;
}

// 기본 로그 함수
const winstonLogger = {
    debug: (message, type = null, module = null) => logWithMeta('debug', message, type, module),
    info: (message, type = null, module = null) => logWithMeta('info', message, type, module),
    warn: (message, type = null, module = null) => logWithMeta('warn', message, type, module),
    error: (message, type = null, module = null) => logWithMeta('error', message, type, module),
    fatal: (message, type = null, module = null) => logWithMeta('fatal', message, type, module),
    
    // 특화된 로그 함수들
    module: (name, message = '모듈 초기화 완료') => logWithMeta('info', message, 'MODULE', name),
    system: (message) => logWithMeta('info', message, 'SYSTEM'),
    config: (message) => logWithMeta('info', message, 'CONFIG'),
    database: (message) => logWithMeta('info', message, 'DATABASE'),
    network: (message) => logWithMeta('info', message, 'NETWORK'),
    command: (name, message = '명령어 등록 완료') => logWithMeta('info', message, 'COMMAND', name),
    slash: (name, message = '슬래시 커맨드 등록 완료') => logWithMeta('info', message, 'SLASH', name),
    web: (message) => logWithMeta('info', message, 'WEB'),
    user: (message) => logWithMeta('info', message, 'USER'),
    server: (message) => logWithMeta('info', message, 'SERVER'),
    webhook: (message) => logWithMeta('info', message, 'WEBHOOK'),
    storage: (message) => logWithMeta('info', message, 'STORAGE'),
    api: (message) => logWithMeta('info', message, 'API'),
    event: (message) => logWithMeta('info', message, 'EVENT'),
    voice: (message) => logWithMeta('info', message, 'VOICE'),
    success: (message) => logWithMeta('info', message, 'SUCCESS'),
    fail: (message) => logWithMeta('error', message, 'FAIL'),
    
    // 웹소켓 핸들러 설정
    setWebSocketHandler: (handler) => {
        if (typeof handler === 'function') {
            wsHandler = handler;
            winstonLogger.info('웹소켓 로그 핸들러가 설정되었습니다.', 'SYSTEM');
        }
    },
    
    // 로그 버퍼 가져오기
    getLogBuffer: () => [...logBuffer],
    
    // 로그 레벨 설정
    setLevel: (level) => {
        if (levels[level] !== undefined) {
            logger.level = level;
            winstonLogger.info(`로그 레벨이 ${level}로 설정되었습니다.`, 'CONFIG');
        } else {
            winstonLogger.warn(`유효하지 않은 로그 레벨: ${level}`, 'CONFIG');
        }
    },
    
    // 시작 메시지 출력
    startup: ({ local = 'http://localhost:3000', domain = 'http://<서버IP>:3000', protocol = 'HTTP', port = 3000 } = {}) => {
        console.log();
        winstonLogger.system(`🤖 aimbot.ad 디스코드 봇 서비스가 시작되었습니다...`);
        console.log();
        winstonLogger.info(`🌐 ${protocol} 모드로 실행 중입니다.`, 'WEB');
        winstonLogger.info(`📡 웹 인터페이스 시작됨:`, 'WEB');
        winstonLogger.info(`   🔗 로컬 접속: ${local}`, 'WEB');
        winstonLogger.info(`   🌍 도메인 접속: ${domain}`, 'WEB');
        winstonLogger.info(`   ⚙️ 프로토콜: ${protocol}`, 'WEB');
        winstonLogger.info(`   📦 포트: ${port}`, 'WEB');
        console.log();
        winstonLogger.success(`웹 서버가 성공적으로 시작되었습니다.`);
        console.log();
    }
};

module.exports = winstonLogger;