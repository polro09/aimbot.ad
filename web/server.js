// web/server.js - 개선된 웹 서버
const express = require('express');
const path = require('path');
const logger = require('../logger');
const config = require('../config/bot-config');
const fs = require('fs');
const helmet = require('helmet'); // 보안 헤더 설정을 위한 패키지 (npm install helmet)
const rateLimit = require('express-rate-limit'); // 요청 제한을 위한 패키지 (npm install express-rate-limit)
const session = require('express-session'); // 세션 관리를 위한 패키지 (npm install express-session)

/**
 * 웹 서버 클래스 - 보안 개선 및 기능 추가
 */
class WebServer {
  constructor(client) {
    this.client = client;
    this.app = express();
    this.port = config.get('web.port', 3000);
    this.host = config.get('web.host', 'localhost');
    this.moduleRoutes = [];
    
    this.setupMiddleware();
    this.setupRoutes();
    
    logger.web('Server', '웹 서버가 초기화되었습니다.');
  }

  /**
   * 미들웨어 설정 - 보안 강화
   */
  setupMiddleware() {
    // 보안 헤더 설정
    this.app.use(helmet({
      contentSecurityPolicy: false, // 필요에 따라 활성화
    }));
    
    // API 요청 제한 설정
    const apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15분
      max: 100, // IP당 최대 요청 수
      standardHeaders: true,
      message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
    });
    this.app.use('/api/', apiLimiter);
    
    // 세션 설정
    this.app.use(session({
      secret: process.env.SESSION_SECRET || 'aimbot-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 24 * 60 * 60 * 1000 // 24시간
      }
    }));
    
    // 정적 파일 제공
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    // EJS 템플릿 엔진 설정
    this.app.set('views', path.join(__dirname, 'views'));
    this.app.set('view engine', 'ejs');
    
    // JSON 파싱
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // 요청 로깅 미들웨어
    this.app.use((req, res, next) => {
      logger.web('HTTP', `${req.method} ${req.url} - ${req.ip}`);
      next();
    });
    
    // 응답 시간 측정 미들웨어
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const ms = Date.now() - start;
        logger.web('Performance', `${req.method} ${req.url} - ${res.statusCode} - ${ms}ms`);
      });
      next();
    });
  }

  /**
   * 라우트 설정 - API 기능 강화
   */
  setupRoutes() {
    // 메인 페이지
    this.app.get('/', (req, res) => {
      res.render('index', {
        title: 'aimbot.ad 대시보드',
        client: this.client,
        botName: 'aimbot.ad',
        modules: this.getModulesList(),
        currentPage: 'home',
        uptime: this.client.uptime,
        serverCount: this.client.guilds.cache.size
      });
    });
    
    // 모듈 관리 페이지
    this.app.get('/modules', (req, res) => {
      res.render('modules', {
        title: '모듈 관리',
        client: this.client,
        botName: 'aimbot.ad',
        modules: this.getModulesList(),
        currentPage: 'modules'
      });
    });
    
    // 모듈 활성화/비활성화 API
    this.app.post('/api/modules/:moduleName/toggle', (req, res) => {
      const { moduleName } = req.params;
      const { enabled } = req.body;
      
      try {
        const module = this.client.modules.get(moduleName);
        if (!module) {
          return res.status(404).json({ success: false, message: '모듈을 찾을 수 없습니다.' });
        }
        
        config.updateModuleConfig(moduleName, { enabled: enabled === 'true' || enabled === true });
        
        // 모듈 활성화/비활성화 처리
        if (typeof module.setEnabled === 'function') {
          module.setEnabled(enabled === 'true' || enabled === true);
        }
        
        logger.web('Modules', `'${moduleName}' 모듈이 ${enabled ? '활성화' : '비활성화'}되었습니다.`);
        res.json({ success: true });
      } catch (error) {
        logger.error('API', `모듈 토글 중 오류 발생: ${error.message}`);
        res.status(500).json({ success: false, message: '모듈 설정 변경 중 오류가 발생했습니다.' });
      }
    });
    
    // 웰컴 모듈 설정 페이지
    this.app.get('/modules/welcome', (req, res) => {
      res.render('welcome', {
        title: '웰컴 모듈 설정',
        client: this.client,
        botName: 'aimbot.ad',
        config: config.getModuleConfig('welcome'),
        welcomeChannelId: config.get('welcomeChannelId'),
        currentPage: 'modules',
        req: req
      });
    });
    
    // 웰컴 모듈 설정 저장
    this.app.post('/modules/welcome/save', (req, res) => {
      const { enabled, joinMessage, leaveMessage, welcomeChannelId } = req.body;
      
      try {
        // 설정 업데이트
        config.updateModuleConfig('welcome', {
          enabled: enabled === 'on',
          joinMessage,
          leaveMessage
        });
        
        if (welcomeChannelId) {
          config.set('welcomeChannelId', welcomeChannelId);
        }
        
        // 설정 저장
        config.saveConfig();
        
        logger.web('Welcome', '웰컴 모듈 설정이 업데이트되었습니다.');
        res.redirect('/modules/welcome?success=true');
      } catch (error) {
        logger.error('Welcome', `설정 저장 중 오류 발생: ${error.message}`);
        res.redirect('/modules/welcome?error=true&message=' + encodeURIComponent('설정 저장 중 오류가 발생했습니다.'));
      }
    });
    
    // 가입 신청서 모듈 설정 페이지
    this.app.get('/modules/registration', (req, res) => {
      res.render('registration', {
        title: '가입 신청서 모듈 설정',
        client: this.client,
        botName: 'aimbot.ad',
        config: config.getModuleConfig('registration'),
        currentPage: 'modules',
        req: req,
        guilds: this.client.guilds.cache.map(guild => ({ 
          id: guild.id, 
          name: guild.name,
          channels: guild.channels.cache
            .filter(channel => channel.type === 0) // 텍스트 채널만
            .map(channel => ({ id: channel.id, name: channel.name })),
          categories: guild.channels.cache
            .filter(channel => channel.type === 4) // 카테고리만
            .map(category => ({ id: category.id, name: category.name })),
          roles: guild.roles.cache
            .map(role => ({ id: role.id, name: role.name }))
        }))
      });
    });
    
    // 가입 신청서 모듈 설정 저장
    this.app.post('/modules/registration/save', (req, res) => {
      const { 
        enabled, 
        channelId, 
        ticketCategoryId, 
        approvalRoleId,
        form1Field1, form1Field2, form1Field3, form1Field4,
        form2Field1, form2Field2, form2Field3, form2Field4
      } = req.body;
      
      try {
        // 설정 업데이트
        config.updateModuleConfig('registration', {
          enabled: enabled === 'on',
          channelId,
          ticketCategoryId,
          approvalRoleId,
          form1Fields: [form1Field1, form1Field2, form1Field3, form1Field4].filter(field => field),
          form2Fields: [form2Field1, form2Field2, form2Field3, form2Field4].filter(field => field)
        });
        
        // 설정 저장
        config.saveConfig();
        
        logger.web('Registration', '가입 신청서 모듈 설정이 업데이트되었습니다.');
        res.redirect('/modules/registration?success=true');
      } catch (error) {
        logger.error('Registration', `설정 저장 중 오류 발생: ${error.message}`);
        res.redirect('/modules/registration?error=true&message=' + encodeURIComponent('설정 저장 중 오류가 발생했습니다.'));
      }
    });
    
    // API 엔드포인트
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: 'online',
        uptime: this.client.uptime,
        serverCount: this.client.guilds.cache.size,
        moduleCount: this.getModulesList().length,
        memory: process.memoryUsage().heapUsed / 1024 / 1024, // MB 단위
        version: require('../package.json').version
      });
    });
    
    // 봇 로그 API (최근 100개)
    this.app.get('/api/logs', (req, res) => {
      try {
        const logFile = path.join(__dirname, '..', 'logs', `log-${new Date().toISOString().split('T')[0]}.txt`);
        if (fs.existsSync(logFile)) {
          const logs = fs.readFileSync(logFile, 'utf8')
            .split('\n')
            .filter(line => line.trim())
            .slice(-100)
            .reverse();
          res.json({ success: true, logs });
        } else {
          res.json({ success: false, message: '로그 파일을 찾을 수 없습니다.' });
        }
      } catch (error) {
        logger.error('API', `로그 조회 중 오류 발생: ${error.message}`);
        res.status(500).json({ success: false, message: '로그 조회 중 오류가 발생했습니다.' });
      }
    });
    
    // 로그 페이지
    this.app.get('/logs', (req, res) => {
      res.render('logs', {
        title: '로그 확인',
        client: this.client,
        botName: 'aimbot.ad',
        currentPage: 'logs'
      });
    });
    
    // 404 페이지
    this.app.use((req, res) => {
      res.status(404).render('error', {
        title: '404 - 페이지를 찾을 수 없음',
        botName: 'aimbot.ad',
        error: {
          code: 404,
          message: '요청하신 페이지를 찾을 수 없습니다.'
        }
      });
    });
    
    // 에러 핸들러
    this.app.use((err, req, res, next) => {
      logger.error('Web', `에러 발생: ${err.message}`);
      res.status(500).render('error', {
        title: '500 - 서버 오류',
        botName: 'aimbot.ad',
        error: {
          code: 500,
          message: '서버 내부 오류가 발생했습니다.'
        }
      });
    });
  }

  /**
   * 모듈 목록을 가져옵니다.
   * @returns {Array} 모듈 목록
   */
  getModulesList() {
    // 실제 모듈 목록을 client.modules에서 가져옴
    return Array.from(this.client.modules.values()).map(module => ({
      name: module.name,
      description: module.description || '설명 없음',
      enabled: module.enabled !== undefined ? module.enabled : config.get(`modules.${module.name}.enabled`, true),
      configurable: module.configurable !== undefined ? module.configurable : true,
      configUrl: `/modules/${module.name}`
    }));
  }

  /**
   * 모듈 라우트를 등록합니다.
   * @param {string} moduleName 모듈 이름
   * @param {function} routeHandler 라우트 핸들러 함수
   */
  registerModuleRoute(moduleName, routeHandler) {
    this.moduleRoutes.push({ moduleName, routeHandler });
    routeHandler(this.app, this.client);
    logger.web('Router', `'${moduleName}' 모듈의 라우트가 등록되었습니다.`);
  }

  /**
   * 웹 서버를 시작합니다.
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, this.host, () => {
          logger.success('WebServer', `웹 서버가 http://${this.host}:${this.port}/ 에서 실행 중입니다.`);
          resolve(this);
        });
        
        // 에러 처리
        this.server.on('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            logger.error('WebServer', `포트 ${this.port}가 이미 사용 중입니다. 다른 포트를 사용하세요.`);
          } else {
            logger.error('WebServer', `웹 서버 오류: ${error.message}`);
          }
          reject(error);
        });
      } catch (error) {
        logger.error('WebServer', `웹 서버 시작 중 오류 발생: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * 웹 서버를 중지합니다.
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('WebServer', '웹 서버가 종료되었습니다.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = (client) => new WebServer(client);