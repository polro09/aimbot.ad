// 상단에 로거 모듈 추가
const { Client, GatewayIntentBits, Collection, Routes, REST } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const storage = require('./storage');
// 이 부분 추가
const logger = require('./utils/logger');

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
        
        // 모듈 로딩 상태 추적
        this.moduleLoadingState = {
            loadedModules: new Set(),
            failedModules: new Set(),
            pendingDependencies: new Map(), // 의존성 대기 중인 모듈 추적
            retryCount: new Map()           // 모듈별 재시도 횟수
        };
        
        instance = this;
    }
    
    // 이벤트 리스너 등록
    _registerEventListeners() {
        // 봇 준비 이벤트
        this.client.once('ready', async () => {
            this.status.isRunning = true;
            this.log('INFO', `${this.client.user.tag} 봇이 준비되었습니다.`);
            
            // 스토리지 초기화 확인
            await this._ensureStorageInitialized();
            
            // 모듈 로딩
            await this.loadModules();
            
            // 슬래시 명령어 등록
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
        
        // 음성 상태 업데이트 이벤트
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
                
                // 모듈이 비활성화되어 있으면 명령어 처리 안함
                if (module.enabled === false) {
                    await interaction.reply({ 
                        content: '이 명령어는 현재 비활성화되어 있습니다.', 
                        ephemeral: true 
                    });
                    return;
                }
                
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
    
    // 스토리지 초기화 확인
    async _ensureStorageInitialized() {
        if (!storage.initialized) {
            try {
                await storage.init(this.log.bind(this));
            } catch (error) {
                this.log('ERROR', `스토리지 초기화 실패: ${error.message}`);
                // 스토리지 초기화 실패해도 계속 진행
                this.log('WARN', '스토리지 초기화 실패, 일부 모듈이 동작하지 않을 수 있습니다.');
            }
        }
    }
    
    // 기존 this.log 함수를 logger로 교체
// log 함수 (약 259번 줄)를 아래와 같이 수정
log(type, message) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        type,
        message
    };
    
    this.status.logs.unshift(logEntry); // 최신 로그를 앞에 추가
    if (this.status.logs.length > this.maxLogs) this.status.logs.pop(); // 오래된 로그 제거
    
    // 기존: console.log(`[${type}] ${message}`);
    // 변경:
    switch(type) {
        case 'ERROR':
            logger.error(message, 'BOT');
            break;
        case 'WARN':
            logger.warn(message, 'BOT');
            break;
        case 'INFO':
            logger.info(message, 'BOT');
            break;
        case 'MODULE':
            logger.module(message);
            break;
        case 'COMMAND':
            logger.command(message);
            break;
        default:
            logger.info(message, type, 'BOT');
    }
    
    // 상태 정보 업데이트
    this._updateBotStatus();
    
    // 로그 이벤트 발생 (웹소켓 등에서 사용)
    if (this.onLog) {
        this.onLog(logEntry);
    }
    
    return logEntry;
}

// _registerEventListeners 함수 내 console.log를 logger로 대체
// 예를 들어, 약 90번 줄의 this.log('INFO', `${this.client.user.tag} 봇이 준비되었습니다.`); 등을 수정할 필요는 없음
// 왜냐하면 이미 수정된 log 함수가 logger를 사용하기 때문
    
    // 봇 상태 정보 업데이트 함수
    _updateBotStatus() {
        if (!this.client || !this.client.guilds) return;
        
        // 서버 목록 정보 
        this.status.guilds = Array.from(this.client.guilds.cache).map(([id, guild]) => ({
            id,
            name: guild.name,
            memberCount: guild.memberCount
        }));
        
        // 모듈 목록 - 간소화된 정보만 포함
        this.status.modules = Array.from(this.client.modules.keys());
        
        // 모듈 상태 정보는 가볍게 유지 (필요할 때만 전체 정보 제공)
        const moduleStatus = {};
        for (const [fileName, module] of this.client.modules.entries()) {
            moduleStatus[fileName] = {
                name: module.name || fileName,
                enabled: module.enabled !== false
            };
        }
        
        this.status.moduleStatus = moduleStatus;
    }
    
    // 모듈 로딩 - 의존성 처리 개선
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
            
            // 모듈 로딩 순서 조정 - 스토리지 의존성에 따른 우선순위
            const moduleGroups = {
                lowDependency: [],    // 낮은 의존성 모듈 (첫번째 로드)
                mediumDependency: [], // 중간 의존성 모듈 (두번째 로드)
                highDependency: []    // 높은 의존성 모듈 (마지막 로드)
            };
            
            // 모듈 분류
            moduleFiles.forEach(file => {
                // 스토리지 의존성이 높은 모듈 구분
                if (file.includes('vacation') || 
                    file.includes('raid') || 
                    file.includes('ticket') || 
                    file.includes('welcome')) {
                    moduleGroups.highDependency.push(file);
                } 
                // 중간 의존성 모듈 (음성 채널 모듈 등)
                else if (file.includes('voice') || 
                         file.includes('channel') || 
                         file.includes('chat')) {
                    moduleGroups.mediumDependency.push(file);
                } 
                // 낮은 의존성 모듈
                else {
                    moduleGroups.lowDependency.push(file);
                }
            });
            
            // 의존성 수준별 로딩 순서 (낮은 의존성 → 높은 의존성)
            const orderedModules = [
                ...moduleGroups.lowDependency,
                ...moduleGroups.mediumDependency,
                ...moduleGroups.highDependency
            ];
            
            // 각 모듈 로드 시도
            for (const file of orderedModules) {
                await this._loadModule(file);
            }
            
            // 의존성 문제로 실패한 모듈 재시도
            await this._retryFailedModules();
            
            this.log('INFO', `총 ${this.client.modules.size}개의 모듈이 로드되었습니다. ` +
                           `실패한 모듈: ${this.moduleLoadingState.failedModules.size}개`);
            
            // 최종적으로 실패한 모듈 목록 로깅
            if (this.moduleLoadingState.failedModules.size > 0) {
                this.log('WARN', `로드에 실패한 모듈: ${Array.from(this.moduleLoadingState.failedModules).join(', ')}`);
            }
        } catch (error) {
            this.log('ERROR', `모듈 로드 중 오류 발생: ${error.message}`);
        }
    }
    
    // bot.js 파일의 _loadModule 함수

// 단일 모듈 로드 함수
async _loadModule(file) {
    try {
        const modulePath = path.join(__dirname, config.dirs.modules, file);
        
        // 캐시 삭제 (개발 중 모듈 변경 사항 반영)
        delete require.cache[require.resolve(modulePath)];
        
        // 모듈 로드 시도
        const module = require(modulePath);
        
        // 모듈 초기화 함수 확인
        if (typeof module.init !== 'function') {
            this.log('ERROR', `모듈 ${file}에 init 함수가 없습니다.`);
            this.moduleLoadingState.failedModules.add(file);
            return false;
        }
        
        try {
            // 모듈 초기화 시도
            await module.init(this.client, this.log.bind(this));
            
            // 모듈 명령어 추가
            if (module.commands) {
                for (const [name, command] of Object.entries(module.commands)) {
                    this.client.commands.set(name, command);
                }
            }
            
            // 모듈 컬렉션에 추가
            this.client.modules.set(file, module);
            this.moduleLoadingState.loadedModules.add(file);
            this.log('MODULE', `모듈 ${file}을(를) 성공적으로 로드했습니다.`);
            return true;
        } catch (initError) {
            // 추가: 저장소 파일 자동 생성 처리
            if (initError.message.includes('저장소 파일') && initError.message.includes('존재하지 않습니다')) {
                const missingStoreMatch = initError.message.match(/저장소 파일 ([a-zA-Z0-9-_]+)이\(가\) 존재하지 않습니다/);
                if (missingStoreMatch && missingStoreMatch[1]) {
                    const missingStore = missingStoreMatch[1];
                    this.log('INFO', `모듈 ${file}에 필요한 저장소 ${missingStore}가 없어 생성합니다.`);
                    
                    // 저장소에 빈 객체 저장
                    await storage.setAll(missingStore, {});
                    await storage.save(missingStore);
                    
                    // 모듈 다시 초기화 시도
                    try {
                        await module.init(this.client, this.log.bind(this));
                        
                        // 모듈 명령어 추가
                        if (module.commands) {
                            for (const [name, command] of Object.entries(module.commands)) {
                                this.client.commands.set(name, command);
                            }
                        }
                        
                        // 모듈 컬렉션에 추가
                        this.client.modules.set(file, module);
                        this.moduleLoadingState.loadedModules.add(file);
                        this.log('MODULE', `모듈 ${file}을(를) 성공적으로 로드했습니다.`);
                        return true;
                    } catch (retryError) {
                        this.log('ERROR', `저장소 생성 후에도 모듈 ${file} 초기화 실패: ${retryError.message}`);
                        this.moduleLoadingState.failedModules.add(file);
                        return false;
                    }
                }
            }
            
            // 스토리지 관련 오류 처리 
            if (this._isStorageDependencyError(initError)) {
                return await this._handleStorageDependency(file, module, initError);
            }
            
            // 기타 오류는 실패 처리
            this.log('ERROR', `모듈 ${file} 초기화 중 오류 발생: ${initError.message}`);
            this.moduleLoadingState.failedModules.add(file);
            return false;
        }
    } catch (error) {
        this.log('ERROR', `모듈 ${file} 로드 중 오류 발생: ${error.message}`);
        this.moduleLoadingState.failedModules.add(file);
        return false;
    }
}
    
    // 스토리지 의존성 오류 확인
    _isStorageDependencyError(error) {
        const errorMessage = error.message.toLowerCase();
        return errorMessage.includes('storage') || 
               errorMessage.includes('저장소') || 
               errorMessage.includes('undefined') || 
               errorMessage.includes('not found') ||
               errorMessage.includes('not initialized');
    }
    
    // 스토리지 의존성 문제 처리
    async _handleStorageDependency(file, module, error) {
        // 스토리지 키 추출 시도
        const storageKeyMatch = error.message.match(/저장소 파일 ([a-zA-Z0-9-_]+)이\(가\) 존재하지 않습니다/) || 
                               error.message.match(/([a-zA-Z0-9-_]+)-config not found/);
        
        let storageKey = null;
        
        if (storageKeyMatch && storageKeyMatch[1]) {
            storageKey = storageKeyMatch[1];
        } else if (file.includes('-')) {
            // 파일 이름에서 키 추측 (예: vacation-system.js -> vacation-system-config)
            storageKey = file.replace('.js', '-config');
        }
        
        if (storageKey) {
            try {
                // 빈 저장소 생성
                await storage.setAll(storageKey, {});
                await storage.save(storageKey);
                this.log('INFO', `모듈 ${file}를 위한 저장소 ${storageKey}를 생성했습니다.`);
                
                // 모듈 다시 초기화 시도
                await module.init(this.client, this.log.bind(this));
                this.client.modules.set(file, module);
                this.moduleLoadingState.loadedModules.add(file);
                this.log('MODULE', `모듈 ${file}을(를) 다시 로드했습니다.`);
                return true;
            } catch (storageError) {
                this.log('ERROR', `모듈 ${file}의 저장소 생성 중 오류: ${storageError.message}`);
                this.moduleLoadingState.failedModules.add(file);
                return false;
            }
        } else {
            // 의존성 문제로 보류
            const retryCount = this.moduleLoadingState.retryCount.get(file) || 0;
            if (retryCount < 3) { // 최대 3번까지 재시도
                this.moduleLoadingState.retryCount.set(file, retryCount + 1);
                this.moduleLoadingState.pendingDependencies.set(file, module);
                this.log('WARN', `모듈 ${file} 로딩이 의존성 문제로 보류됩니다. 나중에 재시도합니다.`);
                return false;
            } else {
                this.log('ERROR', `모듈 ${file} 로딩 실패 (최대 재시도 횟수 초과): ${error.message}`);
                this.moduleLoadingState.failedModules.add(file);
                return false;
            }
        }
    }
    
    // 실패한 모듈 재시도
    async _retryFailedModules() {
        if (this.moduleLoadingState.pendingDependencies.size === 0) {
            return; // 재시도할 모듈 없음
        }
        
        this.log('INFO', `의존성 문제로 지연된 모듈 ${this.moduleLoadingState.pendingDependencies.size}개를 재시도합니다.`);
        
        // 모든 보류 중인 모듈 재시도
        for (const [file, module] of this.moduleLoadingState.pendingDependencies.entries()) {
            try {
                await module.init(this.client, this.log.bind(this));
                
                // 모듈 명령어 추가
                if (module.commands) {
                    for (const [name, command] of Object.entries(module.commands)) {
                        this.client.commands.set(name, command);
                    }
                }
                
                // 모듈 컬렉션에 추가
                this.client.modules.set(file, module);
                this.moduleLoadingState.loadedModules.add(file);
                this.moduleLoadingState.pendingDependencies.delete(file);
                this.log('MODULE', `지연 로드된 모듈 ${file}을(를) 성공적으로 로드했습니다.`);
            } catch (error) {
                this.log('ERROR', `모듈 ${file} 재시도 중 오류 발생: ${error.message}`);
                this.moduleLoadingState.failedModules.add(file);
                this.moduleLoadingState.pendingDependencies.delete(file);
            }
        }
    }
    
    // 슬래시 커맨드 등록 함수
    async registerSlashCommands() {
        try {
            // 봇이 준비되지 않았으면 취소
            if (!this.client.user) {
                this.log('WARN', '봇이 준비되지 않아 슬래시 커맨드를 등록할 수 없습니다.');
                return;
            }
            
            const rest = new REST({ version: '10' }).setToken(config.token);
            const commands = [];
            
            // 각 모듈의 슬래시 커맨드 수집
            for (const [moduleName, module] of this.client.modules.entries()) {
                // 비활성화된 모듈의 명령어는 건너뜀
                if (module.enabled === false) {
                    this.log('INFO', `모듈 ${moduleName}이(가) 비활성화되어 있어 슬래시 커맨드를 등록하지 않습니다.`);
                    continue;
                }
                
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
    
    // 모듈 상태 가져오기 함수
    getModuleStatus(detailed = true) {
        if (!detailed) {
            // 가벼운 버전 반환
            const lightModuleStatus = {};
            for (const [fileName, module] of this.client.modules.entries()) {
                lightModuleStatus[fileName] = {
                    name: module.name || fileName,
                    enabled: module.enabled !== false
                };
            }
            return lightModuleStatus;
        }
        
        // 상세 정보 버전 반환
        const moduleStatus = {};
        
        for (const [fileName, module] of this.client.modules.entries()) {
            moduleStatus[fileName] = {
                name: module.name || fileName,
                description: module.description || '설명 없음',
                version: module.version || '1.0.0',
                enabled: module.enabled !== false,
                commands: module.commands ? Array.isArray(module.commands) 
                    ? module.commands 
                    : Object.keys(module.commands) : []
            };
        }
        
        return moduleStatus;
    }
    
    // 모듈 활성화/비활성화/리로드
    async moduleAction(action, moduleName) {
        if (!this.client.modules.has(moduleName)) {
            throw new Error(`모듈 ${moduleName}을(를) 찾을 수 없습니다.`);
        }
        
        const module = this.client.modules.get(moduleName);
        
        switch (action) {
            case 'enable':
                module.enabled = true;
                this.log('MODULE', `모듈 ${moduleName}이(가) 활성화되었습니다.`);
                
                // 활성화된 모듈의 슬래시 커맨드 등록
                if (module.slashCommands && Array.isArray(module.slashCommands)) {
                    module.slashCommands.forEach(cmd => {
                        this.client.slashCommands.set(cmd.name, { module, command: cmd });
                    });
                }
                
                // 슬래시 커맨드 재등록
                await this.registerSlashCommands();
                
                // 상태 업데이트
                this._updateBotStatus();
                
                return true;
                
            case 'disable':
                module.enabled = false;
                this.log('MODULE', `모듈 ${moduleName}이(가) 비활성화되었습니다.`);
                
                // 비활성화된 모듈의 슬래시 커맨드 제거
                if (module.slashCommands) {
                    module.slashCommands.forEach(cmd => {
                        this.client.slashCommands.delete(cmd.name);
                    });
                }
                
                // 슬래시 커맨드 재등록
                await this.registerSlashCommands();
                
                // 상태 업데이트
                this._updateBotStatus();
                
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
                try {
                    const newModule = require(modulePath);
                    await newModule.init(this.client, this.log.bind(this));
                    
                    // 새 명령어 등록
                    if (newModule.commands) {
                        for (const [name, command] of Object.entries(newModule.commands)) {
                            this.client.commands.set(name, command);
                        }
                    }
                    
                    // 활성화 상태 유지
                    newModule.enabled = module.enabled;
                    
                    // 모듈 업데이트
                    this.client.modules.set(moduleName, newModule);
                    this.log('MODULE', `모듈 ${moduleName}이(가) 다시 로드되었습니다.`);
                    
                    // 슬래시 명령어 재등록
                    await this.registerSlashCommands();
                    
                    // 상태 업데이트
                    this._updateBotStatus();
                    
                    return true;
                } catch (error) {
                    // 모듈 재로드 실패 시 기존 모듈 유지
                    this.log('ERROR', `모듈 ${moduleName} 재로드 실패: ${error.message}`);
                    
                    // 이전 모듈 복원
                    this.client.modules.set(moduleName, module);
                    
                    // 이전 명령어 다시 등록
                    if (module.commands) {
                        for (const [name, command] of Object.entries(module.commands)) {
                            this.client.commands.set(name, command);
                        }
                    }
                    
                    // 이전 슬래시 명령어 다시 등록
                    if (module.slashCommands) {
                        module.slashCommands.forEach(cmd => {
                            this.client.slashCommands.set(cmd.name, { module, command: cmd });
                        });
                    }
                    
                    throw error; // 오류 전파
                }
                
                break;
                
            default:
                throw new Error(`알 수 없는 모듈 작업: ${action}`);
        }
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
    
    // 봇 시작 함수 - 중복 시작 방지 및 에러 처리 개선
    async start() {
        if (this.status.isRunning) {
            console.log('봇이 이미 실행 중입니다.');
            return true; // 이미 실행 중인 경우 성공으로 간주
        }
        
        // 저장소 초기화
        await this._ensureStorageInitialized();
        
        this.status.startTime = new Date();
        
        this.log('INFO', '봇을 시작합니다...');
        
        try {
            await this.client.login(config.token);
            this.status.isRunning = true;
            this.log('INFO', '디스코드에 로그인했습니다.');
            return true;
        } catch (error) {
            this.status.isRunning = false;
            this.status.startTime = null;
            this.log('ERROR', `로그인 중 오류 발생: ${error.message}`);
            throw error;
        }
    }
    
    // 봇 종료 함수 - 중복 종료 방지 및 에러 처리 개선
    async stop() {
        if (!this.status.isRunning) {
            console.log('봇이 실행 중이 아닙니다.');
            return true; // 이미 종료된 경우 성공으로 간주
        }
        
        this.log('INFO', '봇을 종료합니다...');
        
        try {
            // 데이터 저장
            if (storage.initialized) {
                try {
                    await storage.saveAll();
                    this.log('INFO', '모든 모듈 데이터가 저장되었습니다.');
                } catch (storageError) {
                    this.log('ERROR', `종료 전 데이터 저장 중 오류 발생: ${storageError.message}`);
                    // 저장 오류가 있어도 봇은 종료 진행
                }
            }
            
            // 봇 종료 설정
            this.status.isRunning = false;
            this.status.startTime = null;
            
            // 클라이언트 종료
            await this.client.destroy();
            
            this.log('INFO', '봇이 종료되었습니다.');
            return true;
        } catch (error) {
            // 종료 중 오류가 발생했지만 상태는 비활성화로 설정
            this.status.isRunning = false;
            this.status.startTime = null;
            this.log('ERROR', `봇 종료 중 오류 발생: ${error.message}`);
            throw error;
        }
    }
    
    // 봇 재시작 함수 - 에러 처리 개선
    async restart() {
        this.log('INFO', '봇을 재시작합니다...');
        
        try {
            // 봇이 실행 중이 아니면 바로 시작
            if (!this.status.isRunning) {
                return await this.start();
            }
            
            // 봇 종료 시도
            await this.stop();
            
            // 재시작 대기
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 봇 시작 시도
            return await this.start();
        } catch (error) {
            this.log('ERROR', `봇 재시작 중 오류 발생: ${error.message}`);
            this.status.isRunning = false;
            this.status.startTime = null;
            return false;
        }
    }
    
    // 상태 가져오기 함수 - 개선된 버전
    getStatus() {
        return {
            isRunning: this.status.isRunning,
            uptime: this.getUptime(),
            servers: this.status.guilds,
            modules: this.status.modules,
            logs: this.status.logs,
            moduleStatus: this.getModuleStatus(false), // 기본은 간단한 버전
            moduleLoadState: {
                loaded: this.moduleLoadingState.loadedModules.size,
                failed: this.moduleLoadingState.failedModules.size,
                pending: this.moduleLoadingState.pendingDependencies.size
            }
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

// 인스턴스 생성
const botInstance = new DiscordBot();
module.exports = botInstance;