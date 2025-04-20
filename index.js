// index.js - 메인 진입점 파일 개선
const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  Collection,
  Events,
  ActivityType,
  PermissionFlagsBits
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const logger = require('./logger');
const commandManager = require('./commands');
const config = require('./config/bot-config');

// 환경 변수 로드
dotenv.config();

// 클라이언트 초기화 - 필요한 인텐트 추가
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildEmojisAndStickers
  ],
  partials: [
    Partials.User,
    Partials.Channel,
    Partials.GuildMember,
    Partials.Message,
    Partials.Reaction
  ]
});

// 모듈 및 이벤트 컬렉션 초기화
client.modules = new Collection();
client.events = new Collection();
client.commands = new Collection();

/**
 * 모듈 로딩 함수 - 에러 처리 강화 및 모듈 로딩 로직 개선
 */
async function loadModules() {
  logger.system('Loader', '모듈 로딩 중...');
  
  try {
    const modulesPath = path.join(__dirname, 'modules');
    // 모듈 디렉토리가 없으면 생성
    if (!fs.existsSync(modulesPath)) {
      fs.mkdirSync(modulesPath, { recursive: true });
      logger.warn('Loader', '모듈 디렉토리가 없어 새로 생성했습니다.');
    }
    
    const moduleFiles = fs.readdirSync(modulesPath).filter(file => file.endsWith('.js'));
    
    if (moduleFiles.length === 0) {
      logger.warn('Loader', '모듈 디렉토리에 모듈이 없습니다.');
      return;
    }
    
    let loadedCount = 0;
    let errorCount = 0;
    
    for (const file of moduleFiles) {
      try {
        const modulePath = path.join(modulesPath, file);
        // 모듈 캐시 초기화 (개발 중 변경사항 즉시 반영)
        delete require.cache[require.resolve(modulePath)];
        const moduleFunction = require(modulePath);
        
        // 모듈 초기화 및 등록
        if (typeof moduleFunction === 'function') {
          const moduleInstance = moduleFunction(client);
          client.modules.set(moduleInstance.name, moduleInstance);
          logger.module('Loader', `'${moduleInstance.name}' 모듈이 로드되었습니다.`);
          loadedCount++;
          
          // 모듈 시작
          if (typeof moduleInstance.start === 'function') {
            await moduleInstance.start();
          }
        } else {
          logger.warn('Loader', `'${file}' 모듈이 유효한 형식이 아닙니다.`);
          errorCount++;
        }
      } catch (error) {
        logger.error('Loader', `'${file}' 모듈 로딩 중 오류 발생: ${error.message}`);
        logger.error('Loader', `스택 트레이스: ${error.stack}`);
        errorCount++;
      }
    }
    
    logger.success('Loader', `${loadedCount}개 모듈이 성공적으로 로드되었습니다. ${errorCount > 0 ? `(${errorCount}개 모듈 로드 실패)` : ''}`);
  } catch (error) {
    logger.error('Loader', `모듈 로딩 중 오류 발생: ${error.message}`);
    logger.error('Loader', `스택 트레이스: ${error.stack}`);
  }
}

/**
 * 웹 서버 초기화 함수 - 에러 핸들링 강화
 */
async function initWebServer() {
  try {
    const WebServer = require('./web/server');
    const webServer = WebServer(client);
    await webServer.start();
    client.webServer = webServer;
    
    // 프로세스 종료 시 웹 서버도 종료
    process.on('SIGINT', () => {
      logger.system('Process', '프로세스가 종료됩니다. 웹 서버를 종료합니다.');
      webServer.stop();
      process.exit(0);
    });
  } catch (error) {
    logger.error('WebServer', `웹 서버 초기화 중 오류 발생: ${error.message}`);
    logger.error('WebServer', `스택 트레이스: ${error.stack}`);
  }
}

// 클라이언트 이벤트 핸들러
client.on(Events.ClientReady, async () => {
  logger.success('Bot', `봇이 준비되었습니다. 로그인: ${client.user.tag}`);
  
  // 슬래시 커맨드 배포
  await commandManager.deployCommands();
  
  // 웹 서버 초기화
  await initWebServer();
  
  // 상태 메시지 업데이트 함수
  const updateStatus = () => {
    // 서버 수
    const serverCount = client.guilds.cache.size;
    
    // 총 사용자 수 계산
    let totalMembers = 0;
    client.guilds.cache.forEach(guild => {
      totalMembers += guild.memberCount;
    });
    
    // 상태 메시지 설정
    client.user.setActivity(`⚙️ ${serverCount}개의 서버에서 ${totalMembers}명에게 서비스중`, { 
      type: ActivityType.Playing 
    });
  };
  
  // 초기 상태 설정
  updateStatus();
  
  // 주기적으로 상태 메시지 업데이트
  setInterval(updateStatus, 60000 * 5); // 5분마다 업데이트
});

// 명령어 처리 - 에러 핸들링 개선
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isCommand()) return;
    
    const { commandName } = interaction;
    logger.command('Interaction', `'${interaction.user.tag}'님이 '${commandName}' 명령어를 사용했습니다.`);
    
    // 슬래시 명령어 동기화 처리
    if (commandName === '슬래시') {
      // 관리자 권한 확인
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: '⚠️ 이 명령어는 관리자만 사용할 수 있습니다.',
          ephemeral: true
        });
        return;
      }
      
      const type = interaction.options.getString('타입');
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        if (type === 'global') {
          // 글로벌 명령어 동기화
          await commandManager.deployCommands();
          
          await interaction.editReply({
            content: '✅ 모든 슬래시 명령어가 Discord API에 성공적으로 동기화되었습니다.\n' +
                    '⏱️ 전체 서버에 반영되기까지 최대 1시간이 소요될 수 있습니다.',
            ephemeral: true
          });
        } else if (type === 'guild') {
          // 현재 서버에만 명령어 동기화 (즉시 적용)
          const commands = commandManager.getAllCommands();
          
          await interaction.client.application.commands.set(commands, interaction.guildId);
          
          await interaction.editReply({
            content: `✅ 슬래시 명령어가 현재 서버(${interaction.guild.name})에 즉시 동기화되었습니다.`,
            ephemeral: true
          });
        }
      } catch (error) {
        logger.error('CommandSync', `명령어 동기화 중 오류 발생: ${error.message}`);
        
        await interaction.editReply({
          content: `⚠️ 명령어 동기화 중 오류가 발생했습니다: ${error.message}`,
          ephemeral: true
        });
      }
      
      return; // 다른 명령어 처리로 넘어가지 않도록 return
    }
    
    // 모듈별 명령어 처리
    let handled = false;
    for (const [name, module] of client.modules) {
      if (typeof module.handleCommands === 'function') {
        try {
          const wasHandled = await module.handleCommands(interaction);
          if (wasHandled) {
            handled = true;
            break; // 처리되었으면 루프 종료
          }
        } catch (error) {
          logger.error('Command', `'${name}' 모듈의 명령어 처리 중 오류 발생: ${error.message}`);
          // 사용자에게 오류 알림
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ 
              content: '⚠️ 명령어 실행 중 오류가 발생했습니다. 나중에 다시 시도해 주세요.', 
              ephemeral: true 
            });
          }
        }
      }
    }
    
    // 어떤 모듈도 명령어를 처리하지 않은 경우
    if (!handled && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ 
        content: '⚠️ 해당 명령어를 처리할 수 있는 모듈을 찾을 수 없습니다.', 
        ephemeral: true 
      });
    }
  } catch (error) {
    logger.error('InteractionCreate', `명령어 처리 중 오류 발생: ${error.message}`);
    // 상호작용이 아직 응답되지 않았으면 응답
    if (interaction && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ 
          content: '⚠️ 명령어 실행 중 예상치 못한 오류가 발생했습니다.', 
          ephemeral: true 
        });
      } catch (replyError) {
        logger.error('InteractionCreate', `오류 응답 전송 실패: ${replyError.message}`);
      }
    }
  }
});

// 버튼 인터랙션 처리 (가입 신청서 용)
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    
    // 모듈별 버튼 처리
    for (const [name, module] of client.modules) {
      if (typeof module.handleButtons === 'function') {
        try {
          const wasHandled = await module.handleButtons(interaction);
          if (wasHandled) break; // 처리되었으면 루프 종료
        } catch (error) {
          logger.error('Button', `'${name}' 모듈의 버튼 처리 중 오류 발생: ${error.message}`);
        }
      }
    }
  } catch (error) {
    logger.error('Button', `버튼 처리 중 오류 발생: ${error.message}`);
  }
});

// 모달 인터랙션 처리 (가입 신청서 용)
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isModalSubmit()) return;
    
    // 모듈별 모달 처리
    for (const [name, module] of client.modules) {
      if (typeof module.handleModals === 'function') {
        try {
          const wasHandled = await module.handleModals(interaction);
          if (wasHandled) break; // 처리되었으면 루프 종료
        } catch (error) {
          logger.error('Modal', `'${name}' 모듈의 모달 처리 중 오류 발생: ${error.message}`);
        }
      }
    }
  } catch (error) {
    logger.error('Modal', `모달 처리 중 오류 발생: ${error.message}`);
  }
});

// 선택 메뉴 인터랙션 처리
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isStringSelectMenu()) return;
    
    // 모듈별 선택 메뉴 처리
    for (const [name, module] of client.modules) {
      if (typeof module.handleSelectMenus === 'function') {
        try {
          const wasHandled = await module.handleSelectMenus(interaction);
          if (wasHandled) break; // 처리되었으면 루프 종료
        } catch (error) {
          logger.error('SelectMenu', `'${name}' 모듈의 선택 메뉴 처리 중 오류 발생: ${error.message}`);
        }
      }
    }
  } catch (error) {
    logger.error('SelectMenu', `선택 메뉴 처리 중 오류 발생: ${error.message}`);
  }
});

// 에러 핸들링
client.on(Events.Error, (error) => {
  logger.error('Discord', `클라이언트 에러: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Process', `처리되지 않은 Promise 거부: ${reason}`);
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Process', `예상치 못한 예외 발생: ${error.message}`);
  logger.error('Process', `스택 트레이스: ${error.stack}`);
  // 심각한 오류의 경우 프로세스를 종료하지 않도록 주의
});

// 봇 시작
async function startBot() {
  logger.system('Bot', '봇을 시작합니다...');
  
  try {
    // 명령어 매니저 초기화
    commandManager.init();
    
    // 모듈 로드
    await loadModules();
    
    // 봇 로그인
    await client.login(process.env.BOT_TOKEN);
  } catch (error) {
    logger.error('Bot', `봇 시작 중 오류 발생: ${error.message}`);
    logger.error('Bot', `스택 트레이스: ${error.stack}`);
    process.exit(1);
  }
}

// 시작
startBot();