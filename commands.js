const { REST, Routes } = require('discord.js');
const logger = require('./logger');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

class CommandManager {
  constructor() {
    this.commands = [];
    this.rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    this.moduleCommands = new Map(); // 모듈별 명령어 저장
  }

  /**
   * 새 명령어를 등록합니다.
   * @param {Object} command 슬래시 커맨드 객체
   */
  registerCommand(command) {
    // 이미 존재하는 명령어인지 확인
    const existingCommand = this.commands.find(cmd => cmd.name === command.name);
    
    if (existingCommand) {
      logger.warn('CommandManager', `'${command.name}' 명령어가 이미 존재합니다. 덮어쓰기합니다.`);
      this.commands = this.commands.filter(cmd => cmd.name !== command.name);
    }
    
    this.commands.push(command);
    logger.success('CommandManager', `'${command.name}' 명령어가 등록되었습니다.`);
    return this;
  }

  /**
   * 모듈에서 여러 명령어를 등록합니다.
   * @param {string} moduleName 모듈 이름
   * @param {Array} commands 슬래시 커맨드 객체 배열
   */
  registerModuleCommands(moduleName, commands) {
    if (!Array.isArray(commands)) {
      logger.error('CommandManager', `${moduleName} 모듈의 명령어는 배열이어야 합니다.`);
      return this;
    }

    // 모듈별 명령어 저장
    this.moduleCommands.set(moduleName, commands);

    commands.forEach(command => {
      this.registerCommand(command);
    });

    logger.module('CommandManager', `${moduleName} 모듈에서 ${commands.length}개 명령어를 등록했습니다.`);
    return this;
  }

  /**
   * 모든 모듈에서 슬래시 커맨드를 로드합니다.
   */
  loadModuleCommands() {
    try {
      const modulesPath = path.join(__dirname, 'modules');
      if (!fs.existsSync(modulesPath)) {
        logger.warn('CommandManager', '모듈 디렉토리가 존재하지 않습니다.');
        return this;
      }

      const moduleFiles = fs.readdirSync(modulesPath).filter(file => file.endsWith('.js'));
      
      for (const file of moduleFiles) {
        try {
          const modulePath = path.join(modulesPath, file);
          // 캐시 제거하여 최신 코드 로드
          delete require.cache[require.resolve(modulePath)];
          const moduleExport = require(modulePath);
          
          // 더미 클라이언트로 모듈 초기화 - 명령어만 가져오기 위함
          const dummyClient = { 
            on: () => {}, 
            modules: new Map(),
            guilds: { cache: new Map() }
          };
          
          const moduleInstance = moduleExport(dummyClient);
          
          // 모듈 객체에서 slashCommands 배열이 있는지 확인
          if (moduleInstance && moduleInstance.slashCommands && Array.isArray(moduleInstance.slashCommands)) {
            this.registerModuleCommands(moduleInstance.name || file.replace('.js', ''), moduleInstance.slashCommands);
          } else if (moduleInstance && moduleInstance.commands && Array.isArray(moduleInstance.commands)) {
            // 일부 모듈에서는 commands 배열로 명령어 이름만 제공함 - 실제 슬래시 커맨드는 다른 곳에 정의
            logger.info('CommandManager', `'${moduleInstance.name || file}' 모듈에 commands 배열이 있지만 slashCommands가 없습니다.`);
          }
        } catch (error) {
          logger.error('CommandManager', `'${file}' 모듈의 명령어 로드 중 오류 발생: ${error.message}`);
        }
      }
      
      logger.success('CommandManager', '모든 모듈의 슬래시 커맨드가 로드되었습니다.');
      return this;
    } catch (error) {
      logger.error('CommandManager', `모듈 명령어 로드 중 오류 발생: ${error.message}`);
      return this;
    }
  }

  /**
   * Discord API에 슬래시 커맨드를 배포합니다.
   */
  async deployCommands() {
    try {
      // 모듈 명령어 로드
      this.loadModuleCommands();
      
      if (this.commands.length === 0) {
        logger.warn('CommandManager', '배포할 슬래시 커맨드가 없습니다.');
        return;
      }
      
      logger.system('CommandManager', `슬래시 커맨드를 Discord API에 배포 중... (${this.commands.length}개)`);
      
      // 명령어 목록 기록
      const commandNames = this.commands.map(cmd => cmd.name).join(', ');
      logger.info('CommandManager', `배포할 명령어 목록: ${commandNames}`);
      
      // 글로벌 커맨드 배포
      await this.rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: this.commands }
      );
      
      logger.success('CommandManager', `${this.commands.length}개 슬래시 커맨드가 성공적으로 배포되었습니다.`);
    } catch (error) {
      logger.error('CommandManager', `슬래시 커맨드 배포 실패: ${error.message}`);
      if (error.stack) {
        logger.error('CommandManager', `스택 트레이스: ${error.stack}`);
      }
      
      // 에러 세부정보 확인
      if (error.rawError) {
        logger.error('CommandManager', `API 에러 세부정보: ${JSON.stringify(error.rawError)}`);
      }
    }
  }

  /**
   * 특정 서버에만 슬래시 커맨드를 배포합니다.
   * @param {string} guildId 서버 ID
   */
  async deployCommandsToGuild(guildId) {
    try {
      if (this.commands.length === 0) {
        logger.warn('CommandManager', '배포할 슬래시 커맨드가 없습니다.');
        return;
      }
      
      logger.system('CommandManager', `슬래시 커맨드를 서버(${guildId})에 배포 중... (${this.commands.length}개)`);
      
      // 서버 특정 커맨드 배포
      await this.rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: this.commands }
      );
      
      logger.success('CommandManager', `${this.commands.length}개 슬래시 커맨드가 서버(${guildId})에 성공적으로 배포되었습니다.`);
    } catch (error) {
      logger.error('CommandManager', `서버 슬래시 커맨드 배포 실패: ${error.message}`);
    }
  }

  /**
   * 등록된 모든 명령어를 반환합니다.
   * @returns {Array} 등록된 모든 커맨드 배열
   */
  getAllCommands() {
    return this.commands;
  }

  /**
   * 특정 모듈의 명령어들을 반환합니다.
   * @param {string} moduleName 모듈 이름
   * @returns {Array} 해당 모듈의 명령어 배열 또는 빈 배열
   */
  getModuleCommands(moduleName) {
    return this.moduleCommands.get(moduleName) || [];
  }

  /**
   * 특정 이름의 명령어를 찾습니다.
   * @param {string} name 찾을 명령어 이름
   * @returns {Object|null} 찾은 명령어 객체 또는 null
   */
  findCommand(name) {
    return this.commands.find(cmd => cmd.name === name) || null;
  }

  /**
   * 특정 모듈의 명령어 처리를 수행합니다.
   * @param {Interaction} interaction 명령어 인터랙션
   * @param {Client} client 디스코드 클라이언트
   */
  async handleCommand(interaction, client) {
    if (!interaction.isCommand()) return;
    
    const { commandName } = interaction;
    logger.command('CommandManager', `'${interaction.user.tag}'님이 '${commandName}' 명령어를 사용했습니다.`);
    
    // 모듈 찾기
    for (const [name, module] of client.modules) {
      if ((module.commands && module.commands.includes(commandName)) ||
          (this.moduleCommands.get(name) && this.moduleCommands.get(name).some(cmd => cmd.name === commandName))) {
        
        if (typeof module.handleCommands === 'function') {
          try {
            const handled = await module.handleCommands(interaction);
            if (handled) {
              logger.success('CommandManager', `'${name}' 모듈이 '${commandName}' 명령어를 성공적으로 처리했습니다.`);
              return; // 명령어 처리 완료
            }
          } catch (error) {
            logger.error('CommandManager', `'${name}' 모듈의 명령어 '${commandName}' 처리 중 오류 발생: ${error.message}`);
            
            // 사용자에게 오류 메시지
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({
                content: `명령어 처리 중 오류가 발생했습니다: ${error.message}`,
                ephemeral: true
              }).catch(() => {});
            }
            return;
          }
        } else if (typeof module.executeSlashCommand === 'function') {
          try {
            await module.executeSlashCommand(interaction, client);
            return; // 명령어 처리 완료
          } catch (error) {
            logger.error('CommandManager', `'${name}' 모듈의 명령어 '${commandName}' 처리 중 오류 발생: ${error.message}`);
            
            // 사용자에게 오류 메시지
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({
                content: `명령어 처리 중 오류가 발생했습니다: ${error.message}`,
                ephemeral: true
              }).catch(() => {});
            }
            return;
          }
        }
      }
    }
    
    // 처리되지 않은 명령어
    logger.warn('CommandManager', `'${commandName}' 명령어를 처리할 모듈을 찾을 수 없습니다.`);
    
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '이 명령어를 처리할 모듈을 찾을 수 없습니다.',
        ephemeral: true
      }).catch(() => {});
    }
  }

  /**
   * 새로운 명령어를 만들어 관리자가 직접 명령어를 갱신할 수 있게 합니다.
   */
  createSyncCommand() {
    const syncCommand = {
      name: '슬래시',
      description: '슬래시 명령어를 서버에 동기화합니다',
      options: [
        {
          name: '타입',
          description: '동기화 타입을 선택합니다',
          type: 3, // STRING 타입
          required: true,
          choices: [
            {
              name: '전체',
              value: 'global'
            },
            {
              name: '서버',
              value: 'guild'
            }
          ]
        }
      ],
      default_member_permissions: (1 << 3).toString() // ADMINISTRATOR 권한
    };
    
    this.registerCommand(syncCommand);
    logger.success('CommandManager', '슬래시 명령어 동기화 명령어가 등록되었습니다.');
    return this;
  }
  
  /**
   * 초기화 시 슬래시 동기화 명령어를 추가합니다.
   */
  init() {
    // 슬래시 동기화 명령어 추가
    this.createSyncCommand();
    return this;
  }
  
  /**
   * 모듈 커맨드 리로드
   * @param {string} moduleName 모듈 이름
   */
  reloadModuleCommands(moduleName) {
    try {
      const modulePath = path.join(__dirname, 'modules', `${moduleName}.js`);
      if (!fs.existsSync(modulePath)) {
        logger.error('CommandManager', `'${moduleName}' 모듈 파일을 찾을 수 없습니다.`);
        return false;
      }
      
      // 캐시 제거하여 최신 코드 로드
      delete require.cache[require.resolve(modulePath)];
      const moduleExport = require(modulePath);
      
      // 더미 클라이언트로 모듈 초기화
      const dummyClient = { 
        on: () => {}, 
        modules: new Map(),
        guilds: { cache: new Map() }
      };
      
      const moduleInstance = moduleExport(dummyClient);
      
      // 기존 명령어 제거
      if (this.moduleCommands.has(moduleName)) {
        const oldCommands = this.moduleCommands.get(moduleName);
        oldCommands.forEach(cmd => {
          this.commands = this.commands.filter(c => c.name !== cmd.name);
        });
      }
      
      // 새 명령어 등록
      if (moduleInstance && moduleInstance.slashCommands && Array.isArray(moduleInstance.slashCommands)) {
        this.registerModuleCommands(moduleName, moduleInstance.slashCommands);
        logger.success('CommandManager', `'${moduleName}' 모듈의 명령어가 재로드되었습니다.`);
        return true;
      } else {
        logger.warn('CommandManager', `'${moduleName}' 모듈에 slashCommands 배열이 없습니다.`);
        return false;
      }
    } catch (error) {
      logger.error('CommandManager', `'${moduleName}' 모듈의 명령어 재로드 중 오류 발생: ${error.message}`);
      return false;
    }
  }
}

module.exports = new CommandManager();