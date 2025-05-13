const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
require('dotenv').config();

// 필요한 인텐트와 Partials 설정 
// MessageContent 인텐트 추가 (명령어 인식에 필요)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember, Partials.Channel, Partials.Message] // 부분 객체 지원 추가
});

// 모듈 컬렉션 생성
client.modules = new Collection();

// 모듈 로드 함수
function loadModules() {
  try {
    // 입장/퇴장 모듈 로드
    const welcomeModule = require('./modules/welcome-module.js');
    client.modules.set(welcomeModule.name, welcomeModule);
    console.log(`✅ 모듈 로드 성공: ${welcomeModule.name}`);
    
    // 투표 모듈 로드
    const voteModule = require('./modules/vote-module.js');
    client.modules.set(voteModule.name, voteModule);
    console.log(`✅ 모듈 로드 성공: ${voteModule.name}`);
  } catch (error) {
    console.error('❌ 모듈 로드 실패:', error.message);
  }
}

// 오류 핸들링
process.on('unhandledRejection', error => {
  console.error('❌ 처리되지 않은 Promise 거부:', error);
});

// 클라이언트 준비 이벤트
client.once('ready', () => {
  console.log(`✅ ${client.user.tag}으로 로그인했습니다!`);
  
  // 모듈 초기화
  client.modules.forEach(module => {
    if (module.init) {
      try {
        module.init(client);
        console.log(`✅ 모듈 초기화 성공: ${module.name}`);
      } catch (error) {
        console.error(`❌ 모듈 초기화 실패: ${module.name}`, error);
      }
    }
  });
});

// 디버깅을 위한 이벤트 리스너 추가
client.on('guildMemberAdd', member => {
  console.log(`🔍 디버그: 멤버 입장 이벤트 발생 - ${member.user.tag}`);
});

client.on('guildMemberRemove', member => {
  console.log(`🔍 디버그: 멤버 퇴장 이벤트 발생 - ${member.user.tag}`);
});

// 메시지 디버깅 리스너 추가
client.on('messageCreate', message => {
  // 봇 메시지는 무시
  if (message.author.bot) return;
  
  // 접두사 (prefix) 가져오기
  const prefix = process.env.PREFIX || '!';
  
  // 메시지가 접두사로 시작하면 로그 출력
  if (message.content.startsWith(prefix)) {
    console.log(`📝 메시지 감지 (${message.guild.name} / #${message.channel.name}): ${message.content}`);
  }
});

// 모듈 로드
loadModules();

// 봇 로그인
client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log('✅ 봇 로그인 성공'))
  .catch(error => console.error('❌ 봇 로그인 실패:', error.message));