import express from 'express'
import { parseOrThrow, settingsPatchSchema } from '../lib/validate.js'

/**
 * GET /api/settings：完整默认值深合并 + apiKey 打码。
 * PUT /api/settings：分区合并保存，成功返回与 GET 相同的形状。
 * @param {{ settingsService: ReturnType<typeof import('../services/settingsService.js').createSettingsService> }} deps
 */
export function createSettingsRouter({ settingsService }) {
  const router = express.Router()

  router.get('/', (req, res) => {
    res.json({ ok: true, ...settingsService.get() })
  })

  router.put('/', (req, res) => {
    const patch = parseOrThrow(settingsPatchSchema, req.body ?? {})
    res.json({ ok: true, ...settingsService.save(patch) })
  })

  return router
}
