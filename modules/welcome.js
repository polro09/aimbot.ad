// welcome.js - 입장/퇴장 알림 모듈 (슬래시 커맨드 버전)
const logger = require('../utils/logger');
const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('../storage');

// 스토리지 키
const STORAGE_KEY = 'welcome-settings';

// 모듈 설정 관리 (서버별 설정 저장)
let guildSettings = new Map();

// 저장된 설정 불러오기
async function loadSettings() {
    try {
        await storage.load(STORAGE_KEY);
        const data = storage.getAll(STORAGE_KEY);
        
        if (data) {
            // Map으로 변환
            guildSettings = new Map(Object.entries(data));
            logger.info('입장/퇴장 알림 설정을 로드했습니다.', null, 'WELCOME');
        }
        
        return true;
    } catch (error) {
        logger.error(`입장/퇴장 알림 설정 로드 중 오류: ${error.message}`, null, 'WELCOME', error);
        return false;
    }
}

// 설정 저장하기
async function saveSettings() {
    try {
        // Map을 객체로 변환
        const data = Object.fromEntries(guildSettings);
        
        // 스토리지에 저장
        storage.setAll(STORAGE_KEY, data);
        await storage.save(STORAGE_KEY);
        
        logger.info('입장/퇴장 알림 설정을 저장했습니다.', null, 'WELCOME');
        return true;
    } catch (error) {
        logger.error(`입장/퇴장 알림 설정 저장 중 오류: ${error.message}`, null, 'WELCOME', error);
        return false;
    }
}

// 서버 설정 저장
function updateGuildSettings(guildId, settings) {
    guildSettings.set(guildId, settings);
    saveSettings();
}

module.exports = {
    name: 'welcome',
    description: '서버 입장/퇴장 알림 모듈',
    version: '1.1.0',
    enabled: true,
    
    // 슬래시 커맨드 정의
    slashCommands: [
        new SlashCommandBuilder()
            .setName('웰컴채널지정')
            .setDescription('입장과 퇴장 알림을 설정합니다')
            .addChannelOption(option => 
                option.setName('채널')
                    .setDescription('알림을 보낼 채널')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            
        new SlashCommandBuilder()
            .setName('웰컴채널확인')
            .setDescription('현재 입장/퇴장 알림 설정을 확인합니다')
    ],
    
    // 슬래시 커맨드 실행 함수
    executeSlashCommand: async (interaction, client) => {
        const { commandName } = interaction;
        
        if (commandName === '웰컴채널지정') {
            const channel = interaction.options.getChannel('채널');
            
            // 서버 설정 업데이트 (입장과 퇴장 모두 같은 채널로 설정)
            const settings = {
                welcomeChannel: channel.id,
                leaveChannel: channel.id
            };
            
            updateGuildSettings(interaction.guild.id, settings);
            
            // 설정 완료 임베드 생성
            const successEmbed = new EmbedBuilder()
                .setColor('#57F287') // 녹색
                .setTitle('✅ 알림 채널 설정 완료')
                .setDescription(`입장 및 퇴장 알림이 <#${channel.id}> 채널로 설정되었습니다.`)
                .addFields(
                    { name: '📝 설정 정보', value: `채널: <#${channel.id}>\n유형: 입장 및 퇴장 알림` }
                )
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
            
            // 설정 완료 메시지
            await interaction.reply({ embeds: [successEmbed], ephemeral: true });
            logger.command(`${interaction.user.tag}가 ${interaction.guild.name} 서버의 입장/퇴장 알림 채널을 설정했습니다.`);
        }
        else if (commandName === '웰컴채널확인') {
            const settings = guildSettings.get(interaction.guild.id);
            
            if (!settings || (!settings.welcomeChannel && !settings.leaveChannel)) {
                // 설정이 없는 경우 임베드
                const noSettingsEmbed = new EmbedBuilder()
                    .setColor('#ED4245') // 빨간색
                    .setTitle('⚠️ 설정 없음')
                    .setDescription('아직 입장/퇴장 알림 채널이 설정되지 않았습니다.')
                    .addFields(
                        { name: '💡 도움말', value: '`/웰컴채널지정` 명령어를 사용하여 알림 채널을 설정해주세요.' }
                    )
                    .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                    .setTimestamp();
                
                return interaction.reply({ embeds: [noSettingsEmbed], ephemeral: true });
            }
            
            // 현재 설정 임베드 생성
            const settingsEmbed = new EmbedBuilder()
                .setColor('#5865F2') // 디스코드 블루
                .setTitle('🔔 현재 알림 설정')
                .setDescription('입장/퇴장 알림 설정 정보입니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
            
            // 설정에 따라 필드 추가
            if (settings.welcomeChannel === settings.leaveChannel) {
                settingsEmbed.addFields(
                    { name: '📣 입장 및 퇴장 알림', value: `채널: <#${settings.welcomeChannel}>` }
                );
            } else {
                if (settings.welcomeChannel) {
                    settingsEmbed.addFields(
                        { name: '🎉 입장 알림', value: `채널: <#${settings.welcomeChannel}>` }
                    );
                }
                
                if (settings.leaveChannel) {
                    settingsEmbed.addFields(
                        { name: '👋 퇴장 알림', value: `채널: <#${settings.leaveChannel}>` }
                    );
                }
            }
            
            await interaction.reply({ embeds: [settingsEmbed], ephemeral: true });
            logger.command(`${interaction.user.tag}가 ${interaction.guild.name} 서버의 입장/퇴장 설정을 확인했습니다.`);
        }
    },
    
    // 모듈 초기화 함수
    init: async (client) => {
        // 스토리지 초기화 확인
        if (!storage.initialized) {
            await storage.init();
        }
        
        // 저장된 설정 불러오기
        await loadSettings();
        
        logger.module('welcome', '입장/퇴장 알림 모듈이 초기화되었습니다.');
        
        // 입장 이벤트
        client.on('guildMemberAdd', async (member) => {
            try {
                const settings = guildSettings.get(member.guild.id);
                if (!settings || !settings.welcomeChannel) return;
                
                const welcomeChannel = member.guild.channels.cache.get(settings.welcomeChannel);
                if (!welcomeChannel) return;
                
                // 계정 생성 일자
                const createdAt = member.user.createdAt;
                
                // 계정 생성일로부터 지난 일수 계산
                const createdDaysAgo = Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24));
                
                // 입장 임베드 생성
                const welcomeEmbed = new EmbedBuilder()
                    .setColor('#57F287') // 녹색
                    .setTitle(`${member.guild.name}에 오신 것을 환영합니다!`)
                    .setDescription(`<@${member.id}>님이 서버에 참가했습니다. 🎉`)
                    .setThumbnail('https://cdn3.emoji.gg/emojis/2594-switch-enabled.png')
                    .setImage('https://imgur.com/PKwWSvx.png') // 환영 이미지 추가
                    .addFields(
                        { name: '👤 유저 정보', value: '```\n' +
                            `유저 ID: ${member.id}\n` +
                            `계정 생성일: ${createdAt.toISOString().split('T')[0].replace(/-/g, '-')} (${createdDaysAgo}일)\n` +
                            `서버 참가일: ${new Date().toISOString().split('T')[0].replace(/-/g, '-')} (0일)\n` +
                            '```', inline: false },
                        { name: '📊 서버 통계', value: '```\n' +
                            `전체 멤버: ${member.guild.memberCount}명\n` +
                            '```', inline: false }
                    )
                    .setFooter({ text: `${member.guild.name}`, iconURL: member.guild.iconURL({ dynamic: true }) })
                    .setTimestamp()
                    .setAuthor({ name: `${member.user.tag}`, iconURL: member.user.displayAvatarURL({ dynamic: true }) });
                
                await welcomeChannel.send({ embeds: [welcomeEmbed] });
                logger.info(`${member.user.tag}님이 ${member.guild.name} 서버에 입장했습니다.`, null, 'WELCOME');
            } catch (error) {
                logger.error(`입장 알림 전송 중 오류 발생: ${error.message}`, null, 'WELCOME', error);
            }
        });
        
        // 퇴장 이벤트
        client.on('guildMemberRemove', async (member) => {
            try {
                const settings = guildSettings.get(member.guild.id);
                if (!settings || !settings.leaveChannel) return;
                
                const leaveChannel = member.guild.channels.cache.get(settings.leaveChannel);
                if (!leaveChannel) return;
                
                // 서버 참가일
                const joinedAt = member.joinedAt;
                
                // 계정 생성일로부터 지난 일수 계산
                const createdDaysAgo = Math.floor((Date.now() - member.user.createdAt) / (1000 * 60 * 60 * 24));
                
                // 서버 참가일로부터 지난 일수 계산 (체류 기간)
                const joinedDaysAgo = joinedAt ? Math.floor((Date.now() - joinedAt) / (1000 * 60 * 60 * 24)) : '알 수 없음';
                
                // 퇴장 임베드 생성
                const leaveEmbed = new EmbedBuilder()
                    .setColor('#ED4245') // 빨간색
                    .setTitle(`${member.guild.name}에서 퇴장했습니다`)
                    .setDescription(`<@${member.id}>님이 서버에서 나갔습니다. 👋`)
                    .setThumbnail('https://cdn3.emoji.gg/emojis/72295-switch-disabled.png')
                    .setImage('https://imgur.com/PKwWSvx.png') // 퇴장 이미지 추가
                    .addFields(
                        { name: '👤 유저 정보', value: '```\n' +
                            `유저 ID: ${member.id}\n` +
                            `서버 참가일: ${joinedAt ? joinedAt.toISOString().split('T')[0].replace(/-/g, '-') : '알 수 없음'} ${joinedAt ? `(${joinedDaysAgo}일)` : ''}\n` +
                            `서버 체류기간: ${new Date().toISOString().split('T')[0].replace(/-/g, '-')} (${typeof joinedDaysAgo === 'number' ? joinedDaysAgo : 0}일)\n` +
                            '```', inline: false },
                        { name: '📊 서버 통계', value: '```\n' +
                            `전체 멤버: ${member.guild.memberCount}명\n` +
                            '```', inline: false }
                    )
                    .setFooter({ text: `${member.guild.name}`, iconURL: member.guild.iconURL({ dynamic: true }) })
                    .setTimestamp()
                    .setAuthor({ name: `${member.user.tag}`, iconURL: member.user.displayAvatarURL({ dynamic: true }) });
                
                await leaveChannel.send({ embeds: [leaveEmbed] });
                logger.info(`${member.user.tag}님이 ${member.guild.name} 서버에서 퇴장했습니다.`, null, 'WELCOME');
            } catch (error) {
                logger.error(`퇴장 알림 전송 중 오류 발생: ${error.message}`, null, 'WELCOME', error);
            }
        });

        return true;
    }
};