// modules/vacation-system.js - 휴가 신청 시스템 모듈
const logger = require('../utils/logger');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits } = require('discord.js');
const storage = require('../storage');

// 스토리지 키
const STORAGE_KEY = 'vacation-system-config';

// 서버별 설정 저장
let guildSettings = new Map();

// 저장된 설정 불러오기
async function loadSettings(log) {
    try {
        await storage.load(STORAGE_KEY);
        const data = storage.getAll(STORAGE_KEY);
        
        if (data) {
            // Map으로 변환
            guildSettings = new Map(Object.entries(data));
        }
        
        if (log) log('INFO', '휴가 시스템 설정을 로드했습니다.');
        return true;
    } catch (error) {
        if (log) log('ERROR', `휴가 시스템 설정 로드 중 오류: ${error.message}`);
        return false;
    }
}

// 설정 저장하기
async function saveSettings(log) {
    try {
        // Map을 객체로 변환
        const data = Object.fromEntries(guildSettings);
        
        // 스토리지에 저장
        storage.setAll(STORAGE_KEY, data);
        await storage.save(STORAGE_KEY);
        
        if (log) log('INFO', '휴가 시스템 설정을 저장했습니다.');
        return true;
    } catch (error) {
        if (log) log('ERROR', `휴가 시스템 설정 저장 중 오류: ${error.message}`);
        return false;
    }
}

// 서버 설정 업데이트
function updateGuildSettings(guildId, settings, log) {
    guildSettings.set(guildId, settings);
    saveSettings(log);
}

// 휴가 신청 임베드 생성
async function createVacationRequestEmbed(channel, log) {
    try {
        // 임베드 생성
        const vacationEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🏖️ 장기 미접속 신청')
            .setDescription('아래 버튼을 클릭하여 장기 미접속(휴가) 신청을 할 수 있습니다.')
            .addFields(
                { 
                    name: '📝 신청 방법', 
                    value: '1. 공개 신청 또는 비밀 신청 버튼을 선택해주세요.\n2. 양식에 맞게 정보를 입력해주세요.\n3. 관리자 승인 후 휴가가 등록됩니다.', 
                    inline: false 
                },
                { 
                    name: '💡 신청 유형 안내', 
                    value: '• 🔓 **공개 신청**: 휴가 사유가 모든 멤버에게 공개됩니다.\n• 🔒 **비밀 신청**: 휴가 사유는 관리자만 볼 수 있습니다.', 
                    inline: false 
                }
            )
            .setFooter({ text: channel.guild.name, iconURL: channel.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 버튼 생성
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('vacation_request_public')
                    .setLabel('🔓 공개 신청')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('vacation_request_private')
                    .setLabel('🔒 비밀 신청')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        // 메시지 전송
        await channel.send({ embeds: [vacationEmbed], components: [row] });
        
        log('INFO', `휴가 신청 임베드가 ${channel.name} 채널에 생성되었습니다.`);
        
        return true;
    } catch (error) {
        log('ERROR', `휴가 신청 임베드 생성 중 오류: ${error.message}`);
        return false;
    }
}

// 휴가 신청 모달 표시
async function showVacationRequestModal(interaction, isPrivate, log) {
    try {
        // 모달 생성
        const modal = new ModalBuilder()
            .setCustomId(`vacation_modal_${isPrivate ? 'private' : 'public'}`)
            .setTitle('장기 미접속(휴가) 신청서');
        
        // 텍스트 입력 필드 추가
        const startDateInput = new TextInputBuilder()
            .setCustomId('vacation_start_date')
            .setLabel('시작일')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('YYYY-MM-DD 형식으로 입력 (예: 2025-03-15)')
            .setRequired(true);
        
        const endDateInput = new TextInputBuilder()
            .setCustomId('vacation_end_date')
            .setLabel('종료일')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('YYYY-MM-DD 형식으로 입력 (예: 2025-03-25)')
            .setRequired(true);
        
        const reasonInput = new TextInputBuilder()
            .setCustomId('vacation_reason')
            .setLabel('사유')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('휴가 사유를 상세히 적어주세요.\n예시: "개인 사정으로 3월 15일부터 25일까지 접속이 어렵습니다. 가족 여행으로 인해 인터넷 연결이 원활하지 않은 지역에 머물 예정입니다."')
            .setRequired(true);
        
        // 액션 로우에 텍스트 입력 필드 추가
        const firstActionRow = new ActionRowBuilder().addComponents(startDateInput);
        const secondActionRow = new ActionRowBuilder().addComponents(endDateInput);
        const thirdActionRow = new ActionRowBuilder().addComponents(reasonInput);
        
        // 모달에 액션 로우 추가
        modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);
        
        // 모달 표시
        await interaction.showModal(modal);
        
        log('INFO', `${interaction.user.tag}님에게 ${isPrivate ? '비밀' : '공개'} 휴가 신청 모달을 표시했습니다.`);
        
        return true;
    } catch (error) {
        log('ERROR', `휴가 신청 모달 표시 중 오류: ${error.message}`);
        return false;
    }
}
// 휴가 신청 처리
async function handleVacationRequest(interaction, isPrivate, log) {
    try {
        const guildId = interaction.guild.id;
        const settings = guildSettings.get(guildId);
        
        // 폼 데이터 가져오기
        const startDate = interaction.fields.getTextInputValue('vacation_start_date');
        const endDate = interaction.fields.getTextInputValue('vacation_end_date');
        const reason = interaction.fields.getTextInputValue('vacation_reason');
        
        // 공개 신청은 바로 휴가 명단 채널로, 비공개 신청은 승인 채널로 보냄
        if (!isPrivate) {
            // 공개 신청 처리 (승인 과정 없이 바로 명단 채널로)
            if (!settings || !settings.listChannel) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('❌ 오류')
                    .setDescription('휴가 명단 채널이 설정되지 않았습니다. 관리자에게 문의하세요.')
                    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                    .setTimestamp();
                    
                return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
            
            // 휴가 명단 채널 가져오기
            const listChannel = interaction.guild.channels.cache.get(settings.listChannel);
            if (!listChannel) {
                log('ERROR', `휴가 명단 채널을 찾을 수 없습니다: ${settings.listChannel}`);
                return false;
            }
            
            // 사용자에게 제출 확인 메시지
            const confirmEmbed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ 휴가 신청 제출 완료')
                .setDescription('휴가 신청이 성공적으로 등록되었습니다.')
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '📅 휴가 기간', value: `${startDate} ~ ${endDate}`, inline: false },
                    { name: '🔒 비공개 여부', value: '공개', inline: true }
                )
                .setFooter({ text: `${interaction.guild.name} • 자동 등록됨`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            await interaction.reply({ embeds: [confirmEmbed], ephemeral: true });
            
            // 공개 휴가 임베드 생성
            const vacationEmbed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('🏖️ 등록된 휴가')
                .setDescription(`<@${interaction.user.id}>님의 휴가가 등록되었습니다.`)
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 사용자', value: interaction.user.tag, inline: false },
                    { name: '📅 휴가 기간', value: `${startDate} ~ ${endDate}`, inline: false },
                    { name: '📝 사유', value: reason, inline: false }
                )
                .setFooter({ text: `${interaction.guild.name} • 자동 승인됨`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
            
            // 휴가 명단 채널에 전송
            await listChannel.send({ embeds: [vacationEmbed] });
            
            log('INFO', `${interaction.user.tag}님의 공개 휴가 신청이 자동으로 등록되었습니다.`);
        } else {
            // 비공개 신청은 관리자 승인 과정이 필요함
            if (!settings || !settings.approvalChannel) {
                const errorEmbed = new EmbedBuilder()
                    .setColor('#ED4245')
                    .setTitle('❌ 오류')
                    .setDescription('휴가 승인 채널이 설정되지 않았습니다. 관리자에게 문의하세요.')
                    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                    .setTimestamp();
                    
                return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
            
            // 사용자에게 제출 확인 메시지
            const confirmEmbed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ 휴가 신청 제출 완료')
                .setDescription('휴가 신청이 성공적으로 제출되었습니다. 관리자 승인을 기다려주세요.')
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '📅 휴가 기간', value: `${startDate} ~ ${endDate}`, inline: false },
                    { name: '🔒 비공개 여부', value: '비공개', inline: true }
                )
                .setFooter({ text: `${interaction.guild.name} • 승인 대기중`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            await interaction.reply({ embeds: [confirmEmbed], ephemeral: true });
            
            // 승인 채널에 메시지 전송
            const approvalChannel = interaction.guild.channels.cache.get(settings.approvalChannel);
            if (!approvalChannel) {
                log('ERROR', `휴가 승인 채널을 찾을 수 없습니다: ${settings.approvalChannel}`);
                return false;
            }
            
            // 승인용 임베드 생성
            const approvalEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('🏖️ 새로운 휴가 신청')
                .setDescription(`${interaction.user}님의 휴가 신청이 도착했습니다.`)
                .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 신청자', value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
                    { name: '📅 휴가 기간', value: `${startDate} ~ ${endDate}`, inline: false },
                    { name: '🔒 비공개 여부', value: '비공개', inline: true },
                    { name: '📝 사유', value: reason, inline: false }
                )
                .setFooter({ text: `${interaction.guild.name} • 승인 대기중`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
            
            // 승인/거부 버튼
            const approvalButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`vacation_approve:${interaction.user.id}:${isPrivate}:${startDate}:${endDate}:${Buffer.from(reason).toString('base64')}`)
                        .setLabel('✅ 승인')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`vacation_reject:${interaction.user.id}:${Buffer.from(reason).toString('base64')}`)
                        .setLabel('❌ 거부')
                        .setStyle(ButtonStyle.Danger)
                );
            
            // 승인 채널에 전송
            await approvalChannel.send({ 
                content: '@everyone 현재 처리가 필요한 신청서 입니다.',
                embeds: [approvalEmbed], 
                components: [approvalButtons] 
            });
            
            log('INFO', `${interaction.user.tag}님의 비공개 휴가 신청이 제출되었습니다.`);
        }
        
        return true;
    } catch (error) {
        log('ERROR', `휴가 신청 처리 중 오류: ${error.message}`);
        return false;
    }
}

// 휴가 승인 처리
async function approveVacation(interaction, log) {
    try {
        await interaction.deferUpdate();
        
        const parts = interaction.customId.split(':');
        const userId = parts[1];
        const isPrivate = parts[2] === 'true';
        const startDate = parts[3];
        const endDate = parts[4];
        const reasonBase64 = parts[5];
        const reason = Buffer.from(reasonBase64, 'base64').toString();
        
        const guildId = interaction.guild.id;
        const settings = guildSettings.get(guildId);
        
        // 설정 확인
        if (!settings || !settings.listChannel) {
            return await interaction.followUp({ 
                content: '휴가 명단 채널이 설정되지 않았습니다. 관리자에게 문의하세요.', 
                ephemeral: true 
            });
        }
        
        // 휴가 명단 채널 가져오기
        const listChannel = interaction.guild.channels.cache.get(settings.listChannel);
        if (!listChannel) {
            log('ERROR', `휴가 명단 채널을 찾을 수 없습니다: ${settings.listChannel}`);
            return await interaction.followUp({ 
                content: '휴가 명단 채널을 찾을 수 없습니다.', 
                ephemeral: true 
            });
        }
        
        // 사용자 정보 가져오기
        const user = await interaction.client.users.fetch(userId);
        
        // 승인된 휴가 임베드 생성
        const vacationEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 승인된 휴가')
            .setDescription(`<@${userId}>님의 휴가가 승인되었습니다.`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '👤 사용자', value: user.tag, inline: false },
                { name: '📅 휴가 기간', value: `${startDate} ~ ${endDate}`, inline: false }
            )
            .setFooter({ text: `승인자: ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();
        
        // 비공개가 아닌 경우에만 사유 표시
        if (!isPrivate) {
            vacationEmbed.addFields({ name: '📝 사유', value: reason, inline: false });
        } else {
            vacationEmbed.addFields({ name: '📝 사유', value: '(비공개)', inline: false });
        }
        
        // 휴가 명단 채널에 전송
        await listChannel.send({ embeds: [vacationEmbed] });
        
        // 원본 메시지 업데이트
        const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('#57F287')
            .setTitle('✅ 승인된 휴가 신청')
            .addFields({ name: '✅ 상태', value: `${interaction.user.tag}님이 승인함`, inline: true });
        
        await interaction.editReply({ 
            embeds: [originalEmbed], 
            components: [],
            content: '@everyone 승인된 신청서입니다.'
        });
        
        // 사용자에게 DM 전송
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#57F287')
                .setTitle('✅ 휴가 신청 승인')
                .setDescription(`${interaction.guild.name} 서버에서 제출하신 휴가 신청이 승인되었습니다.`)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '📅 휴가 기간', value: `${startDate} ~ ${endDate}`, inline: false },
                    { name: '👤 승인자', value: interaction.user.tag, inline: false }
                )
                .setFooter({ text: `${interaction.guild.name} • ${new Date().toLocaleString()}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();
                
            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            log('WARN', `${user.tag}님에게 DM을 보낼 수 없습니다: ${error.message}`);
        }
        
        log('INFO', `${interaction.user.tag}님이 ${user.tag}님의 휴가 신청을 승인했습니다.`);
        
        return true;
    } catch (error) {
        log('ERROR', `휴가 승인 처리 중 오류: ${error.message}`);
        return false;
    }
}

// 거부 사유 모달 표시
async function showRejectionReasonModal(interaction, log) {
    try {
        const parts = interaction.customId.split(':');
        const userId = parts[1];
        
        // 모달 생성
        const modal = new ModalBuilder()
            .setCustomId(`vacation_reject_reason:${userId}`)
            .setTitle('휴가 신청 거부 사유');
        
        // 텍스트 입력 필드 추가
        const reasonInput = new TextInputBuilder()
            .setCustomId('rejection_reason')
            .setLabel('거부 사유')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('휴가 신청을 거부하는 이유를 적어주세요.\n예시: "현재 인원 부족으로 해당 기간 승인이 어렵습니다. 다른 날짜로 재신청 부탁드립니다."')
            .setRequired(true);
        
        // 액션 로우에 텍스트 입력 필드 추가
        const actionRow = new ActionRowBuilder().addComponents(reasonInput);
        
        // 모달에 액션 로우 추가
        modal.addComponents(actionRow);
        
        // 모달 표시
        await interaction.showModal(modal);
        
        log('INFO', `${interaction.user.tag}님이 휴가 거부 사유 모달을 열었습니다.`);
        
        return true;
    } catch (error) {
        log('ERROR', `휴가 거부 사유 모달 표시 중 오류: ${error.message}`);
        return false;
    }
}

// 휴가 거부 처리
async function rejectVacation(interaction, log) {
    try {
        const userId = interaction.customId.split(':')[1];
        const rejectionReason = interaction.fields.getTextInputValue('rejection_reason');
        
        // 사용자 정보 가져오기
        const user = await interaction.client.users.fetch(userId);
        
        // 원본 메시지 업데이트
        const originalMessage = await interaction.message.fetch();
        const originalEmbed = EmbedBuilder.from(originalMessage.embeds[0])
            .setColor('#ED4245')
            .setTitle('❌ 거부된 휴가 신청')
            .addFields({ name: '❌ 상태', value: `${interaction.user.tag}님이 거부함`, inline: true })
            .addFields({ name: '📝 거부 사유', value: rejectionReason, inline: false });
        
        await interaction.update({ 
            embeds: [originalEmbed], 
            components: [],
            content: '@everyone 거부된 신청서입니다.'
        });
        
        // 사용자에게 DM 전송
        try {
            // 사용자 정보에서 휴가 기간 추출
            const originalEmbed = originalMessage.embeds[0];
            let vacationPeriod = '미정';
            
            // 임베드에서 휴가 기간 필드 찾기
            for (const field of originalEmbed.fields) {
                if (field.name === '📅 휴가 기간') {
                    vacationPeriod = field.value;
                    break;
                } else if (field.name === '📅 시작일' && field.name === '📅 종료일') {
                    // 레거시 형식 지원
                    const startDateField = originalEmbed.fields.find(f => f.name === '📅 시작일');
                    const endDateField = originalEmbed.fields.find(f => f.name === '📅 종료일');
                    if (startDateField && endDateField) {
                        vacationPeriod = `${startDateField.value} ~ ${endDateField.value}`;
                    }
                    break;
                }
            }
            
            const dmEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 휴가 신청 거부')
                .setDescription(`${interaction.guild.name} 서버에서 제출하신 휴가 신청이 거부되었습니다.`)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '📅 휴가 기간', value: vacationPeriod, inline: false },
                    { name: '👤 거부자', value: interaction.user.tag, inline: false },
                    { name: '📝 거부 사유', value: rejectionReason, inline: false }
                )
                .setFooter({ text: `${interaction.guild.name} • ${new Date().toLocaleString()}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
                .setTimestamp();
                
            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            log('WARN', `${user.tag}님에게 DM을 보낼 수 없습니다: ${error.message}`);
        }
        
        log('INFO', `${interaction.user.tag}님이 ${user.tag}님의 휴가 신청을 거부했습니다. 사유: ${rejectionReason}`);
        
        return true;
    } catch (error) {
        log('ERROR', `휴가 거부 처리 중 오류: ${error.message}`);
        return false;
    }
}

// 슬래시 커맨드 정의
const slashCommands = [
    new SlashCommandBuilder()
        .setName('휴가채널지정')
        .setDescription('휴가 신청 임베드를 생성할 채널을 지정합니다')
        .addChannelOption(option =>
            option.setName('채널')
                .setDescription('휴가 신청을 받을 채널')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
    new SlashCommandBuilder()
        .setName('휴가명단채널지정')
        .setDescription('승인된 휴가 목록이 표시될 채널을 지정합니다')
        .addChannelOption(option =>
            option.setName('채널')
                .setDescription('휴가 명단을 표시할 채널')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
    new SlashCommandBuilder()
        .setName('휴가승인채널지정')
        .setDescription('휴가 신청을 승인/거부할 채널을 지정합니다')
        .addChannelOption(option =>
            option.setName('채널')
                .setDescription('휴가 신청 승인을 처리할 채널')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// 슬래시 커맨드 실행 함수
async function executeSlashCommand(interaction, client, log) {
    const { commandName } = interaction;
    const guildId = interaction.guild.id;
    
    // 서버 설정 가져오기
    let settings = guildSettings.get(guildId) || {};
    
    if (commandName === '휴가채널지정') {
        const channel = interaction.options.getChannel('채널');
        
        // 설정 업데이트
        settings.requestChannel = channel.id;
        updateGuildSettings(guildId, settings, log);
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 휴가 신청 채널 설정 완료')
            .setDescription(`휴가 신청 채널이 ${channel}(으)로 설정되었습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        // 채널에 휴가 신청 임베드 생성
        await createVacationRequestEmbed(channel, log);
        
        log('INFO', `${interaction.user.tag}님이 휴가 신청 채널을 ${channel.name}으로 설정했습니다.`);
    }
    else if (commandName === '휴가명단채널지정') {
        const channel = interaction.options.getChannel('채널');
        
        // 설정 업데이트
        settings.listChannel = channel.id;
        updateGuildSettings(guildId, settings, log);
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 휴가 명단 채널 설정 완료')
            .setDescription(`휴가 명단 채널이 ${channel}(으)로 설정되었습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}님이 휴가 명단 채널을 ${channel.name}으로 설정했습니다.`);
    }
    else if (commandName === '휴가승인채널지정') {
        const channel = interaction.options.getChannel('채널');
        
        // 설정 업데이트
        settings.approvalChannel = channel.id;
        updateGuildSettings(guildId, settings, log);
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 휴가 승인 채널 설정 완료')
            .setDescription(`휴가 승인 채널이 ${channel}(으)로 설정되었습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}님이 휴가 승인 채널을 ${channel.name}으로 설정했습니다.`);
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
    
    // 버튼 및 모달 상호작용 처리
    client.on('interactionCreate', async (interaction) => {
        // 상호작용 타입에 따라 처리
        try {
            // 버튼 처리
            if (interaction.isButton()) {
                const customId = interaction.customId;
                
                if (customId === 'vacation_request_public') {
                    await showVacationRequestModal(interaction, false, log);
                }
                else if (customId === 'vacation_request_private') {
                    await showVacationRequestModal(interaction, true, log);
                }
                else if (customId.startsWith('vacation_approve:')) {
                    await approveVacation(interaction, log);
                }
                else if (customId.startsWith('vacation_reject:')) {
                    await showRejectionReasonModal(interaction, log);
                }
            }
            // 모달 제출 처리
            else if (interaction.isModalSubmit()) {
                const modalId = interaction.customId;
                
                if (modalId === 'vacation_modal_public') {
                    await handleVacationRequest(interaction, false, log);
                }
                else if (modalId === 'vacation_modal_private') {
                    await handleVacationRequest(interaction, true, log);
                }
                else if (modalId.startsWith('vacation_reject_reason:')) {
                    await rejectVacation(interaction, log);
                }
            }
        } catch (error) {
            log('ERROR', `휴가 시스템 상호작용 처리 중 오류 발생: ${error.message}`);
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '요청을 처리하는 중 오류가 발생했습니다.', ephemeral: true });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: '요청을 처리하는 중 오류가 발생했습니다.' });
                }
            } catch (replyError) {
                // 응답 오류 무시
            }
        }
    });
    
    log('MODULE', '휴가 신청 시스템 모듈이 초기화되었습니다.');
}

module.exports = {
    name: 'vacation-system',
    description: '장기 미접속(휴가) 신청 및 관리 시스템',
    version: '1.0.0',
    commands: ['휴가채널지정', '휴가명단채널지정', '휴가승인채널지정'],
    enabled: true,
    init,
    executeSlashCommand,
    slashCommands
};