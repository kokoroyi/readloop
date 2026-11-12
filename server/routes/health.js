import express from 'express'
import { isDatabaseHealthy } from '../db/index.js'
import { isFileReadable } from '../lib/fileCheck.js'
import { isAiConfigured } from '../services/settingsService.js'

/**
 * GET /api/health（02-DATA-API §6.3；托盘与前端顶栏探活）。
 * @param {{ db: import('better-sqlite3').Database, config: import('../config.js').config, settingsService: ReturnType<typeof import('../services/settingsService.js').createSettingsService> }} deps
 */
export function createHealthRouter({ db, config, settingsService }) {
  const router = express.Router()

  router.get('/', (req, res) => {
    /** @type {{ configured: boolean, model: string }} */
    let ai = { configured: false, model: '' }
    try {
      const raw = settingsService.getRaw()
      const rawAi = raw.ai && typeof raw.ai === 'object' ? raw.ai : {}
      ai = {
        configured: isAiConfigured(rawAi),
        model: typeof rawAi.model === 'string' ? rawAi.model : ''
      }
    } catch {
      // 设置读取异常时 health 仍返回 200，AI 视为未配置
    }

    const startedAt = Number(req.app.locals.startedAt) || Date.now()
    res.json({
      ok: true,
      version: config.version,
      port: Number(req.app.locals.port) || config.port,
      db: isDatabaseHealthy(db),
      dict: isFileReadable(config.dictPath),
      ai,
      uptimeSec: Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
    })
  })

  return router
}
