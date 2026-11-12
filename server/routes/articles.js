import express from 'express'
import { startEventStream, watchClientClose } from '../lib/sse.js'
import {
  articleCreateSchema,
  articleUpdateSchema,
  articlesQuerySchema,
  chatMessageSchema,
  cleanQuery,
  importCommitSchema,
  importPreviewSchema,
  parseIdParam,
  parseNonNegativeIntParam,
  parseOrThrow,
  randomArticleQuerySchema,
  reorderSchema,
  translationSubmitSchema
} from '../lib/validate.js'

/**
 * 文章路由（02-DATA-API §6.2 #8~#20）：只做 zod 校验 + 调 service + 组装响应；
 * 句内追问的 SSE 事件封装也在路由层完成，持久化与 AI 调用走 readingService。
 * @param {{
 *   articleService: ReturnType<typeof import('../services/articleService.js').createArticleService>,
 *   readingService: ReturnType<typeof import('../services/readingService.js').createReadingService>
 * }} deps
 */
export function createArticlesRouter({ articleService, readingService }) {
  const router = express.Router()

  router.get('/', (req, res) => {
    const query = parseOrThrow(articlesQuerySchema, cleanQuery(req.query))
    res.json({ ok: true, ...articleService.list(query) })
  })

  // 随机回顾抽一篇（必须在 /:id 之前注册，否则 'random' 会被当成 id）
  router.get('/random', (req, res) => {
    const query = parseOrThrow(randomArticleQuerySchema, cleanQuery(req.query ?? {}))
    res.json({ ok: true, ...articleService.random(query.status) })
  })

  router.post('/', (req, res) => {
    const payload = parseOrThrow(articleCreateSchema, req.body ?? {})
    res.json({ ok: true, ...articleService.createPaste(payload) })
  })

  router.post('/reorder', (req, res) => {
    const payload = parseOrThrow(reorderSchema, req.body ?? {})
    res.json({ ok: true, ...articleService.reorder(payload.ids) })
  })

  router.post('/import/preview', (req, res) => {
    const payload = parseOrThrow(importPreviewSchema, req.body ?? {})
    res.json({ ok: true, ...articleService.previewImport(payload) })
  })

  router.post('/import/commit', (req, res) => {
    const payload = parseOrThrow(importCommitSchema, req.body ?? {})
    res.json({ ok: true, ...articleService.commitImport(payload.items) })
  })

  router.get('/:id', (req, res) => {
    const id = parseIdParam(req.params.id, 'id')
    res.json({ ok: true, ...articleService.get(id) })
  })

  router.patch('/:id', (req, res) => {
    const id = parseIdParam(req.params.id, 'id')
    const payload = parseOrThrow(articleUpdateSchema, req.body ?? {})
    res.json({ ok: true, ...articleService.updateTitle(id, payload.title) })
  })

  router.delete('/:id', (req, res) => {
    const id = parseIdParam(req.params.id, 'id')
    articleService.remove(id)
    res.json({ ok: true })
  })

  router.post('/:id/start', (req, res) => {
    const id = parseIdParam(req.params.id, 'id')
    res.json({ ok: true, ...articleService.start(id) })
  })

  router.get('/:id/work', (req, res) => {
    const id = parseIdParam(req.params.id, 'id')
    res.json({ ok: true, ...readingService.getWork(id) })
  })

  router.post('/:id/sentences/:idx/submit', async (req, res, next) => {
    const articleId = parseIdParam(req.params.id, 'id')
    const idx = parseNonNegativeIntParam(req.params.idx, 'idx')
    const payload = parseOrThrow(translationSubmitSchema, req.body ?? {})
    const guard = watchClientClose(res)
    try {
      const result = await readingService.submit({
        articleId,
        idx,
        translation: payload.translation,
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

  router.post('/:id/sentences/:idx/skip', (req, res) => {
    const articleId = parseIdParam(req.params.id, 'id')
    const idx = parseNonNegativeIntParam(req.params.idx, 'idx')
    res.json({ ok: true, ...readingService.skip({ articleId, idx }) })
  })

  router.post('/:id/sentences/:idx/chat', async (req, res, next) => {
    const articleId = parseIdParam(req.params.id, 'id')
    const idx = parseNonNegativeIntParam(req.params.idx, 'idx')
    const payload = parseOrThrow(chatMessageSchema, req.body ?? {})
    const guard = watchClientClose(res)
    try {
      await readingService.prepareChat({ articleId, idx })
    } catch (error) {
      guard.cleanup()
      if (guard.isAborted()) return
      next(error)
      return
    }

    const stream = startEventStream(res)
    try {
      const result = await readingService.streamChat({
        articleId,
        idx,
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

  router.post('/:id/re-read', (req, res) => {
    const id = parseIdParam(req.params.id, 'id')
    res.json({ ok: true, ...articleService.reRead(id) })
  })

  return router
}

export default createArticlesRouter
