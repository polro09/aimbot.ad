// modules/welcome.js - 개선된 웰컴 모듈
const { 
  SlashCommandBuilder, 
  PermissionFlagsBits,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  Events
} = require('discord.js');
const logger = require('../logger');
const config = require('../config/bot-config');
const commandManager = require('../commands');

/**
 * 웰컴 모듈 클래스 - 기능 개선
 */
class WelcomeModule {
  constructor(client) {
    this.client = client;
    this.name = 'welcome';
    this.description = '서버 입장/퇴장 알림 모듈';
    this.enabled = config.get('modules.welcome.enabled', true);
    this.configurable = true;
    
    // 명령어 등록
    this.registerCommands();
    
    logger.module(this.name, '웰컴 모듈이 초기화되었습니다.');
  }

  /**
   * 모듈 활성화 여부 설정
   * @param {boolean} enabled 활성화 여부
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    logger.module(this.name, `모듈이 ${enabled ? '활성화' : '비활성화'}되었습니다.`);
  }

  /**
   * 모듈 이벤트 리스너 등록
   */
  registerEvents() {
    if (!this.enabled) {
      logger.warn(this.name, '모듈이 비활성화되어 있어 이벤트를 등록하지 않습니다.');
      return;
    }

    // 길드 멤버 입장 이벤트
    this.client.on(Events.GuildMemberAdd, async (member) => {
      await this.handleMemberJoin(member);
    });

    // 길드 멤버 퇴장 이벤트
    this.client.on(Events.GuildMemberRemove, async (member) => {
      await this.handleMemberLeave(member);
    });

    logger.success(this.name, '이벤트 리스너가 등록되었습니다.');
  }

  /**
   * 슬래시 커맨드 등록
   */
  registerCommands() {
    const welcomeSetCommand = new SlashCommandBuilder()
      .setName('환영채널설정')
      .setDescription('입장/퇴장 메시지를 보낼 채널을 설정합니다.')
      .addChannelOption(option => 
        option.setName('채널')
          .setDescription('알림을 보낼 채널을 선택하세요.')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON();

    const welcomeMessageCommand = new SlashCommandBuilder()
      .setName('환영메시지설정')
      .setDescription('환영 메시지를 설정합니다.')
      .addSubcommand(subcommand => 
        subcommand
          .setName('입장')
          .setDescription('입장 메시지를 설정합니다.')
          .addStringOption(option => 
            option.setName('메시지')
              .setDescription('입장 메시지 (변수: {username}, {server}, {count})')
              .setRequired(true)))
      .addSubcommand(subcommand => 
        subcommand
          .setName('퇴장')
          .setDescription('퇴장 메시지를 설정합니다.')
          .addStringOption(option => 
            option.setName('메시지')
              .setDescription('퇴장 메시지 (변수: {username}, {server}, {count})')
              .setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON();

    const toggleWelcomeCommand = new SlashCommandBuilder()
      .setName('환영메시지')
      .setDescription('입장/퇴장 메시지를 활성화하거나 비활성화합니다.')
      .addBooleanOption(option => 
        option.setName('활성화')
          .setDescription('활성화 여부 (true: 활성화, false: 비활성화)')
          .setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .toJSON();

    // 커맨드 매니저에 명령어 등록
    commandManager.registerModuleCommands(this.name, [
      welcomeSetCommand,
      welcomeMessageCommand,
      toggleWelcomeCommand
    ]);
  }

  /**
   * 명령어 실행 처리
   * @param {Interaction} interaction 상호작용 객체
   * @returns {boolean} 처리 여부
   */
  async handleCommands(interaction) {
    if (!interaction.isCommand()) return false;

    const { commandName } = interaction;

    if (commandName === '환영채널설정') {
      await this.handleSetWelcomeChannel(interaction);
      return true;
    } else if (commandName === '환영메시지설정') {
      await this.handleSetWelcomeMessage(interaction);
      return true;
    } else if (commandName === '환영메시지') {
      await this.handleToggleWelcome(interaction);
      return true;
    }

    return false;
  }

  /**
   * 환영 채널 설정 명령어 처리
   * @param {Interaction} interaction 상호작용 객체
   */
  async handleSetWelcomeChannel(interaction) {
    try {
      const channel = interaction.options.getChannel('채널');
      
      // 채널 권한 확인
      if (!channel.viewable || !channel.permissionsFor(interaction.guild.members.me).has('SendMessages')) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor('#F04747')
              .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
              .setTitle('❌ 권한 부족')
              .setDescription('선택한 채널에 메시지를 보낼 권한이 없습니다!')
              .setTimestamp()
              .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
          ],
          ephemeral: true
        });
      }
      
      // 설정 업데이트
      config.set('welcomeChannelId', channel.id);
      config.saveConfig();
      
      const embed = new EmbedBuilder()
        .setColor('#43B581')
        .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
        .setTitle('✅ 환영 채널 설정 완료')
        .setDescription(`입장/퇴장 메시지가 <#${channel.id}> 채널로 전송됩니다.`)
        .setTimestamp()
        .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() });
      
      await interaction.reply({ embeds: [embed] });
      logger.success(this.name, `환영 채널이 #${channel.name} (${channel.id})로 설정되었습니다.`);
    } catch (error) {
      logger.error(this.name, `환영 채널 설정 오류: ${error.message}`);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor('#F04747')
            .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
            .setTitle('❌ 설정 오류')
            .setDescription('채널 설정 중 오류가 발생했습니다.')
            .setTimestamp()
            .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
        ],
        ephemeral: true
      });
    }
  }

  /**
   * 환영 메시지 설정 명령어 처리
   * @param {Interaction} interaction 상호작용 객체
   */
  async handleSetWelcomeMessage(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      const message = interaction.options.getString('메시지');
      
      if (subcommand === '입장') {
        config.updateModuleConfig('welcome', { joinMessage: message });
      } else if (subcommand === '퇴장') {
        config.updateModuleConfig('welcome', { leaveMessage: message });
      }
      
      config.saveConfig();
      
      // 미리보기 메시지 생성
      const previewMessage = message
        .replace('{username}', interaction.user.username)
        .replace('{server}', interaction.guild.name)
        .replace('{count}', interaction.guild.memberCount);
      
      const embed = new EmbedBuilder()
        .setColor('#43B581')
        .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
        .setTitle(`✅ ${subcommand === '입장' ? '입장' : '퇴장'} 메시지 설정 완료`)
        .setDescription(`${subcommand === '입장' ? '입장' : '퇴장'} 메시지가 설정되었습니다.`)
        .addFields(
          { name: '설정된 메시지', value: message, inline: false },
          { name: '미리보기', value: previewMessage, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() });
      
      await interaction.reply({ embeds: [embed] });
      logger.success(this.name, `${subcommand === '입장' ? '입장' : '퇴장'} 메시지가 설정되었습니다: ${message}`);
    } catch (error) {
      logger.error(this.name, `환영 메시지 설정 오류: ${error.message}`);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor('#F04747')
            .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
            .setTitle('❌ 설정 오류')
            .setDescription('메시지 설정 중 오류가 발생했습니다.')
            .setTimestamp()
            .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
        ],
        ephemeral: true
      });
    }
  }

  /**
   * 환영 메시지 토글 명령어 처리
   * @param {Interaction} interaction 상호작용 객체
   */
  async handleToggleWelcome(interaction) {
    try {
      const enabled = interaction.options.getBoolean('활성화');
      
      // 설정 업데이트
      config.updateModuleConfig(this.name, { enabled });
      this.enabled = enabled;
      config.saveConfig();
      
      // 활성화 상태에 따라 이벤트 등록/해제
      if (enabled) {
        this.registerEvents();
      }
      
      const embed = new EmbedBuilder()
        .setColor(enabled ? '#43B581' : '#F04747')
        .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
        .setTitle(`${enabled ? '✅ 환영 메시지 활성화' : '⛔ 환영 메시지 비활성화'}`)
        .setDescription(`입장/퇴장 메시지가 ${enabled ? '활성화' : '비활성화'}되었습니다.`)
        .setTimestamp()
        .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() });
      
      await interaction.reply({ embeds: [embed] });
      logger.success(this.name, `환영 메시지가 ${enabled ? '활성화' : '비활성화'}되었습니다.`);
    } catch (error) {
      logger.error(this.name, `환영 메시지 토글 오류: ${error.message}`);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor('#F04747')
            .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
            .setTitle('❌ 설정 오류')
            .setDescription('설정 변경 중 오류가 발생했습니다.')
            .setTimestamp()
            .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
        ],
        ephemeral: true
      });
    }
  }

  /**
   * 멤버 입장 처리
   * @param {GuildMember} member 길드 멤버
   */
  async handleMemberJoin(member) {
    if (!this.enabled) return;
    
    try {
      const welcomeChannelId = config.get('welcomeChannelId');
      if (!welcomeChannelId) {
        return logger.warn(this.name, '환영 채널이 설정되지 않았습니다.');
      }
      
      const channel = member.guild.channels.cache.get(welcomeChannelId);
      if (!channel) {
        return logger.warn(this.name, '설정된 환영 채널을 찾을 수 없습니다.');
      }
      
      // 메시지 포맷팅
      const messageText = config.get('modules.welcome.joinMessage', '{username}님이 서버에 입장했습니다!')
        .replace('{username}', member.user.username)
        .replace('{server}', member.guild.name)
        .replace('{count}', member.guild.memberCount);
      
      // 임베드 메시지 생성
      const embed = new EmbedBuilder()
        .setColor('#43B581')
        .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
        .setTitle('👋 환영합니다!')
        .setDescription(messageText)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: '👤 유저 정보', value: `\`\`\`유저 ID: ${member.id}\n계정 생성일: ${member.user.createdAt.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} (${Math.floor((Date.now() - member.user.createdAt) / (1000 * 60 * 60 * 24))}일)\n서버 참가일: ${member.joinedAt.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} (0일)\`\`\``, inline: false },
        )
        .setImage(member.guild.bannerURL({ format: 'png', size: 1024 }) || null)
        .setTimestamp()
        .setFooter({ text: '🎷Blues', iconURL: member.guild.iconURL() });
      
      await channel.send({ embeds: [embed] });
      logger.success(this.name, `${member.user.tag}님의 입장 메시지를 전송했습니다.`);
    } catch (error) {
      logger.error(this.name, `멤버 입장 처리 오류: ${error.message}`);
    }
  }

  /**
   * 멤버 퇴장 처리
   * @param {GuildMember} member 길드 멤버
   */
  async handleMemberLeave(member) {
    if (!this.enabled) return;
    
    try {
      const welcomeChannelId = config.get('welcomeChannelId');
      if (!welcomeChannelId) {
        return logger.warn(this.name, '환영 채널이 설정되지 않았습니다.');
      }
      
      const channel = member.guild.channels.cache.get(welcomeChannelId);
      if (!channel) {
        return logger.warn(this.name, '설정된 환영 채널을 찾을 수 없습니다.');
      }
      
      // 메시지 포맷팅
      const messageText = config.get('modules.welcome.leaveMessage', '{username}님이 서버에서 퇴장했습니다!')
        .replace('{username}', member.user.username)
        .replace('{server}', member.guild.name)
        .replace('{count}', member.guild.memberCount);
      
      // 임베드 메시지 생성
      const embed = new EmbedBuilder()
        .setColor('#F04747')
        .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
        .setTitle('👋 안녕히 가세요!')
        .setDescription(messageText)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: '👤 유저 정보', value: `\`\`\`유저 ID: ${member.id}\n서버 탈퇴일: ${new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} (0일)\`\`\``, inline: false },
        )
        .setImage(member.guild.bannerURL({ format: 'png', size: 1024 }) || null)
        .setTimestamp()
        .setFooter({ text: '🎷Blues', iconURL: member.guild.iconURL() });
      
      await channel.send({ embeds: [embed] });
      logger.success(this.name, `${member.user.tag}님의 퇴장 메시지를 전송했습니다.`);
    } catch (error) {
      logger.error(this.name, `멤버 퇴장 처리 오류: ${error.message}`);
    }
  }

  /**
   * 모듈을 초기화하고 시작합니다.
   */
  async start() {
    if (this.enabled) {
      this.registerEvents();
      logger.success(this.name, '웰컴 모듈이 활성화되었습니다.');
    } else {
      logger.warn(this.name, '웰컴 모듈이 비활성화되어 있습니다.');
    }
    return this;
  }
}

module.exports = (client) => new WelcomeModule(client);