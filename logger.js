// logger.js - Aimbot 전용 로깅 시스템
const chalk = require('chalk');

const log = {
    info: (msg) => console.log(chalk.cyan(`[INFO] ℹ️ ${msg}`)),
    warn: (msg) => console.warn(chalk.yellow(`[WARN] ⚠️ ${msg}`)),
    error: (msg) => console.error(chalk.red(`[ERROR] ❌ ${msg}`)),
    module: (msg) => console.log(chalk.green(`[MODULE] 📦 ${msg} 모듈 초기화 완료`)),
    command: (msg) => console.log(chalk.magenta(`[COMMAND] 🧩 ${msg} 명령어 등록 완료`)),
    slash: (msg) => console.log(chalk.blue(`[SLASH] 📝 ${msg} 슬래시 커맨드 등록 완료`)),
    startup: ({ local = 'http://localhost:3000', domain = 'http://<서버IP>:3000', protocol = 'HTTP', port = 3000 } = {}) => {
        console.log();
        console.log(chalk.bgBlue.white.bold(`🤖 Aimbot 디스코드 봇 서비스를 시작합니다...`));
        console.log();
        console.log(chalk.yellow(`🌐 ${protocol} 모드로 실행 중입니다.`));
        console.log(chalk.green(`📡 웹 인터페이스 시작됨:`));
        console.log(`   🔗 로컬 접속: ${chalk.underline(local)}`);
        console.log(`   🌍 도메인 접속: ${chalk.underline(domain)}`);
        console.log(`   ⚙️ 프로토콜: ${protocol}`);
        console.log(`   📦 포트: ${port}`);
        console.log();
        console.log(chalk.greenBright(`✅ 웹 서버가 성공적으로 시작되었습니다.`));
        console.log();
    }
};

module.exports = log;
