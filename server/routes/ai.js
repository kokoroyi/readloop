import express from 'express'
import { aiTestBodySchema, parseOrThrow } from '../lib/validate.js'

const OVERRIDE_KEYS = ['baseUrl', 'apiKey', 'model', 'timeoutMs', 'retry']

/**
 * 收集请求体里的 AI 覆盖字段；兼容扁平 { baseUrl, apiKey, model } 与 { ai:{...} } 两种形状。
 * @param {unknown} body zod 校验后的请求体
 * @returns {Record<string, unknown> | null}
 */
function pickOverrides(body) {
  if (!body || typeof body !== 'object') return null
  /** @type {Record<string, unknown>} */
  const overrides = {}
  for (const key of OVERRIDE_KEYS) {
    if (body[key] !== undefined) overrides[key] = body[key]
  }
  if (body.ai && typeof body.ai === 'object') Object.assign(overrides, body.ai)
  return Object.keys(overrides).length > 0 ? overrides : null
}

/**
 * POST /api/ai/test、GET /api/ai/models（OpenAI 兼容，见 TECH-DESIGN §4.2）。
 * 失败统一抛 AppError，由 errorHandler 映射 02-DATA-API §6.5 错误码。
 * @param {{ aiService: ReturnType<typeof import('../services/aiService.js').createAiService> }} deps
 */
export function createAiRouter({ aiService }) {
  const router = express.Router()

  router.post('/test', async (req, res) => {
    const body = parseOrThrow(aiTestBodySchema, req.body)
    const result = await aiService.test(pickOverrides(body))
    res.json({
      ok: true,
      mode: result.mode,
      models: result.models,
      model: result.model,
      latencyMs: result.latencyMs
    })
  })

  router.get('/models', async (req, res) => {
    const result = await aiService.listModels()
    res.json({
      ok: true,
      models: result.models,
      baseUrl: result.baseUrl,
      endpoint: result.endpoint,
      count: result.models.length,
      latencyMs: result.latencyMs
    })
  })

  return router
}
