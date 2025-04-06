
const log = {
    info: (msg) => console.log(`[INFO] ℹ️ ${msg}`),
    warn: (msg) => console.warn(`[WARN] ⚠️ ${msg}`),
    error: (msg) => console.error(`[ERROR] ❌ ${msg}`),
    module: (msg) => console.log(`[MODULE] 📦 ${msg} 모듈 초기화 완료`),
    command: (msg) => console.log(`[COMMAND] 🧩 ${msg} 명령어 등록 완료`),
    slash: (msg) => console.log(`[SLASH] 📝 ${msg} 슬래시 커맨드 등록 완료`),
    startup: ({ local = 'http://localhost:3000', domain = 'http://<서버IP>:3000', protocol = 'HTTP', port = 3000 } = {}) => {
        console.log();
        console.log(`🤖 Aimbot 디스코드 봇 서비스를 시작합니다...`);
        console.log();
        console.log(`🌐 ${protocol} 모드로 실행 중입니다.`);
        console.log(`📡 웹 인터페이스 시작됨:`);
        console.log(`   🔗 로컬 접속: ${local}`);
        console.log(`   🌍 도메인 접속: ${domain}`);
        console.log(`   ⚙️ 프로토콜: ${protocol}`);
        console.log(`   📦 포트: ${port}`);
        console.log();
        console.log(`✅ 웹 서버가 성공적으로 시작되었습니다.`);
        console.log();
    }
};

module.exports = log;
