// example.js - 예제 모듈
const logger = require('../utils/logger');
module.exports = {
    name: 'example',
    description: '예제 모듈입니다.',
    
    // 모듈 명령어
    commands: {
        hello: {
            description: '인사말을 보냅니다.',
            execute: async (message, args, client) => {
                await message.reply('안녕하세요! 반갑습니다! 👋');
            }
        },
        echo: {
            description: '입력받은 메시지를 반복합니다.',
            execute: async (message, args, client) => {
                const text = args.join(' ');
                if (!text) {
                    return message.reply('반복할 메시지를 입력해주세요.');
                }
                await message.reply(`${text}`);
            }
        }
    },
    
    // 모듈 초기화 함수
    init: async (client, log) => {
        // 모듈 초기화 로직
        log('INFO', '예제 모듈이 초기화되었습니다.');
        
        // 이벤트 리스너 등록 예시
        client.on('messageCreate', (message) => {
            // 봇 메시지 무시
            if (message.author.bot) return;
            
            // 'hello' 단어가 포함된 메시지에 반응
            if (message.content.toLowerCase().includes('hello')) {
                // 이 부분은 단순히 봇 기능 예시를 보여주기 위한 것으로, 로그는 남기지 않음
                message.react('👋').catch(() => {});
            }
        });
    }
};