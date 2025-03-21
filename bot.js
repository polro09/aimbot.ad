// bot.js - 디스코드 봇 로직

const { Client, GatewayIntentBits, Collection, Routes, REST } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const storage = require('./storage');

// 싱글톤 패턴을 위한 인스턴스
let instance = null;

class DiscordBot {
    constructor() {
        if (instance) {
            return instance;
        }
        
        // 봇 상태 정보를 저장할 객체
        this.status = {
            isRunning: false,
            startTime: null,
            logs: [],
            modules: new Collection(),
            guilds: []
        };
        
        // 최대 로그 개수
        this.maxLogs = 100;
        
        // 봇 생성 및 인텐트 설정
        this.client = new Client({ 
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildVoiceStates  // 음성 채널 상태 변경 감지를 위한 인텐트 추가
            ] 
        });
        
        // 모듈 및 명령어 컬렉션 생성
        this.client.modules = new Collection();
        this.client.commands = new Collection();
        this.client.slashCommands = new Collection();
        
        // 이벤트 리스너 등록
        this._registerEventListeners();
        
        instance = this;
    }
    
    // 이벤트 리스너 등록
    _registerEventListeners() {
        // 봇 준비 이벤트
        this.client.once('ready', async () => {
            this.status.isRunning = true;
            this.log('INFO', `${this.client.user.tag} 봇이 준비되었습니다.`);
            await this.loadModules();
            await this.registerSlashCommands();
        });
        
        // 서버 참가 이벤트
        this.client.on('guildCreate', (guild) => {
            this.log('INFO', `새로운 서버에 참가했습니다: ${guild.name} (${guild.memberCount}명)`);
            this._updateBotStatus();
        });
        
        // 서버 퇴장 이벤트
        this.client.on('guildDelete', (guild) => {
            this.log('INFO', `서버에서 퇴장했습니다: ${guild.name}`);
            this._updateBotStatus();
        });
        
        // 음성 상태 업데이트 이벤트 (추가됨)
        this.client.on('voiceStateUpdate', (oldState, newState) => {
            // 유저가 음성 채널에 참가한 경우
            if (!oldState.channelId && newState.channelId) {
                this.log('INFO', `유저 ${newState.member.user.tag}가 '${newState.channel.name}' 음성 채널에 참가했습니다.`);
            }
            // 유저가 음성 채널에서 나간 경우
            else if (oldState.channelId && !newState.channelId) {
                this.log('INFO', `유저 ${oldState.member.user.tag}가 '${oldState.channel.name}' 음성 채널에서 나갔습니다.`);
            }
            // 유저가 음성 채널을 이동한 경우
            else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                this.log('INFO', `유저 ${newState.member.user.tag}가 '${oldState.channel.name}'에서 '${newState.channel.name}' 음성 채널로 이동했습니다.`);
            }
        });
        
        // 슬래시 커맨드 처리
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            
            try {
                const { commandName } = interaction;
                const slashCommand = this.client.slashCommands.get(commandName);
                
                if (!slashCommand) return;
                
                const { module } = slashCommand;
                
                if (typeof module.executeSlashCommand === 'function') {
                    await module.executeSlashCommand(interaction, this.client, this.log.bind(this));
                    this.log('COMMAND', `유저 ${interaction.user.tag}가 /${commandName} 슬래시 명령어를 사용했습니다.`);
                } else {
                    this.log('ERROR', `모듈 ${module.name}에 executeSlashCommand 함수가 없습니다.`);
                    await interaction.reply({ content: '이 명령어를 처리할 수 없습니다.', ephemeral: true });
                }
            } catch (error) {
                this.log('ERROR', `슬래시 명령어 처리 중 오류 발생: ${error.message}`);
                
                // 이미 응답했는지 확인
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: '명령어 실행 중 오류가 발생했습니다.', ephemeral: true });
                } else {
                    await interaction.reply({ content: '명령어 실행 중 오류가 발생했습니다.', ephemeral: true });
                }
            }
        });
        
        // 메시지 처리 함수 (기존 명령어 호환성 유지)
        this.client.on('messageCreate', async (message) => {
            // 봇 메시지 무시
            if (message.author.bot) return;
            
            // 접두사로 시작하는지 확인
            if (!message.content.startsWith(config.prefix)) return;
            
            // 명령어 파싱
            const args = message.content.slice(config.prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            
            // 명령어 찾기
            const command = this.client.commands.get(commandName);
            if (!command) return;
            
            try {
                // 명령어 실행 및 로그
                await command.execute(message, args, this.client);
                this.log('COMMAND', `유저 ${message.author.tag}가 ${commandName} 명령어를 사용했습니다.`);
            } catch (error) {
                this.log('ERROR', `명령어 ${commandName} 실행 중 오류 발생: ${error.message}`);
                message.reply('명령어 실행 중 오류가 발생했습니다.');
            }
        });
        
        // 프로세스 종료 처리
        process.on('SIGINT', async () => {
            if (this.status.isRunning) {
                await this.stop();
            }
            process.exit(0);
        });
    }
    
    // 로그 함수
    log(type, message) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type,
            message
        };
        
        this.status.logs.unshift(logEntry); // 최신 로그를 앞에 추가
        if (this.status.logs.length > this.maxLogs) this.status.logs.pop(); // 오래된 로그 제거
        
        console.log(`[${type}] ${message}`);
        
        // 상태 정보 업데이트
        this._updateBotStatus();
        
        // 로그 이벤트 발생 (웹소켓 등에서 사용)
        if (this.onLog) {
            this.onLog(logEntry);
        }
        
        return logEntry;
    }
    
    // 봇 상태 정보 업데이트 함수
    _updateBotStatus() {
        if (!this.client || !this.client.guilds) return;
        
        this.status.guilds = Array.from(this.client.guilds.cache).map(([id, guild]) => ({
            id,
            name: guild.name,
            memberCount: guild.memberCount
        }));
        
        this.status.modules = Array.from(this.client.modules.keys());
    }
    
    // 가동 시간 계산 함수
    getUptime() {
        if (!this.status.startTime) return '봇이 실행 중이 아닙니다';
        
        const now = new Date();
        const diff = now - this.status.startTime;
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        return `${days}일 ${hours}시간 ${minutes}분 ${seconds}초`;
    }
    
    // 슬래시 커맨드 등록 함수
    async registerSlashCommands() {
        try {
            const rest = new REST({ version: '10' }).setToken(config.token);
            const commands = [];
            
            // 각 모듈의 슬래시 커맨드 수집
            for (const [moduleName, module] of this.client.modules.entries()) {
                if (module.slashCommands && Array.isArray(module.slashCommands)) {
                    commands.push(...module.slashCommands.map(cmd => cmd.toJSON()));
                    
                    // 슬래시 커맨드 매핑
                    module.slashCommands.forEach(cmd => {
                        this.client.slashCommands.set(cmd.name, { module, command: cmd });
                    });
                    
                    this.log('INFO', `모듈 ${moduleName}에서 ${module.slashCommands.length}개의 슬래시 커맨드를 로드했습니다.`);
                }
            }
            
            if (commands.length === 0) {
                this.log('INFO', '등록할 슬래시 커맨드가 없습니다.');
                return;
            }
            
            this.log('INFO', `${commands.length}개의 슬래시 커맨드를 등록하는 중...`);
            
            // 전역 커맨드 등록
            await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: commands }
            );
            
            this.log('INFO', '슬래시 커맨드가 성공적으로 등록되었습니다.');
        } catch (error) {
            this.log('ERROR', `슬래시 커맨드 등록 중 오류 발생: ${error.message}`);
        }
    }
    
    // 모듈 로딩 함수
    async loadModules() {
        try {
            // 모듈 디렉토리 확인
            try {
                await fs.access(config.dirs.modules);
            } catch (error) {
                await fs.mkdir(config.dirs.modules, { recursive: true });
            }
            
            // 모듈 파일 읽기
            const files = await fs.readdir(config.dirs.modules);
            const moduleFiles = files.filter(file => file.endsWith('.js'));
            
            // 각 모듈 로드
            for (const file of moduleFiles) {
                try {
                    const modulePath = path.join(__dirname, config.dirs.modules, file);
                    
                    // 캐시 삭제 (개발 중 모듈 변경 사항 반영)
                    delete require.cache[require.resolve(modulePath)];
                    
                    const module = require(modulePath);
                    
                    // 모듈 초기화 확인
                    if (typeof module.init !== 'function') {
                        this.log('ERROR', `모듈 ${file}에 init 함수가 없습니다.`);
                        continue;
                    }
                    
                    // 모듈 초기화
                    await module.init(this.client, this.log.bind(this));
                    
                    // 모듈 명령어 추가
                    if (module.commands) {
                        for (const [name, command] of Object.entries(module.commands)) {
                            this.client.commands.set(name, command);
                        }
                    }
                    
                    // 모듈 컬렉션에 추가
                    this.client.modules.set(file, module);
                    this.log('MODULE', `모듈 ${file}을(를) 성공적으로 로드했습니다.`);
                } catch (error) {
                    this.log('ERROR', `모듈 ${file} 로드 중 오류 발생: ${error.message}`);
                }
            }
            
            this.log('INFO', `총 ${this.client.modules.size}개의 모듈이 로드되었습니다.`);
        } catch (error) {
            this.log('ERROR', `모듈 로드 중 오류 발생: ${error.message}`);
        }
    }
    
    // 모듈 상태 가져오기
    getModuleStatus() {
        const moduleStatus = {};
        
        for (const [fileName, module] of this.client.modules.entries()) {
            moduleStatus[fileName] = {
                name: module.name || fileName,
                description: module.description || '설명 없음',
                version: module.version || '1.0.0',
                enabled: module.enabled !== false,
                commands: module.commands ? Object.keys(module.commands) : []
            };
        }
        
        return moduleStatus;
    }
    
    // 모듈 활성화/비활성화/리로드
    async moduleAction(action, moduleName) {
        try {
            if (!this.client.modules.has(moduleName)) {
                throw new Error(`모듈 ${moduleName}을(를) 찾을 수 없습니다.`);
            }
            
            const module = this.client.modules.get(moduleName);
            
            switch (action) {
                case 'enable':
                    module.enabled = true;
                    this.log('MODULE', `모듈 ${moduleName}이(가) 활성화되었습니다.`);
                    return true;
                    
                case 'disable':
                    module.enabled = false;
                    this.log('MODULE', `모듈 ${moduleName}이(가) 비활성화되었습니다.`);
                    return true;
                    
                case 'reload':
                    // 모듈 다시 로드
                    const modulePath = path.join(__dirname, config.dirs.modules, moduleName);
                    delete require.cache[require.resolve(modulePath)];
                    
                    // 기존 모듈 명령어 제거
                    if (module.commands) {
                        for (const name of Object.keys(module.commands)) {
                            this.client.commands.delete(name);
                        }
                    }
                    
                    // 기존 모듈 슬래시 명령어 제거
                    if (module.slashCommands) {
                        module.slashCommands.forEach(cmd => {
                            this.client.slashCommands.delete(cmd.name);
                        });
                    }
                    
                    // 모듈 다시 로드
                    const newModule = require(modulePath);
                    await newModule.init(this.client, this.log.bind(this));
                    
                    // 새 명령어 등록
                    if (newModule.commands) {
                        for (const [name, command] of Object.entries(newModule.commands)) {
                            this.client.commands.set(name, command);
                        }
                    }
                    
                    // 모듈 업데이트
                    this.client.modules.set(moduleName, newModule);
                    this.log('MODULE', `모듈 ${moduleName}이(가) 다시 로드되었습니다.`);
                    
                    // 슬래시 명령어 재등록
                    await this.registerSlashCommands();
                    
                    return true;
                    
                default:
                    throw new Error(`알 수 없는 모듈 작업: ${action}`);
            }
        } catch (error) {
            this.log('ERROR', `모듈 ${moduleName} ${action} 작업 중 오류 발생: ${error.message}`);
            return false;
        }
    }
    
    // 봇 시작 함수
    async start() {
        if (this.status.isRunning) {
            console.log('봇이 이미 실행 중입니다.');
            return false;
        }
        
        // 저장소 초기화
        if (!storage.initialized) {
            await storage.init(this.log.bind(this));
        }
        
        this.status.startTime = new Date();
        this.status.isRunning = true;
        
        this.log('INFO', '봇을 시작합니다...');
        
        try {
            await this.client.login(config.token);
            this.log('INFO', '디스코드에 로그인했습니다.');
            return true;
        } catch (error) {
            this.status.isRunning = false;
            this.log('ERROR', `로그인 중 오류 발생: ${error.message}`);
            throw error;
        }
    }
    
    // 봇 종료 함수
    async stop() {
        if (!this.status.isRunning) {
            console.log('봇이 실행 중이 아닙니다.');
            return false;
        }
        
        this.log('INFO', '봇을 종료합니다...');
        
        try {
            // 데이터 저장
            if (storage.initialized) {
                await storage.saveAll();
            }
            
            // 클라이언트 종료
            this.client.destroy();
            this.status.isRunning = false;
            this.log('INFO', '봇이 종료되었습니다.');
            return true;
        } catch (error) {
            this.log('ERROR', `봇 종료 중 오류 발생: ${error.message}`);
            throw error;
        }
    }
    
    // 봇 재시작 함수
    async restart() {
        this.log('INFO', '봇을 재시작합니다...');
        
        try {
            await this.stop();
            await this.start();
            return true;
        } catch (error) {
            this.log('ERROR', `봇 재시작 중 오류 발생: ${error.message}`);
            return false;
        }
    }
    
    // 상태 가져오기 함수
    getStatus() {
        return {
            isRunning: this.status.isRunning,
            uptime: this.getUptime(),
            servers: this.status.guilds,
            modules: this.status.modules,
            logs: this.status.logs,
            moduleStatus: this.getModuleStatus()
        };
    }
    
    // 사용자 설정 가져오기
    getUserSettings() {
        return config.userSettings;
    }
    
    // 사용자 설정 저장하기
    async saveUserSettings(settings) {
        try {
            // 유효성 검사
            if (!settings || typeof settings !== 'object') {
                throw new Error('유효하지 않은 설정 객체입니다.');
            }
            
            // 설정 업데이트
            config.userSettings = {
                ...config.userSettings,
                ...settings
            };
            
            // 접두사 업데이트
            if (settings.prefix) {
                config.prefix = settings.prefix;
            }
            
            // 설정 저장
            await storage.setAll('user-settings', config.userSettings);
            await storage.save('user-settings');
            
            this.log('INFO', '사용자 설정이 저장되었습니다.');
            return true;
        } catch (error) {
            this.log('ERROR', `사용자 설정 저장 중 오류 발생: ${error.message}`);
            return false;
        }
    }
}

// 싱글톤 인스턴스 생성 및 내보내기
const botInstance = new DiscordBot();
module.exports = botInstance;