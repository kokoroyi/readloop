import express from 'express'
import { parseOrThrow, statsCalendarQuerySchema } from '../lib/validate.js'

/**
 * 统计路由（02-DATA-API §6.2 #33/#34）。
 * @param {{ statsService: ReturnType<typeof import('../services/statsService.js').createStatsService> }} deps
 */
export function createStatsRouter({ statsService }) {
  const router = express.Router()

  router.get('/overview', (req, res) => {
    res.json({ ok: true, ...statsService.overview() })
  })

  router.get('/calendar', (req, res) => {
    const query = parseOrThrow(statsCalendarQuerySchema, req.query ?? {})
    res.json({ ok: true, ...statsService.calendar(query) })
  })

  return router
}

export default createStatsRouter
