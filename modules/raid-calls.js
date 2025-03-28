// modules/raid-call.js - 레이드 콜 시스템 모듈

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, StringSelectMenuBuilder } = require('discord.js');
const storage = require('../storage');

// 스토리지 키
const CONFIG_STORAGE_KEY = 'raid-call-config';
const RAIDS_STORAGE_KEY = 'raid-calls';

// 서버별 설정 저장
let guildSettings = new Map();

// 활성화된 레이드 콜 저장
let activeRaidCalls = new Map();

// 저장된 설정 불러오기
async function loadSettings(log) {
    try {
        await storage.load(CONFIG_STORAGE_KEY);
        const configData = storage.getAll(CONFIG_STORAGE_KEY);
        
        if (configData) {
            // Map으로 변환
            guildSettings = new Map(Object.entries(configData));
        }
        
        await storage.load(RAIDS_STORAGE_KEY);
        const raidsData = storage.getAll(RAIDS_STORAGE_KEY);
        
        if (raidsData) {
            // Map으로 변환
            activeRaidCalls = new Map();
            
            // 데이터 구조 복원 (중첩된 Map)
            for (const [guildId, raids] of Object.entries(raidsData)) {
                const guildRaids = new Map();
                for (const [raidId, raidData] of Object.entries(raids)) {
                    guildRaids.set(raidId, raidData);
                }
                activeRaidCalls.set(guildId, guildRaids);
            }
        }
        
        if (log) log('INFO', '레이드 콜 시스템 설정을 로드했습니다.');
        return true;
    } catch (error) {
        if (log) log('ERROR', `레이드 콜 시스템 설정 로드 중 오류: ${error.message}`);
        return false;
    }
}

// 설정 저장하기
async function saveSettings(log) {
    try {
        // Map을 객체로 변환
        const configData = Object.fromEntries(guildSettings);
        
        // 스토리지에 저장
        storage.setAll(CONFIG_STORAGE_KEY, configData);
        await storage.save(CONFIG_STORAGE_KEY);
        
        // 활성화된 레이드 콜 저장
        const raidsData = {};
        for (const [guildId, raids] of activeRaidCalls.entries()) {
            raidsData[guildId] = Object.fromEntries(raids);
        }
        
        storage.setAll(RAIDS_STORAGE_KEY, raidsData);
        await storage.save(RAIDS_STORAGE_KEY);
        
        if (log) log('INFO', '레이드 콜 시스템 설정을 저장했습니다.');
        return true;
    } catch (error) {
        if (log) log('ERROR', `레이드 콜 시스템 설정 저장 중 오류: ${error.message}`);
        return false;
    }
}

// 서버 설정 업데이트
function updateGuildSettings(guildId, settings, log) {
    guildSettings.set(guildId, settings);
    saveSettings(log);
}

// 활성화된 레이드 콜 업데이트
function updateRaidCall(guildId, raidId, raidData, log) {
    if (!activeRaidCalls.has(guildId)) {
        activeRaidCalls.set(guildId, new Map());
    }
    
    const guildRaids = activeRaidCalls.get(guildId);
    guildRaids.set(raidId, raidData);
    
    saveSettings(log);
}

// 레이드 콜 삭제
function deleteRaidCall(guildId, raidId, log) {
    if (!activeRaidCalls.has(guildId)) return false;
    
    const guildRaids = activeRaidCalls.get(guildId);
    const result = guildRaids.delete(raidId);
    
    if (result) {
        saveSettings(log);
    }
    
    return result;
}

// 레이드 콜 임베드 생성
async function createRaidCallEmbed(interaction, client, log) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const channel = interaction.options.getChannel('채널');
        
        // 채널 권한 확인 수정된 부분
        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (!permissions || !permissions.has(PermissionFlagsBits.SendMessages)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription(`${channel} 채널에 메시지를 보낼 권한이 없습니다.`)
                .addFields({ name: '해결 방법', value: '봇에게 필요한 권한을 부여해주세요.', inline: false })
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 서버 설정 가져오기 또는 생성
        let settings = guildSettings.get(interaction.guild.id) || {};
        settings.raidCallChannel = channel.id;
        
        // 설정 저장
        updateGuildSettings(interaction.guild.id, settings, log);
        
        // 레이드 콜 임베드 생성
        const raidCallEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🗡️ 레이드 콜 시스템')
            .setDescription('아래 버튼을 클릭하여 새 레이드 콜을 생성하세요.\n파티원을 모집하고 레이드를 관리할 수 있습니다.')
            .addFields(
                { 
                    name: '📋 레이드 콜 사용 방법', 
                    value: '1️⃣ 아래 버튼을 클릭하여 새 레이드 콜을 생성합니다.\n2️⃣ 레이드 정보를 입력합니다.\n3️⃣ 생성된 레이드 콜에 참가자를 모집합니다.', 
                    inline: false 
                },
                { 
                    name: '✅ 레이드 관리 기능', 
                    value: '• 📝 레이드 정보 변경\n• 👥 참가자 관리\n• 🔔 레이드 알림\n• 🗑️ 레이드 취소', 
                    inline: false 
                }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 레이드 생성 버튼
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('create_raid_call')
                    .setLabel('레이드 콜 시작')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🗡️')
            );
        
        // 채널에 임베드와 버튼 전송
        const message = await channel.send({ 
            embeds: [raidCallEmbed], 
            components: [row] 
        });
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 레이드 콜 시스템 설정 완료')
            .setDescription(`${channel} 채널에 레이드 콜 임베드를 성공적으로 생성했습니다.`)
            .addFields({ name: '✨ 다음 단계', value: '이제 사용자들이 레이드 콜을 생성할 수 있습니다.', inline: false })
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [successEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}가 ${interaction.guild.name} 서버의 ${channel.name} 채널에 레이드 콜 임베드를 생성했습니다.`);
        
    } catch (error) {
        log('ERROR', `레이드 콜 임베드 생성 중 오류 발생: ${error.message}`);
        
        if (interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 오류 발생')
                .setDescription(`레이드 콜 임베드 생성 중 오류가 발생했습니다: ${error.message}`)
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            await interaction.editReply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
        }
    }
}

// 알람 채널 설정
async function setAlarmChannel(interaction, client, log) {
    try {
        const channel = interaction.options.getChannel('채널');
        
        // 채널 권한 확인 수정된 부분
        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (!permissions || !permissions.has(PermissionFlagsBits.SendMessages)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription(`${channel} 채널에 메시지를 보낼 권한이 없습니다.`)
                .addFields({ name: '해결 방법', value: '봇에게 필요한 권한을 부여해주세요.', inline: false })
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 서버 설정 가져오기 또는 생성
        let settings = guildSettings.get(interaction.guild.id) || {};
        settings.alarmChannel = channel.id;
        
        // 설정 저장
        updateGuildSettings(interaction.guild.id, settings, log);
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 레이드 알람 채널 설정 완료')
            .setDescription(`레이드 알람 채널이 ${channel}(으)로 설정되었습니다.`)
            .addFields({ name: '✨ 다음 단계', value: '이제 레이드 콜이 생성될 때 이 채널에 알림이 전송됩니다.', inline: false })
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}가 ${interaction.guild.name} 서버의 레이드 알람 채널을 ${channel.name}으로 설정했습니다.`);
        
    } catch (error) {
        log('ERROR', `레이드 알람 채널 설정 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`레이드 알람 채널 설정 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 레이드 콜 생성 모달 표시
async function showRaidCallModal(interaction, client, log) {
    try {
        // 모달 생성
        const modal = new ModalBuilder()
            .setCustomId('raid_call_modal')
            .setTitle('레이드 콜 생성');
        
        // 텍스트 입력 필드 추가
        const dungeonNameInput = new TextInputBuilder()
            .setCustomId('dungeon_name')
            .setLabel('던전/레이드 이름')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('예: 아포칼립스, 카오스, 발할라 등')
            .setRequired(true);
        
        const dateInput = new TextInputBuilder()
            .setCustomId('date')
            .setLabel('날짜')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('YYYY-MM-DD 형식 (예: 2023-12-25)')
            .setRequired(true);
        
        const timeInput = new TextInputBuilder()
            .setCustomId('time')
            .setLabel('시간')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('HH:MM 형식 (예: 19:30)')
            .setRequired(true);
        
        const requiredLevelInput = new TextInputBuilder()
            .setCustomId('required_level')
            .setLabel('요구 레벨/장비')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('예: 레벨 60 이상, 아이템 레벨 900+ 등')
            .setRequired(true);
        
        const descriptionInput = new TextInputBuilder()
            .setCustomId('description')
            .setLabel('설명 (선택 사항)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('추가 설명, 참여 요건, 파티 구성 등을 적어주세요.')
            .setRequired(false);
        
        // 액션 로우에 텍스트 입력 필드 추가
        const firstActionRow = new ActionRowBuilder().addComponents(dungeonNameInput);
        const secondActionRow = new ActionRowBuilder().addComponents(dateInput);
        const thirdActionRow = new ActionRowBuilder().addComponents(timeInput);
        const fourthActionRow = new ActionRowBuilder().addComponents(requiredLevelInput);
        const fifthActionRow = new ActionRowBuilder().addComponents(descriptionInput);
        
        // 모달에 액션 로우 추가
        modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow, fifthActionRow);
        
        // 모달 표시
        await interaction.showModal(modal);
        
        log('INFO', `${interaction.user.tag}님에게 레이드 콜 생성 모달을 표시했습니다.`);
    } catch (error) {
        log('ERROR', `레이드 콜 모달 표시 중 오류 발생: ${error.message}`);
    }
}

// 직업 선택 메뉴 표시 (모달 대신 스크롤 박스로 변경) - 직업명 수정
async function showClassSelectionMenu(interaction, raidId, client, log) {
    try {
        const guildId = interaction.guild.id;
        
        // 레이드 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(raidId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 레이드 찾기 오류')
                .setDescription('레이드 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 레이드일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const raidData = guildRaids.get(raidId);
        
        // 사용자가 이미 참가 중인지 확인
        const isParticipating = raidData.participants.some(p => p.userId === interaction.user.id);
        
        // 직업 목록 (요청한 직업명으로 수정)
        const classOptions = [
            {
                label: '엘레멘탈 나이트',
                description: '-',
                value: `class_elemental_knight:${raidId}`,
                emoji: '⚔️'
            },
            {
                label: '세인트 바드',
                description: '-',
                value: `class_saint_bard:${raidId}`,
                emoji: '🎵'
            },
            {
                label: '알케믹 스팅어',
                description: '-',
                value: `class_alchemic_stinger:${raidId}`,
                emoji: '🧪'
            },
            {
                label: '다크 메이지',
                description: '-',
                value: `class_dark_mage:${raidId}`,
                emoji: '🔮'
            },
            {
                label: '세이크리드 가드',
                description: '-',
                value: `class_sacred_guard:${raidId}`,
                emoji: '🛡️'
            },
            {
                label: '블래스트 랜서',
                description: '-',
                value: `class_blast_lancer:${raidId}`,
                emoji: '🏹'
            }
        ];
        
        // 버튼 및 선택 메뉴 생성
        const components = [];
        
        // 선택 메뉴 생성
        const classSelectionRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`class_selection:${raidId}`)
                    .setPlaceholder('참가할 직업을 선택하세요')
                    .addOptions(classOptions)
            );
        
        components.push(classSelectionRow);
        
        // 이미 참가 중인 경우 참가 취소 버튼 추가
        if (isParticipating) {
            const cancelButtonRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`cancel_participation:${raidId}`)
                        .setLabel('참가 취소')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❌')
                );
            
            components.push(cancelButtonRow);
        }
        
        // 설명 임베드
        const selectionEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🧙‍♂️ 레이드 참가 직업 선택')
            .setDescription(`**${raidData.dungeonName}** 레이드에 참가할 직업을 선택해주세요.`)
            .addFields(
                { name: '📅 레이드 일시', value: `${raidData.date} ${raidData.time}`, inline: true },
                { name: '⚙️ 요구 사항', value: raidData.requiredLevel, inline: true }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.reply({ 
            embeds: [selectionEmbed], 
            components: components,
            ephemeral: true 
        });
        
        log('INFO', `${interaction.user.tag}님에게 직업 선택 메뉴를 표시했습니다. 레이드 ID: ${raidId}`);
    } catch (error) {
        log('ERROR', `직업 선택 메뉴 표시 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`직업 선택 메뉴 표시 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}
// 레이드 콜 생성 처리
async function handleRaidCallCreation(interaction, client, log) {
    try {
        // 서버 설정 확인
        const guildId = interaction.guild.id;
        const settings = guildSettings.get(guildId);
        
        if (!settings || !settings.alarmChannel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 설정 오류')
                .setDescription('레이드 알람 채널이 설정되지 않았습니다.')
                .addFields({ name: '해결 방법', value: '관리자에게 문의하여 `/레이드알람채널` 명령어로 채널을 설정해달라고 요청하세요.', inline: false })
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 입력값 가져오기
        const dungeonName = interaction.fields.getTextInputValue('dungeon_name');
        const date = interaction.fields.getTextInputValue('date');
        const time = interaction.fields.getTextInputValue('time');
        const requiredLevel = interaction.fields.getTextInputValue('required_level');
        const description = interaction.fields.getTextInputValue('description') || '추가 설명 없음';
        
        // 유효성 검사
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const timeRegex = /^\d{2}:\d{2}$/;
        
        if (!dateRegex.test(date)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 입력 오류')
                .setDescription('날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해주세요.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        if (!timeRegex.test(time)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 입력 오류')
                .setDescription('시간 형식이 올바르지 않습니다. HH:MM 형식으로 입력해주세요.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 레이드 고유 ID 생성
        const raidId = Date.now().toString();
        
        // 레이드 데이터 생성
        const raidData = {
            id: raidId,
            dungeonName,
            date,
            time,
            requiredLevel,
            description,
            createdBy: interaction.user.id,
            createdAt: new Date().toISOString(),
            participants: [] // 참가자 배열
        };
        
        // 레이드 데이터 저장
        updateRaidCall(guildId, raidId, raidData, log);
        
        // 레이드 콜 임베드 생성
        const raidEmbed = createRaidEmbed(raidData, interaction.user, interaction.guild);
        
        // 컨트롤 메뉴 생성
        const controlRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`raid_control:${raidId}`)
                    .setPlaceholder('레이드 관리 메뉴')
                    .addOptions([
                        {
                            label: '레이드 정보 변경',
                            description: '레이드 정보를 수정합니다',
                            value: `edit_raid:${raidId}`,
                            emoji: '📝'
                        },
                        {
                            label: '참가 신청',
                            description: '레이드에 참가 신청합니다',
                            value: `join_raid:${raidId}`,
                            emoji: '✅'
                        },
                        {
                            label: '레이드 취소',
                            description: '레이드를 취소합니다',
                            value: `cancel_raid:${raidId}`,
                            emoji: '🗑️'
                        }
                    ])
            );
        
        // 알람 채널에 레이드 콜 임베드 전송
        const alarmChannel = interaction.guild.channels.cache.get(settings.alarmChannel);
        if (!alarmChannel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 채널 오류')
                .setDescription('레이드 알람 채널을 찾을 수 없습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const message = await alarmChannel.send({
            content: '@everyone 새로운 레이드 콜이 생성되었습니다!',
            embeds: [raidEmbed],
            components: [controlRow]
        });
        
        // 메시지 ID 저장
        raidData.messageId = message.id;
        updateRaidCall(guildId, raidId, raidData, log);
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 레이드 콜 생성 완료')
            .setDescription(`레이드 콜이 성공적으로 생성되었습니다.\n[메시지로 이동](${message.url})`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}님이 '${dungeonName}' 레이드 콜을 생성했습니다.`);
        
    } catch (error) {
        log('ERROR', `레이드 콜 생성 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`레이드 콜 생성 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 레이드 임베드 생성 함수
function createRaidEmbed(raidData, user, guild) {
    // 참가자 정보 구성
    let participantsField = '아직 참가자가 없습니다.';
    
    if (raidData.participants && raidData.participants.length > 0) {
        participantsField = raidData.participants.map((p, index) => 
            `${index + 1}. <@${p.userId}> - ${p.class || '직업 미설정'}`
        ).join('\n');
    }
    
    // 임베드 생성
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`🗡️ ${raidData.dungeonName} 레이드 모집`)
        .setDescription(`**${raidData.date} ${raidData.time}**에 진행되는 레이드입니다.`)
        .addFields(
            { name: '📅 날짜 및 시간', value: `${raidData.date} ${raidData.time}`, inline: true },
            { name: '⚔️ 던전/레이드', value: raidData.dungeonName, inline: true },
            { name: '⚙️ 요구 사항', value: raidData.requiredLevel, inline: true },
            { name: '📝 상세 설명', value: raidData.description, inline: false },
            { name: '👥 참가자 목록', value: participantsField, inline: false }
        )
        .setFooter({ text: `생성자: ${user.tag}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp(new Date(raidData.createdAt));
    
    return embed;
}

// 레이드 정보 수정 메뉴 표시 함수 수정 - 임베드 사용
async function showEditRaidMenu(interaction, raidId, client, log) {
    try {
        const guildId = interaction.guild.id;
        
        // 레이드 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(raidId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 레이드 찾기 오류')
                .setDescription('레이드 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 레이드일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const raidData = guildRaids.get(raidId);
        
        // 레이드 생성자만 수정 가능
        if (raidData.createdBy !== interaction.user.id) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription('레이드 생성자만 정보를 수정할 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 수정할 항목 선택 메뉴 - customId 수정
        const editRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`edit_field:${raidId}`)
                    .setPlaceholder('수정할 항목 선택')
                    .addOptions([
                        {
                            label: '던전/레이드 이름',
                            description: '던전 또는 레이드 이름을 변경합니다',
                            value: `edit:dungeon:${raidId}`,
                            emoji: '🏰'
                        },
                        {
                            label: '날짜',
                            description: '레이드 날짜를 변경합니다',
                            value: `edit:date:${raidId}`,
                            emoji: '📅'
                        },
                        {
                            label: '시간',
                            description: '레이드 시간을 변경합니다',
                            value: `edit:time:${raidId}`,
                            emoji: '⏰'
                        },
                        {
                            label: '요구 레벨/장비',
                            description: '참여 요구 사항을 변경합니다',
                            value: `edit:level:${raidId}`,
                            emoji: '⚙️'
                        },
                        {
                            label: '설명',
                            description: '상세 설명을 변경합니다',
                            value: `edit:description:${raidId}`,
                            emoji: '📝'
                        }
                    ])
            );
        
        // 임베드로 변경
        const editMenuEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📝 레이드 정보 수정')
            .setDescription(`**${raidData.dungeonName}** 레이드의 수정할 항목을 선택하세요.`)
            .addFields(
                { name: '현재 정보', value: 
                    `📅 날짜: ${raidData.date}\n` +
                    `⏰ 시간: ${raidData.time}\n` +
                    `⚙️ 요구 사항: ${raidData.requiredLevel}\n`
                }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.reply({
            embeds: [editMenuEmbed],
            components: [editRow],
            ephemeral: true
        });
        
        log('INFO', `${interaction.user.tag}님이 레이드 ID: ${raidId} 의 정보 수정 메뉴를 열었습니다.`);
        
    } catch (error) {
        log('ERROR', `레이드 정보 수정 메뉴 표시 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`레이드 정보 수정 메뉴 표시 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 특정 필드 수정 모달 표시
async function showEditFieldModal(interaction, field, raidId, client, log) {
    try {
        const guildId = interaction.guild.id;
        
        // 레이드 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(raidId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 레이드 찾기 오류')
                .setDescription('레이드 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 레이드일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const raidData = guildRaids.get(raidId);
        
        // 모달 생성
        const modal = new ModalBuilder()
            .setCustomId(`edit_raid_field:${field}:${raidId}`)
            .setTitle('레이드 정보 수정');
        
        // 필드별 모달 구성
        let fieldInput;
        
        switch (field) {
            case 'dungeon':
                fieldInput = new TextInputBuilder()
                    .setCustomId('field_value')
                    .setLabel('던전/레이드 이름')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('새 던전/레이드 이름을 입력하세요')
                    .setValue(raidData.dungeonName)
                    .setRequired(true);
                break;
                
            case 'date':
                fieldInput = new TextInputBuilder()
                    .setCustomId('field_value')
                    .setLabel('날짜')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('YYYY-MM-DD 형식 (예: 2023-12-25)')
                    .setValue(raidData.date)
                    .setRequired(true);
                break;
                
            case 'time':
                fieldInput = new TextInputBuilder()
                    .setCustomId('field_value')
                    .setLabel('시간')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('HH:MM 형식 (예: 19:30)')
                    .setValue(raidData.time)
                    .setRequired(true);
                break;
                
            case 'level':
                fieldInput = new TextInputBuilder()
                    .setCustomId('field_value')
                    .setLabel('요구 레벨/장비')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('예: 레벨 60 이상, 아이템 레벨 900+ 등')
                    .setValue(raidData.requiredLevel)
                    .setRequired(true);
                break;
                
            case 'description':
                fieldInput = new TextInputBuilder()
                    .setCustomId('field_value')
                    .setLabel('설명')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('추가 설명, 참여 요건, 파티 구성 등을 적어주세요.')
                    .setValue(raidData.description)
                    .setRequired(false);
                break;
        }
        
        // 모달에 입력 필드 추가
        const actionRow = new ActionRowBuilder().addComponents(fieldInput);
        modal.addComponents(actionRow);
        
        // 모달 표시
        await interaction.showModal(modal);
        
        log('INFO', `${interaction.user.tag}님에게 레이드 ${field} 필드 수정 모달을 표시했습니다.`);
    } catch (error) {
        log('ERROR', `필드 수정 모달 표시 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`필드 수정 모달 표시 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 필드 수정 선택 처리 (스크롤 박스에서 선택된 항목 처리)
async function handleEditFieldSelection(interaction, client, log) {
    try {
        const selectedValue = interaction.values[0];
        const [action, field, raidId] = selectedValue.split(':');
        
        if (action === 'edit') {
            await showEditFieldModal(interaction, field, raidId, client, log);
        }
    } catch (error) {
        log('ERROR', `필드 수정 선택 처리 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`필드 수정 선택 처리 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 레이드 정보 수정 처리
async function handleRaidFieldEdit(interaction, field, raidId, client, log) {
    try {
        const guildId = interaction.guild.id;
        
        // 레이드 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(raidId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 레이드 찾기 오류')
                .setDescription('레이드 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 레이드일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const raidData = guildRaids.get(raidId);
        
        // 레이드 생성자만 수정 가능
        if (raidData.createdBy !== interaction.user.id) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription('레이드 생성자만 정보를 수정할 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 입력값 가져오기
        const newValue = interaction.fields.getTextInputValue('field_value');
        
        // 필드별 유효성 검사 및 업데이트
        switch (field) {
            case 'dungeon':
                raidData.dungeonName = newValue;
                break;
                
            case 'date':
                // 날짜 형식 검사
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                if (!dateRegex.test(newValue)) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('❌ 입력 오류')
                        .setDescription('날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해주세요.')
                        .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                        .setTimestamp();
                        
                    return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }
                raidData.date = newValue;
                break;
                
            case 'time':
                // 시간 형식 검사
                const timeRegex = /^\d{2}:\d{2}$/;
                if (!timeRegex.test(newValue)) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('❌ 입력 오류')
                        .setDescription('시간 형식이 올바르지 않습니다. HH:MM 형식으로 입력해주세요.')
                        .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                        .setTimestamp();
                        
                    return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }
                raidData.time = newValue;
                break;
                
            case 'level':
                raidData.requiredLevel = newValue;
                break;
                
            case 'description':
                raidData.description = newValue || '추가 설명 없음';
                break;
        }
        
        // 데이터 업데이트
        updateRaidCall(guildId, raidId, raidData, log);
        
        try {
            // 알람 채널에서 메시지 찾기
            const settings = guildSettings.get(guildId);
            const alarmChannel = interaction.guild.channels.cache.get(settings.alarmChannel);
            
            if (alarmChannel && raidData.messageId) {
                const message = await alarmChannel.messages.fetch(raidData.messageId).catch(() => null);
                if (message) {
                    // 임베드 업데이트
                    const raidEmbed = createRaidEmbed(raidData, await client.users.fetch(raidData.createdBy), interaction.guild);
                    
                    await message.edit({
                        embeds: [raidEmbed]
                    });
                }
            }
        } catch (err) {
            log('ERROR', `레이드 메시지 업데이트 중 오류 발생: ${err.message}`);
        }
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 레이드 정보 수정 완료')
            .setDescription(`**${raidData.dungeonName}** 레이드의 ${getFieldDisplayName(field)}이(가) 성공적으로 수정되었습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}님이 '${raidData.dungeonName}' 레이드의 ${field} 필드를 수정했습니다.`);
        
    } catch (error) {
        log('ERROR', `레이드 정보 수정 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`레이드 정보 수정 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 필드 이름 표시용 함수
function getFieldDisplayName(field) {
    switch (field) {
        case 'dungeon': return '던전/레이드 이름';
        case 'date': return '날짜';
        case 'time': return '시간';
        case 'level': return '요구 레벨/장비';
        case 'description': return '설명';
        default: return field;
    }
}

// 직업 선택 처리 - 직업명 매핑 수정
async function handleClassSelection(interaction, raidId, className, client, log) {
    try {
        const guildId = interaction.guild.id;
        
        // 레이드 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(raidId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 레이드 찾기 오류')
                .setDescription('레이드 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 레이드일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.update({ embeds: [errorEmbed], components: [] });
        }
        
        const raidData = guildRaids.get(raidId);
        
        // 이미 참가 중인지 확인
        const participantIndex = raidData.participants.findIndex(p => p.userId === interaction.user.id);
        
        if (participantIndex !== -1) {
            // 이미 참가 중이면 직업 업데이트
            raidData.participants[participantIndex].class = className;
        } else {
            // 새로운 참가자 추가
            raidData.participants.push({
                userId: interaction.user.id,
                class: className,
                joinedAt: new Date().toISOString()
            });
        }
        
        // 데이터 업데이트
        updateRaidCall(guildId, raidId, raidData, log);
        
        try {
            // 알람 채널에서 메시지 찾기
            const settings = guildSettings.get(guildId);
            const alarmChannel = interaction.guild.channels.cache.get(settings.alarmChannel);
            
            if (alarmChannel && raidData.messageId) {
                const message = await alarmChannel.messages.fetch(raidData.messageId).catch(() => null);
                if (message) {
                    // 임베드 업데이트
                    const raidEmbed = createRaidEmbed(raidData, await client.users.fetch(raidData.createdBy), interaction.guild);
                    
                    await message.edit({
                        embeds: [raidEmbed]
                    });
                }
            }
        } catch (err) {
            log('ERROR', `레이드 메시지 업데이트 중 오류 발생: ${err.message}`);
        }
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 레이드 참가 완료')
            .setDescription(`**${raidData.dungeonName}** 레이드에 **${className}** 직업으로 참가 신청되었습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.update({ embeds: [successEmbed], components: [] });
        
        log('INFO', `${interaction.user.tag}님이 '${raidData.dungeonName}' 레이드에 '${className}' 직업으로 참가했습니다.`);
        
    } catch (error) {
        log('ERROR', `레이드 참가 처리 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`레이드 참가 처리 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.update({ embeds: [errorEmbed], components: [] }).catch(() => {});
    }
}

// 참가 취소 처리 함수 추가
async function handleCancelParticipation(interaction, raidId, client, log) {
    try {
        const guildId = interaction.guild.id;
        
        // 레이드 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(raidId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 레이드 찾기 오류')
                .setDescription('레이드 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 레이드일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const raidData = guildRaids.get(raidId);
        
        // 참가자 목록에서 제거
        const participantIndex = raidData.participants.findIndex(p => p.userId === interaction.user.id);
        
        if (participantIndex === -1) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ 참가 정보 없음')
                .setDescription('이 레이드에 참가 신청하지 않았습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 참가 취소 처리
        raidData.participants.splice(participantIndex, 1);
        
        // 데이터 업데이트
        updateRaidCall(guildId, raidId, raidData, log);
        
        try {
            // 알람 채널에서 메시지 찾기
            const settings = guildSettings.get(guildId);
            const alarmChannel = interaction.guild.channels.cache.get(settings.alarmChannel);
            
            if (alarmChannel && raidData.messageId) {
                const message = await alarmChannel.messages.fetch(raidData.messageId).catch(() => null);
                if (message) {
                    // 임베드 업데이트
                    const raidEmbed = createRaidEmbed(raidData, await client.users.fetch(raidData.createdBy), interaction.guild);
                    
                    await message.edit({
                        embeds: [raidEmbed]
                    });
                }
            }
        } catch (err) {
            log('ERROR', `레이드 메시지 업데이트 중 오류 발생: ${err.message}`);
        }
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 레이드 참가 취소 완료')
            .setDescription(`**${raidData.dungeonName}** 레이드 참가가 취소되었습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}님이 '${raidData.dungeonName}' 레이드 참가를 취소했습니다.`);
        
    } catch (error) {
        log('ERROR', `레이드 참가 취소 처리 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`레이드 참가 취소 처리 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 레이드 취소 처리
async function handleRaidCancel(interaction, raidId, client, log) {
    try {
        const guildId = interaction.guild.id;
        
        // 레이드 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(raidId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 레이드 찾기 오류')
                .setDescription('레이드 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 레이드일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const raidData = guildRaids.get(raidId);
        
        // 레이드 생성자만 취소 가능
        if (raidData.createdBy !== interaction.user.id) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription('레이드 생성자만 레이드를 취소할 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 취소 확인 버튼
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_cancel:${raidId}`)
                    .setLabel('레이드 취소 확인')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️'),
                new ButtonBuilder()
                    .setCustomId(`cancel_cancel:${raidId}`)
                    .setLabel('돌아가기')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('↩️')
            );
        
        const confirmEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('⚠️ 레이드 취소 확인')
            .setDescription(`정말로 **${raidData.dungeonName}** 레이드를 취소하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.reply({
            embeds: [confirmEmbed],
            components: [confirmRow],
            ephemeral: true
        });
        
        log('INFO', `${interaction.user.tag}님이 레이드 ID: ${raidId} 의 취소 확인 메뉴를 열었습니다.`);
        
    } catch (error) {
        log('ERROR', `레이드 취소 처리 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`레이드 취소 처리 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 레이드 취소 확인 처리
async function confirmRaidCancel(interaction, raidId, client, log) {
    try {
        const guildId = interaction.guild.id;
        
        // 레이드 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(raidId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 레이드 찾기 오류')
                .setDescription('레이드 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 레이드일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.update({ embeds: [errorEmbed], components: [] });
        }
        
        const raidData = guildRaids.get(raidId);
        
        // 레이드 생성자만 취소 가능
        if (raidData.createdBy !== interaction.user.id) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription('레이드 생성자만 레이드를 취소할 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.update({ embeds: [errorEmbed], components: [] });
        }
        
        // 레이드 취소 임베드
        const cancelledEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 레이드 취소됨')
            .setDescription(`**${raidData.dungeonName}** 레이드가 취소되었습니다.`)
            .addFields(
                { name: '📅 예정 일시', value: `${raidData.date} ${raidData.time}`, inline: true },
                { name: '👤 취소자', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setFooter({ text: `${interaction.guild.name} • 레이드 취소됨`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 메시지 업데이트
        try {
            const settings = guildSettings.get(guildId);
            const alarmChannel = interaction.guild.channels.cache.get(settings.alarmChannel);
            
            if (alarmChannel) {
                const message = await alarmChannel.messages.fetch(raidData.messageId).catch(() => null);
                if (message) {
                    await message.edit({
                        content: '~~이 레이드는 취소되었습니다.~~',
                        embeds: [cancelledEmbed],
                        components: []
                    });
                }
            }
        } catch (err) {
            log('ERROR', `레이드 취소 메시지 업데이트 중 오류 발생: ${err.message}`);
        }
        
        // 레이드 데이터 삭제
        deleteRaidCall(guildId, raidId, log);
        
        // 취소 완료 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 레이드 취소 완료')
            .setDescription(`**${raidData.dungeonName}** 레이드가 성공적으로 취소되었습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.update({ embeds: [successEmbed], components: [] });
        
        log('INFO', `${interaction.user.tag}님이 '${raidData.dungeonName}' 레이드를 취소했습니다.`);
        
    } catch (error) {
        log('ERROR', `레이드 취소 확인 처리 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`레이드 취소 확인 처리 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.update({ embeds: [errorEmbed], components: [] }).catch(() => {});
    }
}

// 모듈 초기화 함수
async function init(client, log) {
    // 스토리지 초기화 확인
    if (!storage.initialized) {
        await storage.init(log);
    }
    
    // 저장된 설정 불러오기
    await loadSettings(log);
    
    // 버튼 상호작용 처리
    client.on('interactionCreate', async (interaction) => {
        try {
            // 버튼 상호작용
            if (interaction.isButton()) {
                const customId = interaction.customId;
                
                if (customId === 'create_raid_call') {
                    await showRaidCallModal(interaction, client, log);
                }
                else if (customId.startsWith('confirm_cancel:')) {
                    const raidId = customId.split(':')[1];
                    await confirmRaidCancel(interaction, raidId, client, log);
                }
                else if (customId.startsWith('cancel_cancel:')) {
                    // 취소 취소 (돌아가기)
                    await interaction.update({ content: '레이드 취소가 취소되었습니다.', embeds: [], components: [] });
                }
                else if (customId.startsWith('cancel_participation:')) {
                    // 참가 취소 처리
                    const raidId = customId.split(':')[1];
                    await handleCancelParticipation(interaction, raidId, client, log);
                }
            }
            // 모달 제출 처리
            else if (interaction.isModalSubmit()) {
                const modalId = interaction.customId;
                
                if (modalId === 'raid_call_modal') {
                    await handleRaidCallCreation(interaction, client, log);
                }
                else if (modalId.startsWith('edit_raid_field:')) {
                    // 레이드 필드 수정 처리
                    const [_, field, raidId] = modalId.split(':');
                    await handleRaidFieldEdit(interaction, field, raidId, client, log);
                }
            }
            // 선택 메뉴 처리
            else if (interaction.isStringSelectMenu()) {
                const customId = interaction.customId;
                
                if (customId.startsWith('raid_control:')) {
                    const selectedValue = interaction.values[0];
                    
                    if (selectedValue.startsWith('edit_raid:')) {
                        const raidId = selectedValue.split(':')[1];
                        await showEditRaidMenu(interaction, raidId, client, log);
                    }
                    else if (selectedValue.startsWith('join_raid:')) {
                        const raidId = selectedValue.split(':')[1];
                        // 수정: 모달 대신 선택 메뉴 표시
                        await showClassSelectionMenu(interaction, raidId, client, log);
                    }
                    else if (selectedValue.startsWith('cancel_raid:')) {
                        const raidId = selectedValue.split(':')[1];
                        await handleRaidCancel(interaction, raidId, client, log);
                    }
                }
                else if (customId.startsWith('edit_field:')) {
                    // 필드 선택 처리
                    await handleEditFieldSelection(interaction, client, log);
                }
                else if (customId.startsWith('class_selection:')) {
                    // 직업 선택 처리
                    const raidId = customId.split(':')[1];
                    const classValue = interaction.values[0];
                    const classType = classValue.split(':')[0].replace('class_', '');
                    
                    // 직업 이름 매핑
                    const classNameMap = {
                        'elemental_knight': '엘레멘탈 나이트',
                        'saint_bard': '세인트 바드',
                        'alchemic_stinger': '알케믹 스팅어',
                        'dark_mage': '다크 메이지',
                        'sacred_guard': '세이크리드 가드',
                        'blast_lancer': '블래스트 랜서'
                    };
                    
                    await handleClassSelection(interaction, raidId, classNameMap[classType] || classType, client, log);
                }
            }
        } catch (error) {
            log('ERROR', `레이드 콜 상호작용 처리 중 오류 발생: ${error.message}`);
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('❌ 오류 발생')
                        .setDescription('요청을 처리하는 중 오류가 발생했습니다.')
                        .setFooter({ text: '다시 시도해주세요.', iconURL: interaction.guild?.iconURL({ dynamic: true }) })
                        .setTimestamp();
                        
                    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }
            } catch (replyError) {
                // 응답 오류 무시
            }
        }
    });
    
    log('MODULE', '레이드 콜 시스템 모듈이 초기화되었습니다.');
}

// 슬래시 커맨드 정의
const slashCommands = [
    new SlashCommandBuilder()
        .setName('레이드알람채널')
        .setDescription('레이드 알람을 전송할 채널을 설정합니다')
        .addChannelOption(option =>
            option.setName('채널')
                .setDescription('레이드 알람을 전송할 채널')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
    new SlashCommandBuilder()
        .setName('레이드콜채널')
        .setDescription('레이드 콜 생성 버튼이 있는 임베드를 설정합니다')
        .addChannelOption(option =>
            option.setName('채널')
                .setDescription('레이드 콜 임베드를 표시할 채널')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// 슬래시 커맨드 실행
async function executeSlashCommand(interaction, client, log) {
    const { commandName } = interaction;
    
    if (commandName === '레이드알람채널') {
        await setAlarmChannel(interaction, client, log);
    }
    else if (commandName === '레이드콜채널') {
        await createRaidCallEmbed(interaction, client, log);
    }
}

module.exports = {
    name: 'raid-call',
    description: '레이드 콜 시스템 모듈',
    version: '1.0.0',
    commands: [],
    enabled: true,
    init,
    executeSlashCommand,
    slashCommands
};