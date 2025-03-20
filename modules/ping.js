// ping.js - 핑 명령어 모듈

module.exports = {
    name: 'ping',
    description: '봇의 응답 속도를 측정합니다.',
    
    // 모듈 명령어
    commands: {
        ping: {
            description: '봇의 응답 속도를 측정합니다.',
            execute: async (message, args, client) => {
                const sent = await message.reply('핑 측정 중...');
                const pingTime = sent.createdTimestamp - message.createdTimestamp;
                
                await sent.edit(`🏓 퐁! API 지연시간: ${client.ws.ping}ms | 메시지 지연시간: ${pingTime}ms`);
            }
        }
    },
    
    // 모듈 초기화 함수
    init: async (client, log) => {
        log('INFO', '핑 모듈이 초기화되었습니다.');
    }
};