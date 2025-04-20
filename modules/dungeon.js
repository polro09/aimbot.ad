// modules/dungeon.js - 던전 파티 모집 모듈
const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    ButtonStyle,
    TextInputStyle,
    PermissionFlagsBits
  } = require('discord.js');
  const fs = require('fs');
  const path = require('path');
  const logger = require('../logger');
  
  /**
   * 던전 파티 모집 모듈
   */
  module.exports = (client) => {
    // 던전 데이터 파일 경로
    const dataFolder = path.join(__dirname, '..', 'data');
    const dungeonDataFile = path.join(dataFolder, 'dungeons.json');
    const configDataFile = path.join(dataFolder, 'dungeon-config.json');
    
    // 모듈 객체
    const module = {
      name: 'dungeon',
      description: '던전 파티 모집 및 관리 모듈',
      enabled: true,
      commands: ['던전'],
      
      // 슬래시 커맨드 정의
      slashCommands: [
        {
          name: '던전',
          description: '던전 파티 모집 및 관리',
          options: [
            {
              name: '임베드_전송',
              description: '던전 선택 임베드를 전송합니다',
              type: 1
            },
            {
              name: '임베드_채널',
              description: '던전 선택 임베드가 표시될 채널을 설정합니다',
              type: 1,
              options: [
                {
                  name: '채널',
                  description: '채널을 선택하세요',
                  type: 7, // 채널 타입
                  required: true,
                  channel_types: [0, 5] // 텍스트 채널 및 공지 채널
                }
              ]
            },
            {
              name: '파티_알림',
              description: '파티 모집 알림이 표시될 채널을 설정합니다',
              type: 1,
              options: [
                {
                  name: '채널',
                  description: '채널을 선택하세요',
                  type: 7, // 채널 타입
                  required: true,
                  channel_types: [0, 5] // 텍스트 채널 및 공지 채널
                }
              ]
            },
            {
              name: '목록',
              description: '등록된 던전 목록을 확인합니다',
              type: 1
            },
            {
              name: '추가',
              description: '새로운 던전을 추가합니다',
              type: 1,
              options: [
                {
                  name: '던전명',
                  description: '던전의 이름을 입력하세요',
                  type: 3, // 문자열 타입
                  required: true
                },
                {
                  name: '썸네일',
                  description: '던전 썸네일 URL을 입력하세요',
                  type: 3, // 문자열 타입
                  required: false
                },
                {
                  name: '이미지',
                  description: '던전 이미지 URL을 입력하세요',
                  type: 3, // 문자열 타입
                  required: false
                }
              ]
            }
          ]
        }
      ],
  
      // 시작 함수
      async start() {
        // 데이터 폴더 확인 및 생성
        if (!fs.existsSync(dataFolder)) {
          fs.mkdirSync(dataFolder, { recursive: true });
        }
        
        // 던전 데이터 파일 확인 및 생성
        if (!fs.existsSync(dungeonDataFile)) {
          fs.writeFileSync(dungeonDataFile, JSON.stringify({
            dungeons: []
          }, null, 2), 'utf8');
        }
        
        // 설정 파일 확인 및 생성
        if (!fs.existsSync(configDataFile)) {
          fs.writeFileSync(configDataFile, JSON.stringify({
            embedChannels: {},
            partyChannels: {}
          }, null, 2), 'utf8');
        }
        
        logger.success('Dungeon', '던전 파티 모집 모듈이 시작되었습니다.');
        return true;
      },
// 슬래시 커맨드 처리
async handleCommands(interaction) {
    if (!interaction.isCommand() || interaction.commandName !== '던전') return false;
    
    const subCommand = interaction.options.getSubcommand();
    
    try {
      switch (subCommand) {
        case '임베드_전송':
          await this.sendDungeonEmbed(interaction);
          break;
        case '임베드_채널':
          await this.setEmbedChannel(interaction);
          break;
        case '파티_알림':
          await this.setPartyChannel(interaction);
          break;
        case '목록':
          await this.showDungeonList(interaction);
          break;
        case '추가':
          await this.addDungeon(interaction);
          break;
        default:
          await interaction.reply({
            content: '알 수 없는 서브 커맨드입니다.',
            ephemeral: true
          });
          return true;
      }
      
      return true;
    } catch (error) {
      logger.error('Dungeon', `커맨드 처리 중 오류 발생: ${error.message}`);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `명령어 처리 중 오류가 발생했습니다: ${error.message}`,
          ephemeral: true
        });
      } else if (interaction.deferred) {
        await interaction.editReply({
          content: `명령어 처리 중 오류가 발생했습니다: ${error.message}`
        });
      }
      return true;
    }
  },
  
  // 버튼 인터랙션 처리
  async handleButtons(interaction) {
    if (!interaction.isButton()) return false;
    
    const [action, ...params] = interaction.customId.split(':');
    
    if (!action.startsWith('dungeon_')) return false;
    
    try {
      switch (action) {
        case 'dungeon_select':
          await this.handleDungeonSelect(interaction);
          break;
        case 'dungeon_join':
          await this.handlePartyJoin(interaction);
          break;
        case 'dungeon_leave':
          await this.handlePartyLeave(interaction, params[0]);
          break;
        case 'dungeon_edit':
          await this.handlePartyEdit(interaction, params[0]);
          break;
        case 'dungeon_cancel':
          await this.handlePartyCancel(interaction, params[0]);
          break;
        default:
          return false;
      }
      
      return true;
    } catch (error) {
      logger.error('Dungeon', `버튼 처리 중 오류 발생: ${error.message}`);
      try {
        await interaction.reply({
          content: `버튼 처리 중 오류가 발생했습니다: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        logger.error('Dungeon', `응답 전송 중 오류 발생: ${replyError.message}`);
      }
      return true;
    }
  },
  
  // 모달 인터랙션 처리
  async handleModals(interaction) {
    if (!interaction.isModalSubmit()) return false;
    
    const [action, ...params] = interaction.customId.split(':');
    
    if (!action.startsWith('dungeon_')) return false;
    
    try {
      switch (action) {
        case 'dungeon_create_modal':
          await this.handleCreatePartyModal(interaction);
          break;
        case 'dungeon_edit_modal':
          await this.handleEditPartyModal(interaction, params[0]);
          break;
        default:
          return false;
      }
      
      return true;
    } catch (error) {
      logger.error('Dungeon', `모달 처리 중 오류 발생: ${error.message}`);
      try {
        await interaction.reply({
          content: `모달 처리 중 오류가 발생했습니다: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        logger.error('Dungeon', `응답 전송 중 오류 발생: ${replyError.message}`);
      }
      return true;
    }
  },
  
  // 선택 메뉴 인터랙션 처리
  async handleSelectMenus(interaction) {
    if (!interaction.isStringSelectMenu()) return false;
    
    const [action, ...params] = interaction.customId.split(':');
    
    if (!action.startsWith('dungeon_')) return false;
    
    try {
      switch (action) {
        case 'dungeon_select_menu':
          await this.handleDungeonSelectMenu(interaction);
          break;
        case 'dungeon_class_select':
          await this.handleClassSelection(interaction, params[0]);
          break;
        case 'dungeon_list_menu':
          await this.handleDungeonListMenu(interaction);
          break;
        default:
          return false;
      }
      
      return true;
    } catch (error) {
      logger.error('Dungeon', `선택 메뉴 처리 중 오류 발생: ${error.message}`);
      try {
        await interaction.reply({
          content: `선택 메뉴 처리 중 오류가 발생했습니다: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        logger.error('Dungeon', `응답 전송 중 오류 발생: ${replyError.message}`);
      }
      return true;
    }
  },
  
  // 설정 파일 로드
  loadConfig() {
    try {
      const configData = fs.readFileSync(configDataFile, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      logger.error('Dungeon', `설정 파일 로드 중 오류 발생: ${error.message}`);
      return {
        embedChannels: {},
        partyChannels: {}
      };
    }
  },
  
  // 설정 파일 저장
  saveConfig(config) {
    try {
      fs.writeFileSync(configDataFile, JSON.stringify(config, null, 2), 'utf8');
      return true;
    } catch (error) {
      logger.error('Dungeon', `설정 파일 저장 중 오류 발생: ${error.message}`);
      return false;
    }
  },
  
  // 던전 데이터 로드
  loadDungeons() {
    try {
      const dungeonData = fs.readFileSync(dungeonDataFile, 'utf8');
      return JSON.parse(dungeonData);
    } catch (error) {
      logger.error('Dungeon', `던전 데이터 로드 중 오류 발생: ${error.message}`);
      return { dungeons: [] };
    }
  },
  
  // 던전 데이터 저장
  saveDungeons(dungeonData) {
    try {
      fs.writeFileSync(dungeonDataFile, JSON.stringify(dungeonData, null, 2), 'utf8');
      return true;
    } catch (error) {
      logger.error('Dungeon', `던전 데이터 저장 중 오류 발생: ${error.message}`);
      return false;
    }
  },
// 임베드 채널 설정
async setEmbedChannel(interaction) {
    const channel = interaction.options.getChannel('채널');
    
    if (!channel.isTextBased()) {
      await interaction.reply({
        content: '텍스트 채널만 선택할 수 있습니다.',
        ephemeral: true
      });
      return;
    }
    
    // 권한 확인
    const permissions = channel.permissionsFor(interaction.guild.members.me);
    if (!permissions.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
      await interaction.reply({
        content: '선택한 채널에 메시지를 보내고 임베드를 전송할 권한이 없습니다.',
        ephemeral: true
      });
      return;
    }
    
    const config = this.loadConfig();
    config.embedChannels[interaction.guild.id] = channel.id;
    this.saveConfig(config);
    
    await interaction.reply({
      content: `던전 선택 임베드 채널이 <#${channel.id}>로 설정되었습니다.`,
      ephemeral: true
    });
  },
  
  // 파티 알림 채널 설정
  async setPartyChannel(interaction) {
    const channel = interaction.options.getChannel('채널');
    
    if (!channel.isTextBased()) {
      await interaction.reply({
        content: '텍스트 채널만 선택할 수 있습니다.',
        ephemeral: true
      });
      return;
    }
    
    // 권한 확인
    const permissions = channel.permissionsFor(interaction.guild.members.me);
    if (!permissions.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
      await interaction.reply({
        content: '선택한 채널에 메시지를 보내고 임베드를 전송할 권한이 없습니다.',
        ephemeral: true
      });
      return;
    }
    
    const config = this.loadConfig();
    config.partyChannels[interaction.guild.id] = channel.id;
    this.saveConfig(config);
    
    await interaction.reply({
      content: `파티 모집 알림 채널이 <#${channel.id}>로 설정되었습니다.`,
      ephemeral: true
    });
  },
  
  // 던전 추가
  async addDungeon(interaction) {
    // 관리자 권한 확인
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: '이 명령어를 사용하려면 서버 관리 권한이 필요합니다.',
        ephemeral: true
      });
      return;
    }
    
    const dungeonName = interaction.options.getString('던전명');
    const thumbnailUrl = interaction.options.getString('썸네일');
    const imageUrl = interaction.options.getString('이미지');
    
    const dungeonData = this.loadDungeons();
    
    // 중복 검사
    const exists = dungeonData.dungeons.some(
      dungeon => dungeon.name.toLowerCase() === dungeonName.toLowerCase() && 
                dungeon.guildId === interaction.guild.id
    );
    
    if (exists) {
      await interaction.reply({
        content: `'${dungeonName}' 던전이 이미 등록되어 있습니다.`,
        ephemeral: true
      });
      return;
    }
    
    // 새 던전 추가
    const newDungeon = {
      id: Date.now().toString(),
      guildId: interaction.guild.id,
      name: dungeonName,
      thumbnail: thumbnailUrl,
      image: imageUrl,
      createdAt: new Date().toISOString(),
      createdBy: interaction.user.id
    };
    
    dungeonData.dungeons.push(newDungeon);
    this.saveDungeons(dungeonData);
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎮 던전 추가 완료')
      .setDescription(`**${dungeonName}** 던전이 성공적으로 추가되었습니다.`)
      .setAuthor({ name: 'Aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
      .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
      .setTimestamp();
    
    if (thumbnailUrl) {
      embed.setThumbnail(thumbnailUrl);
    }
    
    if (imageUrl) {
      embed.setImage(imageUrl);
    }
    
    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  },
  
  // 던전 선택 임베드 전송
  async sendDungeonEmbed(interaction) {
    // 설정 확인
    const config = this.loadConfig();
    const embedChannelId = config.embedChannels[interaction.guild.id];
    
    if (!embedChannelId) {
      await interaction.reply({
        content: '던전 선택 임베드 채널이 설정되지 않았습니다. `/던전 임베드_채널` 명령어로 먼저 채널을 설정하세요.',
        ephemeral: true
      });
      return;
    }
    
    const embedChannel = interaction.guild.channels.cache.get(embedChannelId);
    if (!embedChannel) {
      await interaction.reply({
        content: '설정된 임베드 채널을 찾을 수 없습니다. 채널이 삭제되었거나 접근할 수 없습니다.',
        ephemeral: true
      });
      return;
    }
    
    // 던전 데이터 확인
    const dungeonData = this.loadDungeons();
    const guildDungeons = dungeonData.dungeons.filter(dungeon => dungeon.guildId === interaction.guild.id);
    
    // 던전 선택 임베드 생성
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎮 던전 파티 모집')
      .setDescription('아래 버튼을 눌러 던전 파티를 모집하세요!')
      .setAuthor({ name: 'Aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
      .addFields(
        { name: '✨ 파티 생성 방법', value: '아래 버튼을 클릭한 후, 원하는 던전을 선택하거나 자유롭게 파티를 생성할 수 있습니다.' },
        { name: '📝 파티 참여 방법', value: '생성된 파티의 참가 버튼을 클릭하여 원하는 직업으로 참여할 수 있습니다.' }
      )
      .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
      .setTimestamp();
    
    // 버튼 생성
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dungeon_select')
        .setLabel('파티 모집하기')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎮')
    );
    
    await embedChannel.send({
      embeds: [embed],
      components: [row]
    });
    
    await interaction.reply({
      content: `던전 선택 임베드가 <#${embedChannelId}>에 전송되었습니다.`,
      ephemeral: true
    });
  },
  
  // 던전 선택 모달 표시
  async handleDungeonSelect(interaction) {
    // 파티 채널 설정 확인
    const config = this.loadConfig();
    const partyChannelId = config.partyChannels[interaction.guild.id];
    
    if (!partyChannelId) {
      await interaction.reply({
        content: '파티 모집 알림 채널이 설정되지 않았습니다. `/던전 파티_알림` 명령어로 먼저 채널을 설정하세요.',
        ephemeral: true
      });
      return;
    }
    
    // 던전 데이터 확인
    const dungeonData = this.loadDungeons();
    const guildDungeons = dungeonData.dungeons.filter(dungeon => dungeon.guildId === interaction.guild.id);
    
    // 선택 메뉴 옵션 생성
    const options = [{ label: '자유 파티 생성', value: 'custom', description: '자유롭게 파티 정보를 입력합니다', emoji: '✏️' }];
    
    guildDungeons.forEach(dungeon => {
      options.push({
        label: dungeon.name,
        value: dungeon.id,
        description: `던전 ID: ${dungeon.id}`,
        emoji: '🎮'
      });
    });
    
    // 선택 메뉴 생성
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('dungeon_select_menu')
        .setPlaceholder('던전을 선택하세요')
        .addOptions(options)
    );
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎮 던전 선택')
      .setDescription('파티를 모집할 던전을 선택하거나, 자유롭게 파티를 생성할 수 있습니다.')
      .setAuthor({ name: 'Aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
      .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
      .setTimestamp();
    
    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true
    });
  },
// 던전 선택 메뉴 처리
async handleDungeonSelectMenu(interaction) {
    const selectedValue = interaction.values[0];
    
    if (selectedValue === 'custom') {
      // 자유 파티 생성 모달
      await this.showCreatePartyModal(interaction);
    } else {
      // 선택한 던전으로 파티 생성 모달
      const dungeonData = this.loadDungeons();
      const dungeon = dungeonData.dungeons.find(d => d.id === selectedValue);
      
      if (!dungeon) {
        await interaction.reply({
          content: '선택한 던전을 찾을 수 없습니다.',
          ephemeral: true
        });
        return;
      }
      
      await this.showCreatePartyModal(interaction, dungeon);
    }
  },
  
  // 파티 생성 모달 표시
  async showCreatePartyModal(interaction, selectedDungeon = null) {
    const modal = new ModalBuilder()
      .setCustomId(`dungeon_create_modal${selectedDungeon ? `:${selectedDungeon.id}` : ''}`)
      .setTitle(selectedDungeon ? `${selectedDungeon.name} 파티 모집` : '파티 모집');
    
    // 파티명 입력 필드
    const partyNameInput = new TextInputBuilder()
      .setCustomId('partyName')
      .setLabel('파티명')
      .setPlaceholder('파티 이름을 입력하세요')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);
    
    // 상세 설명 입력 필드
    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('상세 설명')
      .setPlaceholder('파티에 대한 상세 설명을 입력하세요')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1000);
    
    // 날짜 및 시간 입력 필드
    const dateTimeInput = new TextInputBuilder()
      .setCustomId('dateTime')
      .setLabel('날짜 및 시간')
      .setPlaceholder('예: 2025-04-15 오후 8시 30분')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    
    // 던전 입력 필드 (자유 파티인 경우만)
    const dungeonInput = new TextInputBuilder()
      .setCustomId('dungeonName')
      .setLabel('던전 이름')
      .setPlaceholder('던전 이름을 입력하세요')
      .setStyle(TextInputStyle.Short)
      .setRequired(!selectedDungeon); // 선택된 던전이 없을 때만 필수
    
    // 요구 사항 입력 필드
    const requirementInput = new TextInputBuilder()
      .setCustomId('requirement')
      .setLabel('요구 사항')
      .setPlaceholder('파티 참가 요구 사항을 입력하세요')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100);
    
    // 모달에 입력 필드 추가
    if (selectedDungeon) {
      // 미리 정의된 던전인 경우
      modal.addComponents(
        new ActionRowBuilder().addComponents(partyNameInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(dateTimeInput),
        new ActionRowBuilder().addComponents(requirementInput)
      );
    } else {
      // 자유 파티인 경우
      modal.addComponents(
        new ActionRowBuilder().addComponents(partyNameInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(dateTimeInput),
        new ActionRowBuilder().addComponents(dungeonInput),
        new ActionRowBuilder().addComponents(requirementInput)
      );
    }
    
    await interaction.showModal(modal);
  },
  
  // 파티 생성 모달 제출 처리
  async handleCreatePartyModal(interaction) {
    // 커스텀 ID에서 던전 ID 추출
    const dungeonId = interaction.customId.split(':')[1];
    
    // 파티 정보 추출
    const partyName = interaction.fields.getTextInputValue('partyName');
    const description = interaction.fields.getTextInputValue('description') || '상세 설명이 없습니다.';
    const dateTime = interaction.fields.getTextInputValue('dateTime');
    
    let dungeonName, requirement;
    
    // 미리 정의된 던전이면 던전 데이터 로드
    let selectedDungeon = null;
    if (dungeonId) {
      const dungeonData = this.loadDungeons();
      selectedDungeon = dungeonData.dungeons.find(d => d.id === dungeonId);
      
      if (!selectedDungeon) {
        await interaction.reply({
          content: '선택한 던전을 찾을 수 없습니다.',
          ephemeral: true
        });
        return;
      }
      
      dungeonName = selectedDungeon.name;
      requirement = interaction.fields.getTextInputValue('requirement') || '특별한 요구사항 없음';
    } else {
      // 자유 파티인 경우
      dungeonName = interaction.fields.getTextInputValue('dungeonName');
      requirement = interaction.fields.getTextInputValue('requirement') || '특별한 요구사항 없음';
    }
    
    // 날짜 및 시간 파싱 (예: "2025-04-15 오후 8시 30분")
    let date = "", period = "", time = "";
    
    // 간단한 파싱 시도
    const dateTimeParts = dateTime.split(' ');
    if (dateTimeParts.length >= 1) {
      date = dateTimeParts[0]; // 날짜 부분
    }
    if (dateTimeParts.length >= 2) {
      period = dateTimeParts[1]; // 오전/오후 부분
    }
    if (dateTimeParts.length >= 3) {
      time = dateTimeParts.slice(2).join(' '); // 시간 부분 (나머지 모두)
    }
    
    // 파티 데이터 생성
    const partyId = Date.now().toString();
    const partyData = {
      id: partyId,
      name: partyName,
      description: description,
      dateTime: dateTime, // 전체 날짜 및 시간 문자열 저장
      date: date,
      period: period,
      time: time,
      dungeon: dungeonName,
      requirement: requirement,
      leader: {
        id: interaction.user.id,
        tag: interaction.user.tag,
        displayName: interaction.member.displayName
      },
      participants: [],
      createdAt: new Date().toISOString(),
      thumbnail: selectedDungeon ? selectedDungeon.thumbnail : null,
      image: selectedDungeon ? selectedDungeon.image : null
    };
    
    // 파티 임베드 생성 및 전송
    await this.sendPartyEmbed(interaction, partyData);
},

// 파티 임베드 전송
async sendPartyEmbed(interaction, partyData) {
  // 설정 확인
  const config = this.loadConfig();
  const partyChannelId = config.partyChannels[interaction.guild.id];
  
  if (!partyChannelId) {
    await interaction.reply({
      content: '파티 모집 알림 채널이 설정되지 않았습니다. `/던전 파티_알림` 명령어로 먼저 채널을 설정하세요.',
      ephemeral: true
    });
    return;
  }
  
  const partyChannel = interaction.guild.channels.cache.get(partyChannelId);
  if (!partyChannel) {
    await interaction.reply({
      content: '설정된 파티 알림 채널을 찾을 수 없습니다. 채널이 삭제되었거나 접근할 수 없습니다.',
      ephemeral: true
    });
    return;
  }
  
  // 임베드 생성
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🚩 ${partyData.name}`)
    .setAuthor({ 
      name: partyData.leader.displayName, 
      iconURL: interaction.user.displayAvatarURL() 
    })
    .addFields(
      { name: '📝 상세 설명', value: partyData.description },
      { name: '📅 날짜 및 시간', value: partyData.dateTime, inline: true },
      { name: '⚔️ 던전', value: partyData.dungeon, inline: true },
      { name: '⚙️ 요구 사항', value: partyData.requirement, inline: true },
      { name: '\u200B', value: '\u200B' },
      { name: '👥 참가자 목록', value: '아직 참가자가 없습니다.' }
    )
    .setTimestamp()
    .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() });
  
  // 이미지 설정
  if (partyData.thumbnail) {
    embed.setThumbnail(partyData.thumbnail);
  }
  
  if (partyData.image) {
    embed.setImage(partyData.image);
  }
  
  // 버튼 생성
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dungeon_edit:${partyData.id}`)
      .setLabel('파티 편집')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✏️'),
    new ButtonBuilder()
      .setCustomId(`dungeon_join:${partyData.id}`)
      .setLabel('파티 참가')
      .setStyle(ButtonStyle.Success)
      .setEmoji('👍'),
    new ButtonBuilder()
      .setCustomId(`dungeon_leave:${partyData.id}`)
      .setLabel('파티 탈퇴')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('👎'),
    new ButtonBuilder()
      .setCustomId(`dungeon_cancel:${partyData.id}`)
      .setLabel('파티 취소')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⛔')
  );
  
  // 파티 알림 전송
  const message = await partyChannel.send({
    embeds: [embed],
    components: [row]
  });
  
  // 파티 데이터 저장
  partyData.messageId = message.id;
  partyData.channelId = partyChannel.id;
  
  // 파티 데이터 파일 경로
  const partyDataFile = path.join(dataFolder, `party-${partyData.id}.json`);
  
  // 파티 데이터 저장
  fs.writeFileSync(partyDataFile, JSON.stringify(partyData, null, 2), 'utf8');
  
  await interaction.reply({
    content: `파티 모집 글이 <#${partyChannelId}>에 전송되었습니다.`,
    ephemeral: true
  });
},

// 직업 선택 메뉴 표시
async handlePartyJoin(interaction) {
  const partyId = interaction.customId.split(':')[1];
  
  // 파티 데이터 파일 경로
  const partyDataFile = path.join(dataFolder, `party-${partyId}.json`);
  
  // 파티 데이터 로드
  if (!fs.existsSync(partyDataFile)) {
    await interaction.reply({
      content: '파티 정보를 찾을 수 없습니다.',
      ephemeral: true
    });
    return;
  }
  
  const partyData = JSON.parse(fs.readFileSync(partyDataFile, 'utf8'));
  
  // 이미 참가 중인지 확인
  const isAlreadyJoined = partyData.participants.some(p => p.id === interaction.user.id);
  
  if (isAlreadyJoined) {
    await interaction.reply({
      content: '이미 파티에 참가하고 있습니다.',
      ephemeral: true
    });
    return;
  }
  
  // 직업 선택 메뉴 생성
  const options = [
    { label: '엘레멘탈 나이트', value: 'ElementalKnight', emoji: '⚔️' },
    { label: '세인트 바드', value: 'SaintBard', emoji: '🎵' },
    { label: '알케믹 스팅어', value: 'AlchemicStinger', emoji: '🧪' },
    { label: '다크메이지', value: 'DarkMage', emoji: '🔮' },
    { label: '세이크리드 가드', value: 'SacredGuard', emoji: '🛡️' },
    { label: '블래스트 랜서', value: 'BlastLancer', emoji: '🔱' }
  ];
  
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`dungeon_class_select:${partyId}`)
      .setPlaceholder('직업을 선택하세요')
      .addOptions(options)
  );
  
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('👥 파티 참가')
    .setDescription(`**${partyData.name}** 파티에 참가할 직업을 선택하세요.`)
    .setAuthor({ name: 'Aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
    .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
    .setTimestamp();
  
  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true
  });
},

// 직업 선택 처리
async handleClassSelection(interaction, partyId) {
  const selectedClass = interaction.values[0];
  
  // 클래스 한글 이름 매핑
  const classNames = {
    'ElementalKnight': '엘레멘탈 나이트',
    'SaintBard': '세인트 바드',
    'AlchemicStinger': '알케믹 스팅어',
    'DarkMage': '다크메이지',
    'SacredGuard': '세이크리드 가드',
    'BlastLancer': '블래스트 랜서'
  };
  
  // 클래스 이모지 매핑
  const classEmojis = {
    'ElementalKnight': '⚔️',
    'SaintBard': '🎵',
    'AlchemicStinger': '🧪',
    'DarkMage': '🔮',
    'SacredGuard': '🛡️',
    'BlastLancer': '🔱'
  };
  
  // 파티 데이터 파일 경로
  const partyDataFile = path.join(dataFolder, `party-${partyId}.json`);
  
  // 파티 데이터 로드
  if (!fs.existsSync(partyDataFile)) {
    await interaction.reply({
      content: '파티 정보를 찾을 수 없습니다.',
      ephemeral: true
    });
    return;
  }
  
  const partyData = JSON.parse(fs.readFileSync(partyDataFile, 'utf8'));
  
  // 이미 참가 중인지 확인
  const isAlreadyJoined = partyData.participants.some(p => p.id === interaction.user.id);
  
  if (isAlreadyJoined) {
    await interaction.reply({
      content: '이미 파티에 참가하고 있습니다.',
      ephemeral: true
    });
    return;
  }
  
  // 참가자 추가
  partyData.participants.push({
    id: interaction.user.id,
    tag: interaction.user.tag,
    displayName: interaction.member.displayName,
    class: selectedClass,
    className: classNames[selectedClass],
    classEmoji: classEmojis[selectedClass],
    joinedAt: new Date().toISOString()
  });
  
  // 파티 데이터 저장
  fs.writeFileSync(partyDataFile, JSON.stringify(partyData, null, 2), 'utf8');
  
  // 파티 임베드 업데이트
  await this.updatePartyEmbed(interaction, partyData);
  
  await interaction.reply({
    content: `**${partyData.name}** 파티에 ${classEmojis[selectedClass]} ${classNames[selectedClass]}(으)로 참가했습니다.`,
    ephemeral: true
  });
},
// 파티 탈퇴 처리
async handlePartyLeave(interaction, partyId) {
    // 파티 데이터 파일 경로
    const partyDataFile = path.join(dataFolder, `party-${partyId}.json`);
    
    // 파티 데이터 로드
    if (!fs.existsSync(partyDataFile)) {
      await interaction.reply({
        content: '파티 정보를 찾을 수 없습니다.',
        ephemeral: true
      });
      return;
    }
    
    const partyData = JSON.parse(fs.readFileSync(partyDataFile, 'utf8'));
    
    // 참가자 인덱스 찾기
    const participantIndex = partyData.participants.findIndex(p => p.id === interaction.user.id);
    
    if (participantIndex === -1) {
      await interaction.reply({
        content: '현재 이 파티에 참가하고 있지 않습니다.',
        ephemeral: true
      });
      return;
    }
    
    // 파티장은 탈퇴할 수 없음
    if (partyData.leader.id === interaction.user.id) {
      await interaction.reply({
        content: '파티장은 파티를 탈퇴할 수 없습니다. 파티를 취소하려면 "파티 취소" 버튼을 사용하세요.',
        ephemeral: true
      });
      return;
    }
    
    // 참가자 제거
    const removedParticipant = partyData.participants.splice(participantIndex, 1)[0];
    
    // 파티 데이터 저장
    fs.writeFileSync(partyDataFile, JSON.stringify(partyData, null, 2), 'utf8');
    
    // 파티 임베드 업데이트
    await this.updatePartyEmbed(interaction, partyData);
    
    await interaction.reply({
      content: `**${partyData.name}** 파티에서 탈퇴했습니다.`,
      ephemeral: true
    });
  },
  
  // 파티 편집 모달 표시
  async handlePartyEdit(interaction, partyId) {
    // 파티 데이터 파일 경로
    const partyDataFile = path.join(dataFolder, `party-${partyId}.json`);
    
    // 파티 데이터 로드
    if (!fs.existsSync(partyDataFile)) {
      await interaction.reply({
        content: '파티 정보를 찾을 수 없습니다.',
        ephemeral: true
      });
      return;
    }
    
    const partyData = JSON.parse(fs.readFileSync(partyDataFile, 'utf8'));
    
    // 편집 권한 확인 (파티장만 가능)
    if (partyData.leader.id !== interaction.user.id && !interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: '파티장만 파티 정보를 편집할 수 있습니다.',
        ephemeral: true
      });
      return;
    }
    
    // 파티 편집 모달 생성
    const modal = new ModalBuilder()
      .setCustomId(`dungeon_edit_modal:${partyId}`)
      .setTitle('파티 정보 편집');
    
    // 파티명 입력 필드
    const partyNameInput = new TextInputBuilder()
      .setCustomId('partyName')
      .setLabel('파티명')
      .setValue(partyData.name)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);
    
    // 상세 설명 입력 필드
    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('상세 설명')
      .setValue(partyData.description)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1000);
    
    // 날짜 및 시간 입력 필드
    const dateTimeInput = new TextInputBuilder()
      .setCustomId('dateTime')
      .setLabel('날짜 및 시간')
      .setValue(partyData.dateTime || `${partyData.date} ${partyData.period} ${partyData.time}`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    
    // 요구 사항 입력 필드
    const requirementInput = new TextInputBuilder()
      .setCustomId('requirement')
      .setLabel('요구 사항')
      .setValue(partyData.requirement)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100);
    
    // 모달에 입력 필드 추가
    modal.addComponents(
      new ActionRowBuilder().addComponents(partyNameInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(dateTimeInput),
      new ActionRowBuilder().addComponents(requirementInput)
    );
    
    await interaction.showModal(modal);
  },
  
  // 파티 편집 모달 제출 처리
  async handleEditPartyModal(interaction, partyId) {
    // 파티 데이터 파일 경로
    const partyDataFile = path.join(dataFolder, `party-${partyId}.json`);
    
    // 파티 데이터 로드
    if (!fs.existsSync(partyDataFile)) {
      await interaction.reply({
        content: '파티 정보를 찾을 수 없습니다.',
        ephemeral: true
      });
      return;
    }
    
    const partyData = JSON.parse(fs.readFileSync(partyDataFile, 'utf8'));
    
    // 편집 권한 확인 (파티장만 가능)
    if (partyData.leader.id !== interaction.user.id && !interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: '파티장만 파티 정보를 편집할 수 있습니다.',
        ephemeral: true
      });
      return;
    }
    
    // 파티 정보 업데이트
    partyData.name = interaction.fields.getTextInputValue('partyName');
    partyData.description = interaction.fields.getTextInputValue('description');
    partyData.dateTime = interaction.fields.getTextInputValue('dateTime');
    partyData.requirement = interaction.fields.getTextInputValue('requirement');
    partyData.updatedAt = new Date().toISOString();
    
    // 날짜 및 시간 파싱 (이전 호환성 유지를 위해)
    const dateTimeParts = partyData.dateTime.split(' ');
    if (dateTimeParts.length >= 1) {
      partyData.date = dateTimeParts[0];
    }
    if (dateTimeParts.length >= 2) {
      partyData.period = dateTimeParts[1];
    }
    if (dateTimeParts.length >= 3) {
      partyData.time = dateTimeParts.slice(2).join(' ');
    }
    
    // 파티 데이터 저장
    fs.writeFileSync(partyDataFile, JSON.stringify(partyData, null, 2), 'utf8');
    
    // 파티 임베드 업데이트
    await this.updatePartyEmbed(interaction, partyData);
    
    await interaction.reply({
      content: '파티 정보가 업데이트되었습니다.',
      ephemeral: true
    });
  },
  
  // 파티 취소 처리
  async handlePartyCancel(interaction, partyId) {
    // 파티 데이터 파일 경로
    const partyDataFile = path.join(dataFolder, `party-${partyId}.json`);
    
    // 파티 데이터 로드
    if (!fs.existsSync(partyDataFile)) {
      await interaction.reply({
        content: '파티 정보를 찾을 수 없습니다.',
        ephemeral: true
      });
      return;
    }
    
    const partyData = JSON.parse(fs.readFileSync(partyDataFile, 'utf8'));
    
    // 취소 권한 확인 (파티장 또는 관리자만 가능)
    if (partyData.leader.id !== interaction.user.id && !interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: '파티장 또는 관리자만 파티를 취소할 수 있습니다.',
        ephemeral: true
      });
      return;
    }
    
    // 파티 취소 상태로 변경
    partyData.canceled = true;
    partyData.canceledAt = new Date().toISOString();
    partyData.canceledBy = {
      id: interaction.user.id,
      tag: interaction.user.tag,
      displayName: interaction.member.displayName
    };
    
    // 파티 데이터 저장
    fs.writeFileSync(partyDataFile, JSON.stringify(partyData, null, 2), 'utf8');
    
    // 파티 채널과 메시지 ID 가져오기
    const { channelId, messageId } = partyData;
    
    // 채널 가져오기
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel) {
      await interaction.reply({
        content: '파티 메시지가 있는 채널을 찾을 수 없습니다.',
        ephemeral: true
      });
      return;
    }
    
    try {
      // 메시지 가져오기
      const message = await channel.messages.fetch(messageId);
      
      if (!message) {
        await interaction.reply({
          content: '파티 메시지를 찾을 수 없습니다.',
          ephemeral: true
        });
        return;
      }
      
      // 기존 임베드 가져오기
      const embed = EmbedBuilder.from(message.embeds[0])
        .setColor(0xFF0000)
        .setTitle(`⛔ 파티 모집 종료`);
      
      // 버튼 제거하고 임베드만 업데이트
      await message.edit({
        embeds: [embed],
        components: []
      });
      
      await interaction.reply({
        content: '파티 모집이 취소되었습니다.',
        ephemeral: true
      });
    } catch (error) {
      logger.error('Dungeon', `파티 취소 중 오류 발생: ${error.message}`);
      await interaction.reply({
        content: `파티 취소 중 오류가 발생했습니다: ${error.message}`,
        ephemeral: true
      });
    }
  },
// 파티 임베드 업데이트
async updatePartyEmbed(interaction, partyData) {
    // 파티가 취소되었으면 업데이트 안 함
    if (partyData.canceled) {
      return;
    }
    
    // 파티 채널과 메시지 ID 가져오기
    const { channelId, messageId } = partyData;
    
    // 채널 가져오기
    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel) {
      await interaction.followUp({
        content: '파티 메시지가 있는 채널을 찾을 수 없습니다.',
        ephemeral: true
      });
      return;
    }
    
    try {
      // 메시지 가져오기
      const message = await channel.messages.fetch(messageId);
      
      if (!message) {
        await interaction.followUp({
          content: '파티 메시지를 찾을 수 없습니다.',
          ephemeral: true
        });
        return;
      }
      
      // 참가자 목록 포맷팅
      let participantsText = '아직 참가자가 없습니다.';
      if (partyData.participants.length > 0) {
        participantsText = partyData.participants.map(p => 
          `${p.classEmoji} **${p.className}** - ${p.displayName}`
        ).join('\n');
      }
      
      // 임베드 생성
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🚩 ${partyData.name}`)
        .setAuthor({ 
          name: partyData.leader.displayName, 
          iconURL: (await interaction.client.users.fetch(partyData.leader.id)).displayAvatarURL() 
        })
        .addFields(
          { name: '📝 상세 설명', value: partyData.description },
          { name: '📅 날짜 및 시간', value: partyData.dateTime || `${partyData.date} ${partyData.period} ${partyData.time}`, inline: true },
          { name: '⚔️ 던전', value: partyData.dungeon, inline: true },
          { name: '⚙️ 요구 사항', value: partyData.requirement, inline: true },
          { name: '👥 참가자 목록', value: participantsText }
        )
        .setTimestamp()
        .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() });
      
      // 이미지 설정
      if (partyData.thumbnail) {
        embed.setThumbnail(partyData.thumbnail);
      }
      
      if (partyData.image) {
        embed.setImage(partyData.image);
      }
      
      // 메시지 업데이트
      await message.edit({
        embeds: [embed]
      });
    } catch (error) {
      logger.error('Dungeon', `파티 임베드 업데이트 중 오류 발생: ${error.message}`);
      await interaction.followUp({
        content: `파티 임베드 업데이트 중 오류가 발생했습니다: ${error.message}`,
        ephemeral: true
      });
    }
  },
  
  // 던전 목록 보기
  async showDungeonList(interaction) {
    // 던전 데이터 로드
    const dungeonData = this.loadDungeons();
    const guildDungeons = dungeonData.dungeons.filter(dungeon => dungeon.guildId === interaction.guild.id);
    
    if (guildDungeons.length === 0) {
      await interaction.reply({
        content: '등록된 던전이 없습니다. `/던전 추가` 명령어로 던전을 추가하세요.',
        ephemeral: true
      });
      return;
    }
    
    // 선택 메뉴 옵션
    const options = guildDungeons.map(dungeon => ({
      label: dungeon.name,
      value: dungeon.id,
      description: `던전 ID: ${dungeon.id}`,
      emoji: '🎮'
    }));
    
    // 선택 메뉴 생성
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('dungeon_list_menu')
        .setPlaceholder('던전을 선택하세요')
        .addOptions(options)
    );
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎮 던전 목록')
      .setDescription('등록된 던전 목록입니다. 던전을 선택하여 상세 정보를 확인하거나 수정/삭제할 수 있습니다.')
      .setAuthor({ name: 'Aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
      .addFields(
        { name: '🎮 던전 수', value: `${guildDungeons.length}개의 던전이 등록되어 있습니다.` }
      )
      .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
      .setTimestamp();
    
    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true
    });
  },
  
  // 던전 목록 선택 메뉴 처리
  async handleDungeonListMenu(interaction) {
    const selectedDungeonId = interaction.values[0];
    
    // 던전 데이터 로드
    const dungeonData = this.loadDungeons();
    const selectedDungeon = dungeonData.dungeons.find(
      dungeon => dungeon.id === selectedDungeonId && dungeon.guildId === interaction.guild.id
    );
    
    if (!selectedDungeon) {
      await interaction.reply({
        content: '선택한 던전을 찾을 수 없습니다.',
        ephemeral: true
      });
      return;
    }
    
    // 던전 정보 표시
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🎮 ${selectedDungeon.name}`)
      .setDescription('던전 상세 정보입니다.')
      .setAuthor({ name: 'Aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
      .addFields(
        { name: '🆔 던전 ID', value: selectedDungeon.id },
        { name: '📅 등록일', value: new Date(selectedDungeon.createdAt).toLocaleString() },
        { name: '👤 등록자', value: `<@${selectedDungeon.createdBy}>` }
      )
      .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
      .setTimestamp();
    
    if (selectedDungeon.thumbnail) {
      embed.setThumbnail(selectedDungeon.thumbnail);
      embed.addFields({ name: '🖼️ 썸네일 URL', value: selectedDungeon.thumbnail });
    }
    
    if (selectedDungeon.image) {
      embed.setImage(selectedDungeon.image);
      embed.addFields({ name: '🖼️ 이미지 URL', value: selectedDungeon.image });
    }
    
    // 버튼 생성
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dungeon_delete:${selectedDungeon.id}`)
        .setLabel('던전 삭제')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️')
    );
    
    await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
      });
    }
  };
  
  return module;
};