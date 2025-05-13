const { EmbedBuilder, Events } = require('discord.js');
require('dotenv').config();

module.exports = {
  name: 'welcome-module',
  description: '서버 입장/퇴장 알림 모듈',
  
  /**
   * 모듈 초기화 함수
   * @param {Client} client - Discord 클라이언트 객체
   */
  init: (client) => {
    // 입장 이벤트 리스너
    client.on(Events.GuildMemberAdd, async (member) => {
      console.log(`🔍 웰컴 모듈: 멤버 입장 감지 - ${member.user.tag}`);
      
      // 로그 채널 ID를 .env에서 가져오거나 기본 채널 사용
      const logChannelId = process.env.LOG_CHANNEL_ID || member.guild.systemChannelId;
      if (!logChannelId) {
        console.log('⚠️ 로그 채널 ID가 설정되지 않았고, 시스템 채널도 없습니다.');
        return;
      }
      
      const logChannel = member.guild.channels.cache.get(logChannelId);
      if (!logChannel) {
        console.log(`⚠️ ID가 ${logChannelId}인 채널을 찾을 수 없습니다.`);
        return;
      }
      
      try {
        // 사용자 이름 (서버 닉네임 우선, 없으면 유저 이름)
        const displayName = member.nickname || member.user.username;
        
        // 입장 임베드 생성
        const welcomeEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('👋 환영합니다!')
          .setDescription(`<@${member.user.id}>님이 서버에 입장했습니다!`)
          .addFields(
            { name: '👤 유저 정보', value: 
              '```\n' +
              `유저 이름: ${displayName}\n` +
              `유저 ID: ${member.user.id}\n` +
              `계정 생성일: ${formatDate(member.user.createdAt)}\n` +
              `서버 참가일: ${formatDate(member.joinedAt)}\n` +
              '```', 
              inline: false }
          )
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setAuthor({ 
            name: 'DV BOT', 
            iconURL: 'https://i.imgur.com/AxeBESV.png' 
          })
          .setImage('https://i.imgur.com/WQ1csTo.png')
          .setFooter({ 
            text: member.guild.name, 
            iconURL: 'https://i.imgur.com/AxeBESV.png' 
          })
          .setTimestamp();
        
        await logChannel.send({ embeds: [welcomeEmbed] });
        console.log(`✅ 입장 메시지 전송 성공 - ${member.user.tag}`);
      } catch (error) {
        console.error('❌ 입장 메시지 전송 오류:', error);
      }
    });

    // 퇴장 이벤트 리스너
    client.on(Events.GuildMemberRemove, async (member) => {
      console.log(`🔍 웰컴 모듈: 멤버 퇴장 감지 - ${member.user.tag}`);
      
      // 로그 채널 ID를 .env에서 가져오거나 기본 채널 사용
      const logChannelId = process.env.LOG_CHANNEL_ID || member.guild.systemChannelId;
      if (!logChannelId) {
        console.log('⚠️ 로그 채널 ID가 설정되지 않았고, 시스템 채널도 없습니다.');
        return;
      }
      
      const logChannel = member.guild.channels.cache.get(logChannelId);
      if (!logChannel) {
        console.log(`⚠️ ID가 ${logChannelId}인 채널을 찾을 수 없습니다.`);
        return;
      }
      
      try {
        // 사용자 이름 (사용 가능한 마지막 닉네임이나 유저 이름)
        const displayName = member.nickname || member.user.username;
        
        // 퇴장 임베드 생성
        const leaveEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('👋 안녕히 가세요!')
          .setDescription(`<@${member.user.id}>님이 서버에서 퇴장했습니다!`)
          .addFields(
            { name: '👤 유저 정보', value: 
              '```\n' +
              `유저 이름: ${displayName}\n` +
              `유저 ID: ${member.user.id}\n` +
              `서버 탈퇴일: ${formatDate(new Date())}\n` +
              '```', 
              inline: false }
          )
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
          .setAuthor({ 
            name: 'DV BOT', 
            iconURL: 'https://i.imgur.com/AxeBESV.png' 
          })
          .setImage('https://i.imgur.com/WQ1csTo.png')
          .setFooter({ 
            text: member.guild.name, 
            iconURL: 'https://i.imgur.com/AxeBESV.png' 
          })
          .setTimestamp();
        
        await logChannel.send({ embeds: [leaveEmbed] });
        console.log(`✅ 퇴장 메시지 전송 성공 - ${member.user.tag}`);
      } catch (error) {
        console.error('❌ 퇴장 메시지 전송 오류:', error);
      }
    });
    
    console.log('✅ 입장/퇴장 모듈이 초기화되었습니다.');
  }
};

/**
 * 날짜를 YYYY. MM. DD. (요일) 형식으로 포맷팅하는 함수
 * @param {Date} date - 포맷팅할 날짜
 * @returns {string} 포맷팅된 날짜 문자열
 */
function formatDate(date) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayOfWeek = days[date.getDay()];

  return `${year}. ${month}. ${day}. (${dayOfWeek}요일)`;
}