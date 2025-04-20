// modules/voiceroomManager.js - 보이스룸 관리 모듈
const { 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');
const logger = require('../logger');

/**
 * 보이스룸 관리 유틸리티
 * @param {Client} client 디스코드 클라이언트
 * @returns {Object} 모듈 객체
 */
module.exports = (client) => {
  // 보이스룸 모듈 가져오기
  let voiceroomModule = null;
  
  /**
   * 모듈 초기화
   */
  function initialize() {
    try {
      // 보이스룸 모듈 참조 (나중에 로드될 수 있으므로 초기화 시에는 null일 수 있음)
      // 지연 로딩을 통해 순환 참조 문제 방지
      setTimeout(() => {
        try {
          voiceroomModule = client.modules.get('voiceroom');
          if (voiceroomModule) {
            logger.success('VoiceRoomManager', '보이스룸 모듈과 성공적으로 연결되었습니다.');
          } else {
            logger.warn('VoiceRoomManager', '보이스룸 모듈을 찾을 수 없습니다.');
          }
        } catch (error) {
          logger.error('VoiceRoomManager', `보이스룸 모듈 참조 오류: ${error.message}`);
        }
      }, 3000); // 다른 모듈이 로드된 후에 참조하기 위해 약간의 지연 추가
      
      // 이벤트 리스너 등록
      client.on('interactionCreate', handleInteraction);
      
      logger.module('VoiceRoomManager', '보이스룸 관리 모듈이 초기화되었습니다.');
    } catch (error) {
      logger.error('VoiceRoomManager', `초기화 중 오류 발생: ${error.message}`);
    }
  }
  
  /**
   * 인터랙션 처리
   * @param {Interaction} interaction 인터랙션
   */
  async function handleInteraction(interaction) {
    try {
      // 버튼 인터랙션
      if (interaction.isButton()) {
        // 이름 변경 모달
        if (interaction.customId.startsWith('voiceroom_rename_')) {
          const channelId = interaction.customId.replace('voiceroom_rename_', '');
          await showRenameModal(interaction, channelId);
        }
      }
    } catch (error) {
      logger.error('VoiceRoomManager', `인터랙션 처리 중 오류 발생: ${error.message}`);
    }
  }
/**
   * 이름 변경 모달 표시
   * @param {ButtonInteraction} interaction 버튼 인터랙션
   * @param {string} channelId 채널 ID
   */
async function showRenameModal(interaction, channelId) {
  try {
    // 채널 가져오기
    const channel = client.channels.cache.get(channelId);
    
    // 채널이 없는 경우
    if (!channel) {
      await interaction.reply({
        content: '⚠️ 해당 보이스룸이 더 이상 존재하지 않습니다.',
        ephemeral: true
      });
      return;
    }
    
    // 보이스룸 모듈이 초기화되지 않은 경우 - 안전하게 처리
    if (!voiceroomModule || typeof voiceroomModule.isVoiceRoomOwnedBy !== 'function') {
      // 보이스룸 모듈 없이도 작동 가능하도록 모달 직접 생성
      const modal = new ModalBuilder()
        .setCustomId(`voiceroom_rename_modal_${channelId}`)
        .setTitle('보이스룸 이름 변경');
      
      // 텍스트 입력 필드
      const nameInput = new TextInputBuilder()
        .setCustomId('room_name')
        .setLabel('새 이름을 입력하세요')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: 자유 대화방')
        .setMaxLength(25)
        .setRequired(true);
      
      // 액션 로우에 텍스트 입력 추가
      const actionRow = new ActionRowBuilder().addComponents(nameInput);
      
      // 모달에 액션 로우 추가
      modal.addComponents(actionRow);
      
      // 모달 표시
      await interaction.showModal(modal);
      return;
    }
    
    // 사용자가 채널 소유자인지 확인
    if (!voiceroomModule.isVoiceRoomOwnedBy(channelId, interaction.user.id)) {
      await interaction.reply({
        content: '⚠️ 이 보이스룸에 대한 권한이 없습니다.',
        ephemeral: true
      });
      return;
    }
    
    // 모달 생성
    const modal = new ModalBuilder()
      .setCustomId(`voiceroom_rename_modal_${channelId}`)
      .setTitle('보이스룸 이름 변경');
    
    // 텍스트 입력 필드
    const nameInput = new TextInputBuilder()
      .setCustomId('room_name')
      .setLabel('새 이름을 입력하세요')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('예: 자유 대화방')
      .setMaxLength(25)
      .setRequired(true);
    
    // 액션 로우에 텍스트 입력 추가
    const actionRow = new ActionRowBuilder().addComponents(nameInput);
    
    // 모달에 액션 로우 추가
    modal.addComponents(actionRow);
    
    // 모달 표시
    await interaction.showModal(modal);
  } catch (error) {
    logger.error('VoiceRoomManager', `이름 변경 모달 표시 중 오류 발생: ${error.message}`);
    
    // 오류 발생시 사용자에게 알림
    try {
      await interaction.reply({
        content: `⚠️ 모달 표시 중 오류가 발생했습니다: ${error.message}`,
        ephemeral: true
      });
    } catch (replyError) {
      logger.error('VoiceRoomManager', `응답 오류: ${replyError.message}`);
    }
  }
}

/**
 * 보이스룸 정보 표시
 * @param {Guild} guild 길드
 * @param {TextChannel} channel 텍스트 채널
 */
async function showVoiceRoomInfo(guild, channel) {
  try {
    // 보이스룸 모듈이 초기화되지 않은 경우
    if (!voiceroomModule || typeof voiceroomModule.isActiveVoiceRoom !== 'function') {
      await channel.send({
        content: '⚠️ 보이스룸 모듈이 초기화되지 않았습니다.'
      });
      return;
    }
    
    // 활성 보이스룸 필터링 (해당 서버만)
    const serverVoiceRooms = guild.channels.cache.filter(
      ch => ch.type === ChannelType.GuildVoice && 
      voiceroomModule.isActiveVoiceRoom(ch.id)
    );
    
    // 보이스룸이 없는 경우
    if (serverVoiceRooms.size === 0) {
      await channel.send({
        content: '현재 활성화된 보이스룸이 없습니다.'
      });
      return;
    }
    
    // 임베드 생성
    const embed = new EmbedBuilder()
      .setAuthor({ 
        name: 'Aimbot.ad', 
        iconURL: 'https://imgur.com/Sd8qK9c.gif' 
      })
      .setTitle('🔊 활성 보이스룸 현황')
      .setColor('#5865F2')
      .setDescription(`현재 ${serverVoiceRooms.size}개의 보이스룸이 활성화되어 있습니다.`)
      .setFooter({
        text: '🎷Blues',
        iconURL: guild.iconURL({ dynamic: true })
      })
      .setTimestamp();
    
    // 각 보이스룸 정보 추가
    serverVoiceRooms.forEach(voiceRoom => {
      if (voiceroomModule.getVoiceRoomInfo) {
        const voiceRoomInfo = voiceroomModule.getVoiceRoomInfo(voiceRoom.id);
        if (voiceRoomInfo) {
          const ownerTag = guild.members.cache.get(voiceRoomInfo.ownerId)?.user.tag || '알 수 없음';
          const memberCount = voiceRoom.members.size;
          
          embed.addFields({
            name: voiceRoom.name,
            value: `👑 소유자: ${ownerTag}\n👥 인원: ${memberCount}명`,
            inline: true
          });
        }
      }
    });
    
    await channel.send({ embeds: [embed] });
  } catch (error) {
    logger.error('VoiceRoomManager', `보이스룸 정보 표시 중 오류 발생: ${error.message}`);
    // 오류 발생 시 채널에 알림
    try {
      await channel.send({
        content: `⚠️ 보이스룸 정보를 표시하는 중 오류가 발생했습니다: ${error.message}`
      });
    } catch (sendError) {
      logger.error('VoiceRoomManager', `메시지 전송 오류: ${sendError.message}`);
    }
  }
}
/**
   * 사용자 보이스룸 리셋
   * @param {string} userId 사용자 ID
   * @param {string} guildId 길드 ID
   */
async function resetUserVoiceRoom(userId, guildId) {
  try {
    // 보이스룸 모듈이 초기화되지 않은 경우
    if (!voiceroomModule || typeof voiceroomModule.isVoiceRoomOwnedBy !== 'function') {
      logger.error('VoiceRoomManager', '보이스룸 모듈이 초기화되지 않았습니다.');
      return false;
    }
    
    const guild = client.guilds.cache.get(guildId);
    
    // 길드가 없는 경우
    if (!guild) {
      logger.error('VoiceRoomManager', `길드를 찾을 수 없습니다: ${guildId}`);
      return false;
    }
    
    // 해당 사용자가 소유한 보이스룸 찾기
    const userVoiceRooms = guild.channels.cache.filter(
      ch => ch.type === ChannelType.GuildVoice && 
      voiceroomModule.isVoiceRoomOwnedBy(ch.id, userId)
    );
    
    // 보이스룸이 없는 경우
    if (userVoiceRooms.size === 0) {
      return false;
    }
    
    // 각 보이스룸 삭제
    for (const [id, room] of userVoiceRooms) {
      try {
        await room.delete();
        if (voiceroomModule.removeVoiceRoom) {
          voiceroomModule.removeVoiceRoom(id);
        }
        logger.info('VoiceRoomManager', `사용자 ${userId}의 보이스룸이 리셋되었습니다: ${id}`);
      } catch (deleteError) {
        logger.error('VoiceRoomManager', `보이스룸 삭제 중 오류 발생: ${deleteError.message}`);
      }
    }
    
    return true;
  } catch (error) {
    logger.error('VoiceRoomManager', `사용자 보이스룸 리셋 중 오류 발생: ${error.message}`);
    return false;
  }
}

/**
 * 특정 채널이 보이스룸인지 확인
 * @param {string} channelId 채널 ID
 * @returns {boolean} 보이스룸 여부
 */
function isVoiceRoom(channelId) {
  // 보이스룸 모듈이 초기화되지 않은 경우
  if (!voiceroomModule || typeof voiceroomModule.isActiveVoiceRoom !== 'function') {
    return false;
  }
  
  return voiceroomModule.isActiveVoiceRoom(channelId);
}

/**
 * 익스포트를 위한 웹 설정 정보
 * @returns {Object} 설정 정보
 */
function getConfigurationForWeb() {
  return {
    fields: [
      {
        name: 'categoryId',
        label: '보이스룸 카테고리',
        type: 'category',
        required: true,
        description: '보이스룸이 생성될 카테고리를 선택합니다.'
      },
      {
        name: 'lobbyId',
        label: '로비 음성 채널',
        type: 'voiceChannel',
        required: true,
        description: '보이스룸 생성을 위한 로비 채널을 선택합니다.'
      },
      {
        name: 'maxRooms',
        label: '사용자당 최대 보이스룸 수',
        type: 'number',
        default: 1,
        min: 1,
        max: 5,
        description: '한 사용자가 최대로 생성할 수 있는 보이스룸 수를 설정합니다.'
      },
      {
        name: 'autoDeleteTime',
        label: '자동 삭제 시간(분)',
        type: 'number',
        default: 5,
        min: 1,
        max: 60,
        description: '비어있는 보이스룸이 자동으로A 삭제되는 시간을 설정합니다.'
      }
    ]
  };
}

// 모듈 초기화
initialize();

// 모듈 객체 반환
return {
  name: 'voiceroomManager',
  description: '보이스룸 관리 유틸리티',
  enabled: true,
  configurable: false,
  showRenameModal,
  showVoiceRoomInfo,
  resetUserVoiceRoom,
  isVoiceRoom,
  getConfigurationForWeb
};
};