// modules/help.js
const { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
  } = require('discord.js');
  const logger = require('../logger');
  const config = require('../config/bot-config');
  const commandManager = require('../commands');
  
  /**
   * 도움말 모듈 클래스
   */
  class HelpModule {
    constructor(client) {
      this.client = client;
      this.name = 'help';
      this.description = '도움말 및 정보 모듈';
      this.enabled = true;
      
      // 명령어 등록
      this.registerCommands();
      
      logger.module(this.name, '도움말 모듈이 초기화되었습니다.');
    }
  
    /**
     * 슬래시 커맨드 등록
     */
    registerCommands() {
      const helpCommand = new SlashCommandBuilder()
        .setName('도움말')
        .setDescription('봇 도움말 및 명령어 목록을 확인합니다.')
        .addStringOption(option =>
          option.setName('모듈')
            .setDescription('특정 모듈에 대한 도움말을 확인합니다.')
            .setRequired(false)
            .addChoices(
              { name: '환영 메시지', value: 'welcome' },
              { name: '가입 신청서', value: 'registration' }
            ))
        .toJSON();
      
      const botInfoCommand = new SlashCommandBuilder()
        .setName('봇정보')
        .setDescription('봇 정보 및 상태를 확인합니다.')
        .toJSON();
      
      // 명령어 매니저에 등록
      commandManager.registerModuleCommands(this.name, [helpCommand, botInfoCommand]);
    }
  
    /**
     * 명령어 실행 처리
     * @param {Interaction} interaction 상호작용 객체
     * @returns {boolean} 처리 여부
     */
    async handleCommands(interaction) {
      if (!interaction.isCommand()) return false;
  
      const { commandName } = interaction;
  
      if (commandName === '도움말') {
        await this.handleHelpCommand(interaction);
        return true;
      } else if (commandName === '봇정보') {
        await this.handleBotInfoCommand(interaction);
        return true;
      }
  
      return false;
    }
  
    /**
     * 버튼 인터랙션 처리
     * @param {Interaction} interaction 버튼 인터렉션
     * @returns {boolean} 처리 여부
     */
    async handleButtons(interaction) {
      if (!interaction.isButton()) return false;
      
      const { customId } = interaction;
      
      if (customId.startsWith('help_module_')) {
        const moduleName = customId.replace('help_module_', '');
        await this.showModuleHelp(interaction, moduleName);
        return true;
      }
      
      return false;
    }
  
    /**
     * 셀렉트 메뉴 인터랙션 처리
     * @param {Interaction} interaction 셀렉트 메뉴 인터렉션
     * @returns {boolean} 처리 여부
     */
    async handleSelectMenus(interaction) {
      if (!interaction.isStringSelectMenu()) return false;
      
      const { customId, values } = interaction;
      
      if (customId === 'help_module_select') {
        const moduleName = values[0];
        await this.showModuleHelp(interaction, moduleName);
        return true;
      }
      
      return false;
    }
  
    /**
     * 도움말 명령어 처리
     * @param {Interaction} interaction 명령어 인터렉션
     */
    async handleHelpCommand(interaction) {
      try {
        const moduleName = interaction.options.getString('모듈');
        
        if (moduleName) {
          // 특정 모듈 도움말
          await this.showModuleHelp(interaction, moduleName, false);
        } else {
          // 전체 도움말
          const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
            .setTitle('📚 aimbot.ad 도움말')
            .setDescription('aimbot.ad는 모듈형 디스코드 봇으로, 다양한 기능을 제공합니다.')
            .addFields(
              { 
                name: '🔍 기본 명령어', 
                value: '`/도움말` - 도움말 및 명령어 목록을 확인합니다.\n`/봇정보` - 봇 정보 및 상태를 확인합니다.', 
                inline: false 
              },
              { 
                name: '🚪 환영 메시지 모듈', 
                value: '`/환영채널설정` - 입장/퇴장 메시지를 보낼 채널을 설정합니다.\n`/환영메시지설정` - 환영 메시지를 설정합니다.\n`/환영메시지` - 메시지를 활성화/비활성화합니다.', 
                inline: false 
              },
              { 
                name: '📝 가입 신청서 모듈', 
                value: '`/가입신청서 설정` - 가입 신청서 채널을 설정합니다.\n`/가입신청서 생성` - 현재 채널에 가입 신청서 양식을 생성합니다.', 
                inline: false 
              }
            )
            .setTimestamp()
            .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() });
          
          // 모듈 선택 메뉴
          const row1 = new ActionRowBuilder()
            .addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('help_module_select')
                .setPlaceholder('모듈 선택...')
                .addOptions(
                  new StringSelectMenuOptionBuilder()
                    .setLabel('환영 메시지')
                    .setDescription('멤버 입장/퇴장 알림 모듈')
                    .setValue('welcome')
                    .setEmoji('🚪'),
                  new StringSelectMenuOptionBuilder()
                    .setLabel('가입 신청서')
                    .setDescription('가입 신청서 처리 모듈')
                    .setValue('registration')
                    .setEmoji('📝')
                )
            );
          
          // 모듈 버튼
          const row2 = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId('help_module_welcome')
                .setLabel('환영 메시지')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🚪'),
              new ButtonBuilder()
                .setCustomId('help_module_registration')
                .setLabel('가입 신청서')
                .setStyle(ButtonStyle.Success)
                .setEmoji('📝')
            );
          
          await interaction.reply({
            embeds: [embed],
            components: [row1, row2]
          });
        }
      } catch (error) {
        logger.error(this.name, `도움말 명령어 처리 오류: ${error.message}`);
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor('#F04747')
              .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
              .setTitle('❌ 오류 발생')
              .setDescription('도움말을 표시하는 중 오류가 발생했습니다.')
              .setTimestamp()
              .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
          ],
          ephemeral: true
        });
      }
    }
  
    /**
     * 특정 모듈 도움말 표시
     * @param {Interaction} interaction 인터렉션
     * @param {string} moduleName 모듈 이름
     * @param {boolean} isUpdate 업데이트 여부
     */
    async showModuleHelp(interaction, moduleName, isUpdate = true) {
      try {
        let embed;
        
        if (moduleName === 'welcome') {
          embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
            .setTitle('🚪 환영 메시지 모듈 도움말')
            .setDescription('서버에 입장하거나 퇴장하는 멤버를 환영하는 메시지를 전송합니다.')
            .addFields(
              { name: '📌 주요 기능', value: '- 서버 입장/퇴장 알림\n- 커스텀 환영 메시지\n- 임베드 메시지 지원', inline: false },
              { name: '🔧 명령어', value: '`/환영채널설정` - 입장/퇴장 메시지를 보낼 채널을 설정합니다.\n`/환영메시지설정 입장` - 입장 메시지를 설정합니다.\n`/환영메시지설정 퇴장` - 퇴장 메시지를 설정합니다.\n`/환영메시지` - 입장/퇴장 메시지를 활성화/비활성화합니다.', inline: false },
              { name: '📝 변수', value: '`{username}` - 사용자 이름\n`{server}` - 서버 이름\n`{count}` - 서버 멤버 수', inline: false },
              { name: '⚙️ 현재 상태', value: `활성화: ${config.get('modules.welcome.enabled') ? '✅' : '❌'}\n설정된 채널: ${config.get('welcomeChannelId') ? `<#${config.get('welcomeChannelId')}>` : '설정되지 않음'}`, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() });
        } else if (moduleName === 'registration') {
          embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
            .setTitle('📝 가입 신청서 모듈 도움말')
            .setDescription('서버 가입을 위한 신청서 시스템을 제공합니다.')
            .addFields(
              { name: '📌 주요 기능', value: '- 두 가지 유형의 가입 신청서\n- 신청서 승인/거부 시스템\n- 티켓 채널 자동 생성', inline: false },
              { name: '🔧 명령어', value: '`/가입신청서 설정` - 가입 신청서 채널을 설정합니다.\n`/가입신청서 생성` - 현재 채널에 가입 신청서 양식을 생성합니다.', inline: false },
              { name: '📋 신청서 유형', value: '**가입 신청서 1 (기본 정보)**\n닉네임, 나이, 성별, 게임 경력 등 기본 정보\n\n**가입 신청서 2 (상세 정보)**\n지원 동기, 플레이 가능 시간, 소속 길드, 기타 사항 등 상세 정보', inline: false },
              { name: '⚙️ 현재 상태', value: `활성화: ${config.get('modules.registration.enabled') ? '✅' : '❌'}\n설정된 채널: ${config.get('modules.registration.channelId') ? `<#${config.get('modules.registration.channelId')}>` : '설정되지 않음'}`, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() });
        } else {
            embed = new EmbedBuilder()
              .setColor('#F04747')
              .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
              .setTitle('❌ 모듈 없음')
              .setDescription(`'${moduleName}' 모듈에 대한 도움말을 찾을 수 없습니다.`)
              .setTimestamp()
              .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() });
          }
          
          // 돌아가기 버튼
          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId('help_module_main')
                .setLabel('전체 도움말로 돌아가기')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('↩️')
            );
          
          if (isUpdate) {
            if (interaction.isStringSelectMenu() || interaction.isButton()) {
              await interaction.update({
                embeds: [embed],
                components: [row]
              });
            } else {
              await interaction.reply({
                embeds: [embed],
                components: [row]
              });
            }
          } else {
            await interaction.reply({
              embeds: [embed],
              components: [row]
            });
          }
        } catch (error) {
          logger.error(this.name, `모듈 도움말 표시 오류: ${error.message}`);
          
          const errorEmbed = new EmbedBuilder()
            .setColor('#F04747')
            .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
            .setTitle('❌ 오류 발생')
            .setDescription('도움말을 표시하는 중 오류가 발생했습니다.')
            .setTimestamp()
            .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() });
          
          if (isUpdate && (interaction.isStringSelectMenu() || interaction.isButton())) {
            await interaction.update({ embeds: [errorEmbed], components: [] });
          } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
          }
        }
      }
    
      /**
       * 봇 정보 명령어 처리
       * @param {Interaction} interaction 명령어 인터렉션
       */
      async handleBotInfoCommand(interaction) {
        try {
          const client = this.client;
          
          // 작동 시간 계산
          const uptime = client.uptime;
          const days = Math.floor(uptime / 86400000);
          const hours = Math.floor((uptime % 86400000) / 3600000);
          const minutes = Math.floor((uptime % 3600000) / 60000);
          const seconds = Math.floor((uptime % 60000) / 1000);
          
          // 메모리 사용량 계산
          const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
          
          const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
            .setTitle('🤖 봇 정보')
            .setDescription('aimbot.ad는 모듈형 디스코드 봇으로, 다양한 기능을 제공합니다.')
            .addFields(
              { name: '👑 제작자', value: 'Blues', inline: true },
              { name: '🏷️ 버전', value: require('../package.json').version, inline: true },
              { name: '📅 가동 시간', value: `${days}일 ${hours}시간 ${minutes}분 ${seconds}초`, inline: true },
              { name: '🖥️ 서버 수', value: `${client.guilds.cache.size}개`, inline: true },
              { name: '👥 총 유저 수', value: `${client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)}명`, inline: true },
              { name: '📦 모듈 수', value: `${client.modules.size}개`, inline: true },
              { name: '📚 라이브러리', value: `discord.js v${require('discord.js').version}`, inline: true },
              { name: '🧠 메모리 사용량', value: `${memoryUsage.toFixed(2)} MB`, inline: true },
              { name: '🧩 Node.js', value: process.version, inline: true },
              { name: '🔌 활성화된 모듈', value: Array.from(client.modules.values())
                .filter(module => module.enabled)
                .map(module => `• ${module.name}: ${module.description || '설명 없음'}`)
                .join('\n') || '활성화된 모듈 없음', inline: false }
            )
            .setTimestamp()
            .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() });
          
          // 웹 대시보드 버튼
          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setLabel('웹 대시보드')
                .setStyle(ButtonStyle.Link)
                .setURL(`http://${config.get('web.host')}:${config.get('web.port')}/`)
                .setEmoji('🌐'),
              new ButtonBuilder()
                .setCustomId('help_module_main')
                .setLabel('도움말 보기')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📚')
            );
          
          await interaction.reply({
            embeds: [embed],
            components: [row]
          });
        } catch (error) {
          logger.error(this.name, `봇 정보 명령어 처리 오류: ${error.message}`);
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor('#F04747')
                .setAuthor({ name: 'aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
                .setTitle('❌ 오류 발생')
                .setDescription('봇 정보를 표시하는 중 오류가 발생했습니다.')
                .setTimestamp()
                .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
            ],
            ephemeral: true
          });
        }
      }
    
      /**
       * 모듈 시작
       */
      async start() {
        logger.success(this.name, '도움말 모듈이 활성화되었습니다.');
        return this;
      }
    }
    
    module.exports = (client) => new HelpModule(client);