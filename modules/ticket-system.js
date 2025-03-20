// modules/ticket-system.js - 티켓 시스템 모듈

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, PermissionsBitField, StringSelectMenuBuilder } = require('discord.js');
const storage = require('../storage');

// 스토리지 키
const STORAGE_KEY = 'ticket-system-config';

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
        
        if (log) log('INFO', '티켓 시스템 설정을 로드했습니다.');
        return true;
    } catch (error) {
        if (log) log('ERROR', `티켓 시스템 설정 로드 중 오류: ${error.message}`);
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
        
        if (log) log('INFO', '티켓 시스템 설정을 저장했습니다.');
        return true;
    } catch (error) {
        if (log) log('ERROR', `티켓 시스템 설정 저장 중 오류: ${error.message}`);
        return false;
    }
}

// 서버 설정 업데이트
function updateGuildSettings(guildId, settings, log) {
    guildSettings.set(guildId, settings);
    saveSettings(log);
}

// 티켓 임베드 생성
async function createTicketEmbed(interaction, client, log) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const channel = interaction.options.getChannel('채널');
        
        // 채널 권한 확인
        if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionsBitField.Flags.SendMessages)) {
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
        settings.ticketChannel = channel.id;
        
        // 설정 저장
        updateGuildSettings(interaction.guild.id, settings, log);
        
        // 티켓 임베드 생성
        const ticketEmbed = new EmbedBuilder()
            .setColor('#5865F2')  // Discord 브랜드 색상
            .setTitle('🎫 티켓 시스템')
            .setDescription('아래 버튼을 클릭하여 새 티켓을 생성하세요.\n문의사항, 클랜 가입 신청 등을 위해 티켓을 생성할 수 있습니다.')
            .addFields(
                { 
                    name: '📋 티켓 사용 방법', 
                    value: '1️⃣ 아래 버튼을 클릭하여 새 티켓을 생성합니다.\n2️⃣ 생성된 채널에서 필요한 정보를 입력합니다.\n3️⃣ 관리자가 확인 후 처리해드립니다.', 
                    inline: false 
                },
                { 
                    name: '✅ 티켓 생성 가능 사유', 
                    value: '• 💬 클랜 가입 신청\n• ❓ 문의사항\n• 💡 건의사항\n• 🚨 신고', 
                    inline: false 
                }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 티켓 생성 버튼
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setLabel('티켓 생성')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎫')
            );
        
        // 채널에 임베드와 버튼 전송
        const message = await channel.send({ 
            content: '@everyone 티켓 시스템이 설정되었습니다!', 
            embeds: [ticketEmbed], 
            components: [row] 
        });
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 티켓 시스템 설정 완료')
            .setDescription(`${channel} 채널에 티켓 임베드를 성공적으로 생성했습니다.`)
            .addFields({ name: '✨ 다음 단계', value: '이제 사용자들이 티켓을 생성할 수 있습니다.', inline: false })
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [successEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}가 ${interaction.guild.name} 서버의 ${channel.name} 채널에 티켓 임베드를 생성했습니다.`);
        
    } catch (error) {
        log('ERROR', `티켓 임베드 생성 중 오류 발생: ${error.message}`);
        
        if (interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 오류 발생')
                .setDescription(`티켓 임베드 생성 중 오류가 발생했습니다: ${error.message}`)
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            await interaction.editReply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
        }
    }
}

// 관리자 역할 설정
async function setAdminRole(interaction, client, log) {
    try {
        const role = interaction.options.getRole('역할');
        
        // 서버 설정 가져오기 또는 생성
        let settings = guildSettings.get(interaction.guild.id) || {};
        settings.adminRole = role.id;
        
        // 설정 저장
        updateGuildSettings(interaction.guild.id, settings, log);
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 관리자 역할 설정 완료')
            .setDescription(`티켓 시스템 관리자 역할이 ${role}(으)로 설정되었습니다.`)
            .addFields({ name: '✨ 권한 안내', value: '이 역할을 가진 사용자는 모든 티켓에 접근할 수 있습니다.', inline: false })
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}가 ${interaction.guild.name} 서버의 티켓 시스템 관리자 역할을 ${role.name}(으)로 설정했습니다.`);
        
    } catch (error) {
        log('ERROR', `관리자 역할 설정 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`관리자 역할 설정 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 티켓 생성
async function createTicket(interaction, client, log) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const guild = interaction.guild;
        const user = interaction.user;
        
        // 서버 설정 확인
        const settings = guildSettings.get(guild.id);
        if (!settings) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 설정 오류')
                .setDescription('티켓 시스템이 아직 설정되지 않았습니다.')
                .addFields({ name: '해결 방법', value: '관리자에게 문의하여 티켓 시스템을 설정해달라고 요청하세요.', inline: false })
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 관리자 역할 확인
        const adminRole = settings.adminRole 
            ? guild.roles.cache.get(settings.adminRole) 
            : null;
        
        if (!adminRole) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 설정 오류')
                .setDescription('티켓 시스템 관리자 역할이 설정되지 않았습니다.')
                .addFields({ name: '해결 방법', value: '관리자에게 문의하여 관리자 역할을 설정해달라고 요청하세요.', inline: false })
                .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 채널 이름 생성 (티켓-사용자이름-숫자)
        const ticketChannelName = `티켓-${user.username.toLowerCase().replace(/\s+/g, '-')}`;
        
        // 티켓 채널 생성
        const ticketChannel = await guild.channels.create({
            name: ticketChannelName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone 권한
                    deny: [PermissionsBitField.Flags.ViewChannel]
                },
                {
                    id: user.id, // 티켓 생성자 권한
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AddReactions
                    ]
                },
                {
                    id: adminRole.id, // 관리자 역할 권한
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.ManageMessages
                    ]
                },
                {
                    id: client.user.id, // 봇 권한
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.ManageMessages,
                        PermissionsBitField.Flags.EmbedLinks
                    ]
                }
            ]
        });
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 티켓 생성 완료')
            .setDescription(`티켓이 성공적으로 생성되었습니다!`)
            .addFields({ name: '🔗 티켓 채널', value: `${ticketChannel}`, inline: false })
            .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.editReply({ embeds: [successEmbed], ephemeral: true });
        
        // 티켓 채널에 초기 메시지 전송
        const ticketInfoEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🎫 새 티켓이 생성되었습니다')
            .setDescription(`${user}님의 티켓입니다.\n아래 선택 메뉴에서 원하는 작업을 선택하세요.`)
            .addFields(
                { 
                    name: '📌 중요 안내', 
                    value: '선택 메뉴를 사용하여 원하는 작업을 진행하세요.\n작업이 완료되면 티켓 닫기를 선택하세요.', 
                    inline: false 
                }
            )
            .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 선택 메뉴 생성
        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ticket_actions')
                    .setPlaceholder('원하는 작업을 선택하세요')
                    .addOptions([
                        {
                            label: '클랜 규칙',
                            description: '클랜 규칙을 확인합니다',
                            value: 'clan_rules',
                            emoji: '📜'
                        },
                        {
                            label: '클랜 가입 신청',
                            description: '클랜 가입 신청서를 작성합니다',
                            value: 'clan_application',
                            emoji: '📝'
                        },
                        {
                            label: '관리자 호출',
                            description: '관리자를 호출합니다',
                            value: 'call_admin',
                            emoji: '🔔'
                        },
                        {
                            label: '티켓 닫기',
                            description: '티켓을 닫습니다',
                            value: 'close_ticket',
                            emoji: '🔒'
                        }
                    ])
            );
        
        // 티켓 채널에 메시지 전송
        await ticketChannel.send({
            content: `${user}님, 티켓이 생성되었습니다!`,
            embeds: [ticketInfoEmbed],
            components: [row]
        });
        
        // 로그
        log('INFO', `${user.tag}님이 티켓을 생성했습니다. 채널: ${ticketChannel.name}`);
        
    } catch (error) {
        log('ERROR', `티켓 생성 중 오류 발생: ${error.message}`);
        
        if (interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 오류 발생')
                .setDescription(`티켓 생성 중 오류가 발생했습니다: ${error.message}`)
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            await interaction.editReply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
        }
    }
}

// 클랜 규칙 표시
async function showClanRules(interaction, client, log) {
    try {
        // 클랜 규칙 임베드
        const clanRulesEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📜 클랜 규칙')
            .setDescription('우리 클랜의 규칙입니다. 가입하기 전에 반드시 읽어주세요.')
            .addFields(
                { 
                    name: '1️⃣ 기본 규칙', 
                    value: '• 👋 클랜원간 예의를 지켜주세요.\n• 🤝 타인을 존중하고 비하 발언을 삼가해주세요.\n• 🗣️ 과도한 욕설 사용은 자제해주세요.', 
                    inline: false 
                },
                { 
                    name: '2️⃣ 활동 요구사항', 
                    value: '• 📅 주간 활동 최소 3회 이상 필요합니다.\n• 🏆 클랜전 참여는 필수입니다.\n• 📝 장기간 활동이 어려운 경우 미리 공지해주세요.', 
                    inline: false 
                },
                { 
                    name: '3️⃣ 클랜전 규칙', 
                    value: '• ⚔️ 클랜전 신청 후 불참은 경고 대상입니다.\n• ⏱️ 클랜전 공격은 정해진 시간 내에 완료해주세요.\n• 📋 클랜전 전략은 클랜 공지를 따릅니다.', 
                    inline: false 
                },
                { 
                    name: '4️⃣ 처벌 규정', 
                    value: '• ⚠️ 규칙 위반 시 경고가 부여됩니다.\n• 🚫 경고 3회 누적 시 클랜에서 제명됩니다.\n• ⛔ 심각한 규칙 위반은 즉시 제명될 수 있습니다.', 
                    inline: false 
                }
            )
            .setFooter({ text: '클랜 규칙에 동의하시면 아래 버튼을 클릭해주세요.', iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 동의 버튼
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('agree_rules')
                    .setLabel('규칙에 동의합니다')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );
        
        // 규칙 임베드 전송 (본인만 볼 수 있음)
        await interaction.reply({
            embeds: [clanRulesEmbed],
            components: [row],
            ephemeral: true
        });
        
    } catch (error) {
        log('ERROR', `클랜 규칙 표시 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('클랜 규칙을 표시하는 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 클랜 규칙 동의 처리
async function handleRulesAgreement(interaction, client, log) {
    try {
        // 동의 임베드
        const agreementEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 클랜 규칙 동의')
            .setDescription(`${interaction.user}님이 클랜 규칙에 동의하였습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 채널에 동의 메시지 전송
        await interaction.channel.send({
            embeds: [agreementEmbed]
        });
        
        // 사용자에게 응답
        const responseEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 동의 완료')
            .setDescription('클랜 규칙 동의가 완료되었습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [responseEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}님이 클랜 규칙에 동의했습니다.`);
        
    } catch (error) {
        log('ERROR', `클랜 규칙 동의 처리 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('동의 처리 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 클랜 가입 신청 모달 표시
async function showClanApplicationModal(interaction, client, log) {
    try {
        // 모달 생성
        const modal = new ModalBuilder()
            .setCustomId('clan_application_modal')
            .setTitle('클랜 가입 신청서');
        
        // 텍스트 입력 필드 추가
        const gameNameInput = new TextInputBuilder()
            .setCustomId('game_name')
            .setLabel('게임 내 닉네임')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('게임에서 사용하는 닉네임을 입력하세요')
            .setRequired(true);
        
        const gameIdInput = new TextInputBuilder()
            .setCustomId('game_id')
            .setLabel('게임 ID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('게임 ID 또는 고유 번호를 입력하세요')
            .setRequired(true);
        
        const levelInput = new TextInputBuilder()
            .setCustomId('level')
            .setLabel('현재 레벨/티어')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('현재 게임 레벨 또는 티어를 입력하세요')
            .setRequired(true);
        
        const activityInput = new TextInputBuilder()
            .setCustomId('activity')
            .setLabel('주로 활동 가능한 시간')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('평일/주말 활동 가능 시간을 입력하세요')
            .setRequired(true);
        
        const motivationInput = new TextInputBuilder()
            .setCustomId('motivation')
            .setLabel('가입 동기')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('우리 클랜에 가입하려는 이유를 간략히 적어주세요')
            .setRequired(true);
        
        // 액션 로우에 텍스트 입력 필드 추가
        const firstActionRow = new ActionRowBuilder().addComponents(gameNameInput);
        const secondActionRow = new ActionRowBuilder().addComponents(gameIdInput);
        const thirdActionRow = new ActionRowBuilder().addComponents(levelInput);
        const fourthActionRow = new ActionRowBuilder().addComponents(activityInput);
        const fifthActionRow = new ActionRowBuilder().addComponents(motivationInput);
        
        // 모달에 액션 로우 추가
        modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow, fifthActionRow);
        
        // 모달 표시
        await interaction.showModal(modal);
        
    } catch (error) {
        log('ERROR', `클랜 가입 신청 모달 표시 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('가입 신청 양식을 표시하는 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 클랜 가입 신청 처리
async function handleClanApplication(interaction, client, log) {
    try {
        // 폼 데이터 가져오기
        const gameName = interaction.fields.getTextInputValue('game_name');
        const gameId = interaction.fields.getTextInputValue('game_id');
        const level = interaction.fields.getTextInputValue('level');
        const activity = interaction.fields.getTextInputValue('activity');
        const motivation = interaction.fields.getTextInputValue('motivation');
        
        // 신청서 임베드 생성
        const applicationEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📝 클랜 가입 신청서')
            .setDescription(`${interaction.user}님의 클랜 가입 신청서입니다.`)
            .addFields(
                { name: '👤 디스코드 태그', value: interaction.user.tag, inline: true },
                { name: '🎮 게임 닉네임', value: gameName, inline: true },
                { name: '🆔 게임 ID', value: gameId, inline: true },
                { name: '⭐ 레벨/티어', value: level, inline: true },
                { name: '⏰ 활동 가능 시간', value: activity, inline: true },
                { name: '📋 가입 동기', value: motivation, inline: false }
            )
            .setFooter({ text: '관리자가 검토 후 연락드리겠습니다.', iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 버튼 생성 (관리자용 승인/거부 버튼)
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`approve_application:${interaction.user.id}`)
                    .setLabel('승인')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`reject_application:${interaction.user.id}`)
                    .setLabel('거부')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );
        
        // 채널에 신청서 임베드 전송
        await interaction.channel.send({
            embeds: [applicationEmbed],
            components: [row]
        });
        
        // 사용자에게 응답
        const responseEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 신청서 제출 완료')
            .setDescription('클랜 가입 신청이 성공적으로 제출되었습니다.')
            .addFields({ name: '📢 다음 단계', value: '관리자가 검토 후 연락드릴 예정입니다.', inline: false })
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [responseEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}님이 클랜 가입 신청서를 제출했습니다.`);
        
    } catch (error) {
        log('ERROR', `클랜 가입 신청 처리 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('가입 신청 처리 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 가입 신청 승인
async function approveApplication(interaction, client, log) {
    try {
        // 사용자 ID 가져오기
        const userId = interaction.customId.split(':')[1];
        
        // 승인 임베드
        const approveEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 가입 신청 승인')
            .setDescription(`<@${userId}>님의 클랜 가입 신청이 승인되었습니다.`)
            .addFields(
                { name: '👑 승인자', value: `${interaction.user.tag}`, inline: true },
                { name: '🕒 승인 시간', value: new Date().toLocaleString('ko-KR'), inline: true }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 원본 메시지에 승인 임베드 응답
        await interaction.update({
            embeds: [
                EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor('#57F287')
                    .addFields({ name: '✅ 상태', value: '승인됨', inline: true })
            ],
            components: []
        });
        
        // 추가 알림 메시지
        await interaction.channel.send({ embeds: [approveEmbed] });
        
        log('INFO', `${interaction.user.tag}님이 ${userId} 사용자의 클랜 가입 신청을 승인했습니다.`);
        
    } catch (error) {
        log('ERROR', `가입 신청 승인 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('가입 신청 승인 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 가입 신청 거부
async function rejectApplication(interaction, client, log) {
    try {
        // 사용자 ID 가져오기
        const userId = interaction.customId.split(':')[1];
        
        // 거부 사유 모달 표시
        const modal = new ModalBuilder()
            .setCustomId(`reject_reason:${userId}`)
            .setTitle('가입 신청 거부 사유');
        
        const reasonInput = new TextInputBuilder()
            .setCustomId('reject_reason')
            .setLabel('거부 사유')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('가입 신청을 거부하는 이유를 입력하세요')
            .setRequired(true);
        
        const firstActionRow = new ActionRowBuilder().addComponents(reasonInput);
        
        modal.addComponents(firstActionRow);
        
        await interaction.showModal(modal);
        
    } catch (error) {
        log('ERROR', `가입 신청 거부 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('가입 신청 거부 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 가입 신청 거부 사유 처리
async function handleRejectReason(interaction, client, log) {
    try {
        const userId = interaction.customId.split(':')[1];
        const reason = interaction.fields.getTextInputValue('reject_reason');
        
        // 거부 임베드
        const rejectEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 가입 신청 거부')
            .setDescription(`<@${userId}>님의 클랜 가입 신청이 거부되었습니다.`)
            .addFields(
                { name: '👑 거부자', value: `${interaction.user.tag}`, inline: true },
                { name: '🕒 거부 시간', value: new Date().toLocaleString('ko-KR'), inline: true },
                { name: '📝 거부 사유', value: reason, inline: false }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 원본 메시지에 거부 임베드 응답
        await interaction.update({
            embeds: [
                EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor('#ED4245')
                    .addFields({ name: '❌ 상태', value: '거부됨', inline: true })
            ],
            components: []
        });
        
        // 추가 알림 메시지
        await interaction.channel.send({ embeds: [rejectEmbed] });
        
        log('INFO', `${interaction.user.tag}님이 ${userId} 사용자의 클랜 가입 신청을 거부했습니다. 사유: ${reason}`);
        
    } catch (error) {
        log('ERROR', `가입 신청 거부 사유 처리 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('가입 신청 거부 처리 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 관리자 호출
async function callAdmin(interaction, client, log) {
    try {
        // 서버 설정 확인
        const settings = guildSettings.get(interaction.guild.id);
        if (!settings || !settings.adminRole) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 설정 오류')
                .setDescription('관리자 역할이 설정되지 않았습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 관리자 역할 멘션
        const adminRoleMention = `<@&${settings.adminRole}>`;
        
        // 관리자 호출 임베드
        const callAdminEmbed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('🔔 관리자 호출')
            .setDescription(`${interaction.user}님이 관리자를 호출했습니다.`)
            .addFields(
                { name: '📢 채널', value: `<#${interaction.channel.id}>`, inline: true },
                { name: '⏰ 시간', value: new Date().toLocaleString('ko-KR'), inline: true }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 채널에 메시지 전송
        await interaction.channel.send({
            content: adminRoleMention,
            embeds: [callAdminEmbed]
        });
        
        // 사용자에게 응답
        const responseEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 관리자 호출 완료')
            .setDescription('관리자를 성공적으로 호출했습니다.')
            .addFields({ name: '⏳ 안내', value: '곧 관리자가 응답할 예정입니다.', inline: false })
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [responseEmbed], ephemeral: true });
        
        log('INFO', `${interaction.user.tag}님이 티켓 채널 ${interaction.channel.name}에서 관리자를 호출했습니다.`);
        
    } catch (error) {
        log('ERROR', `관리자 호출 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('관리자 호출 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 티켓 닫기
async function closeTicket(interaction, client, log) {
    try {
        // 티켓 닫기 확인 임베드
        const confirmEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('🔒 티켓 닫기')
            .setDescription('정말로 이 티켓을 닫으시겠습니까?')
            .addFields(
                { name: '⚠️ 주의', value: '티켓을 닫으면 이 채널은 5초 후 삭제됩니다.', inline: false }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 확인 버튼
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('confirm_close_ticket')
                    .setLabel('티켓 닫기 확인')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒'),
                new ButtonBuilder()
                    .setCustomId('cancel_close_ticket')
                    .setLabel('취소')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('✖️')
            );
        
        // 확인 메시지 전송
        await interaction.reply({
            embeds: [confirmEmbed],
            components: [row]
        });
        
    } catch (error) {
        log('ERROR', `티켓 닫기 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('티켓 닫기 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 티켓 닫기 확인
async function confirmCloseTicket(interaction, client, log) {
    try {
        // 채널 삭제 공지
        const closingEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('🔒 티켓 닫는 중')
            .setDescription(`${interaction.user}님이 티켓을 닫았습니다. 이 채널은 5초 후 삭제됩니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 닫기 임베드 전송
        await interaction.update({
            embeds: [closingEmbed],
            components: []
        });
        
        log('INFO', `${interaction.user.tag}님이 티켓 채널 ${interaction.channel.name}을(를) 닫았습니다.`);
        
        // 5초 후 채널 삭제
        setTimeout(async () => {
            try {
                await interaction.channel.delete();
                log('INFO', `티켓 채널 ${interaction.channel.name}이(가) 삭제되었습니다.`);
            } catch (error) {
                log('ERROR', `티켓 채널 삭제 중 오류 발생: ${error.message}`);
            }
        }, 5000);
        
    } catch (error) {
        log('ERROR', `티켓 닫기 확인 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('티켓 닫기 처리 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 티켓 닫기 취소
async function cancelCloseTicket(interaction, client, log) {
    try {
        // 취소 임베드
        const cancelEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('✖️ 티켓 닫기 취소됨')
            .setDescription('티켓 닫기가 취소되었습니다. 계속해서 티켓을 이용하실 수 있습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 취소 메시지 업데이트
        await interaction.update({
            embeds: [cancelEmbed],
            components: []
        });
        
        log('INFO', `${interaction.user.tag}님이 티켓 채널 ${interaction.channel.name} 닫기를 취소했습니다.`);
        
    } catch (error) {
        log('ERROR', `티켓 닫기 취소 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('티켓 닫기 취소 처리 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 선택 메뉴 처리
async function handleSelectMenu(interaction, client, log) {
    try {
        const value = interaction.values[0];
        
        switch (value) {
            case 'clan_rules':
                await showClanRules(interaction, client, log);
                break;
            case 'clan_application':
                await showClanApplicationModal(interaction, client, log);
                break;
            case 'call_admin':
                await callAdmin(interaction, client, log);
                break;
            case 'close_ticket':
                await closeTicket(interaction, client, log);
                break;
        }
    } catch (error) {
        log('ERROR', `선택 메뉴 처리 중 오류 발생: ${error.message}`);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription('선택한 작업을 처리하는 중 오류가 발생했습니다.')
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
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
    
    // 서버 시작 시 기존 티켓 채널 복구
    client.guilds.cache.forEach(async (guild) => {
        try {
            // 서버 설정 가져오기
            const settings = guildSettings.get(guild.id);
            if (!settings) return;

            // "티켓-" 접두사를 가진 채널 찾기
            const ticketChannels = guild.channels.cache.filter(
                channel => channel.name.startsWith('티켓-') && channel.type === ChannelType.GuildText
            );

            // 각 티켓 채널에 대해
            for (const [channelId, channel] of ticketChannels) {
                try {
                    // 마지막 메시지 가져오기
                    const messages = await channel.messages.fetch({ limit: 10 });
                    
                    // 선택 메뉴가 있는 메시지 찾기
                    const menuMessage = messages.find(msg => 
                        msg.author.id === client.user.id && 
                        msg.components.length > 0 &&
                        msg.components.some(row => 
                            row.components.some(comp => comp.customId === 'ticket_actions')
                        )
                    );
                    
                    // 선택 메뉴가 없으면 새로 생성
                    if (!menuMessage) {
                        // 티켓 정보 임베드 생성
                        const ticketInfoEmbed = new EmbedBuilder()
                            .setColor('#5865F2')
                            .setTitle('🎫 티켓 시스템 복구됨')
                            .setDescription('서버 재시작으로 티켓 시스템이 복구되었습니다.\n아래 선택 메뉴에서 원하는 작업을 선택하세요.')
                            .addFields(
                                { 
                                    name: '📌 중요 안내', 
                                    value: '선택 메뉴를 사용하여 원하는 작업을 진행하세요.\n작업이 완료되면 티켓 닫기를 선택하세요.', 
                                    inline: false 
                                }
                            )
                            .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) })
                            .setTimestamp();
                        
                        // 선택 메뉴 생성
                        const row = new ActionRowBuilder()
                            .addComponents(
                                new StringSelectMenuBuilder()
                                    .setCustomId('ticket_actions')
                                    .setPlaceholder('원하는 작업을 선택하세요')
                                    .addOptions([
                                        {
                                            label: '클랜 규칙',
                                            description: '클랜 규칙을 확인합니다',
                                            value: 'clan_rules',
                                            emoji: '📜'
                                        },
                                        {
                                            label: '클랜 가입 신청',
                                            description: '클랜 가입 신청서를 작성합니다',
                                            value: 'clan_application',
                                            emoji: '📝'
                                        },
                                        {
                                            label: '관리자 호출',
                                            description: '관리자를 호출합니다',
                                            value: 'call_admin',
                                            emoji: '🔔'
                                        },
                                        {
                                            label: '티켓 닫기',
                                            description: '티켓을 닫습니다',
                                            value: 'close_ticket',
                                            emoji: '🔒'
                                        }
                                    ])
                            );
                        
                        // 티켓 채널에 새 메시지 전송
                        await channel.send({
                            embeds: [ticketInfoEmbed],
                            components: [row]
                        });
                        
                        log('INFO', `기존 티켓 채널 ${channel.name}에 새 메뉴를 생성했습니다.`);
                    }
                } catch (error) {
                    log('ERROR', `티켓 채널 ${channel.name} 복구 중 오류 발생: ${error.message}`);
                }
            }
        } catch (error) {
            log('ERROR', `서버 ${guild.name}의 티켓 채널 복구 중 오류 발생: ${error.message}`);
        }
    });
    
    // 버튼 상호작용 처리
    client.on('interactionCreate', async (interaction) => {
        // 버튼, 모달 제출 또는 선택 메뉴 이벤트만 처리
        if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;
        
        // 상호작용 토큰 만료 등의 에러 처리 강화
        try {
            // 버튼 상호작용
            if (interaction.isButton()) {
                const customId = interaction.customId;
                
                switch (customId) {
                    case 'create_ticket':
                        await createTicket(interaction, client, log);
                        break;
                    case 'agree_rules':
                        await handleRulesAgreement(interaction, client, log);
                        break;
                    case 'confirm_close_ticket':
                        await confirmCloseTicket(interaction, client, log);
                        break;
                    case 'cancel_close_ticket':
                        await cancelCloseTicket(interaction, client, log);
                        break;
                    default:
                        if (customId.startsWith('approve_application:')) {
                            await approveApplication(interaction, client, log);
                            break;
                        } else if (customId.startsWith('reject_application:')) {
                            await rejectApplication(interaction, client, log);
                            break;
                        }
                }
            }
            // 모달 제출 상호작용
            else if (interaction.isModalSubmit()) {
                const modalId = interaction.customId;
                
                if (modalId === 'clan_application_modal') {
                    await handleClanApplication(interaction, client, log);
                } else if (modalId.startsWith('reject_reason:')) {
                    await handleRejectReason(interaction, client, log);
                }
            }
            // 선택 메뉴 상호작용
            else if (interaction.isStringSelectMenu()) {
                const menuId = interaction.customId;
                
                if (menuId === 'ticket_actions') {
                    await handleSelectMenu(interaction, client, log);
                }
            }
        } catch (error) {
            // Discord API 에러 코드 확인 (10062는 상호작용 토큰 만료 에러)
            if (error.code === 10062) {
                log('INFO', `상호작용 토큰 만료 에러가 발생했지만 무시합니다. 채널: ${interaction.channelId}`);
                return;
            }
            
            log('ERROR', `티켓 시스템 상호작용 처리 중 오류 발생: ${error.message}`);
            
            // 에러 응답 (아직 응답하지 않은 경우에만)
            try {
                if (!interaction.replied && !interaction.deferred) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('❌ 오류 발생')
                        .setDescription('요청을 처리하는 동안 오류가 발생했습니다.')
                        .addFields({ name: '🔄 해결 방법', value: '이 문제가 지속되면 명령어를 다시 사용하거나 새 티켓을 생성해 보세요.', inline: false })
                        .setFooter({ text: interaction.guild?.name || '오류', iconURL: interaction.guild?.iconURL({ dynamic: true }) })
                        .setTimestamp();
                        
                    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }
            } catch (replyError) {
                // 응답 오류 무시
            }
        }
    });
    
    log('MODULE', '티켓 시스템 모듈이 초기화되었습니다.');
}

// 슬래시 커맨드 정의
const slashCommands = [
    new SlashCommandBuilder()
        .setName('티켓설정')
        .setDescription('티켓 시스템을 설정합니다')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('임베드생성')
                .setDescription('티켓 시스템 임베드를 생성합니다')
                .addChannelOption(option =>
                    option.setName('채널')
                        .setDescription('임베드를 생성할 채널')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('관리자역할설정')
                .setDescription('티켓 관리자 역할을 설정합니다')
                .addRoleOption(option =>
                    option.setName('역할')
                        .setDescription('티켓 관리자 역할')
                        .setRequired(true)))
];

// 슬래시 커맨드 실행 함수
async function executeSlashCommand(interaction, client, log) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === '임베드생성') {
        await createTicketEmbed(interaction, client, log);
    }
    else if (subcommand === '관리자역할설정') {
        await setAdminRole(interaction, client, log);
    }
}

module.exports = {
    name: 'ticket-system',
    description: '티켓 시스템 모듈',
    version: '1.0.0',
    commands: ['티켓설정'],
    enabled: true,
    init,
    executeSlashCommand,
    slashCommands
};