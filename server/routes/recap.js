import express from 'express'
import { startEventStream, watchClientClose } from '../lib/sse.js'
import {
  chatMessageSchema,
  parseIdParam,
  parseOrThrow,
  recapAnswerSchema,
  recapSkipSchema
} from '../lib/validate.js'

/**
 * 复盘路由（02-DATA-API §6.2 #21~#25 + Lead 确认新增的 recap/skip）：
 * 路由只做 zod 校验 + 调 service + 组装响应/SSE。
 * @param {{ recapService: ReturnType<typeof import('../services/recapService.js').createRecapService> }} deps
 */
export function createRecapRouter({ recapService }) {
  const router = express.Router()

  router.post('/:id/recap/start', async (req, res, next) => {
    const articleId = parseIdParam(req.params.id, 'id')
    const guard = watchClientClose(res)
    try {
      const result = await recapService.start(articleId, { signal: guard.signal })
      guard.cleanup()
      if (guard.isAborted()) return
      res.json({ ok: true, ...result })
    } catch (error) {
      guard.cleanup()
      if (guard.isAborted()) return
      next(error)
    }
  })

  router.get('/:id/recap', (req, res) => {
    const articleId = parseIdParam(req.params.id, 'id')
    res.json({ ok: true, ...recapService.get(articleId) })
  })

  router.post('/:id/recap/answer', async (req, res, next) => {
    const articleId = parseIdParam(req.params.id, 'id')
    const payload = parseOrThrow(recapAnswerSchema, req.body ?? {})
    const guard = watchClientClose(res)
    try {
      const result = await recapService.answer({
        articleId,
        questionId: payload.questionId,
        answer: payload.answer,
        signal: guard.signal
      })
      guard.cleanup()
      if (guard.isAborted()) return
      res.json({ ok: true, ...result })
    } catch (error) {
      guard.cleanup()
      if (guard.isAborted()) return
      next(error)
    }
  })

  router.post('/:id/recap/skip', (req, res) => {
    const articleId = parseIdParam(req.params.id, 'id')
    const payload = parseOrThrow(recapSkipSchema, req.body ?? {})
    res.json({ ok: true, ...recapService.skip({ articleId, questionId: payload.questionId }) })
  })

  router.post('/:id/recap/chat', async (req, res, next) => {
    const articleId = parseIdParam(req.params.id, 'id')
    const payload = parseOrThrow(chatMessageSchema, req.body ?? {})
    const guard = watchClientClose(res)
    try {
      recapService.prepareChat(articleId)
    } catch (error) {
      guard.cleanup()
      if (guard.isAborted()) return
      next(error)
      return
    }

    const stream = startEventStream(res)
    try {
      const result = await recapService.chat({
        articleId,
        message: payload.message,
        signal: guard.signal,
        onDelta: (text) => stream.writeEvent('delta', { text })
      })
      stream.writeEvent('done', {
        messageId: result.messageId,
        content: result.content,
        usage: result.usage ?? null
      })
    } catch (error) {
      const cancelled =
        guard.isAborted() || (error && typeof error === 'object' && error.code === 'CANCELLED')
      if (!cancelled) {
        stream.writeEvent('error', {
          code: error?.code ?? 'AI_UPSTREAM',
          message: error?.message ?? 'AI 服务异常，请重试',
          retryable: error?.retryable ?? true
        })
      }
    } finally {
      guard.cleanup()
      stream.finish()
    }
  })

  router.post('/:id/recap/finish', async (req, res, next) => {
    const articleId = parseIdParam(req.params.id, 'id')
    const guard = watchClientClose(res)
    try {
      const result = await recapService.finish(articleId, { signal: guard.signal })
      guard.cleanup()
      if (guard.isAborted()) return
      res.json({ ok: true, ...result })
    } catch (error) {
      guard.cleanup()
      if (guard.isAborted()) return
      next(error)
    }
  })

  return router
}

export default createRecapRouter
