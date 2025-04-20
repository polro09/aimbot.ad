// logger.js - 로거 시스템 강화
const chalk = require('chalk');
const moment = require('moment-timezone');
const emoji = require('node-emoji');
const fs = require('fs');
const path = require('path');

/**
 * 로거 시스템 - 콘솔에 예쁜 로그 메시지를 출력하고 필요시 파일에 저장합니다.
 */
class Logger {
  constructor() {
    this.timezone = 'Asia/Seoul';
    this.logFolder = path.join(__dirname, 'logs');
    this.logFile = path.join(this.logFolder, `log-${this.getDate()}.txt`);
    
    // 로그 폴더 생성
    if (!fs.existsSync(this.logFolder)) {
      fs.mkdirSync(this.logFolder, { recursive: true });
    }
  }

  /**
   * 현재 날짜를 포맷팅합니다.
   * @returns {string} 포맷팅된 날짜 문자열 (YYYY-MM-DD)
   */
  getDate() {
    return moment().tz(this.timezone).format('YYYY-MM-DD');
  }

  /**
   * 현재 시간을 포맷팅합니다.
   * @returns {string} 포맷팅된 시간 문자열
   */
  getTime() {
    return moment().tz(this.timezone).format('YYYY-MM-DD HH:mm:ss');
  }

  /**
   * 로그를 파일에 저장합니다.
   * @param {string} level 로그 레벨
   * @param {string} module 모듈 이름
   * @param {string} message 로그 메시지
   */
  saveToFile(level, module, message) {
    try {
      const logLine = `[${this.getTime()}] [${level}] [${module}] ${message}\n`;
      fs.appendFileSync(this.logFile, logLine);
    } catch (error) {
      console.error(`로그 파일 저장 실패: ${error.message}`);
    }
  }

  /**
   * 정보 로그를 출력합니다.
   * @param {string} module 모듈 이름
   * @param {string} message 로그 메시지
   */
  info(module, message) {
    console.log(
      `${chalk.gray(this.getTime())} ${chalk.blue.bold('[INFO]')} ${emoji.get('information_source')} ${chalk.cyan(`[${module}]`)} ${message}`
    );
    this.saveToFile('INFO', module, message);
  }

  /**
   * 성공 로그를 출력합니다.
   * @param {string} module 모듈 이름
   * @param {string} message 로그 메시지
   */
  success(module, message) {
    console.log(
      `${chalk.gray(this.getTime())} ${chalk.green.bold('[SUCCESS]')} ${emoji.get('white_check_mark')} ${chalk.cyan(`[${module}]`)} ${message}`
    );
    this.saveToFile('SUCCESS', module, message);
  }

  /**
   * 경고 로그를 출력합니다.
   * @param {string} module 모듈 이름
   * @param {string} message 로그 메시지
   */
  warn(module, message) {
    console.log(
      `${chalk.gray(this.getTime())} ${chalk.yellow.bold('[WARNING]')} ${emoji.get('warning')} ${chalk.cyan(`[${module}]`)} ${message}`
    );
    this.saveToFile('WARNING', module, message);
  }

  /**
   * 에러 로그를 출력합니다.
   * @param {string} module 모듈 이름
   * @param {string} message 로그 메시지
   */
  error(module, message) {
    console.log(
      `${chalk.gray(this.getTime())} ${chalk.red.bold('[ERROR]')} ${emoji.get('x')} ${chalk.cyan(`[${module}]`)} ${message}`
    );
    this.saveToFile('ERROR', module, message);
  }

  /**
   * 시스템 로그를 출력합니다.
   * @param {string} module 모듈 이름
   * @param {string} message 로그 메시지
   */
  system(module, message) {
    console.log(
      `${chalk.gray(this.getTime())} ${chalk.magenta.bold('[SYSTEM]')} ${emoji.get('gear')} ${chalk.cyan(`[${module}]`)} ${message}`
    );
    this.saveToFile('SYSTEM', module, message);
  }

  /**
   * 모듈 로그를 출력합니다.
   * @param {string} module 모듈 이름
   * @param {string} message 로그 메시지
   */
  module(module, message) {
    console.log(
      `${chalk.gray(this.getTime())} ${chalk.blue.bold('[MODULE]')} ${emoji.get('package')} ${chalk.cyan(`[${module}]`)} ${message}`
    );
    this.saveToFile('MODULE', module, message);
  }

  /**
   * 웹 서버 로그를 출력합니다.
   * @param {string} module 모듈 이름
   * @param {string} message 로그 메시지
   */
  web(module, message) {
    console.log(
      `${chalk.gray(this.getTime())} ${chalk.hex('#FF7F50').bold('[WEB]')} ${emoji.get('globe_with_meridians')} ${chalk.cyan(`[${module}]`)} ${message}`
    );
    this.saveToFile('WEB', module, message);
  }

  /**
   * 디스코드 관련 로그를 출력합니다.
   * @param {string} module 모듈 이름
   * @param {string} message 로그 메시지
   */
  discord(module, message) {
    console.log(
      `${chalk.gray(this.getTime())} ${chalk.hex('#5865F2').bold('[DISCORD]')} ${emoji.get('speech_balloon')} ${chalk.cyan(`[${module}]`)} ${message}`
    );
    this.saveToFile('DISCORD', module, message);
  }

  /**
   * 커맨드 로그를 출력합니다.
   * @param {string} module 모듈 이름
   * @param {string} message 로그 메시지
   */
  command(module, message) {
    console.log(
      `${chalk.gray(this.getTime())} ${chalk.hex('#FFA500').bold('[COMMAND]')} ${emoji.get('arrow_right')} ${chalk.cyan(`[${module}]`)} ${message}`
    );
    this.saveToFile('COMMAND', module, message);
  }
  
  /**
   * 데이터베이스 로그를 출력합니다.
   * @param {string} module 모듈 이름
   * @param {string} message 로그 메시지
   */
  database(module, message) {
    console.log(
      `${chalk.gray(this.getTime())} ${chalk.hex('#FF4500').bold('[DATABASE]')} ${emoji.get('floppy_disk')} ${chalk.cyan(`[${module}]`)} ${message}`
    );
    this.saveToFile('DATABASE', module, message);
  }
}

module.exports = new Logger();