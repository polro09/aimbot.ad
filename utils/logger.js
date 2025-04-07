/**
 * logger.js - Winston 기반 통합 로깅 시스템
 * aimbot.ad 디스코드 봇을 위한 통합 로깅 솔루션
 */

const winston = require('winston');
const { createLogger, format, transports } = winston;
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// 환경 변수 설정
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const LOG_FORMAT = process.env.LOG_FORMAT || 'pretty';
const LOG_TO_CONSOLE = process.env.LOG_TO_CONSOLE !== 'false';
const LOG_MAX_FILES = process.env.LOG_MAX_FILES || '14d';
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '20m';
const MAX_BUFFER_SIZE = parseInt(process.env.LOG_BUFFER_SIZE || '200', 10);

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

// 로그 전송 설정
const logTransports = [];

// 콘솔 출력 (선택적)
if (LOG_TO_CONSOLE) {
    logTransports.push(
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
        })
    );
}

// 일반 로그 파일 출력
logTransports.push(
    new DailyRotateFile({
        filename: path.join(logDir, 'aimbot-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: LOG_MAX_FILES,
        maxSize: LOG_MAX_SIZE,
        zippedArchive: true,
        format: format.combine(
            format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            logFormat
        )
    })
);

// 에러 전용 로그 파일
logTransports.push(
    new DailyRotateFile({
        filename: path.join(logDir, 'aimbot-error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxFiles: '30d',
        maxSize: LOG_MAX_SIZE,
        zippedArchive: true,
        format: format.combine(
            format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            logFormat
        )
    })
);

// JSON 포맷 로그 (선택적)
if (LOG_FORMAT === 'json') {
    logTransports.push(
        new DailyRotateFile({
            filename: path.join(logDir, 'aimbot-json-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxFiles: LOG_MAX_FILES,
            maxSize: LOG_MAX_SIZE,
            zippedArchive: true,
            format: format.combine(
                format.timestamp(),
                format.json()
            )
        })
    );
}

// Winston 로거 생성
const winstonLogger = createLogger({
    levels,
    level: LOG_LEVEL,
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        logFormat
    ),
    defaultMeta: { service: 'aimbot-discord' },
    transports: logTransports
});

// 웹소켓 전송용 로그 버퍼
const logBuffer = [];
let wsHandlers = new Set(); // 여러 웹소켓 클라이언트 지원

/**
 * 로그 버퍼에 로그 추가 및 웹소켓으로 전송
 * @param {Object} logEntry - 로그 엔트리 객체
 */
function addToBuffer(logEntry) {
    // 로그 엔트리에 ID 추가
    logEntry.id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    
    // 버퍼에 추가
    logBuffer.push(logEntry);
    if (logBuffer.length > MAX_BUFFER_SIZE) {
        logBuffer.shift();
    }
    
    // 웹소켓 핸들러가 있으면 로그 전송
    if (wsHandlers.size > 0) {
        wsHandlers.forEach(handler => {
            try {
                handler(logEntry);
            } catch (err) {
                console.error(`웹소켓 핸들러 오류: ${err.message}`);
            }
        });
    }
}

/**
 * 로그 메타데이터와 함께 로그 작성
 * @param {string} level - 로그 레벨
 * @param {string} message - 로그 메시지
 * @param {string|null} type - 로그 유형
 * @param {string|null} module - 모듈 이름
 * @returns {Object} 로그 엔트리 객체
 */
function logWithMeta(level, message, type = null, module = null) {
    const logObject = {
        level,
        message,
        type: type || level,
        module,
        timestamp: new Date().toISOString()
    };
    
    winstonLogger[level](message, { type, module });
    
    // 로그 버퍼에 추가
    addToBuffer(logObject);
    
    return logObject;
}

// 통합 로거 인터페이스
const logger = {
    /**
     * 디버그 로그 작성
     * @param {string} message - 로그 메시지
     * @param {string|null} type - 로그 유형
     * @param {string|null} module - 모듈 이름
     */
    debug: (message, type = null, module = null) => logWithMeta('debug', message, type, module),
    
    /**
     * 정보 로그 작성
     * @param {string} message - 로그 메시지
     * @param {string|null} type - 로그 유형
     * @param {string|null} module - 모듈 이름
     */
    info: (message, type = null, module = null) => logWithMeta('info', message, type, module),
    
    /**
     * 경고 로그 작성
     * @param {string} message - 로그 메시지
     * @param {string|null} type - 로그 유형
     * @param {string|null} module - 모듈 이름
     */
    warn: (message, type = null, module = null) => logWithMeta('warn', message, type, module),
    
    /**
     * 오류 로그 작성
     * @param {string} message - 로그 메시지
     * @param {string|null} type - 로그 유형
     * @param {string|null} module - 모듈 이름
     * @param {Error|null} error - 오류 객체
     */
    error: (message, type = null, module = null, error = null) => {
        // error 매개변수가 있으면 사용, 없으면 type이 Error인지 확인
        if (!error && type instanceof Error) {
            error = type;
            type = 'ERROR';
        }
        
        const errMsg = error ? `${message}: ${error.message}` : message;
        const stack = error?.stack ? `\n${error.stack}` : '';
        return logWithMeta('error', errMsg + stack, type || 'ERROR', module);
    },
    
    /**
     * 치명적 오류 로그 작성
     * @param {string} message - 로그 메시지
     * @param {string|null} type - 로그 유형
     * @param {string|null} module - 모듈 이름
     * @param {Error|null} error - 오류 객체
     */
    fatal: (message, type = null, module = null, error = null) => {
        // error 매개변수가 있으면 사용, 없으면 type이 Error인지 확인
        if (!error && type instanceof Error) {
            error = type;
            type = 'FATAL';
        }
        
        const errMsg = error ? `${message}: ${error.message}` : message;
        const stack = error?.stack ? `\n${error.stack}` : '';
        return logWithMeta('fatal', errMsg + stack, type || 'FATAL', module);
    },
    
    /**
     * 모듈 관련 로그 작성
     * @param {string} name - 모듈 이름
     * @param {string} message - 로그 메시지 (기본값: 모듈 초기화 완료)
     */
    module: (name, message = '모듈 초기화 완료') => logWithMeta('info', message, 'MODULE', name),
    
    /**
     * 시스템 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    system: (message) => logWithMeta('info', message, 'SYSTEM'),
    
    /**
     * 설정 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    config: (message) => logWithMeta('info', message, 'CONFIG'),
    
    /**
     * 데이터베이스 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    database: (message) => logWithMeta('info', message, 'DATABASE'),
    
    /**
     * 네트워크 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    network: (message) => logWithMeta('info', message, 'NETWORK'),
    
    /**
     * 명령어 관련 로그 작성
     * @param {string} name - 명령어 이름
     * @param {string} message - 로그 메시지 (기본값: 명령어 등록 완료)
     */
    command: (name, message = '명령어 등록 완료') => logWithMeta('info', message, 'COMMAND', name),
    
    /**
     * 슬래시 명령어 관련 로그 작성
     * @param {string} name - 슬래시 명령어 이름
     * @param {string} message - 로그 메시지 (기본값: 슬래시 커맨드 등록 완료)
     */
    slash: (name, message = '슬래시 커맨드 등록 완료') => logWithMeta('info', message, 'SLASH', name),
    
    /**
     * 웹 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    web: (message) => logWithMeta('info', message, 'WEB'),
    
    /**
     * 사용자 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    user: (message) => logWithMeta('info', message, 'USER'),
    
    /**
     * 서버 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    server: (message) => logWithMeta('info', message, 'SERVER'),
    
    /**
     * 웹훅 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    webhook: (message) => logWithMeta('info', message, 'WEBHOOK'),
    
    /**
     * 스토리지 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    storage: (message) => logWithMeta('info', message, 'STORAGE'),
    
    /**
     * API 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    api: (message) => logWithMeta('info', message, 'API'),
    
    /**
     * 이벤트 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    event: (message) => logWithMeta('info', message, 'EVENT'),
    
    /**
     * 음성 관련 로그 작성
     * @param {string} message - 로그 메시지
     */
    voice: (message) => logWithMeta('info', message, 'VOICE'),
    
    /**
     * 성공 관련 로그 작성
     * @param {string} message - 로그 메시지
     * @param {string} module - 모듈 이름 (기본값: null)
     */
    success: (message, module = null) => logWithMeta('info', message, 'SUCCESS', module),
    
    /**
     * 실패 관련 로그 작성
     * @param {string} message - 로그 메시지
     * @param {string} module - 모듈 이름 (기본값: null)
     */
    fail: (message, module = null) => logWithMeta('error', message, 'FAIL', module),
    
    /**
     * 웹소켓 로그 핸들러 설정
     * @param {Function} handler - 로그 엔트리를 받을 콜백 함수
     * @returns {Function} 핸들러 제거 함수
     */
    setWebSocketHandler: (handler) => {
        if (typeof handler === 'function') {
            wsHandlers.add(handler);
            logger.info('웹소켓 로그 핸들러가 추가되었습니다.', 'SYSTEM');
            
            // 초기 로그 버퍼 전송을 위한 즉시 호출
            try {
                const logBufferCopy = [...logBuffer];
                handler({
                    type: 'logBuffer',
                    logs: logBufferCopy
                });
            } catch (err) {
                logger.error(`웹소켓 핸들러 초기화 오류: ${err.message}`, 'SYSTEM');
            }
            
            // 핸들러 제거 함수 반환
            return () => {
                wsHandlers.delete(handler);
                logger.info('웹소켓 로그 핸들러가 제거되었습니다.', 'SYSTEM');
            };
        }
        return () => {}; // 빈 함수 반환
    },
    
    /**
     * 모든 웹소켓 핸들러 제거
     */
    clearWebSocketHandlers: () => {
        wsHandlers.clear();
        logger.info('모든 웹소켓 로그 핸들러가 제거되었습니다.', 'SYSTEM');
    },
    
    /**
     * 로그 버퍼 가져오기
     * @returns {Array} 로그 버퍼 복사본
     */
    getLogBuffer: () => [...logBuffer],
    
    /**
     * 로그 레벨 설정
     * @param {string} level - 로그 레벨 (debug, info, warn, error, fatal)
     */
    setLevel: (level) => {
        if (levels[level] !== undefined) {
            winstonLogger.level = level;
            logger.info(`로그 레벨이 ${level}로 설정되었습니다.`, 'CONFIG');
        } else {
            logger.warn(`유효하지 않은 로그 레벨: ${level}`, 'CONFIG');
        }
    },
    
    /**
     * 현재 로그 레벨 가져오기
     * @returns {string} 현재 로그 레벨
     */
    getLevel: () => winstonLogger.level,
    
    /**
     * 로그 버퍼 초기화
     */
    clearLogBuffer: () => {
        logBuffer.length = 0;
        logger.info('로그 버퍼가 초기화되었습니다.', 'SYSTEM');
    },
    
    /**
     * 시작 메시지 출력
     * @param {Object} options - 시작 옵션
     * @param {string} options.local - 로컬 주소
     * @param {string} options.domain - 도메인 주소
     * @param {string} options.protocol - 프로토콜
     * @param {number} options.port - 포트 번호
     */
    startup: ({ local = 'http://localhost:3000', domain = 'http://<서버IP>:3000', protocol = 'HTTP', port = 3000 } = {}) => {
        console.log();
        logger.system(`🤖 aimbot.ad 디스코드 봇 서비스가 시작되었습니다...`);
        console.log();
        logger.info(`🌐 ${protocol} 모드로 실행 중입니다.`, 'WEB');
        logger.info(`📡 웹 인터페이스 시작됨:`, 'WEB');
        logger.info(`   🔗 로컬 접속: ${local}`, 'WEB');
        logger.info(`   🌍 도메인 접속: ${domain}`, 'WEB');
        logger.info(`   ⚙️ 프로토콜: ${protocol}`, 'WEB');
        logger.info(`   📦 포트: ${port}`, 'WEB');
        console.log();
        logger.success(`웹 서버가 성공적으로 시작되었습니다.`);
        console.log();
    }
};

// aimbotLogger 스타일 간편 인터페이스 (기존 코드와의 호환성을 위해)
const log = {
    /**
     * 정보 로그 출력
     * @param {string} msg - 로그 메시지
     * @param {string} [module='BOT'] - 모듈 이름
     */
    info: (msg, module = 'BOT') => logger.info(msg, null, module),
    
    /**
     * 경고 로그 출력
     * @param {string} msg - 로그 메시지
     * @param {string} [module='BOT'] - 모듈 이름
     */
    warn: (msg, module = 'BOT') => logger.warn(msg, null, module),
    
    /**
     * 오류 로그 출력
     * @param {string} msg - 로그 메시지
     * @param {string} [module='BOT'] - 모듈 이름
     * @param {Error} [error=null] - 오류 객체
     */
    error: (msg, module = 'BOT', error = null) => logger.error(msg, null, module, error),
    
    /**
     * 치명적 오류 로그 출력
     * @param {string} msg - 로그 메시지
     * @param {string} [module='BOT'] - 모듈 이름
     * @param {Error} [error=null] - 오류 객체
     */
    fatal: (msg, module = 'BOT', error = null) => logger.fatal(msg, null, module, error),
    
    /**
     * 디버그 로그 출력
     * @param {string} msg - 로그 메시지
     * @param {string} [module='BOT'] - 모듈 이름
     */
    debug: (msg, module = 'BOT') => logger.debug(msg, null, module),
    
    /**
     * 모듈 로딩 로그 출력
     * @param {string} moduleName - 모듈 이름
     * @param {string} [message='모듈 초기화 완료'] - 로그 메시지
     */
    module: (moduleName, message = '모듈 초기화 완료') => logger.module(moduleName, message),
    
    /**
     * 명령어 로그 출력
     * @param {string} cmdName - 명령어 이름
     * @param {string} [message='명령어 등록 완료'] - 로그 메시지
     */
    command: (cmdName, message = '명령어 등록 완료') => logger.command(cmdName, message),
    
    /**
     * 슬래시 명령어 로그 출력
     * @param {string} cmdName - 슬래시 명령어 이름
     * @param {string} [message='슬래시 커맨드 등록 완료'] - 로그 메시지
     */
    slash: (cmdName, message = '슬래시 커맨드 등록 완료') => logger.slash(cmdName, message),
    
    /**
     * 성공 로그 출력
     * @param {string} msg - 로그 메시지
     * @param {string} [module='BOT'] - 모듈 이름
     */
    success: (msg, module = 'BOT') => logger.success(msg, module),
    
    /**
     * 시스템 로그 출력
     * @param {string} msg - 로그 메시지
     */
    system: (msg) => logger.system(msg),
    
    /**
     * 스토리지 관련 로그 출력
     * @param {string} msg - 로그 메시지
     */
    storage: (msg) => logger.storage(msg),
    
    /**
     * 웹 관련 로그 출력
     * @param {string} msg - 로그 메시지
     */
    web: (msg) => logger.web(msg),
    
    /**
     * 서버 시작 로그 출력
     * @param {Object} options - 시작 옵션
     */
    startup: (options) => logger.startup(options),
    
    /**
     * 사용자 관련 로그 출력
     * @param {string} msg - 로그 메시지
     */
    user: (msg) => logger.user(msg),
    
    /**
     * 이벤트 관련 로그 출력
     * @param {string} msg - 로그 메시지
     */
    event: (msg) => logger.event(msg),
    
    /**
     * 음성 관련 로그 출력
     * @param {string} msg - 로그 메시지
     */
    voice: (msg) => logger.voice(msg),
    
    /**
     * 로그 레벨 설정
     * @param {string} level - 로그 레벨 (debug, info, warn, error, fatal)
     */
    setLevel: (level) => logger.setLevel(level),
    
    /**
     * 로그 버퍼 가져오기
     * @returns {Array} 로그 버퍼 배열
     */
    getLogBuffer: () => logger.getLogBuffer()
};

// 양쪽 모두 내보내기 (프로젝트에서 어느 쪽이든 사용 가능)
module.exports = logger;
module.exports.log = log;