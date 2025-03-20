// main.js - 애플리케이션 진입점

const config = require('./config');
const bot = require('./bot');
const webServer = require('./webserver');

// 초기화 및 시작 함수
async function initialize() {
    console.log('Sea Dogs Tavern 디스코드 봇 서비스를 시작합니다...');
    
    try {
        // 웹 서버 시작
        await webServer.start();
        console.log('웹 서버가 성공적으로 시작되었습니다.');
        
        // 봇 자동 시작 확인
        if (config.autoStartBot) {
            try {
                console.log('봇을 자동으로 시작합니다...');
                await bot.start();
                console.log('봇이 성공적으로 시작되었습니다.');
            } catch (error) {
                console.error(`봇 자동 시작 실패: ${error.message}`);
            }
        }
        
        console.log('초기화가 완료되었습니다. 서비스가 정상적으로 실행 중입니다.');
    } catch (error) {
        console.error(`초기화 중 오류 발생: ${error.message}`);
        process.exit(1);
    }
}

// 정상 종료 처리
async function shutdown() {
    console.log('서비스를 종료합니다...');
    
    try {
        // 봇 종료
        if (bot.status.isRunning) {
            await bot.stop();
            console.log('봇이 성공적으로 종료되었습니다.');
        }
        
        // 웹 서버 종료
        await webServer.stop();
        console.log('웹 서버가 성공적으로 종료되었습니다.');
        
        console.log('서비스가 정상적으로 종료되었습니다.');
        process.exit(0);
    } catch (error) {
        console.error(`종료 중 오류 발생: ${error.message}`);
        process.exit(1);
    }
}

// 시그널 처리
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 처리되지 않은 오류 처리
process.on('uncaughtException', (error) => {
    console.error(`처리되지 않은 예외 발생: ${error.message}`);
    console.error(error.stack);
    shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('처리되지 않은 프로미스 거부:', reason);
    shutdown();
});

// 애플리케이션 시작
initialize();