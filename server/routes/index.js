import express from 'express'
import { createAiRouter } from './ai.js'
import { createArticlesRouter } from './articles.js'
import { createDictRouter } from './dict.js'
import { createHealthRouter } from './health.js'
import { createLogsRouter } from './logs.js'
import { createReadingRouter } from './reading.js'
import { createRecapRouter } from './recap.js'
import { createSettingsRouter } from './settings.js'
import { createStatsRouter } from './stats.js'
import { createSummaryRouter } from './summary.js'
import { createSystemRouter } from './system.js'
import { createWordsRouter } from './words.js'

/**
 * /api 路由总装。路由层只做 zod 校验 + 调 service + 组装响应，不写 SQL、不直接调 AI。
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   config: import('../config.js').config,
 *   settingsService: ReturnType<typeof import('../services/settingsService.js').createSettingsService>,
 *   aiService: ReturnType<typeof import('../services/aiService.js').createAiService>,
 *   articleService: ReturnType<typeof import('../services/articleService.js').createArticleService>,
 *   readingService: ReturnType<typeof import('../services/readingService.js').createReadingService>,
 *   recapService: ReturnType<typeof import('../services/recapService.js').createRecapService>,
 *   summaryService: ReturnType<typeof import('../services/summaryService.js').createSummaryService>,
 *   statsService: ReturnType<typeof import('../services/statsService.js').createStatsService>,
 *   logsService: ReturnType<typeof import('../services/logsService.js').createLogsService>,
 *   systemService: ReturnType<typeof import('../services/systemService.js').createSystemService>,
 *   wordService: ReturnType<typeof import('../services/wordService.js').createWordService>,
 *   dictionary: ReturnType<typeof import('../lib/dictionary.js').createDictionary>
 * }} deps
 */
export function createApiRouter({
  db,
  config,
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
}) {
  const router = express.Router()

  router.use('/health', createHealthRouter({ db, config, settingsService }))
  router.use('/settings', createSettingsRouter({ settingsService }))
  router.use('/ai', createAiRouter({ aiService }))
  // 复盘/小结路由挂在 /articles 下（路径为 /api/articles/:id/recap/...、/summary/...），
  // 需在通用 articles 路由之前注册（两者路径不冲突）。
  router.use('/articles', createRecapRouter({ recapService }))
  router.use('/articles', createSummaryRouter({ summaryService }))
  router.use('/articles', createArticlesRouter({ articleService, readingService }))
  router.use('/dict', createDictRouter({ dictionary }))
  router.use('/words', createWordsRouter({ wordService }))
  router.use('/reading', createReadingRouter({ readingService }))
  router.use('/stats', createStatsRouter({ statsService }))
  router.use('/logs', createLogsRouter({ logsService }))
  router.use('/system', createSystemRouter({ systemService }))

  // 托盘优雅关闭：先回 {ok:true}，响应 flush 后触发关闭流程（04-ENGINEERING §5.1）
  router.post('/shutdown', (req, res) => {
    const requestShutdown = req.app.locals.requestShutdown
    res.on('finish', () => {
      if (typeof requestShutdown === 'function') setImmediate(() => requestShutdown('api'))
    })
    res.json({ ok: true })
  })

  return router
}
