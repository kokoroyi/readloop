import express from 'express'
import { logsQuerySchema, parseOrThrow } from '../lib/validate.js'

/**
 * 日志路由（02-DATA-API §6.2 #37）：最近 N 条系统日志（设置页「日志」）。
 * @param {{ logsService: ReturnType<typeof import('../services/logsService.js').createLogsService> }} deps
 */
export function createLogsRouter({ logsService }) {
  const router = express.Router()

  router.get('/', (req, res) => {
    const query = parseOrThrow(logsQuerySchema, req.query ?? {})
    res.json({ ok: true, items: logsService.recent(query.limit) })
  })

  return router
}

export default createLogsRouter
