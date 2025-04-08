// modules/raid-call.js - 파티 모집 시스템 모듈 (개선된 버전)
const logger = require('../utils/logger');
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, StringSelectMenuBuilder } = require('discord.js');
const storage = require('../storage');

// 스토리지 키
const CONFIG_STORAGE_KEY = 'raid-call-config';
const RAIDS_STORAGE_KEY = 'raid-calls';
const DUNGEONS_STORAGE_KEY = 'raid-dungeons'; // 던전 데이터용 스토리지 키 추가

// 서버별 설정 저장
let guildSettings = new Map();

// 활성화된 파티 모집 저장
let activeRaidCalls = new Map();

// 던전 정보 저장
let dungeonDatabase = new Map();

// 슬래시 명령어 정의
const slashCommands = [
    new SlashCommandBuilder()
        .setName('레이드알람채널')
        .setDescription('레이드 알람 채널을 설정합니다')
        .addChannelOption(option => 
            option.setName('채널')
                .setDescription('알람을 보낼 채널')
                .setRequired(true)),
                
    new SlashCommandBuilder()
        .setName('파티모집채널')
        .setDescription('파티 모집 채널을 설정합니다')
        .addChannelOption(option => 
            option.setName('채널')
                .setDescription('파티 모집 임베드를 생성할 채널')
                .setRequired(true)),
                
    new SlashCommandBuilder()
        .setName('레이드')
        .setDescription('레이드 관련 명령어')
        .addSubcommand(subcommand =>
            subcommand
                .setName('임베드')
                .setDescription('레이드 모집 임베드를 생성합니다')
                .addChannelOption(option => 
                    option.setName('채널')
                        .setDescription('임베드를 생성할 채널')
                        .setRequired(true))),
                        
    new SlashCommandBuilder()
        .setName('던전')
        .setDescription('던전 관리 명령어')
        .addSubcommand(subcommand =>
            subcommand
                .setName('추가')
                .setDescription('새 던전을 추가합니다')
                .addStringOption(option => 
                    option.setName('이름')
                        .setDescription('던전 이름')
                        .setRequired(true))
                .addStringOption(option => 
                    option.setName('설명')
                        .setDescription('던전 설명')
                        .setRequired(false))
                .addStringOption(option => 
                    option.setName('썸네일')
                        .setDescription('던전 썸네일 URL')
                        .setRequired(false))
                .addStringOption(option => 
                    option.setName('이미지')
                        .setDescription('던전 이미지 URL')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('목록')
                .setDescription('등록된 던전 목록을 확인합니다'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('삭제')
                .setDescription('등록된 던전을 삭제합니다')
                .addStringOption(option => 
                    option.setName('아이디')
                        .setDescription('삭제할 던전 ID')
                        .setRequired(true)))
];

// 스토리지에서 던전 정보 로드하는 함수
async function loadDungeonDatabase(log) {
    try {
        // 던전 데이터베이스 로드
        try {
            await storage.ensureStorage(DUNGEONS_STORAGE_KEY, {});
            const dungeonData = storage.getAll(DUNGEONS_STORAGE_KEY);
            
            if (dungeonData) {
                // Map으로 변환
                dungeonDatabase = new Map();
                
                // 서버별 던전 데이터 복원
                for (const [guildId, dungeons] of Object.entries(dungeonData)) {
                    const guildDungeons = new Map();
                    for (const [dungeonId, dungeonInfo] of Object.entries(dungeons)) {
                        guildDungeons.set(dungeonId, dungeonInfo);
                    }
                    dungeonDatabase.set(guildId, guildDungeons);
                }
            }
            
            // 로그 개선
            logger.info(`던전 데이터베이스 로드 완료: ${Array.from(dungeonDatabase.keys()).length}개 서버`, null, 'RAID-CALL');
        } catch (error) {
            // 로그 개선
            logger.warn(`${DUNGEONS_STORAGE_KEY} 로드 중 오류, 초기화합니다: ${error.message}`, null, 'RAID-CALL');
            storage.setAll(DUNGEONS_STORAGE_KEY, {});
            await storage.save(DUNGEONS_STORAGE_KEY);
            dungeonDatabase = new Map();
        }
        
        return true;
    } catch (error) {
        // 로그 개선
        logger.error(`던전 데이터베이스 로드 중 오류: ${error.message}`, null, 'RAID-CALL');
        return false;
    }
}
// 던전 데이터베이스 저장 함수
async function saveDungeonDatabase(log) {
    try {
        // Map을 객체로 변환
        const dungeonData = {};
        for (const [guildId, dungeons] of dungeonDatabase.entries()) {
            dungeonData[guildId] = Object.fromEntries(dungeons);
        }
        
        // 스토리지에 저장
        storage.setAll(DUNGEONS_STORAGE_KEY, dungeonData);
        await storage.save(DUNGEONS_STORAGE_KEY);
        
        // 로그 개선
        logger.info('던전 데이터베이스를 저장했습니다.', null, 'RAID-CALL');
        return true;
    } catch (error) {
        // 로그 개선
        logger.error(`던전 데이터베이스 저장 중 오류: ${error.message}`, null, 'RAID-CALL');
        return false;
    }
}
// 던전 추가 함수
function addDungeon(guildId, dungeonInfo, log) {
    // 서버의 던전 맵 가져오기 또는 생성
    if (!dungeonDatabase.has(guildId)) {
        dungeonDatabase.set(guildId, new Map());
    }
    
    const guildDungeons = dungeonDatabase.get(guildId);
    
    // 고유 ID 생성 (타임스탬프 + 랜덤값)
    const dungeonId = `dungeon_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // 던전 정보에 ID 추가
    dungeonInfo.id = dungeonId;
    dungeonInfo.createdAt = new Date().toISOString();
    
    // 던전 데이터베이스에 추가
    guildDungeons.set(dungeonId, dungeonInfo);
    
    // 저장 - 로거 사용하지 않고 내부 함수 사용
    saveDungeonDatabase();
    
    return dungeonId;
}

// 던전 목록 가져오기 함수 - 변경 없음, 이미 최적화됨
function getDungeonList(guildId) {
    // 서버의 던전 맵 가져오기
    const guildDungeons = dungeonDatabase.get(guildId);
    
    if (!guildDungeons) {
        return [];
    }
    
    // 던전 목록 반환
    return Array.from(guildDungeons.values());
}

// 던전 정보 가져오기 함수 - 변경 없음, 이미 최적화됨
function getDungeon(guildId, dungeonId) {
    // 서버의 던전 맵 가져오기
    const guildDungeons = dungeonDatabase.get(guildId);
    
    if (!guildDungeons) {
        return null;
    }
    
    // 던전 정보 반환
    return guildDungeons.get(dungeonId);
}

// 던전 삭제 함수
function deleteDungeon(guildId, dungeonId) {
    // 서버의 던전 맵 가져오기
    const guildDungeons = dungeonDatabase.get(guildId);
    
    if (!guildDungeons) {
        return false;
    }
    
    // 던전 삭제
    const result = guildDungeons.delete(dungeonId);
    
    if (result) {
        // 저장 - 로거 사용하지 않고 내부 함수 사용
        saveDungeonDatabase();
    }
    
    return result;
}
// 저장된 설정 불러오기 (기존 함수 수정)
async function loadSettings() {
    try {
        // CONFIG_STORAGE_KEY 로드
        try {
            await storage.ensureStorage(CONFIG_STORAGE_KEY, {});
            const configData = storage.getAll(CONFIG_STORAGE_KEY);
            
            if (configData) {
                // Map으로 변환
                guildSettings = new Map(Object.entries(configData));
            }
        } catch (error) {
            logger.warn(`${CONFIG_STORAGE_KEY} 설정 로드 중 오류, 초기화합니다: ${error.message}`, null, 'RAID-CALL');
            storage.setAll(CONFIG_STORAGE_KEY, {});
            await storage.save(CONFIG_STORAGE_KEY);
            guildSettings = new Map();
        }
        
        // RAIDS_STORAGE_KEY 로드
        try {
            await storage.ensureStorage(RAIDS_STORAGE_KEY, {});
            const raidsData = storage.getAll(RAIDS_STORAGE_KEY);
            
            if (raidsData) {
                // Map으로 변환
                activeRaidCalls = new Map();
                
                // 데이터 구조 복원 (중첩된 Map)
                for (const [guildId, raids] of Object.entries(raidsData)) {
                    const guildRaids = new Map();
                    for (const [raidId, raidData] of Object.entries(raids)) {
                        guildRaids.set(raidId, raidData);
                    }
                    activeRaidCalls.set(guildId, guildRaids);
                }
            }
        } catch (error) {
            logger.warn(`${RAIDS_STORAGE_KEY} 설정 로드 중 오류, 초기화합니다: ${error.message}`, null, 'RAID-CALL');
            storage.setAll(RAIDS_STORAGE_KEY, {});
            await storage.save(RAIDS_STORAGE_KEY);
            activeRaidCalls = new Map();
        }
        
        // 던전 데이터베이스 로드
        await loadDungeonDatabase();
        
        logger.info('파티 모집 시스템 설정을 로드했습니다.', null, 'RAID-CALL');
        return true;
    } catch (error) {
        logger.error(`파티 모집 시스템 설정 로드 중 오류: ${error.message}`, null, 'RAID-CALL');
        return false;
    }
}
// 던전 추가 명령어 처리 함수
async function handleDungeonAdd(interaction, client) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        // 입력값 가져오기
        const dungeonName = interaction.options.getString('이름');
        const dungeonDescription = interaction.options.getString('설명') || '추가 설명 없음';
        const thumbnailUrl = interaction.options.getString('썸네일') || null;
        const imageUrl = interaction.options.getString('이미지') || null;
        
        // URL 유효성 검사 함수
        const isValidUrl = (url) => {
            if (!url) return true; // null이나 빈 문자열은 허용
            try {
                new URL(url);
                return url.startsWith('http://') || url.startsWith('https://');
            } catch {
                return false;
            }
        };
        
        // URL 유효성 검사
        if (thumbnailUrl && !isValidUrl(thumbnailUrl)) {
            return await interaction.editReply({ 
                content: '썸네일 URL이 유효하지 않습니다. http:// 또는 https://로 시작하는 URL을 입력해주세요.', 
                ephemeral: true 
            });
        }
        
        if (imageUrl && !isValidUrl(imageUrl)) {
            return await interaction.editReply({ 
                content: '이미지 URL이 유효하지 않습니다. http:// 또는 https://로 시작하는 URL을 입력해주세요.', 
                ephemeral: true 
            });
        }
        
        // 던전 정보 생성
        const dungeonInfo = {
            name: dungeonName,
            description: dungeonDescription,
            thumbnailUrl: thumbnailUrl,
            imageUrl: imageUrl,
            createdBy: interaction.user.id,
            createdAt: new Date().toISOString()
        };
        
        // 던전 추가
        const dungeonId = addDungeon(interaction.guild.id, dungeonInfo);
        
        // 던전 미리보기 임베드 생성
        const previewEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`🏰 ${dungeonName}`)
            .setDescription(dungeonDescription);
        
        // 썸네일 설정 (있는 경우)
        if (thumbnailUrl) {
            previewEmbed.setThumbnail(thumbnailUrl);
        }
        
        // 이미지 설정 (있는 경우)
        if (imageUrl) {
            previewEmbed.setImage(imageUrl);
        }
        
        // 추가 정보 필드
        previewEmbed.addFields(
            { name: '🆔 던전 ID', value: dungeonId, inline: true },
            { name: '👤 등록자', value: `<@${interaction.user.id}>`, inline: true },
            { name: '📅 등록일', value: new Date().toLocaleDateString(), inline: true }
        );
        
        previewEmbed.setFooter({ text: `${interaction.guild.name} • 던전 등록 완료`, iconURL: interaction.guild.iconURL({ dynamic: true }) });
        
        // 성공 메시지 및 미리보기 전송
        await interaction.editReply({
            content: '✅ 던전이 성공적으로 등록되었습니다. 이제 파티 모집 시 던전 목록에서 선택할 수 있습니다.',
            embeds: [previewEmbed],
            ephemeral: true
        });
        
        logger.info(`${interaction.user.tag}님이 새 던전을 등록했습니다: ${dungeonName} (ID: ${dungeonId})`, null, 'RAID-CALL');
        
    } catch (error) {
        logger.error(`던전 추가 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        if (interaction.deferred) {
            await interaction.editReply({ 
                content: `❌ 던전 추가 중 오류가 발생했습니다: ${error.message}`, 
                ephemeral: true 
            }).catch(() => {});
        } else {
            await interaction.reply({ 
                content: `❌ 던전 추가 중 오류가 발생했습니다: ${error.message}`, 
                ephemeral: true 
            }).catch(() => {});
        }
    }
}
// 던전 목록 조회 명령어 처리 함수
async function handleDungeonList(interaction, client) {
    try {
        // 던전 목록 가져오기
        const dungeons = getDungeonList(interaction.guild.id);
        
        if (dungeons.length === 0) {
            return await interaction.reply({
                content: '🔍 등록된 던전이 없습니다. `/던전 추가` 명령어를 사용하여 던전을 등록해주세요.',
                ephemeral: true
            });
        }
        
        // 던전 목록 임베드 생성
        const listEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🏰 등록된 던전/레이드 목록')
            .setDescription('서버에 등록된 던전과 레이드 목록입니다.')
            .setFooter({ text: `${interaction.guild.name} • 총 ${dungeons.length}개 등록됨`, iconURL: interaction.guild.iconURL({ dynamic: true }) });
        
        // 던전 리스트 필드 생성 (최대 25개까지만 표시)
        const displayDungeons = dungeons.slice(0, 25);
        
        displayDungeons.forEach((dungeon, index) => {
            // 여기서 던전 ID를 필드 이름에 포함
            listEmbed.addFields({
                name: `${index + 1}. ${dungeon.name} (ID: ${dungeon.id})`,
                value: `${dungeon.description.length > 100 ? dungeon.description.substring(0, 97) + '...' : dungeon.description}`,
                inline: false
            });
        });
        
        // 던전이 25개 이상인 경우 알림 추가
        if (dungeons.length > 25) {
            listEmbed.addFields({
                name: '⚠️ 알림',
                value: `추가 ${dungeons.length - 25}개의 던전이 있지만 표시 제한으로 인해 보이지 않습니다.`,
                inline: false
            });
        }
        
        await interaction.reply({
            embeds: [listEmbed],
            ephemeral: true
        });
        
    } catch (error) {
        logger.error(`던전 목록 조회 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        await interaction.reply({ 
            content: `❌ 던전 목록 조회 중 오류가 발생했습니다: ${error.message}`, 
            ephemeral: true 
        }).catch(() => {});
    }
}
// 던전 삭제 명령어 처리 함수
async function handleDungeonDelete(interaction, client) {
    try {
        // 던전 ID 가져오기
        const dungeonId = interaction.options.getString('아이디');
        
        // 던전 정보 가져오기
        const dungeonInfo = getDungeon(interaction.guild.id, dungeonId);
        
        if (!dungeonInfo) {
            return await interaction.reply({
                content: '❌ 해당 ID의 던전을 찾을 수 없습니다. `/던전 목록` 명령어로 등록된 던전을 확인해주세요.',
                ephemeral: true
            });
        }
        
        // 권한 체크 (생성자 또는 관리자만 삭제 가능)
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        
        if (dungeonInfo.createdBy !== interaction.user.id && !isAdmin) {
            return await interaction.reply({
                content: '⛔ 해당 던전을 삭제할 권한이 없습니다. 던전 생성자나 서버 관리자만 삭제할 수 있습니다.',
                ephemeral: true
            });
        }
        
        // 삭제 확인 메시지
        const confirmEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('⚠️ 던전 삭제 확인')
            .setDescription(`정말로 **${dungeonInfo.name}** 던전을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)
            .addFields(
                { name: '🆔 던전 ID', value: dungeonId, inline: true },
                { name: '👤 등록자', value: `<@${dungeonInfo.createdBy}>`, inline: true }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) });
        
        // 확인 버튼
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_delete_dungeon:${dungeonId}`)
                    .setLabel('삭제 확인')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`cancel_delete_dungeon:${dungeonId}`)
                    .setLabel('취소')
                    .setStyle(ButtonStyle.Secondary)
            );
        
        await interaction.reply({
            embeds: [confirmEmbed],
            components: [confirmRow],
            ephemeral: true
        });
        
    } catch (error) {
        logger.error(`던전 삭제 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        await interaction.reply({ 
            content: `❌ 던전 삭제 중 오류가 발생했습니다: ${error.message}`, 
            ephemeral: true 
        }).catch(() => {});
    }
}

// 던전 삭제 확인 버튼 처리
async function handleDungeonDeleteConfirm(interaction, dungeonId, client) {
    try {
        // 던전 정보 가져오기
        const dungeonInfo = getDungeon(interaction.guild.id, dungeonId);
        
        if (!dungeonInfo) {
            return await interaction.update({
                content: '❌ 해당 ID의 던전을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.',
                embeds: [],
                components: [],
                ephemeral: true
            });
        }
        
        // 권한 재확인
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        
        if (dungeonInfo.createdBy !== interaction.user.id && !isAdmin) {
            return await interaction.update({
                content: '⛔ 해당 던전을 삭제할 권한이 없습니다. 던전 생성자나 서버 관리자만 삭제할 수 있습니다.',
                embeds: [],
                components: [],
                ephemeral: true
            });
        }
        
        // 던전 삭제
        const result = deleteDungeon(interaction.guild.id, dungeonId);
        
        if (result) {
            await interaction.update({
                content: `✅ **${dungeonInfo.name}** 던전이 성공적으로 삭제되었습니다.`,
                embeds: [],
                components: [],
                ephemeral: true
            });
            
            logger.info(`${interaction.user.tag}님이 던전을 삭제했습니다: ${dungeonInfo.name} (ID: ${dungeonId})`, null, 'RAID-CALL');
        } else {
            await interaction.update({
                content: '❌ 던전 삭제에 실패했습니다. 다시 시도해주세요.',
                embeds: [],
                components: [],
                ephemeral: true
            });
        }
        
    } catch (error) {
        logger.error(`던전 삭제 확인 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        await interaction.update({ 
            content: `❌ 던전 삭제 중 오류가 발생했습니다: ${error.message}`, 
            embeds: [],
            components: [],
            ephemeral: true 
        }).catch(() => {});
    }
}
// 파티 모집 임베드 생성 (이전 레이드콜 임베드를 대체)
async function createPartyRecruitEmbed(interaction, client) {
    try {
        await interaction.deferReply({ ephemeral: true });
        
        const channel = interaction.options.getChannel('채널');
        
        // 채널 권한 확인
        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (!permissions || !permissions.has(PermissionFlagsBits.SendMessages)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription(`${channel} 채널에 메시지를 보낼 권한이 없습니다.`)
                .addFields({ name: '해결 방법', value: '봇에게 필요한 권한을 부여해주세요.', inline: false })
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 서버 설정 가져오기 또는 생성
        let settings = guildSettings.get(interaction.guild.id) || {};
        settings.raidCallChannel = channel.id;
        
        // 설정 저장
        updateGuildSettings(interaction.guild.id, settings);
        
        // 등록된 던전 목록 가져오기
        const dungeons = getDungeonList(interaction.guild.id);
        
        // 파티 모집 임베드 생성
        const partyRecruitEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('👥 파티 모집 시스템')
            .setDescription('아래 드롭다운 메뉴에서 원하는 던전을 선택하거나 직접 모집을 생성하세요.\n파티원을 모집하고 던전 공략을 관리할 수 있습니다.')
            .addFields(
                { 
                    name: '📋 파티 모집 사용 방법', 
                    value: '1️⃣ 아래 메뉴에서 원하는 던전을 선택하거나 직접 생성을 선택합니다.\n2️⃣ 필요한 정보를 입력합니다.\n3️⃣ 생성된 파티 모집에 참가자를 모집합니다.', 
                    inline: false 
                },
                { 
                    name: '✅ 파티 관리 기능', 
                    value: '• 📝 파티 정보 변경\n• 👥 참가자 관리\n• 🔔 파티 알림\n• 🗑️ 파티 취소', 
                    inline: false 
                }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 던전 선택 드롭다운 메뉴 생성
        const selectOptions = [];
        
        // 기본 옵션 (직접 모집 생성)
        selectOptions.push({
            label: '직접 파티 모집 생성',
            description: '등록된 던전 없이 새로운 파티 모집을 생성합니다',
            value: 'create_custom_party',
            emoji: '➕'
        });
        
        // 등록된 던전 옵션 추가
        dungeons.forEach(dungeon => {
            // 25개 제한 (디스코드 제한)
            if (selectOptions.length < 25) {
                selectOptions.push({
                    label: dungeon.name.substring(0, 100), // 라벨 길이 제한
                    description: (dungeon.description || '설명 없음').substring(0, 100), // 설명 길이 제한
                    value: `dungeon:${dungeon.id}`,
                    emoji: '🏰'
                });
            }
        });
        
        // 드롭다운 컴포넌트 생성
        const row = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('party_recruit_select')
                    .setPlaceholder('파티 모집할 던전 선택 또는 직접 생성')
                    .addOptions(selectOptions)
            );
        
        // 채널에 임베드와 드롭다운 전송
        const message = await channel.send({ 
            embeds: [partyRecruitEmbed], 
            components: [row] 
        });
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 파티 모집 시스템 설정 완료')
            .setDescription(`${channel} 채널에 파티 모집 임베드를 성공적으로 생성했습니다.`)
            .addFields({ name: '✨ 다음 단계', value: '이제 사용자들이 파티 모집을 생성할 수 있습니다.', inline: false })
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [successEmbed], ephemeral: true });
        
        logger.info(`${interaction.user.tag}가 ${interaction.guild.name} 서버의 ${channel.name} 채널에 파티 모집 임베드를 생성했습니다.`, null, 'RAID-CALL');
        
    } catch (error) {
        logger.error(`파티 모집 임베드 생성 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        if (interaction.deferred) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 오류 발생')
                .setDescription(`파티 모집 임베드 생성 중 오류가 발생했습니다: ${error.message}`)
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            await interaction.editReply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
        }
    }
}
// 레이드 임베드 생성 함수 추가
async function createRaidEmbed(interaction, client) {
    try {
        const channel = interaction.options.getChannel('채널');
        
        // 채널 권한 확인
        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (!permissions || !permissions.has(PermissionFlagsBits.SendMessages)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription(`${channel} 채널에 메시지를 보낼 권한이 없습니다.`)
                .addFields({ name: '해결 방법', value: '봇에게 필요한 권한을 부여해주세요.', inline: false })
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 레이드 임베드 생성
        const raidEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🗡️ 레이드 파티 모집')
            .setDescription('아래 메뉴에서 참가하려는 레이드를 선택하거나 직접 만들어보세요.')
            .addFields(
                { 
                    name: '📋 파티 모집 방법', 
                    value: '1️⃣ 파티 모집 요청하기 버튼을 클릭합니다.\n2️⃣ 레이드 정보와 요구 조건을 입력합니다.\n3️⃣ 생성된 파티에 참가자를 모집합니다.', 
                    inline: false 
                },
                { 
                    name: '✅ 레이드 참가 방법', 
                    value: '1️⃣ 참가하고 싶은 레이드의 참가 신청 버튼을 클릭합니다.\n2️⃣ 직업과 역할을 선택하여 참가합니다.', 
                    inline: false 
                }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 버튼 생성
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('create_raid_call')
                    .setLabel('파티 모집 요청하기')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🗡️')
            );
        
        // 채널에 임베드와 버튼 전송
        const message = await channel.send({ 
            embeds: [raidEmbed], 
            components: [row] 
        });
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 레이드 임베드 생성 완료')
            .setDescription(`${channel} 채널에 레이드 파티 모집 임베드를 성공적으로 생성했습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        logger.info(`${interaction.user.tag}가 ${interaction.guild.name} 서버의 ${channel.name} 채널에 레이드 임베드를 생성했습니다.`, null, 'RAID-CALL');
        
    } catch (error) {
        logger.error(`레이드 임베드 생성 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`레이드 임베드 생성 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}
// 모듈 초기화 함수
async function init(client) {
    // 스토리지 초기화 확인
    if (!storage.initialized) {
        await storage.init();
    }
    
    // 저장된 설정 불러오기
    await loadSettings();
    
    // 버튼 상호작용 처리
    client.on('interactionCreate', async (interaction) => {
        try {
            // 버튼 상호작용
            if (interaction.isButton()) {
                const customId = interaction.customId;
                
                if (customId.startsWith('confirm_cancel:')) {
                    const partyId = customId.split(':')[1];
                    await confirmPartyCancel(interaction, partyId, client);
                }
                else if (customId.startsWith('cancel_cancel:')) {
                    // 취소 취소 (돌아가기)
                    await interaction.update({ content: '파티 취소가 취소되었습니다.', embeds: [], components: [] });
                }
                else if (customId.startsWith('cancel_participation:')) {
                    // 참가 취소 처리
                    const partyId = customId.split(':')[1];
                    await handleCancelParticipation(interaction, partyId, client);
                }
                else if (customId.startsWith('confirm_delete_dungeon:')) {
                    // 던전 삭제 확인
                    const dungeonId = customId.split(':')[1];
                    await handleDungeonDeleteConfirm(interaction, dungeonId, client);
                }
                else if (customId.startsWith('cancel_delete_dungeon:')) {
                    // 던전 삭제 취소
                    await interaction.update({ content: '던전 삭제가 취소되었습니다.', embeds: [], components: [] });
                }
            }
            // 모달 제출 처리
            else if (interaction.isModalSubmit()) {
                const modalId = interaction.customId;
                
                if (modalId === 'party_create_custom' || modalId.startsWith('party_create_dungeon:')) {
                    await handlePartyCreation(interaction, client);
                }
                else if (modalId.startsWith('edit_party_field:')) {
                    // 파티 필드 수정 처리
                    const [_, field, partyId] = modalId.split(':');
                    await handlePartyFieldEdit(interaction, field, partyId, client);
                }
            }
            // 선택 메뉴 처리
            else if (interaction.isStringSelectMenu()) {
                const customId = interaction.customId;
                
                if (customId === 'party_recruit_select') {
                    await handlePartySelectMenu(interaction, client);
                }
                else if (customId.startsWith('party_control:')) {
                    const selectedValue = interaction.values[0];
                    
                    if (selectedValue.startsWith('edit_party:')) {
                        const partyId = selectedValue.split(':')[1];
                        await showEditPartyMenu(interaction, partyId, client);
                    }
                    else if (selectedValue.startsWith('join_party:')) {
                        const partyId = selectedValue.split(':')[1];
                        await showClassSelectionMenu(interaction, partyId, client);
                    }
                    else if (selectedValue.startsWith('cancel_party:')) {
                        const partyId = selectedValue.split(':')[1];
                        await handlePartyCancel(interaction, partyId, client);
                    }
                }
                else if (customId.startsWith('edit_field:')) {
                    // 필드 선택 처리
                    await handleEditFieldSelection(interaction, client);
                }
                else if (customId.startsWith('class_selection:')) {
                    // 직업 선택 처리
                    const partyId = customId.split(':')[1];
                    const classValue = interaction.values[0];
                    const classType = classValue.split(':')[0].replace('class_', '');
                    
                    // 직업 이름 매핑
                    const classNameMap = {
                        'elemental_knight': '엘레멘탈 나이트',
                        'saint_bard': '세인트 바드',
                        'alchemic_stinger': '알케믹 스팅어',
                        'dark_mage': '다크 메이지',
                        'sacred_guard': '세이크리드 가드',
                        'blast_lancer': '블래스트 랜서'
                    };
                    
                    await handleClassSelection(interaction, partyId, classNameMap[classType] || classType, client);
                }
            }
        } catch (error) {
            logger.error(`파티 모집 상호작용 처리 중 오류 발생: ${error.message}\n${error.stack}`, null, 'RAID-CALL');
            
            try {
                if (!interaction.replied && !interaction.deferred) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('❌ 오류 발생')
                        .setDescription('요청을 처리하는 중 오류가 발생했습니다.')
                        .setFooter({ text: '다시 시도해주세요.', iconURL: interaction.guild?.iconURL({ dynamic: true }) })
                        .setTimestamp();
                        
                    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }
            } catch (replyError) {
                // 응답 오류 무시
            }
        }
    });
    
    logger.module('파티 모집 시스템 모듈이 초기화되었습니다.');
}
// 설정 저장하기
async function saveSettings() {
    try {
        // Map을 객체로 변환
        const configData = Object.fromEntries(guildSettings);
        
        // 스토리지에 저장
        storage.setAll(CONFIG_STORAGE_KEY, configData);
        await storage.save(CONFIG_STORAGE_KEY);
        
        // 활성화된 파티 모집 저장
        const raidsData = {};
        for (const [guildId, parties] of activeRaidCalls.entries()) {
            raidsData[guildId] = Object.fromEntries(parties);
        }
        
        storage.setAll(RAIDS_STORAGE_KEY, raidsData);
        await storage.save(RAIDS_STORAGE_KEY);
        
        // 던전 데이터베이스 저장
        await saveDungeonDatabase();
        
        logger.info('파티 모집 시스템 설정을 저장했습니다.', null, 'RAID-CALL');
        return true;
    } catch (error) {
        logger.error(`파티 모집 시스템 설정 저장 중 오류: ${error.message}`, null, 'RAID-CALL');
        return false;
    }
}

// 서버 설정 업데이트
function updateGuildSettings(guildId, settings) {
    guildSettings.set(guildId, settings);
    saveSettings();
}

// 활성화된 파티 모집 업데이트
function updateRaidCall(guildId, partyId, partyData) {
    if (!activeRaidCalls.has(guildId)) {
        activeRaidCalls.set(guildId, new Map());
    }
    
    const guildRaids = activeRaidCalls.get(guildId);
    guildRaids.set(partyId, partyData);
    
    saveSettings();
}

// 파티 삭제
function deleteRaidCall(guildId, partyId) {
    if (!activeRaidCalls.has(guildId)) return false;
    
    const guildRaids = activeRaidCalls.get(guildId);
    const result = guildRaids.delete(partyId);
    
    if (result) {
        saveSettings();
    }
    
    return result;
}
// executeSlashCommand 함수 수정
async function executeSlashCommand(interaction, client) {
    const { commandName, options } = interaction;
    
    if (commandName === '레이드알람채널') {
        await setAlarmChannel(interaction, client);
    }
    else if (commandName === '파티모집채널') {
        await createPartyRecruitEmbed(interaction, client);
    }
    // 레이드 임베드 명령어 처리 추가
    else if (commandName === '레이드') {
        const subcommand = options.getSubcommand();
        
        if (subcommand === '임베드') {
            await createRaidEmbed(interaction, client);
        }
    }
    // 던전 관련 명령어 처리
    else if (commandName === '던전') {
        const subcommand = options.getSubcommand();
        
        if (subcommand === '추가') {
            await handleDungeonAdd(interaction, client);
        }
        else if (subcommand === '목록') {
            await handleDungeonList(interaction, client);
        }
        else if (subcommand === '삭제') {
            await handleDungeonDelete(interaction, client);
        }
    }
}
module.exports = {
    name: 'party-recruit',
    description: '파티 모집 시스템 모듈',
    version: '2.0.0',
    commands: [],
    enabled: true,
    init,
    executeSlashCommand,
    slashCommands  // 이제 위에서 정의된 변수를 참조
};
// 알람 채널 설정 함수
async function setAlarmChannel(interaction, client) {
    try {
        const channel = interaction.options.getChannel('채널');
        
        // 채널 권한 확인
        const permissions = channel.permissionsFor(interaction.guild.members.me);
        if (!permissions || !permissions.has(PermissionFlagsBits.SendMessages)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription(`${channel} 채널에 메시지를 보낼 권한이 없습니다.`)
                .addFields({ name: '해결 방법', value: '봇에게 필요한 권한을 부여해주세요.', inline: false })
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 서버 설정 가져오기 또는 생성
        let settings = guildSettings.get(interaction.guild.id) || {};
        settings.alarmChannel = channel.id;
        
        // 설정 저장
        updateGuildSettings(interaction.guild.id, settings);
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 파티 알람 채널 설정 완료')
            .setDescription(`파티 알람 채널이 ${channel}(으)로 설정되었습니다.`)
            .addFields({ name: '✨ 다음 단계', value: '이제 파티 모집이 생성될 때 이 채널에 알림이 전송됩니다.', inline: false })
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        logger.info(`${interaction.user.tag}가 ${interaction.guild.name} 서버의 파티 알람 채널을 ${channel.name}으로 설정했습니다.`, null, 'RAID-CALL');
        
    } catch (error) {
        logger.error(`파티 알람 채널 설정 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`파티 알람 채널 설정 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}
// 드롭다운 메뉴 선택 처리 함수
async function handlePartySelectMenu(interaction, client) {
    try {
        const selectedValue = interaction.values[0];
        
        if (selectedValue === 'create_custom_party') {
            // 직접 파티 모집 생성하는 경우 - 모달 표시
            await showPartyCreateModal(interaction, null, client);
        } else if (selectedValue.startsWith('dungeon:')) {
            // 등록된 던전으로 파티 모집하는 경우
            const dungeonId = selectedValue.split(':')[1];
            const dungeonInfo = getDungeon(interaction.guild.id, dungeonId);
            
            if (!dungeonInfo) {
                return await interaction.reply({
                    content: '❌ 선택한 던전을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.',
                    ephemeral: true
                });
            }
            
            // 등록된 던전 정보로 모달 표시
            await showPartyCreateModal(interaction, dungeonInfo, client);
        }
    } catch (error) {
        logger.error(`파티 드롭다운 선택 처리 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        await interaction.reply({ 
            content: `❌ 파티 모집 처리 중 오류가 발생했습니다: ${error.message}`, 
            ephemeral: true 
        }).catch(() => {});
    }
}
// 파티 모집 생성 모달 표시 (던전 정보가 있으면 미리 채움)
async function showPartyCreateModal(interaction, dungeonInfo, client) {
    try {
        // 모달 생성
        const modal = new ModalBuilder()
            .setCustomId(dungeonInfo ? `party_create_dungeon:${dungeonInfo.id}` : 'party_create_custom')
            .setTitle(dungeonInfo ? `${dungeonInfo.name} 파티 모집` : '파티 모집 생성');
        
        // 텍스트 입력 필드 추가
        const dungeonNameInput = new TextInputBuilder()
            .setCustomId('dungeon_name')
            .setLabel('던전/레이드 이름')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('예: 아포칼립스, 카오스, 발할라 등')
            .setRequired(true);
            
        // 등록된 던전인 경우 던전 이름 미리 채우기
        if (dungeonInfo) {
            dungeonNameInput.setValue(dungeonInfo.name);
        }
        
        const dateInput = new TextInputBuilder()
            .setCustomId('date')
            .setLabel('날짜')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('YYYY-MM-DD 형식 (예: 2023-12-25)')
            .setRequired(true);
        
        const timeInput = new TextInputBuilder()
            .setCustomId('time')
            .setLabel('시간')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('HH:MM 형식 (예: 19:30)')
            .setRequired(true);
        
        const requiredLevelInput = new TextInputBuilder()
            .setCustomId('required_level')
            .setLabel('요구 레벨/장비')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('예: 레벨 60 이상, 아이템 레벨 900+ 등')
            .setRequired(true);
        
        const descriptionInput = new TextInputBuilder()
            .setCustomId('description')
            .setLabel('설명 (선택 사항)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('추가 설명, 참여 요건, 파티 구성 등을 적어주세요.')
            .setRequired(false);
            
        // 등록된 던전인 경우 설명 미리 채우기
        if (dungeonInfo && dungeonInfo.description) {
            descriptionInput.setValue(dungeonInfo.description);
        }
        
        // 액션 로우에 텍스트 입력 필드 추가
        const firstActionRow = new ActionRowBuilder().addComponents(dungeonNameInput);
        const secondActionRow = new ActionRowBuilder().addComponents(dateInput);
        const thirdActionRow = new ActionRowBuilder().addComponents(timeInput);
        const fourthActionRow = new ActionRowBuilder().addComponents(requiredLevelInput);
        const fifthActionRow = new ActionRowBuilder().addComponents(descriptionInput);
        
        // 모달에 액션 로우 추가
        modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow, fifthActionRow);
        
        // 모달 표시
        await interaction.showModal(modal);
        
        logger.info(`${interaction.user.tag}님에게 파티 모집 생성 모달을 표시했습니다.${dungeonInfo ? ` (던전: ${dungeonInfo.name})` : ''}`, null, 'RAID-CALL');
    } catch (error) {
        logger.error(`파티 모집 모달 표시 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
    }
}
// 파티 모집 처리 함수 (모달 제출 처리)
async function handlePartyCreation(interaction, client) {
    try {
        // 서버 설정 확인
        const guildId = interaction.guild.id;
        const settings = guildSettings.get(guildId);
        
        if (!settings || !settings.alarmChannel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 설정 오류')
                .setDescription('파티 모집 알람 채널이 설정되지 않았습니다.')
                .addFields({ name: '해결 방법', value: '관리자에게 문의하여 `/레이드알람채널` 명령어로 채널을 설정해달라고 요청하세요.', inline: false })
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 등록된 던전 정보 가져오기 (있는 경우)
        let dungeonInfo = null;
        if (interaction.customId.startsWith('party_create_dungeon:')) {
            const dungeonId = interaction.customId.split(':')[1];
            dungeonInfo = getDungeon(guildId, dungeonId);
        }
        
        // 입력값 가져오기
        const dungeonName = interaction.fields.getTextInputValue('dungeon_name');
        const date = interaction.fields.getTextInputValue('date');
        const time = interaction.fields.getTextInputValue('time');
        const requiredLevel = interaction.fields.getTextInputValue('required_level');
        const description = interaction.fields.getTextInputValue('description') || '추가 설명 없음';
        
        // 유효성 검사
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const timeRegex = /^\d{2}:\d{2}$/;
        
        if (!dateRegex.test(date)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 입력 오류')
                .setDescription('날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해주세요.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        if (!timeRegex.test(time)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 입력 오류')
                .setDescription('시간 형식이 올바르지 않습니다. HH:MM 형식으로 입력해주세요.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 파티 고유 ID 생성
        const partyId = Date.now().toString();
        
        // 파티 데이터 생성
        const partyData = {
            id: partyId,
            dungeonName,
            date,
            time,
            requiredLevel,
            description,
            createdBy: interaction.user.id,
            createdAt: new Date().toISOString(),
            participants: [], // 참가자 배열
            dungeonId: dungeonInfo ? dungeonInfo.id : null, // 등록된 던전 정보 저장
            thumbnailUrl: dungeonInfo ? dungeonInfo.thumbnailUrl : null,
            imageUrl: dungeonInfo ? dungeonInfo.imageUrl : null
        };
        
        // 파티 데이터 저장
        updateRaidCall(guildId, partyId, partyData);
        
        // 파티 모집 임베드 생성 (등록된 던전 정보 활용)
        const partyEmbed = createPartyEmbed(partyData, interaction.user, interaction.guild, dungeonInfo);
        
        // 컨트롤 메뉴 생성
        const controlRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`party_control:${partyId}`)
                    .setPlaceholder('파티 관리 메뉴')
                    .addOptions([
                        {
                            label: '파티 정보 변경',
                            description: '파티 정보를 수정합니다',
                            value: `edit_party:${partyId}`,
                            emoji: '📝'
                        },
                        {
                            label: '참가 신청',
                            description: '파티에 참가 신청합니다',
                            value: `join_party:${partyId}`,
                            emoji: '✅'
                        },
                        {
                            label: '파티 취소',
                            description: '파티를 취소합니다',
                            value: `cancel_party:${partyId}`,
                            emoji: '🗑️'
                        }
                    ])
            );
        
        // 알람 채널에 파티 모집 임베드 전송
        const alarmChannel = interaction.guild.channels.cache.get(settings.alarmChannel);
        if (!alarmChannel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 채널 오류')
                .setDescription('파티 알람 채널을 찾을 수 없습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const message = await alarmChannel.send({
            content: '@everyone 새로운 파티 모집이 생성되었습니다!',
            embeds: [partyEmbed],
            components: [controlRow]
        });
        
        // 메시지 ID 저장
        partyData.messageId = message.id;
        updateRaidCall(guildId, partyId, partyData);
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 파티 모집 생성 완료')
            .setDescription(`파티 모집이 성공적으로 생성되었습니다.\n[메시지로 이동](${message.url})`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        logger.info(`${interaction.user.tag}님이 '${dungeonName}' 파티 모집을 생성했습니다.`, null, 'RAID-CALL');
        
    } catch (error) {
        logger.error(`파티 모집 생성 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`파티 모집 생성 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}
// 파티 임베드 생성 함수 (던전 정보 활용)
function createPartyEmbed(partyData, user, guild, dungeonInfo = null) {
    // 참가자 정보 구성
    let participantsField = '아직 참가자가 없습니다.';
    
    if (partyData.participants && partyData.participants.length > 0) {
        participantsField = partyData.participants.map((p, index) => 
            `${index + 1}. <@${p.userId}> - ${p.class || '직업 미설정'}`
        ).join('\n');
    }
    
    // 임베드 생성
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`👥 ${partyData.dungeonName} 파티 모집`)
        .setDescription(`📅**${partyData.date} ${partyData.time}**에 진행되는 파티입니다.`);
    
    // 던전 정보가 있으면 추가 설명 포함
    if (dungeonInfo && dungeonInfo.description) {
        embed.setDescription(`📅**${partyData.date} ${partyData.time}**에 진행되는 파티입니다.\n\n${dungeonInfo.description}`);
    }
    
    // 썸네일 설정 (던전 정보에서 가져옴)
    if (partyData.thumbnailUrl) {
        embed.setThumbnail(partyData.thumbnailUrl);
    }
    
    // 이미지 설정 (던전 정보에서 가져옴)
    if (partyData.imageUrl) {
        embed.setImage(partyData.imageUrl);
    }
    
    // 필드 추가
    embed.addFields(
        { name: '⚔️ 던전/레이드', value: partyData.dungeonName, inline: true },
        { name: '⚙️ 요구 사항', value: partyData.requiredLevel, inline: true },
        { name: '📝 상세 설명', value: partyData.description, inline: false },
        { name: '👥 참가자 목록', value: participantsField, inline: false }
    );
    
    embed.setFooter({ text: `생성자: ${user.tag}`, iconURL: user.displayAvatarURL({ dynamic: true }) });
    embed.setTimestamp(new Date(partyData.createdAt));
    
    return embed;
}
// 직업 선택 메뉴 표시 (모달 대신 스크롤 박스로 변경) - 직업명 수정
async function showClassSelectionMenu(interaction, partyId, client) {
    try {
        const guildId = interaction.guild.id;
        
        // 파티 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(partyId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 파티 찾기 오류')
                .setDescription('파티 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 파티일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const partyData = guildRaids.get(partyId);
        
        // 사용자가 이미 참가 중인지 확인
        const isParticipating = partyData.participants.some(p => p.userId === interaction.user.id);
        
        // 직업 목록 (요청한 직업명으로 수정)
        const classOptions = [
            {
                label: '엘레멘탈 나이트',
                description: '근접 딜러',
                value: `class_elemental_knight:${partyId}`,
                emoji: '⚔️'
            },
            {
                label: '세인트 바드',
                description: '힐러/서포터',
                value: `class_saint_bard:${partyId}`,
                emoji: '🎵'
            },
            {
                label: '알케믹 스팅어',
                description: '원거리 딜러',
                value: `class_alchemic_stinger:${partyId}`,
                emoji: '🧪'
            },
            {
                label: '다크 메이지',
                description: '마법 딜러',
                value: `class_dark_mage:${partyId}`,
                emoji: '🔮'
            },
            {
                label: '세이크리드 가드',
                description: '탱커',
                value: `class_sacred_guard:${partyId}`,
                emoji: '🛡️'
            },
            {
                label: '블래스트 랜서',
                description: '범위 딜러',
                value: `class_blast_lancer:${partyId}`,
                emoji: '🏹'
            }
        ];
        
        // 버튼 및 선택 메뉴 생성
        const components = [];
        
        // 선택 메뉴 생성
        const classSelectionRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`class_selection:${partyId}`)
                    .setPlaceholder('참가할 직업을 선택하세요')
                    .addOptions(classOptions)
            );
        
        components.push(classSelectionRow);
        
        // 이미 참가 중인 경우 참가 취소 버튼 추가
        if (isParticipating) {
            const cancelButtonRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`cancel_participation:${partyId}`)
                        .setLabel('참가 취소')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❌')
                );
            
            components.push(cancelButtonRow);
        }
        
        // 던전 정보 가져오기 (등록된 던전인 경우)
        let dungeonInfo = null;
        if (partyData.dungeonId) {
            dungeonInfo = getDungeon(guildId, partyData.dungeonId);
        }
        
        // 설명 임베드
        const selectionEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🧙‍♂️ 파티 참가 직업 선택')
            .setDescription(`**${partyData.dungeonName}** 파티에 참가할 직업을 선택해주세요.`)
            .addFields(
                { name: '📅 파티 일시', value: `${partyData.date} ${partyData.time}`, inline: true },
                { name: '⚙️ 요구 사항', value: partyData.requiredLevel, inline: true }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 던전 정보가 있으면 썸네일 추가
        if (dungeonInfo && dungeonInfo.thumbnailUrl) {
            selectionEmbed.setThumbnail(dungeonInfo.thumbnailUrl);
        }
        
        await interaction.reply({ 
            embeds: [selectionEmbed], 
            components: components,
            ephemeral: true 
        });
        
        logger.info(`${interaction.user.tag}님에게 직업 선택 메뉴를 표시했습니다. 파티 ID: ${partyId}`, null, 'RAID-CALL');
    } catch (error) {
        logger.error(`직업 선택 메뉴 표시 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`직업 선택 메뉴 표시 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}
// 직업 선택 처리 - 직업명 매핑 수정
async function handleClassSelection(interaction, partyId, className, client) {
    try {
        const guildId = interaction.guild.id;
        
        // 파티 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(partyId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 파티 찾기 오류')
                .setDescription('파티 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 파티일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.update({ embeds: [errorEmbed], components: [] });
        }
        
        const partyData = guildRaids.get(partyId);
        
        // 이미 참가 중인지 확인
        const participantIndex = partyData.participants.findIndex(p => p.userId === interaction.user.id);
        
        if (participantIndex !== -1) {
            // 이미 참가 중이면 직업 업데이트
            partyData.participants[participantIndex].class = className;
        } else {
            // 새로운 참가자 추가
            partyData.participants.push({
                userId: interaction.user.id,
                class: className,
                joinedAt: new Date().toISOString()
            });
        }
        
        // 데이터 업데이트
        updateRaidCall(guildId, partyId, partyData);
        
        try {
            // 알람 채널에서 메시지 찾기
            const settings = guildSettings.get(guildId);
            const alarmChannel = interaction.guild.channels.cache.get(settings.alarmChannel);
            
            if (alarmChannel && partyData.messageId) {
                const message = await alarmChannel.messages.fetch(partyData.messageId).catch(() => null);
                if (message) {
                    // 던전 정보 가져오기 (등록된 던전인 경우)
                    let dungeonInfo = null;
                    if (partyData.dungeonId) {
                        dungeonInfo = getDungeon(guildId, partyData.dungeonId);
                    }
                    
                    // 임베드 업데이트
                    const partyEmbed = createPartyEmbed(partyData, await client.users.fetch(partyData.createdBy), interaction.guild, dungeonInfo);
                    
                    await message.edit({
                        embeds: [partyEmbed]
                    });
                }
            }
        } catch (err) {
            logger.error(`파티 메시지 업데이트 중 오류 발생: ${err.message}`, null, 'RAID-CALL');
        }
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 파티 참가 완료')
            .setDescription(`**${partyData.dungeonName}** 파티에 **${className}** 직업으로 참가 신청되었습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.update({ embeds: [successEmbed], components: [] });
        
        logger.info(`${interaction.user.tag}님이 '${partyData.dungeonName}' 파티에 '${className}' 직업으로 참가했습니다.`, null, 'RAID-CALL');
        
    } catch (error) {
        logger.error(`파티 참가 처리 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`파티 참가 처리 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.update({ embeds: [errorEmbed], components: [] }).catch(() => {});
    }
}
// 참가 취소 처리 함수
async function handleCancelParticipation(interaction, partyId, client) {
    try {
        const guildId = interaction.guild.id;
        
        // 파티 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(partyId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 파티 찾기 오류')
                .setDescription('파티 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 파티일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const partyData = guildRaids.get(partyId);
        
        // 참가자 목록에서 제거
        const participantIndex = partyData.participants.findIndex(p => p.userId === interaction.user.id);
        
        if (participantIndex === -1) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setTitle('⚠️ 참가 정보 없음')
                .setDescription('이 파티에 참가 신청하지 않았습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 참가 취소 처리
        partyData.participants.splice(participantIndex, 1);
        
        // 데이터 업데이트
        updateRaidCall(guildId, partyId, partyData);
        
        try {
            // 알람 채널에서 메시지 찾기
            const settings = guildSettings.get(guildId);
            const alarmChannel = interaction.guild.channels.cache.get(settings.alarmChannel);
            
            if (alarmChannel && partyData.messageId) {
                const message = await alarmChannel.messages.fetch(partyData.messageId).catch(() => null);
                if (message) {
                    // 던전 정보 가져오기 (등록된 던전인 경우)
                    let dungeonInfo = null;
                    if (partyData.dungeonId) {
                        dungeonInfo = getDungeon(guildId, partyData.dungeonId);
                    }
                    
                    // 임베드 업데이트
                    const partyEmbed = createPartyEmbed(partyData, await client.users.fetch(partyData.createdBy), interaction.guild, dungeonInfo);
                    
                    await message.edit({
                        embeds: [partyEmbed]
                    });
                }
            }
        } catch (err) {
            logger.error(`파티 메시지 업데이트 중 오류 발생: ${err.message}`, null, 'RAID-CALL');
        }
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 파티 참가 취소 완료')
            .setDescription(`**${partyData.dungeonName}** 파티 참가가 취소되었습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        logger.info(`${interaction.user.tag}님이 '${partyData.dungeonName}' 파티 참가를 취소했습니다.`, null, 'RAID-CALL');
        
    } catch (error) {
        logger.error(`파티 참가 취소 처리 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`파티 참가 취소 처리 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}
// 파티 정보 수정 메뉴 표시 함수
async function showEditPartyMenu(interaction, partyId, client) {
    try {
        const guildId = interaction.guild.id;
        
        // 파티 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(partyId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 파티 찾기 오류')
                .setDescription('파티 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 파티일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const partyData = guildRaids.get(partyId);
        
        // 파티 생성자만 수정 가능
        if (partyData.createdBy !== interaction.user.id) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription('파티 생성자만 정보를 수정할 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 던전 정보 가져오기 (등록된 던전인 경우)
        let dungeonInfo = null;
        if (partyData.dungeonId) {
            dungeonInfo = getDungeon(guildId, partyData.dungeonId);
        }
        
        // 수정할 항목 선택 메뉴
        const editRow = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`edit_field:${partyId}`)
                    .setPlaceholder('수정할 항목 선택')
                    .addOptions([
                        {
                            label: '던전/레이드 이름',
                            description: '던전 또는 레이드 이름을 변경합니다',
                            value: `edit:dungeon:${partyId}`,
                            emoji: '🏰'
                        },
                        {
                            label: '날짜',
                            description: '파티 날짜를 변경합니다',
                            value: `edit:date:${partyId}`,
                            emoji: '📅'
                        },
                        {
                            label: '시간',
                            description: '파티 시간을 변경합니다',
                            value: `edit:time:${partyId}`,
                            emoji: '⏰'
                        },
                        {
                            label: '요구 레벨/장비',
                            description: '참여 요구 사항을 변경합니다',
                            value: `edit:level:${partyId}`,
                            emoji: '⚙️'
                        },
                        {
                            label: '설명',
                            description: '상세 설명을 변경합니다',
                            value: `edit:description:${partyId}`,
                            emoji: '📝'
                        }
                    ])
            );
        
        // 임베드로 변경
        const editMenuEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📝 파티 정보 수정')
            .setDescription(`**${partyData.dungeonName}** 파티의 수정할 항목을 선택하세요.`)
            .addFields(
                { name: '현재 정보', value: 
                    `📅 날짜: ${partyData.date}\n` +
                    `⏰ 시간: ${partyData.time}\n` +
                    `⚙️ 요구 사항: ${partyData.requiredLevel}\n`
                }
            )
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 썸네일 설정 (던전 정보에서 가져옴)
        if (partyData.thumbnailUrl) {
            editMenuEmbed.setThumbnail(partyData.thumbnailUrl);
        }
        
        await interaction.reply({
            embeds: [editMenuEmbed],
            components: [editRow],
            ephemeral: true
        });
        
        logger.info(`${interaction.user.tag}님이 파티 ID: ${partyId} 의 정보 수정 메뉴를 열었습니다.`, null, 'RAID-CALL');
        
    } catch (error) {
        logger.error(`파티 정보 수정 메뉴 표시 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`파티 정보 수정 메뉴 표시 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}
// 특정 필드 수정 모달 표시
async function showEditFieldModal(interaction, field, partyId, client) {
    try {
        const guildId = interaction.guild.id;
        
        // 파티 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(partyId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 파티 찾기 오류')
                .setDescription('파티 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 파티일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const partyData = guildRaids.get(partyId);
        
        // 모달 생성
        const modal = new ModalBuilder()
            .setCustomId(`edit_party_field:${field}:${partyId}`)
            .setTitle('파티 정보 수정');
        
        // 필드별 모달 구성
        let fieldInput;
        
        switch (field) {
            case 'dungeon':
                fieldInput = new TextInputBuilder()
                    .setCustomId('field_value')
                    .setLabel('던전/레이드 이름')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('새 던전/레이드 이름을 입력하세요')
                    .setValue(partyData.dungeonName)
                    .setRequired(true);
                break;
                
            case 'date':
                fieldInput = new TextInputBuilder()
                    .setCustomId('field_value')
                    .setLabel('날짜')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('YYYY-MM-DD 형식 (예: 2023-12-25)')
                    .setValue(partyData.date)
                    .setRequired(true);
                break;
                
            case 'time':
                fieldInput = new TextInputBuilder()
                    .setCustomId('field_value')
                    .setLabel('시간')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('HH:MM 형식 (예: 19:30)')
                    .setValue(partyData.time)
                    .setRequired(true);
                break;
                
            case 'level':
                fieldInput = new TextInputBuilder()
                    .setCustomId('field_value')
                    .setLabel('요구 레벨/장비')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('예: 레벨 60 이상, 아이템 레벨 900+ 등')
                    .setValue(partyData.requiredLevel)
                    .setRequired(true);
                break;
                
            case 'description':
                fieldInput = new TextInputBuilder()
                    .setCustomId('field_value')
                    .setLabel('설명')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('추가 설명, 참여 요건, 파티 구성 등을 적어주세요.')
                    .setValue(partyData.description)
                    .setRequired(false);
                break;
        }
        
        // 모달에 입력 필드 추가
        const actionRow = new ActionRowBuilder().addComponents(fieldInput);
        modal.addComponents(actionRow);
        
        // 모달 표시
        await interaction.showModal(modal);
        
        logger.info(`${interaction.user.tag}님에게 파티 ${field} 필드 수정 모달을 표시했습니다.`, null, 'RAID-CALL');
    } catch (error) {
        logger.error(`필드 수정 모달 표시 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`필드 수정 모달 표시 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}
// 필드 수정 선택 처리 (스크롤 박스에서 선택된 항목 처리)
async function handleEditFieldSelection(interaction, client) {
    try {
        const selectedValue = interaction.values[0];
        const [action, field, partyId] = selectedValue.split(':');
        
        if (action === 'edit') {
            await showEditFieldModal(interaction, field, partyId, client);
        }
    } catch (error) {
        logger.error(`필드 수정 선택 처리 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`필드 수정 선택 처리 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}
// 파티 정보 수정 처리
async function handlePartyFieldEdit(interaction, field, partyId, client) {
    try {
        const guildId = interaction.guild.id;
        
        // 파티 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(partyId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 파티 찾기 오류')
                .setDescription('파티 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 파티일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const partyData = guildRaids.get(partyId);
        
        // 파티 생성자만 수정 가능
        if (partyData.createdBy !== interaction.user.id) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription('파티 생성자만 정보를 수정할 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 입력값 가져오기
        const newValue = interaction.fields.getTextInputValue('field_value');
        
        // 필드별 유효성 검사 및 업데이트
        switch (field) {
            case 'dungeon':
                partyData.dungeonName = newValue;
                break;
                
            case 'date':
                // 날짜 형식 검사
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                if (!dateRegex.test(newValue)) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('❌ 입력 오류')
                        .setDescription('날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해주세요.')
                        .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                        .setTimestamp();
                        
                    return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }
                partyData.date = newValue;
                break;
                
            case 'time':
                // 시간 형식 검사
                const timeRegex = /^\d{2}:\d{2}$/;
                if (!timeRegex.test(newValue)) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#ED4245')
                        .setTitle('❌ 입력 오류')
                        .setDescription('시간 형식이 올바르지 않습니다. HH:MM 형식으로 입력해주세요.')
                        .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                        .setTimestamp();
                        
                    return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }
                partyData.time = newValue;
                break;
                
            case 'level':
                partyData.requiredLevel = newValue;
                break;
                
            case 'description':
                partyData.description = newValue || '추가 설명 없음';
                break;
        }
        
        // 데이터 업데이트
        updateRaidCall(guildId, partyId, partyData);
        
        try {
            // 알람 채널에서 메시지 찾기
            const settings = guildSettings.get(guildId);
            const alarmChannel = interaction.guild.channels.cache.get(settings.alarmChannel);
            
            if (alarmChannel && partyData.messageId) {
                const message = await alarmChannel.messages.fetch(partyData.messageId).catch(() => null);
                if (message) {
                    // 던전 정보 가져오기 (등록된 던전인 경우)
                    let dungeonInfo = null;
                    if (partyData.dungeonId) {
                        dungeonInfo = getDungeon(guildId, partyData.dungeonId);
                    }
                    
                    // 임베드 업데이트
                    const partyEmbed = createPartyEmbed(partyData, await client.users.fetch(partyData.createdBy), interaction.guild, dungeonInfo);
                    
                    await message.edit({
                        embeds: [partyEmbed]
                    });
                }
            }
        } catch (err) {
            logger.error(`파티 메시지 업데이트 중 오류 발생: ${err.message}`, null, 'RAID-CALL');
        }
        
        // 성공 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 파티 정보 수정 완료')
            .setDescription(`**${partyData.dungeonName}** 파티의 ${getFieldDisplayName(field)}이(가) 성공적으로 수정되었습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [successEmbed], ephemeral: true });
        
        logger.info(`${interaction.user.tag}님이 '${partyData.dungeonName}' 파티의 ${field} 필드를 수정했습니다.`, null, 'RAID-CALL');
        
    } catch (error) {
        logger.error(`파티 정보 수정 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`파티 정보 수정 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}

// 필드 이름 표시용 함수 - 변경 없음
function getFieldDisplayName(field) {
    switch (field) {
        case 'dungeon': return '던전/레이드 이름';
        case 'date': return '날짜';
        case 'time': return '시간';
        case 'level': return '요구 레벨/장비';
        case 'description': return '설명';
        default: return field;
    }
}
// 파티 취소 처리
async function handlePartyCancel(interaction, partyId, client) {
    try {
        const guildId = interaction.guild.id;
        
        // 파티 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(partyId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 파티 찾기 오류')
                .setDescription('파티 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 파티일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        const partyData = guildRaids.get(partyId);
        
        // 파티 생성자만 취소 가능
        if (partyData.createdBy !== interaction.user.id) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription('파티 생성자만 파티를 취소할 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
        
        // 취소 확인 버튼
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_cancel:${partyId}`)
                    .setLabel('파티 취소 확인')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️'),
                new ButtonBuilder()
                    .setCustomId(`cancel_cancel:${partyId}`)
                    .setLabel('돌아가기')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('↩️')
            );
        
        const confirmEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('⚠️ 파티 취소 확인')
            .setDescription(`정말로 **${partyData.dungeonName}** 파티를 취소하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.reply({
            embeds: [confirmEmbed],
            components: [confirmRow],
            ephemeral: true
        });
        
        logger.info(`${interaction.user.tag}님이 파티 ID: ${partyId} 의 취소 확인 메뉴를 열었습니다.`, null, 'RAID-CALL');
        
    } catch (error) {
        logger.error(`파티 취소 처리 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`파티 취소 처리 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
}
// 파티 취소 확인 처리
async function confirmPartyCancel(interaction, partyId, client) {
    try {
        const guildId = interaction.guild.id;
        
        // 파티 데이터 가져오기
        const guildRaids = activeRaidCalls.get(guildId);
        if (!guildRaids || !guildRaids.has(partyId)) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 파티 찾기 오류')
                .setDescription('파티 정보를 찾을 수 없습니다. 이미 취소되었거나 만료된 파티일 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.update({ embeds: [errorEmbed], components: [] });
        }
        
        const partyData = guildRaids.get(partyId);
        
        // 파티 생성자만 취소 가능
        if (partyData.createdBy !== interaction.user.id) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ 권한 오류')
                .setDescription('파티 생성자만 파티를 취소할 수 있습니다.')
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
                .setTimestamp();
                
            return await interaction.update({ embeds: [errorEmbed], components: [] });
        }
        
        // 파티 취소 임베드
        const cancelledEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 파티 취소됨')
            .setDescription(`**${partyData.dungeonName}** 파티가 취소되었습니다.`)
            .addFields(
                { name: '📅 예정 일시', value: `${partyData.date} ${partyData.time}`, inline: true },
                { name: '👤 취소자', value: `<@${interaction.user.id}>`, inline: true }
            )
            .setFooter({ text: `${interaction.guild.name} • 파티 취소됨`, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        // 메시지 업데이트
        try {
            const settings = guildSettings.get(guildId);
            const alarmChannel = interaction.guild.channels.cache.get(settings.alarmChannel);
            
            if (alarmChannel) {
                const message = await alarmChannel.messages.fetch(partyData.messageId).catch(() => null);
                if (message) {
                    await message.edit({
                        content: '~~이 파티는 취소되었습니다.~~',
                        embeds: [cancelledEmbed],
                        components: []
                    });
                }
            }
        } catch (err) {
            logger.error(`파티 취소 메시지 업데이트 중 오류 발생: ${err.message}`, null, 'RAID-CALL');
        }
        
        // 파티 데이터 삭제
        deleteRaidCall(guildId, partyId);
        
        // 취소 완료 메시지
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('✅ 파티 취소 완료')
            .setDescription(`**${partyData.dungeonName}** 파티가 성공적으로 취소되었습니다.`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
        
        await interaction.update({ embeds: [successEmbed], components: [] });
        
        logger.info(`${interaction.user.tag}님이 '${partyData.dungeonName}' 파티를 취소했습니다.`, null, 'RAID-CALL');
        
    } catch (error) {
        logger.error(`파티 취소 확인 처리 중 오류 발생: ${error.message}`, null, 'RAID-CALL');
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ 오류 발생')
            .setDescription(`파티 취소 확인 처리 중 오류가 발생했습니다: ${error.message}`)
            .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL({ dynamic: true }) })
            .setTimestamp();
            
        await interaction.update({ embeds: [errorEmbed], components: [] }).catch(() => {});
    }
}
