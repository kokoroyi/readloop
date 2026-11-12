import express from 'express'
import { parseOrThrow, readingEndSchema, readingTickSchema } from '../lib/validate.js'

/**
 * 阅读计时路由（02-DATA-API §6.2 #35/#36）。
 * @param {{ readingService: ReturnType<typeof import('../services/readingService.js').createReadingService> }} deps
 */
export function createReadingRouter({ readingService }) {
  const router = express.Router()

  router.post('/tick', (req, res) => {
    const payload = parseOrThrow(readingTickSchema, req.body ?? {})
    res.json({ ok: true, ...readingService.tick(payload) })
  })

  router.post('/end', (req, res) => {
    const payload = parseOrThrow(readingEndSchema, req.body ?? {})
    res.json({ ok: true, ...readingService.end(payload) })
  })

  return router
}

export default createReadingRouter
