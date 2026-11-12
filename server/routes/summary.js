import express from 'express'
import { parseIdParam, parseOrThrow, summaryNotesSchema } from '../lib/validate.js'

/**
 * 学习小结路由（02-DATA-API §6.2 #26~#28）。
 * @param {{ summaryService: ReturnType<typeof import('../services/summaryService.js').createSummaryService> }} deps
 */
export function createSummaryRouter({ summaryService }) {
  const router = express.Router()

  router.get('/:id/summary/export', (req, res) => {
    const articleId = parseIdParam(req.params.id, 'id')
    const { markdown, filename } = summaryService.exportMarkdown(articleId)
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(markdown)
  })

  router.get('/:id/summary', (req, res) => {
    const articleId = parseIdParam(req.params.id, 'id')
    res.json({ ok: true, ...summaryService.get(articleId) })
  })

  router.patch('/:id/summary', (req, res) => {
    const articleId = parseIdParam(req.params.id, 'id')
    const payload = parseOrThrow(summaryNotesSchema, req.body ?? {})
    res.json({ ok: true, ...summaryService.saveNotes(articleId, payload.userNotes) })
  })

  return router
}

export default createSummaryRouter
