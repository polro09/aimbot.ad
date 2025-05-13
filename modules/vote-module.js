const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, Events } = require('discord.js');
require('dotenv').config();

// 활성화된 투표 저장소
const activeVotes = new Map();

// 주기적 투표 업데이트 간격 (5분)
const UPDATE_INTERVAL = 5 * 60 * 1000;

/**
 * 투표 임베드 생성 함수
 * @param {Guild} guild - 서버 객체
 * @param {Object} vote - 투표 객체
 * @returns {EmbedBuilder} 임베드 객체
 */
function createVoteEmbed(guild, vote) {
  // 총 투표 수 계산
  const totalVotes = vote.voters.size; // 투표자 수와 동일함
  
  // 후보자를 득표수 기준으로 정렬
  const sortedCandidates = [...vote.candidates].sort((a, b) => {
    return (vote.votes.get(b.id) || 0) - (vote.votes.get(a.id) || 0);
  });
  
  // 1위 후보자 (동점일 경우 첫 번째 사람)
  const topCandidate = sortedCandidates.length > 0 ? sortedCandidates[0] : null;
  const topVoteCount = topCandidate ? (vote.votes.get(topCandidate.id) || 0) : 0;
  
  // 동점자 확인
  const tiedCandidates = sortedCandidates.filter(c => (vote.votes.get(c.id) || 0) === topVoteCount);
  const isTied = tiedCandidates.length > 1;
  
  // 1위 후보자의 썸네일 URL (없으면 서버 아이콘)
  const thumbnailURL = topCandidate 
    ? guild.members.cache.get(topCandidate.id)?.user.displayAvatarURL({ dynamic: true }) 
    : guild.iconURL({ dynamic: true });
  
  // 경과 시간 계산
  const elapsedTime = Date.now() - (vote.startTime || (vote.endTime - (3 * 24 * 60 * 60 * 1000)));
  const totalDuration = vote.endTime - vote.startTime; // 투표 총 기간
  const progressPercent = Math.min(Math.round((elapsedTime / totalDuration) * 100), 100);
  
  // 진행 막대 생성
  const progressBar = createProgressBar(progressPercent);
  
  // 1위 정보 문자열 생성
  let topCandidateInfo = '';
  if (topCandidate && topVoteCount > 0) {
    if (isTied) {
      topCandidateInfo = `👑 공동 1위: **${tiedCandidates.map(c => c.displayName).join(', ')}** (각 ${topVoteCount}표)`;
    } else {
      topCandidateInfo = `👑 현재 1위: **${topCandidate.displayName}** (${topVoteCount}표)`;
    }
  } else {
    topCandidateInfo = "아직 투표가 없습니다";
  }
  
  // 임베드 생성
  const embed = new EmbedBuilder()
    .setColor('#3498DB') // 파란색
    .setTitle(`🗳️${topCandidateInfo}`)
    .setDescription([
      `### 🔍 관리자 선출 투표 현황`,
      `🧑‍🤝‍🧑 참여 인원: **${vote.voters.size}명**`,
      `📊 총 투표수: **${totalVotes}표**`,
      `🆔 투표 ID: \`${vote.id}\``,
      `⏳ 진행률: ${progressBar} **${progressPercent}%**`,
      `⏰ 종료 시간: <t:${Math.floor(vote.endTime / 1000)}:F> (<t:${Math.floor(vote.endTime / 1000)}:R>)`
    ].join('\n'))
    .setThumbnail(thumbnailURL)
    .setAuthor({ 
      name: 'DV BOT', 
      iconURL: 'https://i.imgur.com/AxeBESV.png' 
    })
    .setImage('https://i.imgur.com/WQ1csTo.png')
    .setFooter({ 
      text: guild.name, 
      iconURL: 'https://i.imgur.com/AxeBESV.png' 
    })
    .setTimestamp();
  
  // 후보자별 득표수 추가 (순위별로 정렬)
  if (sortedCandidates.length > 0) {
    let candidatesField = '';
    sortedCandidates.forEach((candidate, index) => {
      const voteCount = vote.votes.get(candidate.id) || 0;
      const percent = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
      
      // 순위 이모지 추가
      let rankEmoji = '🔹';
      if (index === 0 && voteCount > 0) rankEmoji = '🥇';
      else if (index === 1 && voteCount > 0) rankEmoji = '🥈';
      else if (index === 2 && voteCount > 0) rankEmoji = '🥉';
      
      // 진행 막대 생성
      const voteBar = createVoteBar(percent);
      
      candidatesField += `${rankEmoji} **${candidate.displayName}**: ${voteCount}표 (${percent}%)\n${voteBar}\n`;
    });
    
    if (candidatesField) {
      embed.addFields({ name: '📊 투표 현황', value: candidatesField, inline: false });
    }
  }
  
  // 도움말 추가
  embed.addFields({ 
    name: '📝 투표 방법', 
    value: '아래의 **투표하기** 버튼을 클릭하여 투표에 참여\n투표는 **무기명**으로 진행되며. \n각 유저당 **한 번만** 투표할 수 있습니다.\n**새로고침** 버튼을 눌러 최신 투표 결과를 확인.', 
    inline: false 
  });
  
  return embed;
}

/**
 * 투표 결과 임베드 생성 함수
 * @param {Guild} guild - 서버 객체
 * @param {Object} vote - 투표 객체
 * @returns {EmbedBuilder} 임베드 객체
 */
function createVoteResultEmbed(guild, vote) {
  // 총 투표 수 계산
  const totalVotes = vote.voters.size;
  
  // 득표수별로 후보자 정렬
  const sortedCandidates = [...vote.candidates].sort((a, b) => {
    return (vote.votes.get(b.id) || 0) - (vote.votes.get(a.id) || 0);
  });
  
  // 우승자 (동점일 경우 여러명)
  const topVoteCount = sortedCandidates.length > 0 ? vote.votes.get(sortedCandidates[0].id) || 0 : 0;
  const winners = sortedCandidates.filter(c => (vote.votes.get(c.id) || 0) === topVoteCount);
  
  // 1위 후보자의 썸네일 URL
  let thumbnailURL = guild.iconURL({ dynamic: true });
  if (winners.length === 1 && topVoteCount > 0) {
    const winner = guild.members.cache.get(winners[0].id);
    if (winner) {
      thumbnailURL = winner.user.displayAvatarURL({ dynamic: true });
    }
  }
  
  // 우승자 문자열 생성
  let winnerStr = '🚫 **없음** (투표가 없거나 동점)';
  if (winners.length === 1 && topVoteCount > 0) {
    winnerStr = `🏆 **${winners[0].displayName}**\n투표 점유율: **${Math.round((topVoteCount / totalVotes) * 100)}%** (${topVoteCount}표)`;
  } else if (winners.length > 1 && topVoteCount > 0) {
    winnerStr = `👥 **${winners.length}명 공동 우승!**\n`;
    winners.forEach((winner, index) => {
      winnerStr += `${index + 1}. **${winner.displayName}** (${topVoteCount}표)\n`;
    });
    winnerStr += `각 우승자 투표 점유율: **${Math.round((topVoteCount / totalVotes) * 100)}%**`;
  }
  
  // 이모지로 꾸민 분리선
  const divider = '───────── ⭐ ───────── ⭐ ─────────';
// 임베드 생성
const embed = new EmbedBuilder()
.setColor('#2ECC71') // 초록색 (완료됨)
.setTitle(`🎉 ${vote.title} - 최종 결과 발표 🎉`)
.setDescription([
  `### 📋 투표 정보 요약`,
  `🗳️ **총 투표수**: ${totalVotes}표`,
  `👥 **참여 인원**: ${vote.voters.size}명`,
  `🆔 **투표 ID**: \`${vote.id}\``,
  `📆 **투표 기간**: <t:${Math.floor(vote.startTime / 1000)}:F> ~ <t:${Math.floor(vote.endTime / 1000)}:F>`,
  ``,
  `### 🏆 최종 결과`,
  `${winnerStr}`,
  ``,
  divider
].join('\n'))
.setThumbnail(thumbnailURL)
.setAuthor({ 
  name: 'DV BOT', 
  iconURL: 'https://i.imgur.com/AxeBESV.png' 
})
.setImage('https://i.imgur.com/WQ1csTo.png')
.setFooter({ 
  text: `${guild.name} | 투표가 종료되었습니다`, 
  iconURL: 'https://i.imgur.com/AxeBESV.png' 
})
.setTimestamp();

// 모든 후보자 결과 추가
let resultsField = '';
sortedCandidates.forEach((candidate, index) => {
const voteCount = vote.votes.get(candidate.id) || 0;
const percent = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;

// 순위 이모지 추가
let rankEmoji = '🔹';
if (index === 0 && voteCount > 0) rankEmoji = '🥇';
else if (index === 1 && voteCount > 0) rankEmoji = '🥈';
else if (index === 2 && voteCount > 0) rankEmoji = '🥉';
else if (index === 3 && voteCount > 0) rankEmoji = '4️⃣';
else if (index === 4 && voteCount > 0) rankEmoji = '5️⃣';

// 진행 막대 생성
const voteBar = createVoteBar(percent);

resultsField += `${rankEmoji} **${candidate.displayName}**: ${voteCount}표 (${percent}%)\n${voteBar}\n`;
});

if (resultsField) {
embed.addFields({ name: '📊 상세 투표 결과', value: resultsField, inline: false });
}

// 참여 감사 메시지
embed.addFields({ 
name: '💌 안내 메시지', 
value: '투표에 참여해주신 모든 분들께 감사드립니다! 이 투표는 종료되었습니다.', 
inline: false 
});

return embed;
}

/**
* 후보자 선택 메뉴 생성 함수
* @param {Object} vote - 투표 객체
* @param {string} voteId - 투표 ID
* @returns {ActionRowBuilder} 액션 로우 객체
*/
function createCandidateSelectMenu(vote, voteId) {
// 선택 메뉴 옵션 생성
const options = vote.candidates.map(candidate => ({
label: candidate.displayName,
value: candidate.id,
description: `${candidate.username}`
}));

// 25개 제한 (Discord 제한)
const limitedOptions = options.slice(0, 25);

// 선택 메뉴 생성
const selectMenu = new StringSelectMenuBuilder()
.setCustomId(`vote_select_${voteId}`)
.setPlaceholder('투표할 후보를 선택하세요')
.addOptions(limitedOptions);

return new ActionRowBuilder().addComponents(selectMenu);
}

/**
* 무작위 투표 ID 생성 함수
* @returns {string} 무작위 6자리 ID
*/
function generateVoteId() {
const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
let result = '';
for (let i = 0; i < 6; i++) {
result += characters.charAt(Math.floor(Math.random() * characters.length));
}
return result;
}
/**
 * 시간을 가독성 있게 포맷팅하는 함수
 * @param {number} ms - 밀리초
 * @returns {string} 포맷팅된 시간
 */
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}일`;
    if (hours > 0) return `${hours}시간`;
    if (minutes > 0) return `${minutes}분`;
    return `${seconds}초`;
  }
  
  /**
   * 진행 막대를 생성하는 함수
   * @param {number} percent - 진행률 (0-100)
   * @returns {string} 진행 막대 문자열
   */
  function createProgressBar(percent) {
    const filledBlocks = Math.floor(percent / 10);
    const emptyBlocks = 10 - filledBlocks;
    
    let progressBar = '';
    
    // 채워진 블록
    for (let i = 0; i < filledBlocks; i++) {
      progressBar += '🟦';
    }
    
    // 빈 블록
    for (let i = 0; i < emptyBlocks; i++) {
      progressBar += '⬜';
    }
    
    return progressBar;
  }
  
  /**
   * 투표 막대를 생성하는 함수 
   * @param {number} percent - 투표율 (0-100)
   * @returns {string} 투표 막대 문자열
   */
  function createVoteBar(percent) {
    const filledBlocks = Math.floor(percent / 5); // 더 세분화된 막대 (20칸)
    const emptyBlocks = 20 - filledBlocks;
    
    // 다양한 이모지로 막대 생성
    const bars = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
    let voteBar = '';
    
    // 채워진 블록
    for (let i = 0; i < filledBlocks; i++) {
      voteBar += '█';
    }
    
    // 빈 블록
    // 너무 길어지지 않도록 조정 (10칸만 표시)
    if (emptyBlocks > 0 && voteBar.length < 10) {
      const visibleEmptyBlocks = Math.min(emptyBlocks, 10 - voteBar.length);
      voteBar += '░'.repeat(visibleEmptyBlocks);
    }
    
    return voteBar;
  }
  
  /**
   * 두 배열이 동일한지 비교하는 함수
   * @param {Array} arr1 - 첫 번째 배열
   * @param {Array} arr2 - 두 번째 배열
   * @returns {boolean} 두 배열이 동일하면 true, 아니면 false
   */
  function arraysEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    
    const sortedArr1 = [...arr1].sort();
    const sortedArr2 = [...arr2].sort();
    
    for (let i = 0; i < sortedArr1.length; i++) {
      if (sortedArr1[i] !== sortedArr2[i]) return false;
    }
    
    return true;
  }
  
  module.exports = {
    name: 'vote-module',
    description: '서버 관리자 투표 모듈',
    
    /**
     * 모듈 초기화 함수
     * @param {Client} client - Discord 클라이언트 객체
     */
    init: (client) => {
      // 주기적인 투표 상태 업데이트 설정
      setInterval(() => {
        // 활성화된 모든 투표 업데이트
        activeVotes.forEach((vote, voteId) => {
          // 종료된 투표는 처리하지 않음
          if (Date.now() >= vote.endTime) {
            return;
          }
          
          // 서버 가져오기
          const guild = client.guilds.cache.get(vote.guildId);
          if (guild) {
            updateVoteResults(guild, voteId);
          }
        });
      }, UPDATE_INTERVAL);
// 명령어 리스너 등록
client.on(Events.MessageCreate, async (message) => {
    // 봇 메시지 무시
    if (message.author.bot) return;
    
    // 접두사 가져오기
    const prefix = process.env.PREFIX || '!';
    
    // 메시지가 접두사로 시작하는지 확인 (로깅 추가)
    if (!message.content.startsWith(prefix)) {
      return;
    }
    
    console.log(`🔍 명령어 감지: ${message.content}`);
    
    try {
      const args = message.content.slice(prefix.length).trim().split(/ +/);
      const command = args.shift().toLowerCase();
      
      console.log(`🔍 처리된 명령어: '${command}', 인자: [${args.join(', ')}]`);
      
      // 투표 생성 명령어
      if (command === '투표시작' || command === 'vote') {
        console.log('✅ 투표시작 명령어 인식됨');
        
        // 권한 체크 (관리자 또는 투표 관리 권한이 있는 사용자만 투표 생성 가능)
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator) && 
            !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return message.reply('⚠️ 투표를 생성할 권한이 없습니다. 관리자 또는 서버 관리 권한이 필요합니다.');
        }
        
        // 제목 추출 (예: !투표 "우리 서버 관리자 선출")
        let title = '관리자 투표';
        if (args.length > 0) {
          // 따옴표로 둘러싸인 제목 찾기
          const fullText = args.join(' ');
          const titleMatch = fullText.match(/"([^"]+)"/);
          
          if (titleMatch && titleMatch[1]) {
            title = titleMatch[1];
            // 제목 부분 제거
            const newArgs = fullText.replace(titleMatch[0], '').trim().split(/ +/);
            args.splice(0, args.length, ...newArgs);
          }
        }
        
        // 투표 시간 설정 (기본값: 3일)
        let duration = 3 * 24 * 60 * 60 * 1000; // 3일(밀리초)
        const timeArg = args.find(arg => /^\d+[hmd]$/.test(arg));
        
        if (timeArg) {
          const value = parseInt(timeArg.slice(0, -1));
          const unit = timeArg.slice(-1);
          
          if (unit === 'd') duration = value * 24 * 60 * 60 * 1000; // 일
          else if (unit === 'h') duration = value * 60 * 60 * 1000; // 시간
          else if (unit === 'm') duration = value * 60 * 1000; // 분
          
          console.log(`⏱️ 투표 기간 설정: ${formatDuration(duration)}`);
        }
        
        await createVote(message, title, duration);
      }
      
      // 투표 종료 명령어
      else if (command === '투표종료' || command === 'endvote') {
        console.log('✅ 투표종료 명령어 인식됨');
        
        // 권한 체크
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator) && 
            !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return message.reply('⚠️ 투표를 종료할 권한이 없습니다. 관리자 또는 서버 관리 권한이 필요합니다.');
        }
        
        const voteId = args[0];
        if (!voteId) {
          // 활성화된 투표 목록 보여주기
          const activeVotesList = Array.from(activeVotes.keys());
          if (activeVotesList.length === 0) {
            return message.reply('⚠️ 현재 활성화된, 투표가 없습니다.');
          }
          
          let voteListStr = '**현재 활성화된 투표 목록:**\n';
          activeVotesList.forEach(id => {
            const vote = activeVotes.get(id);
            voteListStr += `- ID: \`${id}\` | 제목: ${vote.title} | 종료: <t:${Math.floor(vote.endTime / 1000)}:R>\n`;
          });
          
          voteListStr += '\n종료하려면 `!투표종료 [투표ID]` 명령어를 사용하세요.';
          return message.reply(voteListStr);
        }
        
        if (!activeVotes.has(voteId)) {
          return message.reply(`⚠️ ID가 \`${voteId}\`인 투표를 찾을 수 없습니다. 정확한 투표 ID를 입력해주세요.`);
        }
        
        endVote(message.guild, voteId);
        message.reply(`✅ 투표가 수동으로 종료되었습니다. (투표 ID: ${voteId})`);
      }
      
      // 투표 상태 확인 명령어
      else if (command === '투표상태' || command === 'votestatus') {
        console.log('✅ 투표상태 명령어 인식됨');
        
        const activeVotesList = Array.from(activeVotes.keys());
        if (activeVotesList.length === 0) {
          return message.reply('현재 활성화된 투표가, 없습니다.');
        }
        
        let voteListStr = '**현재 활성화된 투표 목록:**\n';
        activeVotesList.forEach(id => {
          const vote = activeVotes.get(id);
          const totalVotes = vote.voters.size;
          voteListStr += `- ID: \`${id}\` | 제목: ${vote.title} | 투표수: ${totalVotes} | 종료: <t:${Math.floor(vote.endTime / 1000)}:R>\n`;
        });
        
        message.reply(voteListStr);
      }
      
      // 도움말 명령어
      else if (command === '투표도움말' || command === 'votehelp') {
        console.log('✅ 투표도움말 명령어 인식됨');
        
        const helpMessage = [
          '**📋 투표 시스템 도움말**',
          '',
          '**기본 명령어:**',
          '`!투표시작 "투표 제목" [기간]` - 새 투표 생성',
          '`!투표종료 [투표ID]` - 투표 수동 종료',
          '`!투표상태` - 활성화된 모든 투표 확인',
          '`!투표도움말` - 이 도움말 표시',
          '',
          '**투표 기간 설정:**',
            '`3d` - 3일 (기본값)',
            '`12h` - 12시간',
            '`30m` - 30분',
            '',
            '**예시:**',
            '`!투표시작 "서버 관리자 선출" 1d` - 1일간 진행되는 투표 생성',
            '`!투표종료 ABC123` - ID가 ABC123인 투표 종료'
          ].join('\n');
          
          message.reply(helpMessage);
        }
      } catch (error) {
        console.error('❌ 명령어 처리 중 오류:', error);
        message.reply('⚠️ 명령어 처리 중 오류가 발생했습니다. 다시 시도해주세요.');
      }
    });

    // 투표 상호작용 리스너
    client.on(Events.InteractionCreate, async (interaction) => {
      // 버튼 상호작용 처리
      if (interaction.isButton()) {
        // 투표하기 버튼
        if (interaction.customId.startsWith('vote_')) {
          const voteId = interaction.customId.split('_')[1];
          
          if (!activeVotes.has(voteId)) {
            return interaction.reply({ content: '⚠️ 이 투표는 더 이상 활성화되지 않았습니다.', ephemeral: true });
          }

          const vote = activeVotes.get(voteId);
          
          // 이미 투표한 사용자인지 확인
          if (vote.voters.has(interaction.user.id)) {
            // 이미 투표한 후보자 찾기
            let votedCandidate = null;
            if (vote.voterChoices && vote.voterChoices.has(interaction.user.id)) {
              votedCandidate = vote.candidates.find(c => c.id === vote.voterChoices.get(interaction.user.id));
            }
            
            const votedCandidateName = votedCandidate ? votedCandidate.displayName : "알 수 없는 후보자";
            return interaction.reply({ 
              content: `⚠️ 이미 **${votedCandidateName}**님에게 투표하셨습니다. 투표는 한 번만 가능합니다.`, 
              ephemeral: true 
            });
          }
          
          // 사용자 선택 메뉴 표시
          const row = createCandidateSelectMenu(vote, voteId);
          return interaction.reply({ 
            content: '🗳️ 투표할 후보를 선택해주세요:', 
            components: [row], 
            ephemeral: true 
          });
        }
        
        // 투표 안내 버튼
        else if (interaction.customId.startsWith('info_')) {
          const voteId = interaction.customId.split('_')[1];
          
          if (!activeVotes.has(voteId)) {
            return interaction.reply({ content: '⚠️ 이 투표는 더 이상 활성화되지 않았습니다.', ephemeral: true });
          }
          
          const vote = activeVotes.get(voteId);
          const hasVoted = vote.voters.has(interaction.user.id);
          
          // 사용자가 투표한 후보자 정보 가져오기
          let votedCandidateInfo = '';
          if (hasVoted && vote.voterChoices && vote.voterChoices.has(interaction.user.id)) {
            const votedCandidateId = vote.voterChoices.get(interaction.user.id);
            const votedCandidate = vote.candidates.find(c => c.id === votedCandidateId);
            if (votedCandidate) {
              votedCandidateInfo = `\n✅ **${votedCandidate.displayName}**님에게 투표하셨습니다.`;
            }
          }
          
          // 투표 안내 메시지
          const infoMessage = [
            '📝 **투표 안내**',
            '',
            '• 이 투표는 **무기명**으로 진행됩니다. 누가 누구에게 투표했는지 공개되지 않습니다.',
            '• 한 사람당 **한 명의 후보자에게만** 투표할 수 있으며, 투표 후에는 변경할 수 없습니다.',
            `• 투표 기간은 <t:${Math.floor(vote.endTime / 1000)}:F>까지입니다.`,
            `• 현재 총 **${vote.voters.size}명**이 투표에 참여했습니다.`,
            '',
            hasVoted ? `✅ 당신은 이미 투표하셨습니다.${votedCandidateInfo}` : '❌ 당신은 아직 투표하지 않았습니다.'
          ].join('\n');
          
          return interaction.reply({ content: infoMessage, ephemeral: true });
        }
        
        // 새로고침 버튼
        else if (interaction.customId.startsWith('refresh_')) {
          const voteId = interaction.customId.split('_')[1];
          
          if (!activeVotes.has(voteId)) {
            return interaction.reply({ content: '⚠️ 이 투표는 더 이상 활성화되지 않았습니다.', ephemeral: true });
          }
          
          // 투표 결과 업데이트
          updateVoteResults(interaction.message.guild, voteId);
          
          return interaction.reply({ 
            content: '✅ 투표 결과가 새로고침되었습니다!', 
            ephemeral: true 
          });
        }
      }
      
      // 셀렉트 메뉴 상호작용 처리
      else if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('vote_select_')) {
          const voteId = interaction.customId.split('_')[2];
          
          if (!activeVotes.has(voteId)) {
            return interaction.reply({ content: '⚠️ 이 투표는 더 이상 활성화되지 않았습니다.', ephemeral: true });
          }
          
          const vote = activeVotes.get(voteId);
          const candidateId = interaction.values[0];
          
          // 이미 투표한 사용자인지 다시 한번 확인
          if (vote.voters.has(interaction.user.id)) {
            return interaction.reply({ 
              content: '⚠️ 이미 투표하셨습니다. 투표는 한 번만 가능합니다.', 
              ephemeral: true 
            });
          }
          
          // 투표 기록을 위한 voterChoices 맵이 없으면 생성
          if (!vote.voterChoices) {
            vote.voterChoices = new Map();
          }
          
          // 투표 기록 - 어떤 사용자가 어떤 후보에게 투표했는지 저장
          vote.voterChoices.set(interaction.user.id, candidateId);
          
          // 득표수 증가
          vote.votes.set(candidateId, (vote.votes.get(candidateId) || 0) + 1);
          
          // 투표자 목록에 추가
          vote.voters.add(interaction.user.id);
          
          // 투표 결과 즉시 업데이트
          updateVoteResults(interaction.message.guild, voteId);
          
          // 투표 감사 메시지 생성
          const candidate = vote.candidates.find(c => c.id === candidateId);
          let thankMessage = `✅ **${candidate.displayName}**님에게 투표가 등록되었습니다!\n`;
          thankMessage += `현재 총 **${vote.voters.size}명**이 투표에 참여했습니다.\n`;
          thankMessage += `투표해주셔서 감사합니다! 🙏`;
          
          return interaction.reply({ content: thankMessage, ephemeral: true });
        }
      }
    });
    
    console.log('✅ 투표 모듈이 초기화되었습니다.');
  }
};
/**
 * 투표 생성 함수
 * @param {Message} message - 메시지 객체
 * @param {string} title - 투표 제목
 * @param {number} duration - 투표 지속 시간 (밀리초)
 */
async function createVote(message, title, duration) {
    try {
      // 서버 멤버들을 가져옴 (최대 1000명)
      const members = await message.guild.members.fetch({ limit: 1000 });
      
      // 투표 ID 생성 (무작위 6자리 영숫자)
      const voteId = generateVoteId();
      
      // 투표 객체 생성
      const vote = {
        id: voteId,
        title: title,
        guildId: message.guild.id,
        channelId: message.channel.id,
        votes: new Map(), // userId -> 득표수
        voters: new Set(), // 투표한 사람들
        voterChoices: new Map(), // 어떤 사용자가 어떤 후보에게 투표했는지 기록 (userId -> candidateId)
        candidates: [], // 후보자 목록
        messageId: null,
        startTime: Date.now(),
        endTime: Date.now() + duration,
        lastUpdateTime: Date.now(), // 마지막 업데이트 시간
        lastLeaderIds: [] // 마지막 업데이트 시 1위 목록 (변경 감지용)
      };
      
      // 특정 역할(1370666632153792575)을 가진 멤버만 후보자로 등록
      const targetRoleId = '1370666632153792575';
      
      // 필터링된 멤버 수를 추적
      let filteredMemberCount = 0;
      
      // 후보자 목록 생성 (특정 역할을 가진 멤버들만)
      members.forEach(member => {
        // 봇은 제외
        if (member.user.bot) return;
        
        // 특정 역할을 가진 멤버만 포함
        if (!member.roles.cache.has(targetRoleId)) return;
        
        // 후보자 추가
        filteredMemberCount++;
        
        // 후보자 정보 저장
        vote.candidates.push({
          id: member.id,
          displayName: member.displayName || member.user.username,
          username: member.user.username
        });
        
        // 초기 득표수 0으로 설정
        vote.votes.set(member.id, 0);
      });
      
      // 디버그 로그
      console.log(`🔍 총 서버 멤버: ${members.size}명, 역할 ID ${targetRoleId}를 가진 멤버: ${filteredMemberCount}명`);
      
      // 투표할 후보가 없으면 오류 메시지 표시
      if (vote.candidates.length === 0) {
        return message.reply(`⚠️ 투표할 후보자가 없습니다. 역할 ID ${targetRoleId}를 가진 멤버가 없습니다.`);
      }
      
      // 투표 저장
      activeVotes.set(voteId, vote);
      
      // 투표 임베드 생성
      const embed = createVoteEmbed(message.guild, vote);
      
      // 투표 버튼 생성 (여러 버튼 제공)
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`vote_${voteId}`)
            .setLabel('투표하기')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🗳️'),
          new ButtonBuilder()
            .setCustomId(`info_${voteId}`)
            .setLabel('투표 안내')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('ℹ️'),
          new ButtonBuilder()
            .setCustomId(`refresh_${voteId}`)
            .setLabel('새로고침')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔄')
        );
      
      // 투표 메시지 전송
      const voteMessage = await message.channel.send({
        embeds: [embed],
        components: [row]
      });
      
      // 메시지 ID 저장
      vote.messageId = voteMessage.id;
      
      // 투표 종료 타이머 설정
      setTimeout(() => {
        if (activeVotes.has(voteId)) {
          endVote(message.guild, voteId);
        }
      }, duration);
      
      message.reply(`✅ 투표가 생성되었습니다. 투표 ID: ${voteId} (${formatDuration(duration)} 후 자동 종료)`);
    } catch (error) {
      console.error('❌ 투표 생성 오류:', error);
      message.reply('⚠️ 투표 생성 중 오류가 발생했습니다.');
    }
  }
  
  /**
   * 투표 종료 함수
   * @param {Guild} guild - 서버 객체
   * @param {string} voteId - 투표 ID
   */
  async function endVote(guild, voteId) {
    try {
      // 투표 정보 가져오기
      const vote = activeVotes.get(voteId);
      if (!vote) return;
      
      // 투표 종료 임베드 생성
      const embed = createVoteResultEmbed(guild, vote);
      
      // 채널 가져오기
      const channel = guild.channels.cache.get(vote.channelId);
      if (!channel) {
        console.error(`⚠️ 채널을 찾을 수 없습니다: ${vote.channelId}`);
        return;
      }
      
      // 기존 메시지 가져와서 업데이트
      try {
        const message = await channel.messages.fetch(vote.messageId);
        if (message) {
          await message.edit({
            embeds: [embed],
            components: [] // 투표 버튼 제거
          });
        }
      } catch (err) {
        // 메시지를 찾을 수 없는 경우 새 메시지 전송
        console.log(`⚠️ 투표 메시지를 찾을 수 없어 새로운 결과 메시지를 전송합니다.`);
        await channel.send({
          embeds: [embed],
          content: `🏁 투표 ID ${voteId}가 종료되었습니다.`
        });
      }
      
      // 활성화된 투표에서 제거
      activeVotes.delete(voteId);
      
      console.log(`✅ 투표가 종료되었습니다. (투표 ID: ${voteId})`);
    } catch (error) {
      console.error('❌ 투표 종료 오류:', error);
    }
  }
  
  /**
   * 투표 결과 업데이트 함수
   * @param {Guild} guild - 서버 객체
   * @param {string} voteId - 투표 ID
   */
  async function updateVoteResults(guild, voteId) {
    try {
      // 투표 정보 가져오기
      const vote = activeVotes.get(voteId);
      if (!vote) return;
  
      // 득표수별로 후보자 정렬
      const sortedCandidates = [...vote.candidates].sort((a, b) => {
        return (vote.votes.get(b.id) || 0) - (vote.votes.get(a.id) || 0);
      });
      
      // 현재 1위 후보자들 ID 배열
      const topVoteCount = sortedCandidates.length > 0 ? vote.votes.get(sortedCandidates[0].id) || 0 : 0;
      const currentLeaderIds = sortedCandidates
        .filter(c => (vote.votes.get(c.id) || 0) === topVoteCount)
        .map(c => c.id);
      
      // 투표 임베드 업데이트
      const embed = createVoteEmbed(guild, vote);
      
      // 채널 가져오기
      const channel = guild.channels.cache.get(vote.channelId);
      if (!channel) {
        console.error(`⚠️ 채널을 찾을 수 없습니다: ${vote.channelId}`);
        return;
      }
      
      // 메시지 업데이트
      try {
        const message = await channel.messages.fetch(vote.messageId);
        if (message) {
          await message.edit({ 
            embeds: [embed],
            components: message.components // 버튼은 유지
          });
          
          // 1위 변동 정보 저장 (알림 메시지 없이)
          const hasLeaderChanged = !arraysEqual(vote.lastLeaderIds, currentLeaderIds);
          if (hasLeaderChanged) {
            vote.lastLeaderIds = [...currentLeaderIds];
          }
        }
      } catch (err) {
        console.error('⚠️ 투표 결과 업데이트 실패:', err);
      }
    } catch (error) {
      console.error('❌ 투표 결과 업데이트 오류:', error);
    }
  }