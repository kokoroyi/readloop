import express from 'express'
import {
  cleanQuery,
  dictLookupQuerySchema,
  dictSuggestQuerySchema,
  parseOrThrow
} from '../lib/validate.js'

/**
 * 词典路由（02-DATA-API §6.2 #6/#7）。
 * @param {{ dictionary: ReturnType<typeof import('../lib/dictionary.js').createDictionary> }} deps
 */
export function createDictRouter({ dictionary }) {
  const router = express.Router()

  router.get('/lookup', (req, res) => {
    const { word } = parseOrThrow(dictLookupQuerySchema, cleanQuery(req.query))
    res.json({ ok: true, entry: dictionary.lookup(word) })
  })

  router.get('/suggest', (req, res) => {
    const { q } = parseOrThrow(dictSuggestQuerySchema, cleanQuery(req.query))
    res.json({ ok: true, items: dictionary.suggest(q) })
  })

  return router
}

export default createDictRouter
