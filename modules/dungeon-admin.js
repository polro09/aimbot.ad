// modules/dungeon-admin.js - 던전 관리 모듈
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
   * 던전 관리 모듈
   */
  module.exports = (client) => {
    // 데이터 파일 경로
    const dataFolder = path.join(__dirname, '..', 'data');
    const dungeonDataFile = path.join(dataFolder, 'dungeons.json');
    const configDataFile = path.join(dataFolder, 'dungeon-config.json');
    
    // 모듈 객체
    const module = {
      name: 'dungeon-admin',
      description: '던전 관리 모듈',
      enabled: true,
      commands: ['던전관리'],
      
      // 슬래시 커맨드 정의
      slashCommands: [
        {
          name: '던전관리',
          description: '던전 데이터 관리 명령어',
          options: [
            {
              name: '초기화',
              description: '던전 모듈의 설정을 초기화합니다.',
              type: 1
            },
            {
              name: '삭제',
              description: '등록된 던전을 삭제합니다.',
              type: 1,
              options: [
                {
                  name: '던전명',
                  description: '삭제할 던전의 이름을 입력하세요.',
                  type: 3, // 문자열 타입
                  required: true
                }
              ]
            },
            {
              name: '통계',
              description: '던전 파티 모집 통계를 확인합니다.',
              type: 1
            }
          ],
          default_member_permissions: (1 << 5).toString() // MANAGE_GUILD 권한
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
        
        logger.success('DungeonAdmin', '던전 관리 모듈이 시작되었습니다.');
        return true;
      },
      
      // 슬래시 커맨드 처리
      async handleCommands(interaction) {
        if (!interaction.isCommand() || interaction.commandName !== '던전관리') return false;
        
        // 권한 확인
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: '이 명령어를 사용하려면 서버 관리 권한이 필요합니다.',
            ephemeral: true
          });
          return true;
        }
        
        const subCommand = interaction.options.getSubcommand();
        
        try {
          switch (subCommand) {
            case '초기화':
              await this.resetDungeonConfig(interaction);
              break;
            case '삭제':
              await this.deleteDungeon(interaction);
              break;
            case '통계':
              await this.showDungeonStats(interaction);
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
          logger.error('DungeonAdmin', `커맨드 처리 중 오류 발생: ${error.message}`);
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
        
        if (!action.startsWith('dungeon_admin_')) return false;
        
        try {
          switch (action) {
            case 'dungeon_admin_delete':
              await this.confirmDeleteDungeon(interaction, params[0]);
              break;
            default:
              return false;
          }
          
          return true;
        } catch (error) {
          logger.error('DungeonAdmin', `버튼 처리 중 오류 발생: ${error.message}`);
          try {
            await interaction.reply({
              content: `버튼 처리 중 오류가 발생했습니다: ${error.message}`,
              ephemeral: true
            });
          } catch (replyError) {
            logger.error('DungeonAdmin', `응답 전송 중 오류 발생: ${replyError.message}`);
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
          logger.error('DungeonAdmin', `설정 파일 로드 중 오류 발생: ${error.message}`);
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
          logger.error('DungeonAdmin', `설정 파일 저장 중 오류 발생: ${error.message}`);
          return false;
        }
      },
      
      // 던전 데이터 로드
      loadDungeons() {
        try {
          const dungeonData = fs.readFileSync(dungeonDataFile, 'utf8');
          return JSON.parse(dungeonData);
        } catch (error) {
          logger.error('DungeonAdmin', `던전 데이터 로드 중 오류 발생: ${error.message}`);
          return { dungeons: [] };
        }
      },
      
      // 던전 데이터 저장
      saveDungeons(dungeonData) {
        try {
          fs.writeFileSync(dungeonDataFile, JSON.stringify(dungeonData, null, 2), 'utf8');
          return true;
        } catch (error) {
          logger.error('DungeonAdmin', `던전 데이터 저장 중 오류 발생: ${error.message}`);
          return false;
        }
      },
      
      // 던전 모듈 설정 초기화
      async resetDungeonConfig(interaction) {
        const config = this.loadConfig();
        
        // 현재 서버의 설정만 초기화
        const guildId = interaction.guild.id;
        
        if (config.embedChannels[guildId]) {
          delete config.embedChannels[guildId];
        }
        
        if (config.partyChannels[guildId]) {
          delete config.partyChannels[guildId];
        }
        
        this.saveConfig(config);
        
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('🔄 설정 초기화 완료')
          .setDescription('던전 모듈의 설정이 초기화되었습니다.')
          .setAuthor({ name: 'Aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
          .addFields(
            { name: '초기화된 설정', value: '던전 선택 임베드 채널, 파티 모집 알림 채널' }
          )
          .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
          .setTimestamp();
        
        await interaction.reply({
          embeds: [embed],
          ephemeral: true
        });
      },
      
      // 던전 삭제
      async deleteDungeon(interaction) {
        const dungeonName = interaction.options.getString('던전명');
        
        // 던전 데이터 로드
        const dungeonData = this.loadDungeons();
        
        // 삭제할 던전 찾기
        const dungeonIndex = dungeonData.dungeons.findIndex(
          dungeon => dungeon.name.toLowerCase() === dungeonName.toLowerCase() && 
                    dungeon.guildId === interaction.guild.id
        );
        
        if (dungeonIndex === -1) {
          await interaction.reply({
            content: `'${dungeonName}' 던전을 찾을 수 없습니다.`,
            ephemeral: true
          });
          return;
        }
        
        // 던전 삭제
        const deletedDungeon = dungeonData.dungeons.splice(dungeonIndex, 1)[0];
        
        // 던전 데이터 저장
        this.saveDungeons(dungeonData);
        
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('🗑️ 던전 삭제 완료')
          .setDescription(`**${deletedDungeon.name}** 던전이 성공적으로 삭제되었습니다.`)
          .setAuthor({ name: 'Aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
          .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
          .setTimestamp();
        
        await interaction.reply({
          embeds: [embed],
          ephemeral: true
        });
      },
      
      // 던전 통계 보기
      async showDungeonStats(interaction) {
        await interaction.deferReply({ ephemeral: true });
        
        // 데이터 폴더에서 파티 데이터 파일들 찾기
        const partyFiles = fs.readdirSync(dataFolder).filter(file => file.startsWith('party-') && file.endsWith('.json'));
        
        if (partyFiles.length === 0) {
          await interaction.editReply({
            content: '아직 파티 모집 데이터가 없습니다.',
            ephemeral: true
          });
          return;
        }
        
        // 통계 데이터 수집
        const stats = {
          totalParties: 0,
          activeParties: 0,
          canceledParties: 0,
          totalParticipants: 0,
          classCounts: {
            'ElementalKnight': 0,
            'SaintBard': 0,
            'AlchemicStinger': 0,
            'DarkMage': 0,
            'SacredGuard': 0,
            'BlastLancer': 0
          },
          dungeonCounts: {},
          mostPopularDungeon: null,
          mostPopularClass: null
        };
        
        // 현재 서버의 파티만 수집
        for (const file of partyFiles) {
          try {
            const partyData = JSON.parse(fs.readFileSync(path.join(dataFolder, file), 'utf8'));
            
            // 다른 서버의 파티는 건너뜀
            if (partyData.leader && partyData.leader.guildId && partyData.leader.guildId !== interaction.guild.id) {
              continue;
            }
            
            stats.totalParties++;
            
            if (partyData.canceled) {
              stats.canceledParties++;
            } else {
              stats.activeParties++;
            }
            
            // 던전 카운트
            if (partyData.dungeon) {
              if (!stats.dungeonCounts[partyData.dungeon]) {
                stats.dungeonCounts[partyData.dungeon] = 0;
              }
              stats.dungeonCounts[partyData.dungeon]++;
            }
            
            // 참가자 정보
            if (partyData.participants && Array.isArray(partyData.participants)) {
              stats.totalParticipants += partyData.participants.length;
              
              // 직업 카운트
              partyData.participants.forEach(participant => {
                if (participant.class && stats.classCounts[participant.class] !== undefined) {
                  stats.classCounts[participant.class]++;
                }
              });
            }
          } catch (error) {
            logger.error('DungeonAdmin', `파티 데이터 파일 '${file}' 처리 중 오류 발생: ${error.message}`);
          }
        }
        
        // 가장 인기 있는 던전 찾기
        if (Object.keys(stats.dungeonCounts).length > 0) {
          let maxCount = 0;
          
          for (const [dungeon, count] of Object.entries(stats.dungeonCounts)) {
            if (count > maxCount) {
              maxCount = count;
              stats.mostPopularDungeon = dungeon;
            }
          }
        }
        
        // 가장 인기 있는 직업 찾기
        let maxClassCount = 0;
        for (const [className, count] of Object.entries(stats.classCounts)) {
          if (count > maxClassCount) {
            maxClassCount = count;
            stats.mostPopularClass = className;
          }
        }
        
        // 직업 이름 매핑
        const classNames = {
          'ElementalKnight': '엘레멘탈 나이트',
          'SaintBard': '세인트 바드',
          'AlchemicStinger': '알케믹 스팅어',
          'DarkMage': '다크메이지',
          'SacredGuard': '세이크리드 가드',
          'BlastLancer': '블래스트 랜서'
        };
        
        // 직업 이모지 매핑
        const classEmojis = {
          'ElementalKnight': '⚔️',
          'SaintBard': '🎵',
          'AlchemicStinger': '🧪',
          'DarkMage': '🔮',
          'SacredGuard': '🛡️',
          'BlastLancer': '🔱'
        };
        
        // 직업 통계 문자열 생성
        const classStatsText = Object.entries(stats.classCounts)
          .map(([className, count]) => `${classEmojis[className]} **${classNames[className]}**: ${count}명`)
          .join('\n');
        
        // 던전 통계 문자열 생성
        const dungeonStatsText = Object.entries(stats.dungeonCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5) // 상위 5개만
          .map(([dungeon, count]) => `🎮 **${dungeon}**: ${count}회`)
          .join('\n') || '데이터 없음';
        
        // 임베드 생성
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📊 던전 파티 통계')
          .setDescription('던전 파티 모집 통계 정보입니다.')
          .setAuthor({ name: 'Aimbot.ad', iconURL: 'https://imgur.com/Sd8qK9c.gif' })
          .addFields(
            { name: '📈 기본 통계', value: [
              `총 파티 수: ${stats.totalParties}개`,
              `활성 파티: ${stats.activeParties}개`,
              `취소된 파티: ${stats.canceledParties}개`,
              `총 참가자 수: ${stats.totalParticipants}명`
            ].join('\n') },
            { name: '🎮 인기 던전 Top 5', value: dungeonStatsText },
            { name: '👥 직업별 참가자 수', value: classStatsText }
          )
          .setFooter({ text: '🎷Blues', iconURL: interaction.guild.iconURL() })
          .setTimestamp();
        
        // 추가 통계 정보
        if (stats.mostPopularDungeon) {
          embed.addFields({
            name: '🏆 가장 인기 있는 던전',
            value: `🎮 **${stats.mostPopularDungeon}** (${stats.dungeonCounts[stats.mostPopularDungeon]}회)`
          });
        }
        
        if (stats.mostPopularClass) {
          embed.addFields({
            name: '🏆 가장 인기 있는 직업',
            value: `${classEmojis[stats.mostPopularClass]} **${classNames[stats.mostPopularClass]}** (${stats.classCounts[stats.mostPopularClass]}명)`
          });
        }
        
        await interaction.editReply({
          embeds: [embed],
          ephemeral: true
        });
      }
    };
    
    return module;
  };