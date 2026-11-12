import express from 'express'
import {
  cleanQuery,
  parseIdParam,
  parseOrThrow,
  wordCreateSchema,
  wordsExportQuerySchema,
  wordsQuerySchema
} from '../lib/validate.js'

/**
 * 词库路由（02-DATA-API §6.2 #29~#32）。
 * @param {{ wordService: ReturnType<typeof import('../services/wordService.js').createWordService> }} deps
 */
export function createWordsRouter({ wordService }) {
  const router = express.Router()

  router.get('/export', (req, res) => {
    const { format } = parseOrThrow(wordsExportQuerySchema, cleanQuery(req.query))
    const result = wordService.exportWords(format)
    if (format === 'json') {
      res.json({ ok: true, items: result.items })
      return
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
    res.send(result.body)
  })

  router.get('/', (req, res) => {
    const query = parseOrThrow(wordsQuerySchema, cleanQuery(req.query))
    res.json({ ok: true, ...wordService.list(query) })
  })

  router.post('/', (req, res) => {
    const payload = parseOrThrow(wordCreateSchema, req.body ?? {})
    res.json({ ok: true, ...wordService.add(payload) })
  })

  router.delete('/:id', (req, res) => {
    const id = parseIdParam(req.params.id, 'id')
    wordService.remove(id)
    res.json({ ok: true })
  })

  return router
}

export default createWordsRouter
