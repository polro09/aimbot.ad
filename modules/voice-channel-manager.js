// modules/voice-channel-manager.js - 음성 채널 자동 생성 및 관리 모듈

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, StringSelectMenuBuilder } = require('discord.js');
const storage = require('../storage');

// 스토리지 키
const STORAGE_KEY = 'voice-channels-config';

// 생성된 음성 채널 추적 맵
// Map<guildId, Map<parentChannelId, Array<createdChannelId>>>
const createdChannels = new Map();

// 부모 채널 설정 맵 (자동 생성 대상 채널)
// Map<guildId, Array<parentChannelId>>
const parentChannels = new Map();

// 사용자별 채널 소유 정보
// Map<channelId, {ownerId, createdAt}>
const channelOwnership = new Map();

// 소유자 이전 대기 목록
// Map<channelId, Set<userId>> - 채널 ID별 이전 요청 목록
const transferRequests = new Map();

// 설정 저장
async function saveConfig(log) {
    try {
        // 설정 데이터 생성
        const data = {};
        for (const [guildId, channelIds] of parentChannels.entries()) {
            data[guildId] = channelIds;
        }
        
        // 스토리지에 저장
        storage.setAll(STORAGE_KEY, data);
        await storage.save(STORAGE_KEY);
        
        return true;
    } catch (error) {
        if (log) log('ERROR', `음성 채널 설정 저장 중 오류: ${error.message}`);
        return false;
    }
}

// 설정 불러오기
async function loadConfig(log) {
    try {
        // 스토리지에서 로드
        await storage.load(STORAGE_KEY);
        const data = storage.getAll(STORAGE_KEY);
        
        // 데이터 적용
        for (const [guildId, channelIds] of Object.entries(data)) {
            parentChannels.set(guildId, channelIds);
        }
        
        if (log) log('INFO', '음성 채널 자동 생성 설정을 로드했습니다.');
        return true;
    } catch (error) {
        if (log) log('ERROR', `음성 채널 설정 로드 중 오류: ${error.message}`);
        return false;
    }
}

// 모듈 초기화 함수
async function init(client, log) {
    // 스토리지 초기화
    if (!storage.initialized) {
        await storage.init(log);
    }
    
    // 설정 로드
    await loadConfig(log);
    
    // 음성 상태 업데이트 이벤트 처리
    client.on('voiceStateUpdate', async (oldState, newState) => {
        try {
            const guildId = newState.guild.id;
            
            // 해당 서버에 자동 생성 채널이 설정되어 있는지 확인
            const autoCreateChannels = parentChannels.get(guildId);
            if (!autoCreateChannels || autoCreateChannels.length === 0) return;
            
            // 1. 사용자가 음성 채널에 입장한 경우
            if (newState.channelId && (!oldState.channelId || oldState.channelId !== newState.channelId)) {
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
            }
        } catch (error) {
            log('ERROR', `음성 채널 자동 생성 처리 중 오류 발생: ${error.message}`);
        }
    });
    
    // 버튼 상호작용 처리
    client.on('interactionCreate', async (interaction) => {
        // 버튼, 모달 제출, 또는 문자열 선택 메뉴만 처리
        if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;
        
        try {
            if (interaction.isButton()) {
                const [action, channelId] = interaction.customId.split(':');
                
                switch (action) {
                    case 'rename_channel':
                        await showRenameModal(interaction, channelId);
                        break;
                    case 'transfer_ownership':
                        await showTransferOwnershipMenu(interaction, channelId, client);
                        break;
                    case 'request_ownership':
                        await handleOwnershipRequest(interaction, channelId, client);
                        break;
                    case 'channel_info':
                        await showChannelInfo(interaction, channelId, client);
                        break;
                }
            } else if (interaction.isModalSubmit() && interaction.customId.startsWith('rename_modal:')) {
                const channelId = interaction.customId.split(':')[1];
                await renameChannel(interaction, channelId, client, log);
            } else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('transfer_owner:')) {
                const channelId = interaction.customId.split(':')[1];
                await transferOwnership(interaction, channelId, client, log);
            }
        } catch (error) {
            log('ERROR', `버튼 상호작용 처리 중 오류 발생: ${error.message}`);
            
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
    for (const guild of client.guilds.cache.values()) {
        try {
            const guildCreatedChannels = getCreatedChannelsForGuild(guild.id);
            if (!guildCreatedChannels) continue;
            
            for (const [parentId, channelIds] of guildCreatedChannels.entries()) {
                for (const channelId of channelIds) {
                    const channel = guild.channels.cache.get(channelId);
                    if (channel && channel.members.size === 0) {
                        await channel.delete();
                        log('INFO', `빈 자동 생성 채널 정리: ${channel.name} (${channel.id})`);
                        
                        // 소유권 정보 제거
                        channelOwnership.delete(channelId);
                    }
                }
            }
        } catch (error) {
            log('ERROR', `서버 ${guild.name}의 빈 채널 정리 중 오류 발생: ${error.message}`);
        }
    }
    
    log('MODULE', '음성 채널 관리 모듈이 초기화되었습니다.');
}
// 사용자가 부모 채널에 입장했을 때 처리
async function handleUserJoinParentChannel(state, client, log) {
    const guild = state.guild;
    const user = state.member.user;
    const parentChannel = state.channel;
    
    if (!parentChannel) return;
    
    try {
        // 속도 개선을 위해 비동기 작업을 즉시 시작
        // 사용자 닉네임 또는 이름 가져오기
        const creatorName = state.member.nickname || state.member.user.username;
        
        // 새 채널 생성 - 최대한 빠르게 생성
        const newChannel = await guild.channels.create({
            name: `🔊 ${creatorName}의 통화방`,
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
            ]
        });
        
        // 채널 생성 후 사용자 이동 (적절한 지연으로 처리)
        setTimeout(() => {
            state.setChannel(newChannel).catch(e => {
                if (log) log('ERROR', `사용자 이동 중 오류 발생: ${e.message}`);
            });
        }, 500); // 500ms 지연 - Discord API 안정성과 사용자 경험 사이의 균형점
        
        // 채널 소유권 정보 저장
        channelOwnership.set(newChannel.id, {
            ownerId: state.member.id,
            createdAt: new Date()
        });
        
        // 생성된 채널 추적
        addCreatedChannel(guild.id, parentChannel.id, newChannel.id);
        
        // DM 메시지 전송 (비동기 백그라운드 처리)
        sendChannelControlsMessage(user, newChannel).catch(e => {
            if (log) log('ERROR', `DM 메시지 전송 중 오류 발생: ${e.message}`);
        });
        
        if (log) log('INFO', `새 음성 채널 생성됨: ${newChannel.name} (${newChannel.id}) - 소유자: ${creatorName}`);
        
        return true;
    } catch (error) {
        if (log) log('ERROR', `새 음성 채널 생성 중 오류 발생: ${error.message}`);
        return false;
    }
}

// 사용자가 채널에 입장했을 때 처리 (소유권 이전 요청 확인)
async function handleUserJoinChannel(state, client, log) {
    const channelId = state.channelId;
    const userId = state.member.id;
    
    // 채널 ID가 없거나 소유권 요청이 없으면 무시
    if (!channelId || !transferRequests.has(channelId)) return;
    
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
                // 소유권 정보 업데이트
                ownerData.ownerId = userId;
                channelOwnership.set(channelId, ownerData);
                
                // 채널 권한 업데이트
                await channel.permissionOverwrites.edit(userId, {
                    ManageChannels: true,
                    MuteMembers: true,
                    DeafenMembers: true,
                    MoveMembers: true
                });
                
                // 요청 목록에서 제거
                requestSet.delete(userId);
                if (requestSet.size === 0) {
                    transferRequests.delete(channelId);
                }
                
                // 채널에 소유권 이전 알림
                try {
                    const transferEmbed = new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle('👑 소유권 이전')
                        .setDescription(`<@${userId}>님이 이 통화방의 새 소유자가 되었습니다.`)
                        .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                        .setTimestamp();
                    
                    await channel.send({ embeds: [transferEmbed] });
                    
                    if (log) log('INFO', `채널 ${channel.name} (${channelId})의 소유권이 자동으로 ${userId}에게 이전되었습니다.`);
                } catch (error) {
                    log('ERROR', `소유권 이전 알림 중 오류 발생: ${error.message}`);
                }
            }
        } catch (error) {
            log('ERROR', `소유권 자동 이전 중 오류 발생: ${error.message}`);
        }
    }
}

// 소유자가 채널을 떠났을 때 처리
async function handleOwnerLeftChannel(state, client, log) {
    const channelId = state.channelId;
    const userId = state.member.id;
    
    // 채널 ID가 없거나 소유자가 아니면 무시
    if (!channelId || !isChannelOwner(userId, channelId)) return;
    
    try {
        const channel = state.channel;
        if (!channel || channel.members.size === 0) return; // 빈 채널이면 무시 (cleanupEmptyChannels에서 처리)
        
        // 남아있는 멤버 중 첫 번째 멤버에게 소유권 이전
        const newOwnerId = channel.members.first().id;
        
        // 소유권 정보 업데이트
        const ownerData = channelOwnership.get(channelId);
        if (ownerData) {
            ownerData.ownerId = newOwnerId;
            channelOwnership.set(channelId, ownerData);
            
            // 채널 권한 업데이트
            await channel.permissionOverwrites.edit(newOwnerId, {
                ManageChannels: true,
                MuteMembers: true,
                DeafenMembers: true,
                MoveMembers: true
            });
            
            // 이전 소유자 권한 제거
            await channel.permissionOverwrites.delete(userId);
            
            // 채널에 소유권 이전 알림
            try {
                const transferEmbed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('👑 소유권 자동 이전')
                    .setDescription(`<@${newOwnerId}>님이 이 통화방의 새 소유자가 되었습니다.`)
                    .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                    .setTimestamp();
                
                await channel.send({ embeds: [transferEmbed] });
                
                if (log) log('INFO', `채널 ${channel.name} (${channelId})의 소유권이 자동으로 ${newOwnerId}에게 이전되었습니다.`);
            } catch (error) {
                log('ERROR', `소유권 이전 알림 중 오류 발생: ${error.message}`);
            }
        }
    } catch (error) {
        log('ERROR', `소유자 퇴장 처리 중 오류 발생: ${error.message}`);
    }
}

// 빈 자동 생성 채널 정리
async function cleanupEmptyChannels(state, log) {
    const guild = state.guild;
    const channel = state.channel;
    
    if (!channel) return;
    
    try {
        // 채널이 비어 있고 자동 생성된 채널인지 확인
        if (channel.members.size === 0 && isCreatedChannel(guild.id, channel.id)) {
            // 채널 삭제
            await channel.delete();
            
            // 추적 목록에서 제거
            removeCreatedChannel(guild.id, channel.id);
            
            // 소유권 정보 제거
            channelOwnership.delete(channel.id);
            
            // 소유권 요청 목록에서 제거
            transferRequests.delete(channel.id);
            
            if (log) log('INFO', `빈 음성 채널 삭제됨: ${channel.name} (${channel.id})`);
            
            return true;
        }
    } catch (error) {
        if (log) log('ERROR', `빈 채널 정리 중 오류 발생: ${error.message}`);
    }
    
    return false;
}

// 채널 관리 메시지 전송
async function sendChannelControlsMessage(user, channel) {
    try {
        // 임베드 생성 - 더 세련되고 가독성 있는 디자인
        const embed = new EmbedBuilder()
            .setColor('#5865F2') // Discord 브랜드 색상으로 변경
            .setTitle('🎧 통화방이 생성되었습니다!')
            .setDescription(`**${channel.name}** 통화방이 성공적으로 생성되었습니다.\n아래 버튼으로 통화방을 관리하세요.`)
            .setThumbnail('https://i.imgur.com/6YToyEF.png')
            .addFields(
                { 
                    name: '📝 이름 변경', 
                    value: '통화방의 이름을 원하는대로 변경할 수 있습니다.', 
                    inline: true 
                },
                { 
                    name: '👑 소유권 이전', 
                    value: '다른 사용자에게 통화방 관리 권한을 넘길 수 있습니다.', 
                    inline: true 
                },
                { 
                    name: 'ℹ️ 채널 정보', 
                    value: '통화방 생성 시간, 참가자 수 등을 확인할 수 있습니다.', 
                    inline: true 
                }
            )
            .addFields(
                { 
                    name: '소유자 권한', 
                    value: '👑 채널 소유자는 다음 권한을 가집니다:\n• 채널 이름 변경\n• 사용자 음소거/귓속말\n• 사용자 내보내기\n• 소유권 이전', 
                    inline: false 
                }
            )
            .setImage('https://i.imgur.com/qwJpfaZ.gif') // 환영 이미지 추가
            .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
        
        // 버튼 생성 - 동일한 기능이지만 세련된 디자인
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`rename_channel:${channel.id}`)
                    .setLabel('이름 변경')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📝'),
                new ButtonBuilder()
                    .setCustomId(`transfer_ownership:${channel.id}`)
                    .setLabel('소유권 이전')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('👑'),
                new ButtonBuilder()
                    .setCustomId(`channel_info:${channel.id}`)
                    .setLabel('채널 정보')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('ℹ️')
            );
        
        // DM으로 전송
        await user.send({ embeds: [embed], components: [row] });
        
    } catch (error) {
        console.error(`음성 채널 관리 메시지 전송 중 오류 발생: ${error.message}`);
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
// 채널 이름 변경 모달 표시
async function showRenameModal(interaction, channelId) {
    try {
        // 소유권 확인
        if (!validateChannelOwnership(interaction.user.id, channelId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')  // 빨간색 (오류)
                .setTitle('⚠️ 권한 오류')
                .setDescription('자신이 생성한 채널만 관리할 수 있습니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
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
        
        // 모달 표시 - 예외 처리 없이 (에러 시 discord.js가 자체 처리)
        return await interaction.showModal(modal);
    } catch (error) {
        console.error(`채널 이름 변경 모달 표시 중 오류 발생: ${error.message}`);
        
        // 오류 발생 시 사용자에게 알림 (응답하지 않았다면)
        if (!interaction.replied && !interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 오류 발생')
                .setDescription('이름 변경 모달을 표시할 수 없습니다. 나중에 다시 시도해주세요.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
        }
    }
}

// 채널 이름 변경 처리
async function renameChannel(interaction, channelId, client, log) {
    try {
        // 먼저 응답을 지연시킴 (3초 타임아웃 방지)
        await interaction.deferReply({ ephemeral: true });
        
        // 유효성 검사
        if (!validateChannelOwnership(interaction.user.id, channelId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 권한 오류')
                .setDescription('자신이 생성한 채널만 관리할 수 있습니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 사용자 입력 가져오기
        let newName = interaction.fields.getTextInputValue('channel_name');
        
        // 채널 가져오기
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 채널 찾기 오류')
                .setDescription('채널을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 이모지 접두사 추가
        if (!newName.startsWith('🔊')) {
            newName = `🔊 ${newName}`;
        }
        
        try {
            // 이름 변경 시도
            await channel.setName(newName);
            
            // 성공 임베드 생성
            const successEmbed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ 채널 이름 변경 완료')
                .setDescription(`통화방 이름이 **${newName}**으로 변경되었습니다.`)
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
            
            // 응답
            await interaction.editReply({ embeds: [successEmbed] });
            
            if (log) log('INFO', `${interaction.user.tag}님이 음성 채널 이름을 "${newName}"으로 변경했습니다.`);
        } catch (err) {
            // 이름 변경 실패
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 이름 변경 오류')
                .setDescription(`채널 이름을 변경하지 못했습니다.\n사유: ${err.message}`)
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
    } catch (error) {
        log('ERROR', `채널 이름 변경 처리 중 오류 발생: ${error.message}`);
        
        // 이미 응답했거나 지연했는지 확인
        if (interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 오류 발생')
                .setDescription('예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
        }
    }
}

// 소유권 이전 메뉴 표시
async function showTransferOwnershipMenu(interaction, channelId, client) {
    try {
        // 먼저 응답을 지연시킴 (3초 타임아웃 방지)
        await interaction.deferReply({ ephemeral: true });
        
        // 유효성 검사
        if (!validateChannelOwnership(interaction.user.id, channelId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')  // 빨간색 (오류)
                .setTitle('⚠️ 권한 오류')
                .setDescription('자신이 생성한 채널만 관리할 수 있습니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 채널 가져오기
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')  // 빨간색 (오류)
                .setTitle('⚠️ 채널 찾기 오류')
                .setDescription('채널을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 채널에 있는 다른 멤버 목록 가져오기
        const otherMembers = channel.members.filter(member => member.id !== interaction.user.id);
        
        if (otherMembers.size === 0) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FEE75C')  // 노란색 (경고)
                .setTitle('⚠️ 소유권 이전 불가')
                .setDescription('통화방에 다른 사용자가 없습니다.\n소유권을 이전할 사용자가 통화방에 입장해 있어야 합니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 멤버 목록 생성
        const membersList = otherMembers.map(member => 
            `• <@${member.id}> (${member.user.tag})`
        ).join('\n');
        
        // 임베드 생성
        const transferEmbed = new EmbedBuilder()
            .setColor('#5865F2')  // Discord 브랜드 색상
            .setTitle('👑 통화방 소유권 이전')
            .setDescription('소유권을 이전할 사용자를 선택해주세요.')
            .addFields(
                { 
                    name: '현재 통화방에 있는 사용자', 
                    value: membersList,
                    inline: false
                },
                {
                    name: '소유권 이전 설명',
                    value: '소유권을 이전하면 선택한 사용자가 채널 이름 변경, 사용자 관리 등의 권한을 갖게 됩니다.',
                    inline: false
                }
            )
            .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
        
        // 선택 메뉴 옵션 생성
        const options = otherMembers.map(member => ({
            label: member.user.username,
            description: member.user.tag,
            value: member.id
        }));
        
        // StringSelectMenu 사용 (UserSelectMenu 대신)
        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`transfer_owner:${channelId}`)
                    .setPlaceholder('소유권을 이전할 사용자 선택')
                    .addOptions(options)
            );
        
        // 응답
        await interaction.editReply({
            embeds: [transferEmbed],
            components: [row]
        });
    } catch (error) {
        console.error(`소유권 이전 메뉴 표시 중 오류 발생: ${error.message}`);
        
        if (interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 오류 발생')
                .setDescription('예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
        }
    }
}

// 소유권 이전 처리
async function transferOwnership(interaction, channelId, client, log) {
    try {
        // 먼저 응답을 지연시킴 (3초 타임아웃 방지)
        await interaction.deferReply({ ephemeral: true });
        
        // 유효성 검사
        if (!validateChannelOwnership(interaction.user.id, channelId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 권한 오류')
                .setDescription('자신이 생성한 채널만 관리할 수 있습니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 채널 가져오기
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 채널 찾기 오류')
                .setDescription('채널을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 선택한 새 소유자 ID
        const newOwnerId = interaction.values[0];
        
        // 채널에 새 소유자가 있는지 확인
        const newOwnerMember = channel.members.get(newOwnerId);
        if (!newOwnerMember) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ 소유권 이전 불가')
                .setDescription('선택한 사용자가 현재 통화방에 없습니다. 소유권을 이전할 사용자가 통화방에 입장해 있어야 합니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        try {
            // 소유권 정보 업데이트
            const ownerData = channelOwnership.get(channelId);
            if (ownerData) {
                ownerData.ownerId = newOwnerId;
                channelOwnership.set(channelId, ownerData);
                
                // 새 소유자에게 권한 부여
                await channel.permissionOverwrites.edit(newOwnerId, {
                    ManageChannels: true,
                    MuteMembers: true,
                    DeafenMembers: true,
                    MoveMembers: true
                });
                
                // 이전 소유자(자신) 권한 제거
                await channel.permissionOverwrites.delete(interaction.user.id);
                
                // 성공 임베드
                const successEmbed = new EmbedBuilder()
                    .setColor('#57F287')
                    .setTitle('✅ 소유권 이전 완료')
                    .setDescription(`<@${newOwnerId}>님에게 통화방 소유권이 이전되었습니다.`)
                    .addFields(
                        { 
                            name: '변경된 권한', 
                            value: '새 소유자는 이제 통화방을 관리할 수 있는 모든 권한을 가집니다.', 
                            inline: false 
                        }
                    )
                    .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                    .setTimestamp();
                
                // 응답
                await interaction.editReply({ embeds: [successEmbed] });
                
                // 채널에 소유권 이전 알림 (임베드 사용)
                const channelNotifyEmbed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('👑 소유권 이전')
                    .setDescription(`<@${interaction.user.id}>님이 <@${newOwnerId}>님에게 통화방 소유권을 이전했습니다.`)
                    .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                    .setTimestamp();
                
                await channel.send({ embeds: [channelNotifyEmbed] });
                
                if (log) log('INFO', `${interaction.user.tag}님이 채널 ${channel.name} (${channelId})의 소유권을 ${newOwnerId}에게 이전했습니다.`);
            } else {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('⚠️ 소유권 정보 오류')
                    .setDescription('채널 소유권 정보를 찾을 수 없습니다.')
                    .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                    .setTimestamp();
                    
                return await interaction.editReply({ embeds: [errorEmbed] });
            }
        } catch (err) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 소유권 이전 오류')
                .setDescription(`소유권을 이전하는 중 오류가 발생했습니다.\n사유: ${err.message}`)
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
    } catch (error) {
        log('ERROR', `소유권 이전 처리 중 오류 발생: ${error.message}`);
        
        if (interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 오류 발생')
                .setDescription('예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
        }
    }
}

// 소유권 요청 처리
async function handleOwnershipRequest(interaction, channelId, client) {
    try {
        // 먼저 응답을 지연시킴 (3초 타임아웃 방지)
        await interaction.deferReply({ ephemeral: true });
        
        // 채널 가져오기
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 채널 찾기 오류')
                .setDescription('채널을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 이미 소유자인지 확인
        if (isChannelOwner(interaction.user.id, channelId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ 소유권 요청 불가')
                .setDescription('이미 이 통화방의 소유자입니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 채널 정보 확인
        const ownerData = channelOwnership.get(channelId);
        if (!ownerData) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 채널 정보 오류')
                .setDescription('채널 소유권 정보를 찾을 수 없습니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 현재 소유자가 채널에 있는지 확인
        const currentOwner = channel.members.get(ownerData.ownerId);
        if (currentOwner) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ 소유권 요청 불가')
                .setDescription('현재 소유자가 통화방에 있습니다. 소유자에게 직접 소유권 이전을 요청하세요.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 요청 등록
        if (!transferRequests.has(channelId)) {
            transferRequests.set(channelId, new Set());
        }
        transferRequests.get(channelId).add(interaction.user.id);
        
        // 성공 임베드
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 소유권 요청 등록 완료')
            .setDescription('소유권 요청이 등록되었습니다.')
            .addFields(
                { 
                    name: '자동 이전 조건', 
                    value: '통화방에 원래 소유자가 입장하지 않으면 당신이 통화방에 들어갔을 때 자동으로 소유권이 이전됩니다.', 
                    inline: false 
                }
            )
            .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
            .setTimestamp();
        
        // 응답
        await interaction.editReply({ embeds: [successEmbed] });
        
    } catch (error) {
        console.error(`소유권 요청 처리 중 오류 발생: ${error.message}`);
        
        if (interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 오류 발생')
                .setDescription('예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
        }
    }
}

// 채널 정보 표시
async function showChannelInfo(interaction, channelId, client) {
    try {
        // 먼저 응답을 지연시킴 (3초 타임아웃 방지)
        await interaction.deferReply({ ephemeral: true });
        
        // 채널 가져오기
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 채널 찾기 오류')
                .setDescription('채널을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        // 채널 소유권 정보 확인
        const ownerData = channelOwnership.get(channelId);
        if (!ownerData) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 정보 없음')
                .setDescription('채널 정보를 찾을 수 없습니다.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
        
        try {
            // 필요한 정보 추출
            const createdAt = ownerData.createdAt;
            const memberCount = channel.members.size;
            
            // 소유자 정보 가져오기
            const owner = await client.users.fetch(ownerData.ownerId).catch(() => null);
            const ownerName = owner ? owner.tag : '알 수 없음';
            
            // 시간 포맷팅
            const createdTimeStr = createdAt.toLocaleString('ko-KR', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            
            // 소유자 여부 확인
            const isOwner = ownerData.ownerId === interaction.user.id;
            
            // 현재 참가자 목록 생성
            let membersList = '';
            if (memberCount > 0) {
                const memberEntries = [...channel.members.values()].map(member => 
                    `• ${member.user.tag}${member.id === ownerData.ownerId ? ' 👑' : ''}`
                );
                membersList = memberEntries.join('\n');
            } else {
                membersList = '현재 참가자가 없습니다.';
            }
            
            // 임베드 생성
            const infoEmbed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle(`ℹ️ 채널 정보: ${channel.name}`)
                .setDescription('통화방에 대한 상세 정보입니다.')
                .addFields(
                    { name: '👤 생성자', value: ownerName, inline: true },
                    { name: '🕒 생성 시간', value: createdTimeStr, inline: true },
                    { name: '👥 참가자 수', value: `${memberCount}명`, inline: true },
                    { name: '👑 소유권', value: isOwner ? '당신' : `<@${ownerData.ownerId}>`, inline: true }
                )
                .addFields(
                    { name: '현재 참가자', value: membersList, inline: false }
                )
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
            
            // 소유자가 아니고 통화방에 소유자가 없다면 소유권 요청 버튼 제공
            let components = [];
            if (!isOwner && !channel.members.has(ownerData.ownerId)) {
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`request_ownership:${channelId}`)
                            .setLabel('소유권 요청')
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('👑')
                    );
                components = [row];
            }
            
            return await interaction.editReply({ 
                embeds: [infoEmbed],
                components: components
            });
        } catch (err) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 정보 처리 오류')
                .setDescription(`채널 정보를 불러오는 중 오류가 발생했습니다.\n사유: ${err.message}`)
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] });
        }
    } catch (error) {
        console.error(`채널 정보 표시 중 오류 발생: ${error.message}`);
        
        // 이미 응답했거나 지연했는지 확인
        if (interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⚠️ 오류 발생')
                .setDescription('예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed] }).catch(() => {});
        }
    }
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
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
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
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        } else {
            const alreadySetEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ 이미 설정됨')
                .setDescription(`채널 <#${channel.id}>은(는) 이미 설정되어 있습니다.`)
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
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
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [removeEmbed], ephemeral: true });
        } else {
            const notSetEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ 설정되지 않음')
                .setDescription(`채널 <#${channel.id}>은(는) 설정되어 있지 않습니다.`)
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
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
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
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
                .setFooter({ text: 'Sea Dogs Tavern', iconURL: 'https://i.imgur.com/wSTFkRM.png' })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [listEmbed], ephemeral: true });
        }
    }
}

module.exports = {
    name: 'voice-channel-manager',
    description: '사용자 음성 통화방 자동 생성 및 관리 모듈',
    version: '1.1.0',
    commands: ['음성채널설정'],
    enabled: true,
    init,
    executeSlashCommand,
    slashCommands
};