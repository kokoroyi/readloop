import express from 'express'
import { clearDataSchema, parseOrThrow } from '../lib/validate.js'

/**
 * 系统路由（M5 数据管理）：
 * - GET  /api/system/info       系统信息（关于/数据管理页）
 * - POST /api/system/backup     备份数据库（checkpoint 后复制，保留最近 5 份）
 * - POST /api/system/clear-data 清空学习数据（危险操作，必须显式 confirm:true）
 * @param {{ systemService: ReturnType<typeof import('../services/systemService.js').createSystemService> }} deps
 */
export function createSystemRouter({ systemService }) {
  const router = express.Router()

  router.get('/info', (req, res) => {
    res.json({ ok: true, ...systemService.info(Number(req.app.locals.port) || undefined) })
  })

  router.post('/backup', (req, res) => {
    res.json({ ok: true, ...systemService.backup() })
  })

  router.post('/clear-data', (req, res) => {
    const payload = parseOrThrow(clearDataSchema, req.body ?? {})
    res.json({ ok: true, ...systemService.clearData({ keepWords: payload.keepWords }) })
  })

  return router
}

export default createSystemRouter
