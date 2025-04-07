// main.js - 애플리케이션 진입점

const config = require('./config');
const bot = require('./bot');
const webServer = require('./webserver');
const logger = require('./utils/logger');

async function initialize() {
    logger.system('Aimbot.ad 디스코드 봇 서비스를 시작합니다...');
    
    try {
        // 웹 서버 시작
        await webServer.start();
        logger.success('웹 서버가 성공적으로 시작되었습니다.');
        
        // 봇 자동 시작 확인
        if (config.autoStartBot) {
            try {
                logger.info('봇을 자동으로 시작합니다...', 'SYSTEM');
                await bot.start();
                logger.success('봇이 성공적으로 시작되었습니다.');
            } catch (error) {
                logger.error(`봇 자동 시작 실패: ${error.message}`, 'SYSTEM');
            }
        }
        

        logger.success('초기화가 완료되었습니다. 서비스가 정상적으로 실행 중입니다.');
    } catch (error) {

        logger.fatal(`초기화 중 오류 발생: ${error.message}`, 'SYSTEM');
        process.exit(1);
    }
}

// shutdown 함수에서 console.log를 logger로 변경
async function shutdown() {
    // 기존: console.log('서비스를 종료합니다...');
    // 변경:
    logger.system('서비스를 종료합니다...');
    
    try {
        // 봇 종료
        if (bot.status.isRunning) {
            await bot.stop();
            // 기존: console.log('봇이 성공적으로 종료되었습니다.');
            // 변경:
            logger.success('봇이 성공적으로 종료되었습니다.');
        }
        
        // 웹 서버 종료
        await webServer.stop();
        // 기존: console.log('웹 서버가 성공적으로 종료되었습니다.');
        // 변경:
        logger.success('웹 서버가 성공적으로 종료되었습니다.');
        
        // 기존: console.log('서비스가 정상적으로 종료되었습니다.');
        // 변경:
        logger.success('서비스가 정상적으로 종료되었습니다.');
        process.exit(0);
    } catch (error) {
        // 기존: console.error(`종료 중 오류 발생: ${error.message}`);
        // 변경:
        logger.fatal(`종료 중 오류 발생: ${error.message}`, 'SYSTEM');
        process.exit(1);
    }
}

// 시그널 처리
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 오류 핸들러에서 console.error를 logger로 변경
process.on('uncaughtException', (error) => {
    // 기존: console.error(`처리되지 않은 예외 발생: ${error.message}`);
    // 기존: console.error(error.stack);
    // 변경:
    logger.fatal(`처리되지 않은 예외 발생: ${error.message}\n${error.stack}`, 'SYSTEM');
    shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    // 기존: console.error('처리되지 않은 프로미스 거부:', reason);
    // 변경:
    logger.fatal(`처리되지 않은 프로미스 거부: ${reason}`, 'SYSTEM');
    shutdown();
});

// 애플리케이션 시작
initialize();