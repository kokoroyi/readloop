import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import express from 'express'
import { config as defaultConfig } from './config.js'
import { createAiCallsRepository } from './db/repositories/aiCalls.js'
import { createArticlesRepository } from './db/repositories/articles.js'
import { createLogsRepository } from './db/repositories/logs.js'
import { createReadingSessionsRepository } from './db/repositories/reading.js'
import { createRecapSessionsRepository } from './db/repositories/recapSessions.js'
import { createSentenceChatsRepository } from './db/repositories/sentenceChats.js'
import { createSentencesRepository } from './db/repositories/sentences.js'
import { createSettingsRepository } from './db/repositories/settings.js'
import { createStatsRepository } from './db/repositories/stats.js'
import { createSummariesRepository } from './db/repositories/summaries.js'
import { createSystemRepository } from './db/repositories/system.js'
import { createSentenceWorkRepository } from './db/repositories/work.js'
import { createWordsRepository } from './db/repositories/words.js'
import { createAiClient } from './lib/aiClient.js'
import { createAiQueue } from './lib/aiQueue.js'
import { createDictionary } from './lib/dictionary.js'
import { errorHandler, notFoundHandler } from './lib/errors.js'
import { logger as defaultLogger } from './lib/logger.js'
import { createApiRouter } from './routes/index.js'
import { createAiService } from './services/aiService.js'
import { createArticleService } from './services/articleService.js'
import { createLogsService } from './services/logsService.js'
import { createReadingService } from './services/readingService.js'
import { createRecapService } from './services/recapService.js'
import { createSettingsService } from './services/settingsService.js'
import { createStatsService } from './services/statsService.js'
import { createSummaryService } from './services/summaryService.js'
import { createSystemService } from './services/systemService.js'
import { createWordService } from './services/wordService.js'

/** CSP 与安全头（04-ENGINEERING §8） */
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"

/** 允许透传的外部 X-Request-Id 格式（其余一律重新生成 uuid） */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/

/**
 * 为每个请求分配 X-Request-Id：合法入参透传，否则生成 uuid。
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requestIdMiddleware(req, res, next) {
  const incoming = req.get('X-Request-Id')
  req.id =
    typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID()
  res.setHeader('X-Request-Id', req.id)
  next()
}

/**
 * 安全响应头。
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
}

/**
 * SPA 回退：GET/HEAD 的非 /api 请求且 public/index.html 存在时返回 index.html。
 * /api/* 不参与回退（02-DATA-API §6.1）。
 * @param {import('./config.js').config} appConfig
 * @returns {import('express').RequestHandler}
 */
function createSpaFallback(appConfig) {
  return function spaFallback(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path === '/api' || req.path.startsWith('/api/')) return next()
    try {
      if (!fs.statSync(appConfig.indexHtmlPath).isFile()) return next()
    } catch {
      // 前端尚未构建（server/public 不存在）时交给 404 兜底
      return next()
    }
    res.sendFile(appConfig.indexHtmlPath)
  }
}

/**
 * 组装 Express 应用（中间件顺序严格按 04-ENGINEERING §5.2）。
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   config?: import('./config.js').config,
 *   logger?: typeof defaultLogger,
 *   onShutdown?: (reason: string) => void,
 *   aiQueue?: ReturnType<typeof createAiQueue>,
 *   aiQueueOptions?: { capacity?: number, queueTimeoutMs?: number }
 * }} options
 * @returns {import('express').Express}
 */
export function createApp(options = {}) {
  const { db } = options
  if (!db) throw new Error('createApp 需要已打开的数据库连接')
  const appConfig = options.config ?? defaultConfig
  const appLogger = options.logger ?? defaultLogger

  const repositories = {
    settings: createSettingsRepository(db),
    articles: createArticlesRepository(db),
    sentences: createSentencesRepository(db),
    work: createSentenceWorkRepository(db),
    reading: createReadingSessionsRepository(db),
    words: createWordsRepository(db),
    chats: createSentenceChatsRepository(db),
    aiCalls: createAiCallsRepository(db),
    recapSessions: createRecapSessionsRepository(db),
    summaries: createSummariesRepository(db),
    stats: createStatsRepository(db),
    logs: createLogsRepository(db),
    system: createSystemRepository(db)
  }
  const dictionary = createDictionary({ dictPath: appConfig.dictPath, logger: appLogger })
  const aiQueue = options.aiQueue ?? createAiQueue(options.aiQueueOptions ?? {})
  const aiClient = createAiClient({
    aiCalls: repositories.aiCalls,
    queue: aiQueue,
    logger: appLogger
  })

  const settingsService = createSettingsService({
    repository: repositories.settings,
    logger: appLogger
  })
  const aiService = createAiService({ settingsService, aiClient })
  const articleService = createArticleService({
    db,
    articles: repositories.articles,
    sentences: repositories.sentences,
    work: repositories.work,
    reading: repositories.reading,
    chats: repositories.chats,
    recapSessions: repositories.recapSessions,
    summaries: repositories.summaries,
    logger: appLogger
  })
  const readingService = createReadingService({
    db,
    articles: repositories.articles,
    sentences: repositories.sentences,
    work: repositories.work,
    chats: repositories.chats,
    reading: repositories.reading,
    settingsService,
    aiClient,
    logger: appLogger
  })
  const recapService = createRecapService({
    db,
    articles: repositories.articles,
    sentences: repositories.sentences,
    work: repositories.work,
    recapSessions: repositories.recapSessions,
    summaries: repositories.summaries,
    reading: repositories.reading,
    settingsService,
    aiClient,
    logger: appLogger
  })
  const summaryService = createSummaryService({
    articles: repositories.articles,
    sentences: repositories.sentences,
    work: repositories.work,
    summaries: repositories.summaries
  })
  const statsService = createStatsService({
    stats: repositories.stats,
    logger: appLogger
  })
  const logsService = createLogsService({ logs: repositories.logs })
  const systemService = createSystemService({
    db,
    config: appConfig,
    system: repositories.system,
    logger: appLogger
  })
  const wordService = createWordService({
    words: repositories.words,
    articles: repositories.articles,
    dictionary,
    logger: appLogger
  })

  const app = express()
  app.disable('x-powered-by')
  app.locals.startedAt = Date.now()
  app.locals.port = appConfig.port
  app.locals.requestShutdown = typeof options.onShutdown === 'function' ? options.onShutdown : null
  app.locals.dictionary = dictionary
  app.locals.services = {
    repositories,
    aiQueue,
    aiClient,
    settingsService,
    aiService,
    articleService,
    readingService,
    recapService,
    summaryService,
    statsService,
    logsService,
    systemService,
    wordService
  }

  app.use(requestIdMiddleware)
  app.use(express.json({ limit: appConfig.jsonLimit }))
  app.use(securityHeaders)
  app.use(
    '/api',
    createApiRouter({
      db,
      config: appConfig,
      settingsService,
      aiService,
      articleService,
      readingService,
      recapService,
      summaryService,
      statsService,
      logsService,
      systemService,
      wordService,
      dictionary
    })
  )
  app.use(express.static(appConfig.publicDir))
  app.use(createSpaFallback(appConfig))
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

export default createApp
