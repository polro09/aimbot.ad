// modules/voice-channel-manager.js - 음성 채널 자동 생성 및 관리 모듈
// 버전 1.5.1 - AFK 채널 자동 삭제 및 채널 이름 변경 문제 수정
// 수정된 사항:
// 1. 채널 이름 변경 시 "생각 중" 상태로 멈추는 문제 해결
// 2. AFK 채널이 비어 있을 때 제대로 삭제되지 않는 문제 개선
const logger = require('../utils/logger');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, StringSelectMenuBuilder } = require('discord.js');
const storage = require('../storage');

// 스토리지 키
const STORAGE_KEY = 'voice-channels-config';
const VOICE_DATA_KEY = 'voice_channels'; // 기존 데이터와의 호환성 유지

// 생성된 음성 채널 추적 맵
// Map<guildId, Map<parentChannelId, Array<createdChannelId>>>
const createdChannels = new Map();

// 부모 채널 설정 맵 (자동 생성 대상 채널)
// Map<guildId, Array<parentChannelId>>
const parentChannels = new Map();

// 사용자별 채널 소유 정보
// Map<channelId, {ownerId, createdAt, roomType, lastInteraction}>
const channelOwnership = new Map();

// 소유자 이전 대기 목록
// Map<channelId, Set<userId>> - 채널 ID별 이전 요청 목록
const transferRequests = new Map();

// 권한 변경 작업 진행 중인 채널 트래킹
const pendingPermissionUpdates = new Set();

// 상호작용 처리 중인 사용자 추적
// Map<userId, Map<channelId, timestamp>>
const pendingInteractions = new Map();

// AFK 채널 추적 맵
// Map<guildId, {channelId, isEmpty, lastEmptyTime}>
const afkChannels = new Map();

// 사용자 활동 시간 추적
// Map<userId, timestamp>
const userActivityTimestamps = new Map();

// 채널 상호작용 마지막 타임스탬프
// Map<channelId, timestamp>
const channelLastInteraction = new Map();

// 채널 이름 변경 작업 추적 (동시 이름 변경 제한)
// Map<channelId, {inProgress: boolean, timestamp: number, userId: string}>
const channelRenameOperations = new Map();

// 비활성 감지 간격 (10분)
const INACTIVITY_CHECK_INTERVAL = 10 * 60 * 1000;

// 비활성 판단 기준 (30분)
const INACTIVITY_THRESHOLD = 30 * 60 * 1000;

// 상호작용 타임아웃 (10초)
const INTERACTION_TIMEOUT = 10 * 1000;

// AFK 채널 삭제 타임아웃 (15분 비어있는 상태)
const AFK_DELETION_TIMEOUT = 15 * 60 * 1000;

// 채널 이름 변경 작업 타임아웃 (60초)
const RENAME_TIMEOUT = 60 * 1000;

// 오류 로그 추적 (최근 10개)
const errorLogs = [];
const MAX_ERROR_LOGS = 10;

// 통화방 유형 및 이름 포맷
const ROOM_TYPES = {
    'default': {
        emoji: '🔊',
        format: name => `🔊 ${name}의 룸`,
        image: 'https://i.imgur.com/6YToyEF.png'
    },
    'freetalk': {
        emoji: '🔋',
        format: name => `🔋ㅣ${name}의 일반대화`,
        image: 'https://i.imgur.com/JKgZnul.png'
    },
    'hunting': {
        emoji: '🏹', 
        format: name => `🏹ㅣ${name}의 사냥파티`,
        image: 'https://i.imgur.com/iWkAeRs.png'
    },
    'trading': {
        emoji: '🪙',
        format: name => `🪙ㅣ${name}의 교역파티`,
        image: 'https://i.imgur.com/NdXQMgk.png'
    },
    'study': {
        emoji: '🎓',
        format: name => `🎓ㅣ${name}의 스터디룸`,
        image: 'https://i.imgur.com/ItKD2V2.png'
    },
    'music': {
        emoji: '🎶',
        format: name => `🎶ㅣ${name}의 뮤직룸`,
        image: 'https://i.imgur.com/GJcXxWP.png'
    },
    'afk': {
        emoji: '🪫',
        format: () => `🪫ㅣAFK`,
        image: 'https://i.imgur.com/yj8LcTn.png'
    }
};

/**
 * 오류 로그 추가
 * @param {string} source 오류 발생 위치
 * @param {string} message 오류 메시지
 * @param {Object} [details] 추가 세부 정보
 */
function addErrorLog(source, message, details = {}) {
    const errorLog = {
        timestamp: new Date(),
        source,
        message,
        details
    };
    
    errorLogs.unshift(errorLog);
    
    if (errorLogs.length > MAX_ERROR_LOGS) {
        errorLogs.pop();
    }
    
    return errorLog;
}

/**
 * 진행 중인 상호작용 추적 - 개선된 버전
 * @param {string} userId 사용자 ID
 * @param {string} channelId 채널 ID
 * @param {string} actionType 액션 타입 (선택적)
 * @returns {boolean} 이미 진행 중인지 여부
 */
function trackInteraction(userId, channelId, actionType = '') {
    if (!userId || !channelId) return false;
    
    const now = Date.now();
    const interactionKey = `${channelId}:${actionType}`;
    
    // 사용자별 상호작용 맵 가져오기
    let userInteractions = pendingInteractions.get(userId);
    if (!userInteractions) {
        userInteractions = new Map();
        pendingInteractions.set(userId, userInteractions);
    }
    
    // 이미 진행 중인 상호작용이 있는지 확인
    if (userInteractions.has(interactionKey)) {
        const lastTime = userInteractions.get(interactionKey);
        
        // 10초 이내에 동일한 상호작용이 있으면 중복으로 간주
        if (now - lastTime < INTERACTION_TIMEOUT) {
            return true;
        }
    }
    
    // 상호작용 기록
    userInteractions.set(interactionKey, now);
    
    // 채널 마지막 상호작용 시간 업데이트
    channelLastInteraction.set(channelId, now);
    
    // 해당 채널의 소유권 정보에도 마지막 상호작용 시간 업데이트
    const ownerData = channelOwnership.get(channelId);
    if (ownerData) {
        ownerData.lastInteraction = now;
    }
    
    // 10초 후 자동 제거
    setTimeout(() => {
        const interactions = pendingInteractions.get(userId);
        if (interactions) {
            interactions.delete(interactionKey);
            if (interactions.size === 0) {
                pendingInteractions.delete(userId);
            }
        }
    }, INTERACTION_TIMEOUT);
    
    return false;
}

/**
 * 채널 이름 변경 작업 추적 - 새로 추가된 함수
 * @param {string} channelId 채널 ID
 * @param {string} userId 사용자 ID
 * @returns {boolean} 작업 상태 (true: 진행 중인 작업 없음, false: 이미 진행 중)
 */
function trackRenameOperation(channelId, userId) {
    if (!channelId) return false;
    
    const now = Date.now();
    
    // 이미 진행 중인 이름 변경 작업이 있는지 확인
    if (channelRenameOperations.has(channelId)) {
        const operation = channelRenameOperations.get(channelId);
        
        // 작업이 진행 중이고 일정 시간(60초) 이내인 경우
        if (operation.inProgress && now - operation.timestamp < RENAME_TIMEOUT) {
            // 동일한 사용자가 요청한 경우에만 허용
            if (operation.userId === userId) {
                // 타임스탬프 갱신
                operation.timestamp = now;
                channelRenameOperations.set(channelId, operation);
                return true;
            }
            return false; // 다른 사용자가 변경 중이면 거부
        }
    }
    
    // 새 작업 등록
    channelRenameOperations.set(channelId, {
        inProgress: true,
        timestamp: now,
        userId
    });
    
    // 일정 시간 후 자동 정리
    setTimeout(() => {
        const operation = channelRenameOperations.get(channelId);
        if (operation && operation.timestamp === now) {
            // 작업 완료 표시
            operation.inProgress = false;
            channelRenameOperations.set(channelId, operation);
        }
    }, RENAME_TIMEOUT);
    
    return true;
}

/**
 * 채널 이름 변경 작업 완료 표시
 * @param {string} channelId 채널 ID
 */
function completeRenameOperation(channelId) {
    if (channelRenameOperations.has(channelId)) {
        const operation = channelRenameOperations.get(channelId);
        operation.inProgress = false;
        channelRenameOperations.set(channelId, operation);
    }
}

// 설정 저장
async function saveConfig(log) {
    try {
        // 설정 데이터 생성
        const configData = {};
        for (const [guildId, channelIds] of parentChannels.entries()) {
            configData[guildId] = channelIds;
        }
        
        // 스토리지에 저장
        storage.setAll(STORAGE_KEY, configData);
        await storage.save(STORAGE_KEY);
        
        // 추적 중인 채널 데이터도 저장 (호환성)
        const voiceData = {};
        for (const [guildId, channels] of createdChannels.entries()) {
            const channelIds = [];
            
            for (const [parentId, childChannels] of channels.entries()) {
                channelIds.push(...childChannels);
            }
            
            if (channelIds.length > 0) {
                voiceData[guildId] = [...new Set(channelIds)]; // 중복 제거
            }
        }
        
        storage.setAll(VOICE_DATA_KEY, voiceData);
        await storage.save(VOICE_DATA_KEY);
        
        return true;
    } catch (error) {
        if (log) log('ERROR', `음성 채널 설정 저장 중 오류: ${error.message}`);
        addErrorLog('saveConfig', error.message, { stack: error.stack });
        return false;
    }
}

// 설정 불러오기
async function loadConfig(log) {
    try {
        // 자동 생성 설정 불러오기
        try {
            await storage.load(STORAGE_KEY);
            const configData = storage.getAll(STORAGE_KEY);
            
            // 데이터 적용
            for (const [guildId, channelIds] of Object.entries(configData)) {
                if (Array.isArray(channelIds)) {
                    parentChannels.set(guildId, channelIds);
                }
            }
        } catch (configError) {
            if (log) log('WARN', `음성 채널 설정 로드 중 오류 (새 파일 생성됨): ${configError.message}`);
            await storage.ensureStorage(STORAGE_KEY, {});
        }
        
        // 기존 트래킹 데이터 불러오기 (호환성)
        try {
            await storage.load(VOICE_DATA_KEY);
            const voiceData = storage.getAll(VOICE_DATA_KEY);
            
            for (const [guildId, channelIds] of Object.entries(voiceData)) {
                if (!Array.isArray(channelIds) || channelIds.length === 0) continue;
                
                // 임시로 첫 번째 부모 채널 ID 사용 (실제 부모를 알 수 없음)
                const parentIds = parentChannels.get(guildId) || [];
                const parentId = parentIds.length > 0 ? parentIds[0] : 'unknown';
                
                const guildChannels = createdChannels.get(guildId) || new Map();
                guildChannels.set(parentId, channelIds);
                createdChannels.set(guildId, guildChannels);
            }
        } catch (voiceError) {
            if (log) log('WARN', `음성 채널 데이터 로드 중 오류 (새 파일 생성됨): ${voiceError.message}`);
            await storage.ensureStorage(VOICE_DATA_KEY, {});
        }
        
        if (log) log('INFO', '음성 채널 자동 생성 설정을 로드했습니다.');
        return true;
    } catch (error) {
        if (log) log('ERROR', `음성 채널 설정 로드 중 오류: ${error.message}`);
        addErrorLog('loadConfig', error.message, { stack: error.stack });
        return false;
    }
}

// AFK 채널 정리 함수 - 개선된 버전
async function cleanupAfkChannels(client, log) {
    const now = Date.now();
    
    // 모든 AFK 채널 확인
    for (const [guildId, afkData] of [...afkChannels.entries()]) { // 복사본으로 반복 (삭제 중 Map 변경 방지)
        try {
            if (!afkData || !afkData.channelId) {
                // 유효하지 않은 데이터는 목록에서 제거
                afkChannels.delete(guildId);
                continue;
            }
            
            // 길드 가져오기
            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                // 서버를 찾을 수 없으면 목록에서 제거
                afkChannels.delete(guildId);
                if (log) log('INFO', `서버 ${guildId}를 찾을 수 없어 AFK 채널 추적에서 제거합니다.`);
                continue;
            }
            
            // 채널 가져오기 - API 호출로 최신 정보 확인
            const channel = await guild.channels.fetch(afkData.channelId).catch(() => null);
            if (!channel) {
                // 채널이 이미 삭제되었으면 목록에서 제거
                afkChannels.delete(guildId);
                if (log) log('INFO', `AFK 채널 ${afkData.channelId}가 이미 삭제되어 추적에서 제거합니다.`);
                continue;
            }
            
            // 채널이 비어있는지 확인 - 최신 정보 확인
            const isEmpty = channel.members.size === 0;
            
            // 상태 업데이트
            if (isEmpty && !afkData.isEmpty) {
                // 빈 상태로 변경됨
                afkData.isEmpty = true;
                afkData.lastEmptyTime = now;
                afkChannels.set(guildId, afkData);
                
                if (log) log('INFO', `AFK 채널 ${channel.name} (${afkData.channelId})이(가) 비어 있음. 15분 후 삭제 예정.`);
            } 
            else if (!isEmpty && afkData.isEmpty) {
                // 사용 중 상태로 변경됨
                afkData.isEmpty = false;
                afkData.lastEmptyTime = null;
                afkChannels.set(guildId, afkData);
                
                if (log) log('INFO', `AFK 채널 ${channel.name} (${afkData.channelId})에 사용자가 입장했습니다. 삭제가 취소되었습니다.`);
            }
            else if (isEmpty && afkData.isEmpty && afkData.lastEmptyTime) {
                // 비어있는 시간 확인
                const emptyDuration = now - afkData.lastEmptyTime;
                
                // 15분 이상 비어있으면 삭제
                if (emptyDuration >= AFK_DELETION_TIMEOUT) {
                    if (log) log('INFO', `AFK 채널 ${channel.name} (${afkData.channelId})이(가) ${Math.floor(emptyDuration / 60000)}분 동안 비어 있어 삭제합니다.`);
                    
                    try {
                        // Promise.race를 사용하여 타임아웃 설정 (10초)
                        const deletePromise = channel.delete('비어 있는 AFK 채널 자동 정리');
                        const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('채널 삭제 작업이 시간 초과되었습니다.')), 10000)
                        );
                        
                        await Promise.race([deletePromise, timeoutPromise]);
                        
                        // 삭제 성공 후 추적 정보 정리
                        afkChannels.delete(guildId);
                        
                        // 추적 목록에서도 제거
                        removeCreatedChannel(guildId, afkData.channelId);
                        channelOwnership.delete(afkData.channelId);
                        channelRenameOperations.delete(afkData.channelId);
                        transferRequests.delete(afkData.channelId);
                        channelLastInteraction.delete(afkData.channelId);
                        
                        if (log) log('INFO', `AFK 채널 ${afkData.channelId}이(가) 성공적으로 삭제되었습니다.`);
                    } catch (deleteError) {
                        if (log) log('ERROR', `AFK 채널 삭제 중 오류: ${deleteError.message}`);
                        addErrorLog('cleanupAfkChannels', deleteError.message, {
                            guildId,
                            channelId: afkData.channelId
                        });
                        
                        // 오류 발생 시 재시도를 위해 마지막 빈 시간 초기화
                        afkData.lastEmptyTime = now;
                        afkChannels.set(guildId, afkData);
                    }
                } else {
                    // 남은 시간 로깅 (5분 간격으로)
                    const remainingMinutes = Math.ceil((AFK_DELETION_TIMEOUT - emptyDuration) / 60000);
                    if (remainingMinutes % 5 === 0 || remainingMinutes <= 2) {
                        if (log) log('INFO', `AFK 채널 ${channel.name} (${afkData.channelId}) 삭제까지 약 ${remainingMinutes}분 남았습니다.`);
                    }
                }
            }
        } catch (error) {
            if (log) log('ERROR', `AFK 채널 정리 중 오류: ${error.message}`);
            addErrorLog('cleanupAfkChannels', error.message, { 
                guildId,
                channelId: afkData ? afkData.channelId : 'unknown'
            });
            
            // 오류 발생 시 해당 AFK 채널 추적 정보 정리 (3회 이상 오류 발생 시)
            const errorCount = (afkData.errorCount || 0) + 1;
            if (errorCount >= 3) {
                if (log) log('WARN', `AFK 채널 ${afkData.channelId} 정리 실패가 3회 이상 발생하여 추적에서 제거합니다.`);
                afkChannels.delete(guildId);
            } else {
                // 오류 카운트 증가
                afkData.errorCount = errorCount;
                afkChannels.set(guildId, afkData);
            }
        }
    }
}

// 모듈 초기화 함수
async function init(client, log) {
    // 스토리지 초기화
    try {
        if (!storage.initialized) {
            await storage.init(log);
        }
        
        // 설정 로드
        await loadConfig(log);
    } catch (storageError) {
        log('ERROR', `스토리지 초기화 중 오류: ${storageError.message}`);
        addErrorLog('init', storageError.message, { stack: storageError.stack });
    }
    
    // 음성 상태 업데이트 이벤트 처리
    client.on('voiceStateUpdate', async (oldState, newState) => {
        try {
            const guildId = newState.guild.id;
            
            // 해당 서버에 자동 생성 채널이 설정되어 있는지 확인
            const autoCreateChannels = parentChannels.get(guildId);
            if (!autoCreateChannels || autoCreateChannels.length === 0) return;
            
            // 1. 사용자가 음성 채널에 입장한 경우
            if (newState.channelId && (!oldState.channelId || oldState.channelId !== newState.channelId)) {
                // 사용자 활동 시간 업데이트
                userActivityTimestamps.set(newState.member.id, Date.now());
                
                // 입장한 채널이 부모 채널인지 확인
                if (autoCreateChannels.includes(newState.channelId)) {
                    await handleUserJoinParentChannel(newState, client, log);
                }
                
                // 음성 채널 입장 이벤트 처리 (소유자 자동 이전 용)
                await handleUserJoinChannel(newState, client, log);
            }
            
            // 2. 사용자가 음성 채널에서 퇴장한 경우
            if (oldState.channelId && (!newState.channelId || oldState.channelId !== newState.channelId)) {
                // 퇴장한 채널이 생성된 채널인지 확인
                await cleanupEmptyChannels(oldState, log);
                
                // 소유자가 퇴장했는지 확인하고 필요 시 소유권 이전
                await handleOwnerLeftChannel(oldState, client, log);
                
                // 사용자 활동 추적에서 제거 (퇴장했으므로)
                if (!newState.channelId) {
                    userActivityTimestamps.delete(oldState.member.id);
                }
            }
            
            // 3. 사용자가 여전히 채널에 있는 경우 - 활동 시간 업데이트
            if (newState.channelId) {
                // 사용자가 음성 채널 내에서 마이크나 헤드셋 상태를 변경하면 활동 중으로 간주
                if (oldState.mute !== newState.mute || 
                    oldState.deaf !== newState.deaf || 
                    oldState.streaming !== newState.streaming ||
                    oldState.selfVideo !== newState.selfVideo) {
                    userActivityTimestamps.set(newState.member.id, Date.now());
                }
            }
        } catch (error) {
            log('ERROR', `음성 채널 자동 생성 처리 중 오류 발생: ${error.message}`);
            addErrorLog('voiceStateUpdate', error.message, { 
                stack: error.stack,
                oldState: { channelId: oldState.channelId, guildId: oldState.guild?.id },
                newState: { channelId: newState.channelId, guildId: newState.guild?.id }
            });
        }
    });
    
    // 메시지 생성 이벤트 처리 (사용자 활동 감지)
    client.on('messageCreate', (message) => {
        // 봇 메시지 무시
        if (message.author.bot) return;
        
        // 메시지 작성 시 활동 시간 업데이트
        userActivityTimestamps.set(message.author.id, Date.now());
    });
    
    // 버튼 및 선택 메뉴 상호작용 처리 - 개선된 UI 처리
    client.on('interactionCreate', async (interaction) => {
        // 버튼, 모달 제출, 또는 문자열 선택 메뉴만 처리
        if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;
        
        try {
            // 상호작용 시 활동 시간 업데이트
            userActivityTimestamps.set(interaction.user.id, Date.now());
            
            if (interaction.isButton()) {
                const [action, channelId] = interaction.customId.split(':');
                
                // 중복 상호작용 확인 - 버튼 (액션 타입 포함)
                if (trackInteraction(interaction.user.id, channelId, `button:${action}`)) {
                    return await interaction.deferUpdate().catch(() => {});
                }
                
                switch (action) {
                    case 'rename_channel':
                        await showRenameModal(interaction, channelId);
                        break;
                    case 'request_ownership':
                        await handleOwnershipRequest(interaction, channelId, client);
                        break;
                    case 'confirm_close_channel':
                        await handleChannelClose(interaction, channelId, client, log);
                        break;
                    case 'cancel_close_channel':
                        await handleCancelClose(interaction, channelId, log);
                        break;
                }
            } else if (interaction.isModalSubmit() && interaction.customId.startsWith('rename_modal:')) {
                const channelId = interaction.customId.split(':')[1];
                
                // 중복 상호작용 확인 - 모달 (모달 유형 포함)
                if (trackInteraction(interaction.user.id, channelId, 'modal:rename')) {
                    return await interaction.deferUpdate().catch(() => {});
                }
                
                // 채널 이름 변경 작업 추적 - 동시 변경 방지
                if (!trackRenameOperation(channelId, interaction.user.id)) {
                    return await interaction.reply({
                        content: '다른 이름 변경 작업이 이미 진행 중입니다. 잠시 후 다시 시도해주세요.',
                        ephemeral: true
                    });
                }
                
                try {
                    await renameChannel(interaction, channelId, client, log);
                } catch (error) {
                    // 이름 변경 작업 완료 표시 (오류가 발생해도)
                    completeRenameOperation(channelId);
                    throw error; // 오류 전파
                }
            } else if (interaction.isStringSelectMenu()) {
                const customId = interaction.customId;
                
                if (customId.startsWith('voice_room_actions:')) {
                    const channelId = customId.split(':')[1];
                    const selectedAction = interaction.values[0];
                    
                    // 액션 식별자 추출 (선택 메뉴 아이템마다 고유한 추적을 위해)
                    const actionType = selectedAction.split(':')[0];
                    
                    // 중복 상호작용 확인 - 선택 메뉴 (액션 타입 포함)
                    if (trackInteraction(interaction.user.id, channelId, `select:${actionType}`)) {
                        return await interaction.deferUpdate().catch(() => {});
                    }
                    
                    if (selectedAction.startsWith('rename_channel')) {
                        await showRenameModal(interaction, channelId);
                    } else if (selectedAction.startsWith('transfer_ownership')) {
                        await showTransferOwnershipMenu(interaction, channelId, client);
                    } else if (selectedAction.startsWith('view_info')) {
                        await showChannelInfo(interaction, channelId, client);
                    } else if (selectedAction.startsWith('room_type:')) {
                        const roomType = selectedAction.split(':')[1];
                        
                        // 채널 이름 변경 작업 추적 - 동시 변경 방지
                        if (!trackRenameOperation(channelId, interaction.user.id)) {
                            return await interaction.reply({
                                content: '다른 이름 변경 작업이 이미 진행 중입니다. 잠시 후 다시 시도해주세요.',
                                ephemeral: true
                            });
                        }
                        
                        await handleRoomTypeSelection(interaction, channelId, roomType, client, log);
                    } else if (selectedAction === 'close_channel') {
                        await confirmCloseChannel(interaction, channelId, log);
                    }
                } else if (customId.startsWith('transfer_owner:')) {
                    const channelId = customId.split(':')[1];
                    
                    // 중복 상호작용 확인 - 소유권 이전 (특정 사용자 선택 무시)
                    if (trackInteraction(interaction.user.id, channelId, 'transfer')) {
                        return await interaction.deferUpdate().catch(() => {});
                    }
                    
                    await transferOwnership(interaction, channelId, client, log);
                }
            }
        } catch (error) {
            log('ERROR', `버튼 상호작용 처리 중 오류 발생: ${error.message}`);
            addErrorLog('interactionCreate', error.message, { 
                stack: error.stack,
                interactionType: interaction.type,
                customId: interaction.customId
            });
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ 
                        content: '요청을 처리하는 동안 오류가 발생했습니다. 나중에 다시 시도해주세요.',
                        ephemeral: true 
                    });
                } else if (interaction.deferred) {
                    await interaction.editReply({
                        content: '요청을 처리하는 동안 오류가 발생했습니다. 나중에 다시 시도해주세요.'
                    });
                }
            } catch (e) {
                // 이미 응답했거나 처리할 수 없는 경우 무시
            }
        }
    });
    
    // 봇 시작 시 모든 서버의 빈 자동 생성 채널 정리
client.once('ready', async () => {
    try {
        for (const guild of client.guilds.cache.values()) {
            try {
                const guildCreatedChannels = getCreatedChannelsForGuild(guild.id);
                if (!guildCreatedChannels) continue;
                
                for (const [parentId, channelIds] of guildCreatedChannels.entries()) {
                    for (const channelId of [...channelIds]) { // 복사본 사용하여 반복 중 삭제 문제 방지
                        try {
                            // API에서 채널 최신 정보 가져오기 (캐시 대신)
                            const channel = await guild.channels.fetch(channelId).catch(() => null);
                            if (!channel) {
                                // 존재하지 않는 채널은 목록에서 제거
                                removeCreatedChannel(guild.id, channelId);
                                continue;
                            }
                            
                            // AFK 채널 확인 및 추적
                            if (channel.name.includes('AFK')) {
                                afkChannels.set(guild.id, {
                                    channelId: channel.id,
                                    isEmpty: channel.members.size === 0,
                                    lastEmptyTime: channel.members.size === 0 ? Date.now() : null,
                                    errorCount: 0 // 오류 카운트 초기화
                                });
                                
                                log('INFO', `기존 AFK 채널 감지됨: ${channel.name} (${channel.id})`);
                                continue; // AFK 채널은 바로 삭제하지 않고 모니터링
                            }
                            
                            // 비어있는 일반 채널 삭제
                            if (channel.members.size === 0) {
                                try {
                                    await channel.delete('봇 시작 시 빈 자동 생성 채널 정리');
                                    log('INFO', `빈 자동 생성 채널 정리: ${channel.name} (${channel.id})`);
                                    
                                    // 추적 정보 모두 정리
                                    channelOwnership.delete(channelId);
                                    channelRenameOperations.delete(channelId);
                                    transferRequests.delete(channelId);
                                    channelLastInteraction.delete(channelId);
                                    
                                    // 추적 목록에서 제거
                                    removeCreatedChannel(guild.id, channelId);
                                } catch (deleteError) {
                                    log('ERROR', `채널 삭제 중 오류: ${deleteError.message}`);
                                    addErrorLog('initialCleanup', deleteError.message, {
                                        guildId: guild.id,
                                        channelId: channel.id,
                                        channelName: channel.name
                                    });
                                }
                            } else {
                                // 사용 중인 채널의 소유권 정보 복구 (필요한 경우)
                                if (!channelOwnership.has(channelId) && channel.members.size > 0) {
                                    // 가장 오래된 멤버를 소유자로 설정 (임시 복구)
                                    const oldestMember = channel.members.first();
                                    if (oldestMember) {
                                        channelOwnership.set(channelId, {
                                            ownerId: oldestMember.id,
                                            createdAt: new Date(),
                                            roomType: 'default',
                                            lastInteraction: Date.now()
                                        });
                                        log('INFO', `채널 ${channel.name} (${channelId})의 소유권 정보를 복구했습니다. 새 소유자: ${oldestMember.user.tag}`);
                                    }
                                }
                            }
                        } catch (channelError) {
                            log('ERROR', `채널 ${channelId} 정리 중 오류: ${channelError.message}`);
                            addErrorLog('initialCleanup', channelError.message, {
                                guildId: guild.id,
                                channelId
                            });
                            
                            // 오류 발생 시 안전하게 추적 목록에서 제거
                            removeCreatedChannel(guild.id, channelId);
                        }
                    }
                }
            } catch (guildError) {
                log('ERROR', `서버 ${guild.name} (${guild.id}) 채널 정리 중 오류: ${guildError.message}`);
                addErrorLog('initialCleanup', guildError.message, {
                    guildId: guild.id,
                    guildName: guild.name
                });
            }
        }
        
        // 설정 저장 (변경사항 적용)
        await saveConfig(log);
        log('INFO', '시작 시 자동 생성 채널 정리가 완료되었습니다.');
    } catch (error) {
        log('ERROR', `자동 생성 채널 정리 중 오류: ${error.message}`);
        addErrorLog('initialCleanup', error.message, { stack: error.stack });
    }
});
// AFK 채널 자동 감지 설정
setupInactivityDetection(client, log);
    
// AFK 채널 자동 정리 설정 - 개선된 버전
setInterval(() => {
    try {
        cleanupAfkChannels(client, log);
    } catch (error) {
        log('ERROR', `AFK 채널 자동 정리 중 치명적 오류 발생: ${error.message}`);
        addErrorLog('afkCleanupInterval', error.message, { stack: error.stack });
    }
}, 30000); // 30초마다 확인 (빠른 정리를 위해)

// 주기적으로 채널 상태 정보 정리 - 새로 추가된 기능
setInterval(() => {
    try {
        cleanupStaleTracking(client, log);
    } catch (error) {
        log('ERROR', `채널 추적 정보 정리 중 오류 발생: ${error.message}`);
        addErrorLog('trackingCleanupInterval', error.message, { stack: error.stack });
    }
}, 5 * 60 * 1000); // 5분마다 확인

log('MODULE', '음성 채널 관리 모듈이 초기화되었습니다.');
}

// 이름 변경 작업 등 오래된 채널 추적 정보 정리 - 새로 추가된 함수
async function cleanupStaleTracking(client, log) {
const now = Date.now();

// 1. 오래된 이름 변경 작업 정리
for (const [channelId, operation] of [...channelRenameOperations.entries()]) {
    // 1시간 이상 지난 작업은 삭제
    if (now - operation.timestamp > 60 * 60 * 1000) {
        channelRenameOperations.delete(channelId);
        if (log) log('INFO', `오래된 채널 이름 변경 작업 정리: ${channelId}`);
    }
    // 또는 진행 중이 아닌 작업은 30분 후 삭제
    else if (!operation.inProgress && now - operation.timestamp > 30 * 60 * 1000) {
        channelRenameOperations.delete(channelId);
        if (log) log('INFO', `완료된 채널 이름 변경 작업 정리: ${channelId}`);
    }
}

// 2. 존재하지 않는 채널의 추적 정보 정리
for (const guildId of createdChannels.keys()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        // 서버를 찾을 수 없으면 해당 서버의 모든 채널 정보 삭제
        createdChannels.delete(guildId);
        if (log) log('INFO', `존재하지 않는 서버 ${guildId}의 채널 추적 정보를 정리했습니다.`);
        continue;
    }
    
    const guildChannels = createdChannels.get(guildId);
    if (!guildChannels) continue;
    
    for (const [parentId, channelIds] of guildChannels.entries()) {
        const validChannelIds = [];
        
        for (const channelId of channelIds) {
            // 채널이 여전히 존재하는지 확인 (API를 너무 많이 호출하지 않도록 캐시 사용)
            const channel = guild.channels.cache.get(channelId);
            if (channel) {
                validChannelIds.push(channelId);
            } else {
                // 채널이 없으면 모든 추적 정보 정리
                channelOwnership.delete(channelId);
                channelRenameOperations.delete(channelId);
                transferRequests.delete(channelId);
                channelLastInteraction.delete(channelId);
                
                if (log) log('INFO', `존재하지 않는 채널 ${channelId}의 추적 정보를 정리했습니다.`);
            }
        }
        
        // 유효한 채널 ID만 저장
        if (validChannelIds.length > 0) {
            guildChannels.set(parentId, validChannelIds);
        } else {
            guildChannels.delete(parentId);
        }
    }
    
    // 빈 맵 제거
    if (guildChannels.size === 0) {
        createdChannels.delete(guildId);
    }
}

// 3. 오래된 소유권 이전 요청 정리
for (const [channelId, requestSet] of [...transferRequests.entries()]) {
    // 빈 세트 삭제
    if (requestSet.size === 0) {
        transferRequests.delete(channelId);
        continue;
    }
    
    // 채널이 존재하는지 확인 (모든 서버에서)
    let channelExists = false;
    for (const guild of client.guilds.cache.values()) {
        if (guild.channels.cache.has(channelId)) {
            channelExists = true;
            break;
        }
    }
    
    if (!channelExists) {
        transferRequests.delete(channelId);
        if (log) log('INFO', `존재하지 않는 채널 ${channelId}의 소유권 이전 요청을 정리했습니다.`);
    }
}

// 4. 주기적으로 설정 저장 (변경사항 적용)
await saveConfig(log);
}

// 비활성 사용자 감지 시스템 설정
function setupInactivityDetection(client, log) {
// 정기적으로 사용자 활동 확인
setInterval(() => {
    try {
        checkUserActivity(client, log);
    } catch (error) {
        log('ERROR', `비활성 사용자 감지 중 오류 발생: ${error.message}`);
        addErrorLog('inactivityDetection', error.message, { stack: error.stack });
    }
}, INACTIVITY_CHECK_INTERVAL);

log('INFO', `비활성 사용자 감지 시스템이 설정되었습니다 (${INACTIVITY_CHECK_INTERVAL / 60000}분 간격으로 확인)`);
}

// 사용자 활동 확인 및 비활성 사용자 처리
async function checkUserActivity(client, log) {
const now = Date.now();

// 각 서버별로 음성 채널 내 사용자 확인
for (const guild of client.guilds.cache.values()) {
    try {
        // 모든 음성 채널 확인
        const voiceChannels = guild.channels.cache.filter(channel => 
            channel.type === ChannelType.GuildVoice && 
            channel.members.size > 0 &&
            !channel.name.includes('AFK') // AFK 채널은 제외
        );
        
        // 모든 음성 채널의 멤버 확인
        for (const [channelId, channel] of voiceChannels) {
            for (const [memberId, member] of channel.members) {
                // 마지막 활동 시간 확인
                const lastActivity = userActivityTimestamps.get(memberId) || 0;
                const inactiveTime = now - lastActivity;
                
                // 30분 이상 비활성 상태면 AFK 채널로 이동
                if (inactiveTime >= INACTIVITY_THRESHOLD) {
                    await moveToAFKChannel(member, guild, log);
                }
            }
        }
    } catch (error) {
        log('ERROR', `사용자 활동 확인 중 오류 발생: ${error.message}`);
        addErrorLog('checkUserActivity', error.message, { 
            stack: error.stack,
            guildId: guild.id,
            guildName: guild.name
        });
    }
}
}
// 사용자를 AFK 채널로 이동
async function moveToAFKChannel(member, guild, log) {
    try {
        // 사용자가 AFK 채널에 이미 있는지 확인
        if (member.voice.channel && member.voice.channel.name.includes('AFK')) {
            return;
        }
        
        // AFK 채널 찾기 또는 생성
        const afkChannel = await findOrCreateAFKChannel(guild, log);
        if (!afkChannel) return;
        
        // 사용자 이동
        await member.voice.setChannel(afkChannel, '비활성 사용자 자동 이동');
        log('INFO', `비활성 사용자 ${member.user.tag}을(를) AFK 채널로 이동했습니다.`);
        
        // 이동 알림 DM 전송
        try {
            const inactivityEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('🪫 AFK 채널로 이동됨')
                .setDescription(`30분 동안 활동이 없어 AFK 채널로 이동되었습니다.`)
                .addFields(
                    { name: '서버', value: guild.name, inline: true },
                    { name: '이동 채널', value: afkChannel.name, inline: true }
                )
                .setThumbnail(ROOM_TYPES.afk.image)
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
            
            await member.user.send({ embeds: [inactivityEmbed] }).catch(() => {
                // DM 전송 실패는 무시
            });
        } catch (dmError) {
            // DM 에러 무시
        }
    } catch (error) {
        log('ERROR', `사용자 ${member.user.tag}를 AFK 채널로 이동하는 중 오류 발생: ${error.message}`);
        addErrorLog('moveToAFKChannel', error.message, { 
            stack: error.stack,
            userId: member.id,
            username: member.user.tag,
            guildId: guild.id
        });
    }
}

// AFK 채널 찾기 또는 생성 - 개선된 버전
async function findOrCreateAFKChannel(guild, log) {
    try {
        // 이미 추적 중인 AFK 채널 확인
        let afkData = afkChannels.get(guild.id);
        if (afkData && afkData.channelId) {
            try {
                // API 호출로 최신 채널 정보 가져오기
                const existingChannel = await guild.channels.fetch(afkData.channelId).catch(() => null);
                if (existingChannel) {
                    // 상태 업데이트
                    afkData.isEmpty = existingChannel.members.size === 0;
                    afkData.lastEmptyTime = existingChannel.members.size === 0 ? Date.now() : null;
                    afkChannels.set(guild.id, afkData);
                    return existingChannel;
                }
            } catch (fetchError) {
                log('WARN', `AFK 채널 정보 가져오기 실패: ${fetchError.message}`);
                // 계속 진행 (새 채널 생성)
            }
        }
        
        // 이름에 "AFK"가 포함된 채널 찾기
        try {
            const afkChannels = guild.channels.cache.filter(channel => 
                channel.type === ChannelType.GuildVoice && 
                channel.name.includes('AFK')
            );
            
            if (afkChannels.size > 0) {
                // 첫 번째 AFK 채널 사용
                const afkChannel = afkChannels.first();
                
                // 발견된 AFK 채널 저장 및 반환
                afkChannels.set(guild.id, {
                    channelId: afkChannel.id,
                    isEmpty: afkChannel.members.size === 0,
                    lastEmptyTime: afkChannel.members.size === 0 ? Date.now() : null,
                    errorCount: 0
                });
                
                log('INFO', `기존 AFK 채널 발견: ${afkChannel.name} (${afkChannel.id})`);
                return afkChannel;
            }
        } catch (findError) {
            log('WARN', `기존 AFK 채널 검색 실패: ${findError.message}`);
            // 계속 진행 (새 채널 생성)
        }
        
        // 자동 생성 대상 채널 확인
        const autoCreateChannels = parentChannels.get(guild.id);
        let parentCategory = null;
        
        if (autoCreateChannels && autoCreateChannels.length > 0) {
            // 첫 번째 자동 생성 채널의 카테고리 사용
            try {
                const firstChannel = await guild.channels.fetch(autoCreateChannels[0]).catch(() => null);
                if (firstChannel && firstChannel.parent) {
                    parentCategory = firstChannel.parent;
                }
            } catch (categoryError) {
                log('WARN', `카테고리 정보 가져오기 실패: ${categoryError.message}`);
                // 계속 진행 (카테고리 없이 생성)
            }
        }
        
        // AFK 채널이 없으면 새로 생성 (가능하면 같은 카테고리에)
        const channelOptions = {
            name: ROOM_TYPES.afk.format(),
            type: ChannelType.GuildVoice,
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone
                    allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak]
                }
            ],
            reason: 'AFK 채널 자동 생성'
        };
        
        // 카테고리가 있으면 추가
        if (parentCategory) {
            channelOptions.parent = parentCategory.id;
        }
        
        // 채널 생성 시도
        try {
            const newAFKChannel = await guild.channels.create(channelOptions);
            
            // 새 AFK 채널 저장
            afkChannels.set(guild.id, {
                channelId: newAFKChannel.id,
                isEmpty: true,
                lastEmptyTime: Date.now(),
                errorCount: 0
            });
            
            // 생성된 채널 추적에 추가
            addCreatedChannel(guild.id, parentCategory ? parentCategory.id : 'unknown', newAFKChannel.id);
            
            log('INFO', `서버 ${guild.name}에 AFK 채널을 생성했습니다: ${newAFKChannel.name} (카테고리: ${parentCategory ? parentCategory.name : '없음'})`);
            
            return newAFKChannel;
        } catch (createError) {
            log('ERROR', `AFK 채널 생성 실패: ${createError.message}`);
            addErrorLog('findOrCreateAFKChannel', createError.message, {
                stack: createError.stack,
                guildId: guild.id,
                guildName: guild.name
            });
            return null;
        }
    } catch (error) {
        log('ERROR', `AFK 채널 찾기/생성 중 오류 발생: ${error.message}`);
        addErrorLog('findOrCreateAFKChannel', error.message, { 
            stack: error.stack,
            guildId: guild.id,
            guildName: guild.name
        });
        return null;
    }
}

// 사용자가 부모 채널에 입장했을 때 처리
async function handleUserJoinParentChannel(state, client, log) {
    const guild = state.guild;
    const user = state.member.user;
    const parentChannel = state.channel;
    
    if (!parentChannel) return;
    
    try {
        // 사용자 닉네임 또는 이름 가져오기 (서버별명 우선)
        const creatorName = state.member.nickname || state.member.user.username;
        
        // 새 채널 생성 - 기본 이름 형식 변경
        const newChannel = await guild.channels.create({
            name: ROOM_TYPES.default.format(creatorName),
            type: ChannelType.GuildVoice,
            parent: parentChannel.parent,
            bitrate: parentChannel.bitrate,
            userLimit: parentChannel.userLimit,
            permissionOverwrites: [
                {
                    id: guild.id, // 모든 사용자
                    allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak]
                },
                {
                    id: state.member.id, // 채널 생성자
                    allow: [
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.MuteMembers,
                        PermissionsBitField.Flags.DeafenMembers,
                        PermissionsBitField.Flags.MoveMembers
                    ]
                }
            ],
            reason: '사용자 음성 통화방 자동 생성'
        });
        
        // 채널 생성 후 사용자 이동 (적절한 지연으로 처리)
        setTimeout(() => {
            state.setChannel(newChannel, '자동 생성 통화방으로 이동').catch(e => {
                if (log) log('ERROR', `사용자 이동 중 오류 발생: ${e.message}`);
            });
        }, 500); // 500ms 지연
        
        // 채널 소유권 정보 저장
        channelOwnership.set(newChannel.id, {
            ownerId: state.member.id,
            createdAt: new Date(),
            roomType: 'default', // 기본 유형 저장
            lastInteraction: Date.now() // 마지막 상호작용 시간 초기화
        });
        
        // 사용자 활동 시간 초기화
        userActivityTimestamps.set(state.member.id, Date.now());
        
        // 생성된 채널 추적
        addCreatedChannel(guild.id, parentChannel.id, newChannel.id);
        
        // DM 메시지 전송 (비동기 백그라운드 처리)
        sendChannelControlsMessage(user, newChannel, creatorName).catch(e => {
            if (log) log('ERROR', `DM 메시지 전송 중 오류 발생: ${e.message}`);
        });
        
        if (log) log('INFO', `새 음성 채널 생성됨: ${newChannel.name} (${newChannel.id}) - 소유자: ${creatorName}`);
        
        return true;
    } catch (error) {
        if (log) log('ERROR', `새 음성 채널 생성 중 오류 발생: ${error.message}`);
        addErrorLog('handleUserJoinParentChannel', error.message, { 
            stack: error.stack,
            userId: state.member.id,
            guildId: guild.id,
            parentChannelId: parentChannel.id
        });
        return false;
    }
}
// 사용자가 채널에 입장했을 때 처리 (소유권 이전 요청 확인)
async function handleUserJoinChannel(state, client, log) {
    const channelId = state.channelId;
    const userId = state.member.id;
    
    // 채널 ID가 없거나 소유권 요청이 없으면 무시
    if (!channelId || !transferRequests.has(channelId)) return;
    
    // 권한 변경 작업이 이미 진행 중인지 확인
    if (pendingPermissionUpdates.has(channelId)) {
        if (log) log('INFO', `채널 ${channelId}의 권한 변경이 이미 진행 중입니다.`);
        return;
    }
    
    // 입장한 채널에 해당 사용자의 소유권 이전 요청이 있는지 확인
    const requestSet = transferRequests.get(channelId);
    if (requestSet && requestSet.has(userId)) {
        try {
            // 채널 정보 확인
            const ownerData = channelOwnership.get(channelId);
            if (!ownerData) return;
            
            // 현재 소유자가 채널에 없는지 확인
            const channel = state.channel;
            const currentOwner = channel.members.get(ownerData.ownerId);
            
            // 소유자가 없고, 요청한 사용자가 입장했으면 소유권 이전
            if (!currentOwner) {
                // 진행 중 표시
                pendingPermissionUpdates.add(channelId);
                
                try {
                    // 이전 소유자의 권한 제거 (기존 권한 설정이 남아있을 수 있음)
                    await channel.permissionOverwrites.delete(ownerData.ownerId).catch(() => {
                        // 오류가 발생해도 계속 진행 (권한이 이미 없을 수 있음)
                    });
                    
                    // 새 소유자에게 권한 부여 (기존 권한 덮어쓰기)
                    await channel.permissionOverwrites.edit(userId, {
                        ManageChannels: true,
                        MuteMembers: true,
                        DeafenMembers: true,
                        MoveMembers: true
                    });
                    
                    // 소유권 정보 업데이트
                    ownerData.ownerId = userId;
                    ownerData.lastInteraction = Date.now(); // 마지막 상호작용 시간 업데이트
                    channelOwnership.set(channelId, ownerData);
                    
                    // 요청 목록에서 제거
                    requestSet.delete(userId);
                    if (requestSet.size === 0) {
                        transferRequests.delete(channelId);
                    }
                    
                    // 채널에 소유권 이전 알림
                    const transferEmbed = new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle('👑 소유권 이전')
                        .setDescription(`<@${userId}>님이 이 통화방의 새 소유자가 되었습니다.`)
                        .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                        .setTimestamp();
                    
                    await channel.send({ embeds: [transferEmbed] });
                    
                    if (log) log('INFO', `채널 ${channel.name} (${channelId})의 소유권이 자동으로 ${userId}에게 이전되었습니다.`);
                } catch (permError) {
                    log('ERROR', `권한 변경 중 오류 발생: ${permError.message}`);
                    addErrorLog('handleUserJoinChannel', permError.message, { 
                        stack: permError.stack,
                        channelId,
                        userId,
                        previousOwnerId: ownerData.ownerId
                    });
                } finally {
                    // 권한 변경 작업 완료 표시
                    pendingPermissionUpdates.delete(channelId);
                }
            }
        } catch (error) {
            // 오류 발생 시 권한 변경 작업 완료 표시
            pendingPermissionUpdates.delete(channelId);
            log('ERROR', `소유권 자동 이전 중 오류 발생: ${error.message}`);
            addErrorLog('handleUserJoinChannel', error.message, { 
                stack: error.stack,
                channelId,
                userId
            });
        }
    }
}

// 소유자가 채널을 떠났을 때 처리
async function handleOwnerLeftChannel(state, client, log) {
    const channelId = state.channelId;
    const userId = state.member.id;
    
    // 채널 ID가 없거나 소유자가 아니면 무시
    if (!channelId || !isChannelOwner(userId, channelId)) return;
    
    // 권한 변경 작업이 이미 진행 중인지 확인
    if (pendingPermissionUpdates.has(channelId)) {
        if (log) log('INFO', `채널 ${channelId}의 권한 변경이 이미 진행 중입니다.`);
        return;
    }
    
    try {
        const channel = state.channel;
        if (!channel || channel.members.size === 0) return; // 빈 채널이면 무시 (cleanupEmptyChannels에서 처리)
        
        // 진행 중 표시
        pendingPermissionUpdates.add(channelId);
        
        try {
            // 남아있는 멤버 중 첫 번째 멤버에게 소유권 이전
            const newOwnerId = channel.members.first().id;
            
            // 소유권 정보 업데이트
            const ownerData = channelOwnership.get(channelId);
            if (ownerData) {
                // 이전 소유자의 권한 제거
                await channel.permissionOverwrites.delete(userId).catch(e => {
                    log('WARN', `이전 소유자 권한 제거 중 오류 발생 (무시됨): ${e.message}`);
                });
                
                // 새 소유자에게 권한 부여
                await channel.permissionOverwrites.edit(newOwnerId, {
                    ManageChannels: true,
                    MuteMembers: true,
                    DeafenMembers: true,
                    MoveMembers: true
                });
                
                // 소유권 정보 업데이트
                ownerData.ownerId = newOwnerId;
                ownerData.lastInteraction = Date.now(); // 마지막 상호작용 시간 업데이트
                channelOwnership.set(channelId, ownerData);
                
                // 채널에 소유권 이전 알림
                const transferEmbed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('👑 소유권 자동 이전')
                    .setDescription(`<@${newOwnerId}>님이 이 통화방의 새 소유자가 되었습니다.`)
                    .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                    .setTimestamp();
                
                await channel.send({ embeds: [transferEmbed] });
                
                // 사용자 활동 시간 초기화
                userActivityTimestamps.set(newOwnerId, Date.now());
                
                if (log) log('INFO', `채널 ${channel.name} (${channelId})의 소유권이 자동으로 ${newOwnerId}에게 이전되었습니다.`);
            }
        } finally {
            // 권한 변경 작업 완료 표시
            pendingPermissionUpdates.delete(channelId);
        }
    } catch (error) {
        // 오류 발생 시 권한 변경 작업 완료 표시
        pendingPermissionUpdates.delete(channelId);
        log('ERROR', `소유자 퇴장 처리 중 오류 발생: ${error.message}`);
        addErrorLog('handleOwnerLeftChannel', error.message, { 
            stack: error.stack,
            channelId,
            userId
        });
    }
}

// 빈 자동 생성 채널 정리 - 개선된 버전
async function cleanupEmptyChannels(state, log) {
    const guild = state.guild;
    const channel = state.channel;
    
    if (!channel) return;
    
    try {
        // 채널이 비어 있고 자동 생성된 채널인지 확인
        if (channel.members.size === 0 && isCreatedChannel(guild.id, channel.id)) {
            // AFK 채널인 경우 바로 삭제하지 않고 비어있는 상태로 마킹
            if (channel.name.includes('AFK')) {
                const afkData = afkChannels.get(guild.id);
                if (afkData && afkData.channelId === channel.id) {
                    afkData.isEmpty = true;
                    afkData.lastEmptyTime = Date.now();
                    afkChannels.set(guild.id, afkData);
                    
                    if (log) log('INFO', `AFK 채널이 비어 있음. 15분 후 삭제 예정: ${channel.name} (${channel.id})`);
                    return false;
                }
            }
            
            // 일반 채널은 바로 삭제 시도
            try {
                // Promise.race를 사용하여 타임아웃 설정 (10초)
                const deletePromise = channel.delete('빈 자동 생성 채널 정리');
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('채널 삭제 작업이 시간 초과되었습니다.')), 10000)
                );
                
                await Promise.race([deletePromise, timeoutPromise]);
                
                // 모든 추적 정보 정리
                removeCreatedChannel(guild.id, channel.id);
                channelOwnership.delete(channel.id);
                channelRenameOperations.delete(channel.id);
                transferRequests.delete(channel.id);
                pendingPermissionUpdates.delete(channel.id);
                channelLastInteraction.delete(channel.id);
                
                // AFK 채널이 삭제된 경우 추적 목록에서 제거
                const afkData = afkChannels.get(guild.id);
                if (afkData && afkData.channelId === channel.id) {
                    afkChannels.delete(guild.id);
                }
                
                if (log) log('INFO', `빈 음성 채널 삭제됨: ${channel.name} (${channel.id})`);
                return true;
            } catch (deleteError) {
                log('ERROR', `빈 채널 삭제 중 오류 발생: ${deleteError.message}`);
                addErrorLog('cleanupEmptyChannels', deleteError.message, {
                    channelId: channel.id,
                    channelName: channel.name,
                    guildId: guild.id
                });
                return false;
            }
        }
    } catch (error) {
        if (log) log('ERROR', `빈 채널 정리 중 오류 발생: ${error.message}`);
        addErrorLog('cleanupEmptyChannels', error.message, { 
            stack: error.stack,
            channelId: channel.id,
            guildId: guild.id
        });
    }
    
    return false;
}

// 채널 관리 메시지 전송 - 선택 메뉴 및 이미지 추가
async function sendChannelControlsMessage(user, channel, ownerName) {
    try {
        // 임베드 생성 - 더 세련되고 가독성 있는 디자인
        const embed = new EmbedBuilder()
            .setColor('#5865F2') // Discord 브랜드 색상
            .setTitle('🎧 통화방이 생성되었습니다!')
            .setDescription(`**${channel.name}** 통화방이 성공적으로 생성되었습니다.\n아래 선택 메뉴에서 원하는 작업을 선택하세요.`)
            .setThumbnail(ROOM_TYPES.default.image) // 기본 이미지 추가
            .addFields(
                { 
                    name: '📝 채널 관리 옵션', 
                    value: '선택 메뉴에서 채널 이름 변경, 소유권 이전, 채널 정보 확인 등의 작업을 할 수 있습니다.', 
                    inline: false 
                },
                { 
                    name: '🏷️ 통화방 유형 선택', 
                    value: '원하는 통화방 유형을 선택하여 이름을 변경할 수 있습니다.\n(예: 사냥파티, 교역파티, 스터디룸 등)', 
                    inline: false 
                },
                { 
                    name: '👑 소유자 권한', 
                    value: '채널 소유자는 다음 권한을 가집니다:\n• 채널 이름 변경\n• 사용자 음소거/귓속말\n• 사용자 내보내기\n• 소유권 이전', 
                    inline: false 
                }
            )
            .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
        
        // 선택 메뉴로 변경 (버튼 대신) - 옵션 수 제한으로 인해 UI 분리 및 스크롤 문제 해결
        const actionRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`voice_room_actions:${channel.id}`)
                    .setPlaceholder('관리 기능 선택')
                    .addOptions([
                        {
                            label: '이름 직접 변경',
                            description: '통화방 이름을 직접 입력하여 변경합니다',
                            value: 'rename_channel',
                            emoji: '📝'
                        },
                        {
                            label: '소유권 이전',
                            description: '다른 사용자에게 통화방 관리 권한을 넘깁니다',
                            value: 'transfer_ownership',
                            emoji: '👑'
                        },
                        {
                            label: '채널 정보',
                            description: '통화방 생성 시간, 참가자 수 등을 확인합니다',
                            value: 'view_info',
                            emoji: 'ℹ️'
                        },
                        {
                            label: '채널 닫기',
                            description: '통화방을 닫고 삭제합니다',
                            value: 'close_channel',
                            emoji: '🔒'
                        }
                    ])
            );
        
        // 통화방 유형 선택 메뉴 (별도 컴포넌트로 분리)
        const typeRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`voice_room_actions:${channel.id}`)
                    .setPlaceholder('통화방 유형 선택')
                    .addOptions([
                        {
                            label: '일반 대화방',
                            description: 'freetalk 통화방으로 이름을 변경합니다',
                            value: 'room_type:freetalk',
                            emoji: '🔋'
                        },
                        {
                            label: '사냥 파티',
                            description: '사냥 파티용 통화방으로 이름을 변경합니다',
                            value: 'room_type:hunting',
                            emoji: '🏹'
                        },
                        {
                            label: '교역 파티',
                            description: '교역 파티용 통화방으로 이름을 변경합니다',
                            value: 'room_type:trading',
                            emoji: '🪙'
                        },
                        {
                            label: '스터디룸',
                            description: '스터디룸 통화방으로 이름을 변경합니다',
                            value: 'room_type:study',
                            emoji: '🎓'
                        },
                        {
                            label: '뮤직룸',
                            description: '음악 감상용 통화방으로 이름을 변경합니다',
                            value: 'room_type:music',
                            emoji: '🎶'
                        }
                    ])
            );
        
        // DM으로 전송 - 메시지 두 개로 분리하여 스크롤 및 상호작용 문제 해결
        await user.send({ embeds: [embed], components: [actionRow] });
        
        // 약간 지연 후 두 번째 메시지 전송 (첫 번째 메시지와 충돌 방지)
        setTimeout(async () => {
            try {
                const typeEmbed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('🏷️ 통화방 유형 선택')
                    .setDescription('통화방 목적에 맞는 유형을 선택하면 자동으로 이름이 변경됩니다.')
                    .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                    .setTimestamp();
                
                await user.send({ embeds: [typeEmbed], components: [typeRow] });
            } catch (error) {
                // 두 번째 메시지 전송 실패는 무시
            }
        }, 500);
        
    } catch (error) {
        console.error(`음성 채널 관리 메시지 전송 중 오류 발생: ${error.message}`);
        addErrorLog('sendChannelControlsMessage', error.message, { 
            stack: error.stack,
            userId: user.id,
            channelId: channel.id
        });
    }
}
// 통화방 유형 선택 처리
async function handleRoomTypeSelection(interaction, channelId, roomType, client, log) {
    try {
        // 먼저 응답을 지연시킴 (3초 타임아웃 방지)
        await interaction.deferReply({ ephemeral: true });
        
        // 유효성 검사 - 소유자인지 확인
        if (!validateChannelOwnership(interaction.user.id, channelId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 권한 오류')
                .setDescription('자신이 생성한 채널만 관리할 수 있습니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            // 이름 변경 작업 완료 표시
            completeRenameOperation(channelId);
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 채널 가져오기
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 채널 찾기 오류')
                .setDescription('채널을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            // 이름 변경 작업 완료 표시
            completeRenameOperation(channelId);
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 유효한 통화방 유형인지 확인
        if (!ROOM_TYPES[roomType]) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 선택 오류')
                .setDescription('유효하지 않은 통화방 유형입니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            // 이름 변경 작업 완료 표시
            completeRenameOperation(channelId);
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 서버 별명 가져오기
        const guild = channel.guild;
        const member = await guild.members.fetch(interaction.user.id);
        const userName = member.nickname || member.user.username;
        
        // 새 채널 이름 생성
        const newChannelName = ROOM_TYPES[roomType].format(userName);
        
        try {
            // 이름 변경 시도 - 타임아웃 추가
            const renamePromise = channel.setName(newChannelName, '통화방 유형 변경');
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('이름 변경 작업이 시간 초과되었습니다.')), 10000)
            );
            
            // Promise.race를 사용하여 타임아웃 설정
            await Promise.race([renamePromise, timeoutPromise]);
            
            // 채널 유형 저장
            const ownerData = channelOwnership.get(channelId) || {
                ownerId: interaction.user.id,
                createdAt: new Date()
            };
            
            ownerData.roomType = roomType;
            ownerData.lastInteraction = Date.now(); // 마지막 상호작용 시간 업데이트
            channelOwnership.set(channelId, ownerData);
            
            // 성공 임베드 생성
            const successEmbed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ 통화방 유형 변경 완료')
                .setDescription(`통화방 이름이 **${newChannelName}**으로 변경되었습니다.`)
                .setThumbnail(ROOM_TYPES[roomType].image)
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
            
            // 응답
            await interaction.editReply({ embeds: [successEmbed] });
            
            // 이름 변경 작업 완료 표시
            completeRenameOperation(channelId);
            
            if (log) log('INFO', `${interaction.user.tag}님이 음성 채널 유형을 "${roomType}"으로 변경했습니다.`);
        } catch (err) {
            // 이름 변경 실패
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 이름 변경 오류')
                .setDescription(`채널 이름을 변경하지 못했습니다.\n사유: ${err.message}`)
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            // 오류 로그 기록
            addErrorLog('handleRoomTypeSelection', err.message, { 
                stack: err.stack,
                channelId,
                userId: interaction.user.id,
                roomType,
                attemptedName: newChannelName
            });
            
            // 이름 변경 작업 완료 표시
            completeRenameOperation(channelId);
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
    } catch (error) {
        log('ERROR', `통화방 유형 변경 중 오류 발생: ${error.message}`);
        addErrorLog('handleRoomTypeSelection', error.message, { 
            stack: error.stack,
            channelId,
            userId: interaction.user.id,
            roomType
        });
        
        // 이름 변경 작업 완료 표시
        completeRenameOperation(channelId);
        
        // 이미 응답했거나 지연했는지 확인
        if (interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 오류 발생')
                .setDescription('예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
        }
    }
}

// 채널 정보 표시 함수
async function showChannelInfo(interaction, channelId, client) {
    try {
        // 응답 지연
        await interaction.deferReply({ ephemeral: true });
        
        // 채널 가져오기
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            return await interaction.editReply({
                content: '채널을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.'
            });
        }
        
        // 소유자 정보 가져오기
        const ownerData = channelOwnership.get(channelId) || { ownerId: '알 수 없음', createdAt: new Date(), roomType: 'default' };
        const owner = channel.guild.members.cache.get(ownerData.ownerId);
        const ownerName = owner ? (owner.nickname || owner.user.username) : '알 수 없음';
        
        // 생성 시간 계산
        const createdTime = ownerData.createdAt;
        const now = new Date();
        const diffMs = now - createdTime;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        // 채널 정보 임베드 생성
        const infoEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`📊 채널 정보: ${channel.name}`)
            .addFields(
                { name: '채널 ID', value: channel.id, inline: true },
                { name: '소유자', value: `<@${ownerData.ownerId}> (${ownerName})`, inline: true },
                { name: '생성 시간', value: `${createdTime.toLocaleString()} (${diffHours}시간 ${diffMinutes}분 전)`, inline: false },
                { name: '통화방 유형', value: `${ROOM_TYPES[ownerData.roomType]?.emoji || '🔊'} ${ownerData.roomType || 'default'}`, inline: true },
                { name: '참가자 수', value: `${channel.members.size}명`, inline: true },
                { name: '사용자 제한', value: channel.userLimit > 0 ? `${channel.userLimit}명` : '무제한', inline: true }
            )
            .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
            
        // 참가자 목록 추가 (최대 10명까지만 표시)
        if (channel.members.size > 0) {
            const members = Array.from(channel.members.values()).slice(0, 10);
            const memberList = members.map(m => `• <@${m.id}> ${m.nickname ? `(${m.nickname})` : ''}`).join('\n');
            infoEmbed.addFields({ name: '참가자 목록', value: memberList + (channel.members.size > 10 ? '\n... 외 더 많은 참가자' : ''), inline: false });
        }
        
        // 채널 유형에 따른 썸네일 추가
        if (ROOM_TYPES[ownerData.roomType]?.image) {
            infoEmbed.setThumbnail(ROOM_TYPES[ownerData.roomType].image);
        }
        
        // 응답 전송
        await interaction.editReply({ embeds: [infoEmbed] });
    } catch (error) {
        console.error(`채널 정보 표시 중 오류 발생: ${error.message}`);
        addErrorLog('showChannelInfo', error.message, { 
            stack: error.stack,
            channelId,
            userId: interaction.user.id
        });
        
        // 오류 응답
        if (interaction.deferred) {
            await interaction.editReply({ content: '채널 정보를 불러오는 중 오류가 발생했습니다.' });
        } else {
            await interaction.reply({ content: '채널 정보를 불러오는 중 오류가 발생했습니다.', ephemeral: true });
        }
    }
}

// 채널 이름 변경 모달 표시
async function showRenameModal(interaction, channelId) {
    try {
        // 소유권 확인
        if (!validateChannelOwnership(interaction.user.id, channelId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')  // 빨간색 (오류)
                .setTitle('⚠️ 권한 오류')
                .setDescription('자신이 생성한 채널만 관리할 수 있습니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 채널 이름 변경 작업 추적 - 동시 변경 방지
        if (!trackRenameOperation(channelId, interaction.user.id)) {
            return await interaction.reply({
                content: '다른 이름 변경 작업이 이미 진행 중입니다. 잠시 후 다시 시도해주세요.',
                ephemeral: true
            });
        }
        
        // 모달 생성 - 최대한 간단하게
        const modal = new ModalBuilder()
            .setCustomId(`rename_modal:${channelId}`)
            .setTitle('통화방 이름 변경');
        
        // 텍스트 입력 필드 추가
        const channelNameInput = new TextInputBuilder()
            .setCustomId('channel_name')
            .setLabel('새 통화방 이름')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('새로운 통화방 이름을 입력하세요')
            .setRequired(true)
            .setMaxLength(100);
        
        const firstActionRow = new ActionRowBuilder().addComponents(channelNameInput);
        modal.addComponents(firstActionRow);
        
        // 모달 표시 실패 시 작업 추적 정리
        try {
            // 모달 표시 - 예외 처리 없이 (에러 시 discord.js가 자체 처리)
            await interaction.showModal(modal);
        } catch (modalError) {
            completeRenameOperation(channelId); // 작업 완료 표시
            throw modalError; // 오류 전파
        }
    } catch (error) {
        console.error(`채널 이름 변경 모달 표시 중 오류 발생: ${error.message}`);
        addErrorLog('showRenameModal', error.message, { 
            stack: error.stack,
            channelId,
            userId: interaction.user.id
        });
        
        // 이름 변경 작업 추적 정리
        completeRenameOperation(channelId);
        
        // 오류 발생 시 사용자에게 알림 (응답하지 않았다면)
        if (!interaction.replied && !interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 오류 발생')
                .setDescription('이름 변경 모달을 표시할 수 없습니다. 나중에 다시 시도해주세요.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
        }
    }
}

// 채널 닫기 확인 메뉴
async function confirmCloseChannel(interaction, channelId, log) {
    try {
        // 유효성 검사 - 소유자인지 확인
        if (!validateChannelOwnership(interaction.user.id, channelId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 권한 오류')
                .setDescription('자신이 생성한 채널만 닫을 수 있습니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 닫기 확인 임베드
        const confirmEmbed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('⚠️ 통화방 닫기 확인')
            .setDescription('정말로 이 통화방을 닫으시겠습니까?\n통화방을 닫으면 모든 사용자가 연결 해제되고 채널이 삭제됩니다.')
            .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
        
        // 확인 버튼
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_close_channel:${channelId}`)
                    .setLabel('통화방 닫기')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId(`cancel_close_channel:${channelId}`)
                    .setLabel('취소')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('❌')
            );
        
        await interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true });
    } catch (error) {
        log('ERROR', `통화방 닫기 확인 메뉴 표시 중 오류 발생: ${error.message}`);
        addErrorLog('confirmCloseChannel', error.message, { 
            stack: error.stack,
            channelId,
            userId: interaction.user.id
        });
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('⚠️ 오류 발생')
            .setDescription('예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
            .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 채널 닫기 취소 처리
async function handleCancelClose(interaction, channelId, log) {
    try {
        const cancelEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('❌ 통화방 닫기 취소됨')
            .setDescription('통화방 닫기가 취소되었습니다.')
            .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
        
        await interaction.update({ embeds: [cancelEmbed], components: [] });
        
        log('INFO', `${interaction.user.tag}님이 통화방 닫기를 취소했습니다.`);
    } catch (error) {
        log('ERROR', `통화방 닫기 취소 처리 중 오류 발생: ${error.message}`);
        addErrorLog('handleCancelClose', error.message, { 
            stack: error.stack,
            channelId,
            userId: interaction.user.id
        });
        
        try {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 오류 발생')
                .setDescription('통화방 닫기 취소 처리 중 오류가 발생했습니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            await interaction.update({ embeds: [errorEmbed], components: [] });
        } catch (replyError) {
            // 응답 오류 무시
        }
    }
}
// 채널 닫기 처리
async function handleChannelClose(interaction, channelId, client, log) {
    try {
        // 유효성 검사 - 소유자인지 확인
        if (!validateChannelOwnership(interaction.user.id, channelId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 권한 오류')
                .setDescription('자신이 생성한 채널만 닫을 수 있습니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.update({ embeds: [errorEmbed], components: [] });
        }
        
        // 채널 가져오기
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 채널 찾기 오류')
                .setDescription('채널을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.update({ embeds: [errorEmbed], components: [] });
        }
        
        // 닫기 진행 중 임베드
        const closingEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('🔒 통화방 닫는 중')
            .setDescription('통화방을 닫는 중입니다. 3초 후 모든 사용자가 연결 해제되고 채널이 삭제됩니다.')
            .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
        
        await interaction.update({ embeds: [closingEmbed], components: [] });
        
        // 채널에 닫기 메시지 전송
        try {
            await channel.send({
                content: `@everyone`,
                embeds: [
                    new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('🔒 통화방이 곧 닫힙니다')
                        .setDescription(`<@${interaction.user.id}>님이 통화방을 닫았습니다. 3초 후 이 채널은 삭제됩니다.`)
                        .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                        .setTimestamp()
                ]
            });
        } catch (err) {
            // 채널 메시지 전송 실패는 무시
            log('WARN', `채널 닫기 메시지 전송 실패: ${err.message}`);
        }
        
        // 3초 후 채널 삭제
        setTimeout(async () => {
            try {
                // 모든 멤버 연결 끊기 (AFK 채널로 이동)
                const afkChannel = await findOrCreateAFKChannel(channel.guild, log);
                if (afkChannel) {
                    // Promise.all로 이동 작업 병렬 처리
                    const movePromises = [];
                    
                    for (const [memberId, member] of channel.members) {
                        movePromises.push(
                            member.voice.setChannel(afkChannel, '통화방 닫힘으로 인한 이동')
                                .catch(moveError => {
                                    // 멤버 이동 실패는 무시하고 계속 진행
                                    log('WARN', `멤버 ${member.user.tag} 이동 실패: ${moveError.message}`);
                                })
                        );
                    }
                    
                    // 모든 이동 작업 완료 대기 (최대 5초)
                    await Promise.race([
                        Promise.all(movePromises),
                        new Promise(resolve => setTimeout(resolve, 5000))
                    ]);
                }
                
                // 채널 삭제 (타임아웃 추가)
                const deletePromise = channel.delete('사용자가 통화방 닫기 요청');
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('채널 삭제 작업이 시간 초과되었습니다.')), 10000)
                );
                
                await Promise.race([deletePromise, timeoutPromise]);
                
                // 추적 정보 정리
                removeCreatedChannel(channel.guild.id, channelId);
                channelOwnership.delete(channelId);
                channelRenameOperations.delete(channelId);
                transferRequests.delete(channelId);
                pendingPermissionUpdates.delete(channelId);
                channelLastInteraction.delete(channelId);
                
                log('INFO', `${interaction.user.tag}님이 통화방 ${channel.name}을(를) 닫았습니다.`);
            } catch (error) {
                log('ERROR', `통화방 닫기 처리 중 오류 발생: ${error.message}`);
                addErrorLog('handleChannelClose', error.message, { 
                    stack: error.stack,
                    channelId,
                    userId: interaction.user.id
                });
            }
        }, 3000);
    } catch (error) {
        log('ERROR', `통화방 닫기 처리 중 오류 발생: ${error.message}`);
        addErrorLog('handleChannelClose', error.message, { 
            stack: error.stack,
            channelId,
            userId: interaction.user.id
        });
        
        try {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 오류 발생')
                .setDescription('통화방 닫기 처리 중 오류가 발생했습니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            await interaction.update({ embeds: [errorEmbed], components: [] });
        } catch (replyError) {
            // 응답 오류 무시
        }
    }
}

// 소유권 이전 메뉴 표시
async function showTransferOwnershipMenu(interaction, channelId, client) {
    try {
        // 응답 지연
        await interaction.deferReply({ ephemeral: true });
        
        // 소유자 확인
        if (!validateChannelOwnership(interaction.user.id, channelId)) {
            return await interaction.editReply({
                content: '자신이 생성한 채널만 관리할 수 있습니다.'
            });
        }
        
        // 채널 가져오기
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            return await interaction.editReply({
                content: '채널을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.'
            });
        }
        
        // 채널 멤버 확인 (소유자 제외)
        const members = channel.members.filter(member => member.id !== interaction.user.id);
        
        if (members.size === 0) {
            return await interaction.editReply({
                content: '채널에 다른 멤버가 없습니다. 소유권을 이전할 대상이 없습니다.'
            });
        }
        
        // 소유권 이전 임베드
        const transferEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('👑 소유권 이전')
            .setDescription('다음 중 소유권을 이전할 멤버를 선택하세요:')
            .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
        
        // 멤버 선택 메뉴 생성 (최대 25명까지만 표시)
        const memberOptions = [];
        const membersList = Array.from(members.values()).slice(0, 25);
        
        for (const member of membersList) {
            memberOptions.push({
                label: member.nickname || member.user.username,
                description: `ID: ${member.id}`,
                value: member.id,
                emoji: '👤'
            });
        }
        
        // 선택 메뉴 컴포넌트
        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`transfer_owner:${channelId}`)
                    .setPlaceholder('소유권을 이전할 멤버 선택')
                    .addOptions(memberOptions)
            );
        
        // 응답 전송
        await interaction.editReply({
            embeds: [transferEmbed],
            components: [row]
        });
    } catch (error) {
        console.error(`소유권 이전 메뉴 표시 중 오류 발생: ${error.message}`);
        addErrorLog('showTransferOwnershipMenu', error.message, { 
            stack: error.stack,
            channelId,
            userId: interaction.user.id
        });
        
        // 오류 응답
        if (interaction.deferred) {
            await interaction.editReply({ content: '소유권 이전 메뉴를 불러오는 중 오류가 발생했습니다.' });
        } else {
            await interaction.reply({ content: '소유권 이전 메뉴를 불러오는 중 오류가 발생했습니다.', ephemeral: true });
        }
    }
}

// 소유권 이전 처리
async function transferOwnership(interaction, channelId, client, log) {
    try {
        // 응답 지연
        await interaction.deferReply({ ephemeral: true });
        
        // 소유자 확인
        if (!validateChannelOwnership(interaction.user.id, channelId)) {
            return await interaction.editReply({
                content: '자신이 생성한 채널만 관리할 수 있습니다.'
            });
        }
        
        // 채널 가져오기
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            return await interaction.editReply({
                content: '채널을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.'
            });
        }
        
        // 선택한 사용자 ID
        const newOwnerId = interaction.values[0];
        
        // 사용자 확인
        const newOwner = channel.members.get(newOwnerId);
        if (!newOwner) {
            return await interaction.editReply({
                content: '선택한 사용자가 채널에 없습니다. 다시 시도해주세요.'
            });
        }
        
        // 소유권 데이터 가져오기
        const ownerData = channelOwnership.get(channelId);
        if (!ownerData) {
            return await interaction.editReply({
                content: '채널 소유권 정보를 찾을 수 없습니다.'
            });
        }
        
        // 권한 변경 진행 중 표시
        pendingPermissionUpdates.add(channelId);
        
        try {
            // 이전 소유자 권한 제거
            await channel.permissionOverwrites.delete(interaction.user.id).catch(e => {
                log('WARN', `이전 소유자 권한 제거 중 오류 발생 (무시됨): ${e.message}`);
            });
            
            // 새 소유자 권한 설정
            await channel.permissionOverwrites.edit(newOwnerId, {
                ManageChannels: true,
                MuteMembers: true,
                DeafenMembers: true,
                MoveMembers: true
            });
            
            // 소유권 정보 업데이트
            ownerData.ownerId = newOwnerId;
            ownerData.lastInteraction = Date.now(); // 마지막 상호작용 시간 업데이트
            channelOwnership.set(channelId, ownerData);
            
            // 소유권 이전 성공 알림
            const successEmbed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('👑 소유권 이전 완료')
                .setDescription(`<@${newOwnerId}>님에게 채널 소유권이 이전되었습니다.`)
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
            
            await interaction.editReply({
                embeds: [successEmbed],
                components: []
            });
            
            // 채널에 안내 메시지 전송
            const channelAnnouncementEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('👑 소유권 이전')
                .setDescription(`<@${interaction.user.id}>님이 <@${newOwnerId}>님에게 이 통화방의 소유권을 이전했습니다.`)
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            await channel.send({ embeds: [channelAnnouncementEmbed] });
            
            // 로그
            if (log) log('INFO', `채널 ${channel.name} (${channelId})의 소유권이 ${interaction.user.id}에서 ${newOwnerId}로 이전되었습니다.`);
        } finally {
            // 권한 변경 진행 중 표시 제거
            pendingPermissionUpdates.delete(channelId);
        }
    } catch (error) {
        console.error(`소유권 이전 중 오류 발생: ${error.message}`);
        addErrorLog('transferOwnership', error.message, { 
            stack: error.stack,
            channelId,
            userId: interaction.user.id,
            newOwnerId: interaction.values?.[0]
        });
        
        // 권한 변경 진행 중 표시 제거
        pendingPermissionUpdates.delete(channelId);
        
        // 오류 응답
        if (interaction.deferred) {
            await interaction.editReply({ content: '소유권 이전 중 오류가 발생했습니다.' });
        } else {
            await interaction.reply({ content: '소유권 이전 중 오류가 발생했습니다.', ephemeral: true });
        }
    }
}

// 소유권 요청 처리
async function handleOwnershipRequest(interaction, channelId, client) {
    try {
        // 채널 가져오기
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            return await interaction.reply({
                content: '채널을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.',
                ephemeral: true
            });
        }
        
        // 소유권 정보 확인
        const ownerData = channelOwnership.get(channelId);
        if (!ownerData) {
            return await interaction.reply({
                content: '채널 소유권 정보를 찾을 수 없습니다.',
                ephemeral: true
            });
        }
        
        // 본인이 이미 소유자인 경우
        if (ownerData.ownerId === interaction.user.id) {
            return await interaction.reply({
                content: '이미 이 채널의 소유자입니다.',
                ephemeral: true
            });
        }
        
        // 현재 소유자가 채널에 있는지 확인
        const currentOwner = channel.members.get(ownerData.ownerId);
        if (currentOwner) {
            return await interaction.reply({
                content: '현재 소유자가 채널에 있습니다. 소유자에게 직접 소유권 이전을 요청하세요.',
                ephemeral: true
            });
        }
        
        // 소유권 이전 요청 등록
        if (!transferRequests.has(channelId)) {
            transferRequests.set(channelId, new Set());
        }
        
        transferRequests.get(channelId).add(interaction.user.id);
        
        // 성공 응답
        const requestEmbed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('👑 소유권 요청 등록')
            .setDescription('소유권 이전 요청이 등록되었습니다. 현재 소유자가 채널에 돌아오지 않으면 자동으로 소유권이 이전됩니다.')
            .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
            
        await interaction.reply({
            embeds: [requestEmbed],
            ephemeral: true
        });
    } catch (error) {
        console.error(`소유권 요청 처리 중 오류 발생: ${error.message}`);
        addErrorLog('handleOwnershipRequest', error.message, { 
            stack: error.stack,
            channelId,
            userId: interaction.user.id
        });
        
        await interaction.reply({
            content: '소유권 요청 처리 중 오류가 발생했습니다.',
            ephemeral: true
        });
    }
}
// 자동 생성 설정 추가
function addAutoCreateChannel(guildId, channelId, log) {
    let channels = parentChannels.get(guildId) || [];
    
    // 중복 체크
    if (!channels.includes(channelId)) {
        channels.push(channelId);
        parentChannels.set(guildId, channels);
        saveConfig(log);
        return true;
    }
    
    return false;
}

// 자동 생성 설정 제거
function removeAutoCreateChannel(guildId, channelId, log) {
    let channels = parentChannels.get(guildId) || [];
    
    // 채널 ID 찾기 및 제거
    const index = channels.indexOf(channelId);
    if (index !== -1) {
        channels.splice(index, 1);
        parentChannels.set(guildId, channels);
        saveConfig(log);
        return true;
    }
    
    return false;
}

// 자동 생성 설정 목록 조회
function getAutoCreateChannels(guildId) {
    return parentChannels.get(guildId) || [];
}

// 생성된 채널 관리 함수들
function getCreatedChannelsForGuild(guildId) {
    return createdChannels.get(guildId);
}

function addCreatedChannel(guildId, parentId, channelId) {
    if (!createdChannels.has(guildId)) {
        createdChannels.set(guildId, new Map());
    }
    
    const guildChannels = createdChannels.get(guildId);
    
    if (!guildChannels.has(parentId)) {
        guildChannels.set(parentId, []);
    }
    
    guildChannels.get(parentId).push(channelId);
}

function removeCreatedChannel(guildId, channelId) {
    if (!createdChannels.has(guildId)) return false;
    
    const guildChannels = createdChannels.get(guildId);
    
    for (const [parentId, channels] of guildChannels.entries()) {
        const index = channels.indexOf(channelId);
        if (index !== -1) {
            channels.splice(index, 1);
            
            // 빈 배열 정리
            if (channels.length === 0) {
                guildChannels.delete(parentId);
                
                // 빈 맵 정리
                if (guildChannels.size === 0) {
                    createdChannels.delete(guildId);
                }
            }
            
            // 설정 저장
            saveConfig();
            return true;
        }
    }
    
    return false;
}

function isCreatedChannel(guildId, channelId) {
    if (!createdChannels.has(guildId)) return false;
    
    const guildChannels = createdChannels.get(guildId);
    
    for (const channels of guildChannels.values()) {
        if (channels.includes(channelId)) {
            return true;
        }
    }
    
    return false;
}

// 채널 소유자인지 확인
function isChannelOwner(userId, channelId) {
    const ownerData = channelOwnership.get(channelId);
    return ownerData && ownerData.ownerId === userId;
}

// 채널 소유권 확인
function validateChannelOwnership(userId, channelId) {
    return isChannelOwner(userId, channelId);
}

// 슬래시 커맨드 정의
const slashCommands = [
    new SlashCommandBuilder()
        .setName('음성채널설정')
        .setDescription('음성 통화방 자동 생성 기능을 설정합니다')
        .addSubcommand(subcommand =>
            subcommand
                .setName('추가')
                .setDescription('자동 생성 기능을 활성화할 음성 채널을 추가합니다')
                .addChannelOption(option =>
                    option.setName('채널')
                        .setDescription('자동 생성 기능을 활성화할 음성 채널')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('제거')
                .setDescription('자동 생성 기능을 비활성화할 음성 채널을 제거합니다')
                .addChannelOption(option =>
                    option.setName('채널')
                        .setDescription('자동 생성 기능을 비활성화할 음성 채널')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('목록')
                .setDescription('현재 설정된 자동 생성 음성 채널 목록을 확인합니다'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('진단')
                .setDescription('음성 채널 모듈의 진단 정보를 확인합니다'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('정리')
                .setDescription('빈 음성 채널 및 AFK 채널을 수동으로 정리합니다'))
];

// 슬래시 커맨드 실행 함수
async function executeSlashCommand(interaction, client, log) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    
    if (subcommand === '추가') {
        const channel = interaction.options.getChannel('채널');
        
        // 음성 채널인지 확인
        if (channel.type !== ChannelType.GuildVoice) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 채널 유형 오류')
                .setDescription('선택한 채널은 음성 채널이 아닙니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 채널 추가
        const success = addAutoCreateChannel(guildId, channel.id, log);
        
        if (success) {
            log('INFO', `서버 ${interaction.guild.name}에 자동 생성 음성 채널이 추가됨: ${channel.name} (${channel.id})`);
            
            const successEmbed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ 설정 완료')
                .setDescription(`채널 <#${channel.id}>이(가) 음성 통화방 자동 생성 대상으로 추가되었습니다.`)
                .addFields(
                    { name: '채널 정보', value: `이름: ${channel.name}\nID: ${channel.id}`, inline: true },
                    { name: '사용 방법', value: '해당 음성 채널에 입장하면 자동으로 새 통화방이 생성됩니다.', inline: true }
                )
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        } else {
            const alreadySetEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ 이미 설정됨')
                .setDescription(`채널 <#${channel.id}>은(는) 이미 설정되어 있습니다.`)
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [alreadySetEmbed], ephemeral: true });
        }
    }
    else if (subcommand === '제거') {
        const channel = interaction.options.getChannel('채널');
        
        // 채널 제거
        const success = removeAutoCreateChannel(guildId, channel.id, log);
        
        if (success) {
            log('INFO', `서버 ${interaction.guild.name}에서 자동 생성 음성 채널이 제거됨: ${channel.name} (${channel.id})`);
            
            const removeEmbed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ 설정 제거 완료')
                .setDescription(`채널 <#${channel.id}>이(가) 음성 통화방 자동 생성 대상에서 제거되었습니다.`)
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [removeEmbed], ephemeral: true });
        } else {
            const notSetEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ 설정되지 않음')
                .setDescription(`채널 <#${channel.id}>은(는) 설정되어 있지 않습니다.`)
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [notSetEmbed], ephemeral: true });
        }
    }
    else if (subcommand === '목록') {
        const channelIds = getAutoCreateChannels(guildId);
        
        if (channelIds.length === 0) {
            const noChannelsEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('📋 설정 목록')
                .setDescription('설정된 자동 생성 음성 통화방이 없습니다.')
                .addFields(
                    { name: '🔍 도움말', value: '`/음성채널설정 추가` 명령어로 음성 통화방 자동 생성 기능을 설정할 수 있습니다.' }
                )
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [noChannelsEmbed], ephemeral: true });
        } else {
            const channelList = channelIds.map(id => {
                const channel = interaction.guild.channels.cache.get(id);
                return channel ? `• <#${id}> (ID: ${id})` : `• 알 수 없는 채널 (ID: ${id})`;
            }).join('\n');
            
            const listEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('📋 음성 통화방 자동 생성 설정 목록')
                .setDescription('다음 채널에 입장하면 개인 음성 통화방이 자동으로 생성됩니다:')
                .addFields(
                    { name: '설정된 채널 목록', value: channelList }
                )
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [listEmbed], ephemeral: true });
        }
    }
    else if (subcommand === '진단') {
        // 권한 체크 - 서버 관리자만 진단 정보 확인 가능
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            const noPermEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 권한 오류')
                .setDescription('진단 정보를 확인하려면 서버 관리 권한이 필요합니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
            
            return await interaction.reply({ embeds: [noPermEmbed], ephemeral: true });
        }
        
        // 모듈 상태 정보 수집
        const guildChannelIds = getAutoCreateChannels(guildId);
        const createdCounts = {};
        
        let totalCreatedChannels = 0;
        let validParentChannels = 0;
        
        // 현재 활성화된 부모 채널 확인
        for (const parentId of guildChannelIds) {
            const parentChannel = interaction.guild.channels.cache.get(parentId);
            if (parentChannel) {
                validParentChannels++;
                
                // 해당 부모 채널에서 생성된 채널 수 계산
                const createdForParent = getCreatedChannelCount(guildId, parentId);
                createdCounts[parentId] = createdForParent;
                totalCreatedChannels += createdForParent;
            }
        }
        
        // 오류 로그 요약
        const recentErrors = errorLogs.slice(0, 3); // 최근 3개 오류만 표시
        const errorSummary = recentErrors.length > 0 
            ? recentErrors.map(e => `${new Date(e.timestamp).toLocaleString()} - ${e.source}: ${e.message}`).join('\n')
            : '최근 오류 없음';
        
        // AFK 채널 정보
        const afkData = afkChannels.get(guildId);
        const afkChannelInfo = afkData 
            ? `ID: ${afkData.channelId}\n상태: ${afkData.isEmpty ? '비어 있음' : '사용 중'}`
            : '없음';
        
        // 진단 정보 임베드 생성
        const diagEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🛠️ 음성 채널 모듈 진단 정보')
            .addFields(
                { name: '설정된 부모 채널', value: `총 ${guildChannelIds.length}개 (유효: ${validParentChannels}개)`, inline: true },
                { name: '생성된 채널', value: `총 ${totalCreatedChannels}개`, inline: true },
                { name: '모듈 버전', value: '1.5.1', inline: true },
                { name: 'AFK 채널', value: afkChannelInfo, inline: false },
                { name: '이름 변경 작업', value: `진행 중: ${Array.from(channelRenameOperations.entries()).filter(([_, op]) => op.inProgress).length}개`, inline: true },
                { name: '최근 오류 로그', value: errorSummary, inline: false }
            )
            .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
        
        // 부모 채널별 생성 채널 정보
        if (Object.keys(createdCounts).length > 0) {
            const channelDetailsList = Object.entries(createdCounts).map(([parentId, count]) => {
                const parentChannel = interaction.guild.channels.cache.get(parentId);
                return `• ${parentChannel ? parentChannel.name : '알 수 없는 채널'} (${parentId}): ${count}개`;
            }).join('\n');
            
            diagEmbed.addFields({ 
                name: '채널별 생성 현황', 
                value: channelDetailsList,
                inline: false
            });
        }
        
        return await interaction.reply({ embeds: [diagEmbed], ephemeral: true });
    }
    else if (subcommand === '정리') {
        // 권한 체크 - 서버 관리자만 정리 가능
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            const noPermEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 권한 오류')
                .setDescription('채널 정리 기능을 사용하려면 서버 관리 권한이 필요합니다.')
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
            
            return await interaction.reply({ embeds: [noPermEmbed], ephemeral: true });
        }
        
        // 처리 지연 응답
        await interaction.deferReply({ ephemeral: true });
        
        // 정리 시작 메시지
        const startEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🧹 채널 정리 시작')
            .setDescription('빈 자동 생성 채널 및 AFK 채널을 정리 중입니다...')
            .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
            
        await interaction.editReply({ embeds: [startEmbed] });
        
        try {
            let deletedCount = 0;
            let skippedCount = 0;
            let afkFoundCount = 0;
            
            // 1. 현재 서버의 추적된 채널 정리
            const guildChannels = getCreatedChannelsForGuild(guildId);
            if (guildChannels) {
                for (const [parentId, channelIds] of guildChannels.entries()) {
                    for (const channelId of [...channelIds]) { // 복사본 사용
                        try {
                            // 채널 가져오기
                            const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
                            
                            if (!channel) {
                                // 존재하지 않는 채널은 추적 목록에서 제거
                                removeCreatedChannel(guildId, channelId);
                                continue;
                            }
                            
                            // AFK 채널은 따로 처리
                            if (channel.name.includes('AFK')) {
                                afkFoundCount++;
                                
                                // AFK 채널이 비어있으면 삭제
                                if (channel.members.size === 0) {
                                    try {
                                        await channel.delete('관리자 수동 정리 - 빈 AFK 채널');
                                        deletedCount++;
                                        
                                        // AFK 추적 목록에서 제거
                                        const afkData = afkChannels.get(guildId);
                                        if (afkData && afkData.channelId === channelId) {
                                            afkChannels.delete(guildId);
                                        }
                                        
                                        // 추적 목록에서 제거
                                        removeCreatedChannel(guildId, channelId);
                                        
                                        // 다른 추적 정보도 정리
                                        channelOwnership.delete(channelId);
                                        channelRenameOperations.delete(channelId);
                                        transferRequests.delete(channelId);
                                        channelLastInteraction.delete(channelId);
                                    } catch (deleteError) {
                                        log('ERROR', `AFK 채널 삭제 중 오류: ${deleteError.message}`);
                                        skippedCount++;
                                    }
                                } else {
                                    skippedCount++;
                                }
                                continue;
                            }
                            
                            // 빈 채널 정리
                            if (channel.members.size === 0) {
                                try {
                                    await channel.delete('관리자 수동 정리 - 빈 자동 생성 채널');
                                    deletedCount++;
                                    
                                    // 추적 목록에서 제거
                                    removeCreatedChannel(guildId, channelId);
                                    
                                    // 다른 추적 정보도 정리
                                    channelOwnership.delete(channelId);
                                    channelRenameOperations.delete(channelId);
                                    transferRequests.delete(channelId);
                                    channelLastInteraction.delete(channelId);
                                } catch (deleteError) {
                                    log('ERROR', `채널 삭제 중 오류: ${deleteError.message}`);
                                    skippedCount++;
                                }
                            } else {
                                skippedCount++;
                            }
                        } catch (error) {
                            log('ERROR', `채널 ${channelId} 정리 중 오류: ${error.message}`);
                            skippedCount++;
                        }
                    }
                }
            }
            
            // 2. 정리 결과 전송
            const resultEmbed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ 채널 정리 완료')
                .setDescription(`${deletedCount}개의 채널이 정리되었습니다.`)
                .addFields(
                    { name: '삭제된 채널', value: `${deletedCount}개`, inline: true },
                    { name: '건너뛴 채널', value: `${skippedCount}개 (사용 중)`, inline: true },
                    { name: 'AFK 채널', value: `${afkFoundCount}개 발견됨`, inline: true }
                )
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            await interaction.editReply({ embeds: [resultEmbed] });
            
            // 로그
            log('INFO', `관리자 ${interaction.user.tag}이(가) 서버 ${interaction.guild.name}의 채널 정리를 실행: ${deletedCount}개 삭제됨`);
        } catch (error) {
            log('ERROR', `채널 정리 중 오류 발생: ${error.message}`);
            
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 채널 정리 오류')
                .setDescription(`채널 정리 중 오류가 발생했습니다: ${error.message}`)
                .setFooter({ text: 'AimBot.AD', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
}

// 특정 부모 채널에서 생성된 채널 수 조회
function getCreatedChannelCount(guildId, parentId) {
    const guildChannels = createdChannels.get(guildId);
    if (!guildChannels) return 0;
    
    const channels = guildChannels.get(parentId);
    return channels ? channels.length : 0;
}

// 모듈 내보내기
module.exports = {
    name: 'voice-channel-manager',
    description: '사용자 음성 통화방 자동 생성 및 관리 모듈',
    version: '1.5.1',  // 버전 업데이트
    commands: ['음성채널설정'],
    enabled: true,
    init,
    executeSlashCommand,
    slashCommands,
    
    // 내부 상태 진단 정보 공개
    diagnostics: {
        getErrorLogs: () => [...errorLogs],
        getChannelStats: () => ({
            parentChannels: new Map(parentChannels),
            createdChannels: new Map(createdChannels),
            totalOwned: channelOwnership.size,
            pendingTransfers: new Map(transferRequests),
            afkChannels: new Map(afkChannels),
            pendingRenames: new Map(channelRenameOperations)  // 이름 변경 작업 추적 정보 추가
        }),
        // 문제 해결을 위한 수동 정리 함수 추가
        cleanupChannel: (channelId) => {
            // 특정 채널의 추적 정보 수동 정리
            channelRenameOperations.delete(channelId);
            channelOwnership.delete(channelId);
            transferRequests.delete(channelId);
            pendingPermissionUpdates.delete(channelId);
            channelLastInteraction.delete(channelId);
            return true;
        },
        // 수동으로 특정 서버의 모든 자동 생성 채널 추적 정리
        cleanupGuild: (guildId) => {
            createdChannels.delete(guildId);
            
            // AFK 채널 추적도 정리
            afkChannels.delete(guildId);
            
            return true;
        },
        // 수동으로 진행 중인 채널 이름 변경 작업 정리
        forceCompleteRenames: () => {
            for (const [channelId, operation] of channelRenameOperations) {
                operation.inProgress = false;
            }
            return true;
        }
    }
};