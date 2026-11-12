import Database from 'better-sqlite3'
import { AppError } from './errors.js'

/**
 * ECDICT 词典服务（TECH-DESIGN §4.7）：
 * - 只读连接 config.dictPath（%APPDATA%\readloop\stardict.db），懒加载；
 * - lookup：小写精确 → exchange 的 0: 原型（went→go）→ 常见词形回退 → 404；
 * - suggest：前缀补全，最多 10 条；
 * - 词典缺失/损坏统一 DICT_UNAVAILABLE 503。
 */

const SUGGEST_LIMIT = 10
const TRANSLATION_MAX_LINES = 4
const UNAVAILABLE_RETRY_MS = 5000

/** 可选列（不同 ECDICT 版本可能缺列，按实际 columns 拼 SELECT） */
const OPTIONAL_COLUMNS = [
  'phonetic',
  'translation',
  'pos',
  'collins',
  'bnc',
  'frq',
  'tag',
  'exchange',
  'sw'
]

/**
 * 单词归一化：trim + 小写。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeWord(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

/**
 * 从 ECDICT exchange 中取原型（0: 片段），例如 "0:go/1:p" → "go"。
 * @param {unknown} exchange
 * @returns {string | null}
 */
export function parseExchangeLemma(exchange) {
  if (typeof exchange !== 'string' || exchange.length === 0) return null
  for (const part of exchange.split('/')) {
    const separator = part.indexOf(':')
    if (separator <= 0) continue
    const code = part.slice(0, separator)
    const value = part.slice(separator + 1).trim()
    if (code === '0' && value.length > 0) return value
  }
  return null
}

/**
 * 释义取前 N 行（默认 4 行，02-DATA-API §6.3）。
 * @param {unknown} translation
 * @param {number} [maxLines]
 * @returns {string}
 */
export function translationPreview(translation, maxLines = TRANSLATION_MAX_LINES) {
  if (typeof translation !== 'string') return ''
  return translation
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, maxLines)
    .join('\n')
}

/**
 * 正数词频保留，0/负数视为未知返回 null。
 * @param {unknown} value
 * @returns {number | null}
 */
function positiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function textValue(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * 常见屈折形式的原型候选（exact 查询兜底）。
 * @param {string} word 小写单词
 * @returns {string[]}
 */
export function inflectedCandidates(word) {
  const candidates = new Set()
  /**
   * @param {string} value
   */
  const add = (value) => {
    if (value.length >= 2 && value !== word) candidates.add(value)
  }
  if (word.endsWith('ies')) add(`${word.slice(0, -3)}y`)
  if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`)
  if (word.endsWith('ves')) add(`${word.slice(0, -3)}f`)
  if (word.endsWith('es')) add(word.slice(0, -2))
  if (word.endsWith('s')) add(word.slice(0, -1))
  if (word.endsWith('ed')) {
    const stem = word.slice(0, -2)
    add(stem)
    add(word.slice(0, -1))
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      add(stem.slice(0, -1))
    }
  }
  if (word.endsWith('ing')) {
    const stem = word.slice(0, -3)
    add(stem)
    add(`${stem}e`)
    if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
      add(stem.slice(0, -1))
    }
  }
  if (word.endsWith('est')) add(word.slice(0, -3))
  if (word.endsWith('er')) add(word.slice(0, -2))
  return [...candidates]
}

/**
 * LIKE 前缀转义（% _ \）。
 * @param {string} value
 * @returns {string}
 */
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

/**
 * 创建词典实例（懒加载只读连接）。
 * @param {{ dictPath: string, logger?: { warn: (module: string, message: string, detail?: unknown) => void } }} options
 */
export function createDictionary({ dictPath, logger } = {}) {
  /** @type {import('better-sqlite3').Database | null} */
  let db = null
  /** @type {string[]} */
  let columns = []
  /** @type {Record<string, import('better-sqlite3').Statement>} */
  let statements = {}
  /** @type {AppError | null} */
  let cachedUnavailable = null
  let lastFailureAt = 0
  let warnedFailure = false

  /**
   * 关闭连接并清空缓存（不抛错）。
   */
  function close() {
    if (db) {
      try {
        db.close()
      } catch {
        // 连接已关闭时忽略
      }
    }
    db = null
    columns = []
    statements = {}
  }

  /**
   * @returns {AppError}
   */
  function unavailableError() {
    if (cachedUnavailable) return cachedUnavailable
    return new AppError('DICT_UNAVAILABLE', '词典缺失或不可读，请检查数据目录下的 stardict.db')
  }

  /**
   * 确保连接可用；失败时抛出 DICT_UNAVAILABLE（5 秒内复用失败结果避免反复打开大文件）。
   */
  function ensureOpen() {
    if (db) return
    if (lastFailureAt > 0 && Date.now() - lastFailureAt < UNAVAILABLE_RETRY_MS) {
      throw unavailableError()
    }
    try {
      if (typeof dictPath !== 'string' || dictPath.length === 0) throw new Error('未配置词典路径')
      const connection = new Database(dictPath, { readonly: true, fileMustExist: true })
      const table = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stardict'")
        .get()
      if (!table) throw new Error('stardict 表不存在')
      const tableColumns = connection
        .prepare('PRAGMA table_info(stardict)')
        .all()
        .map((row) => row.name)
      if (!tableColumns.includes('word')) throw new Error('stardict 缺少 word 列')
      db = connection
      columns = tableColumns
      statements = {}
      cachedUnavailable = null
      lastFailureAt = 0
      warnedFailure = false
    } catch (error) {
      close()
      lastFailureAt = Date.now()
      cachedUnavailable = new AppError(
        'DICT_UNAVAILABLE',
        '词典缺失或不可读，请检查数据目录下的 stardict.db',
        {
          cause: error
        }
      )
      if (!warnedFailure && logger) {
        warnedFailure = true
        logger.warn('dictionary', '词典不可用', {
          dictPath,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      throw cachedUnavailable
    }
  }

  /**
   * select 列清单（按实际 schema 裁掉缺列）。
   * @returns {string}
   */
  function selectColumns() {
    const available = OPTIONAL_COLUMNS.filter((column) => columns.includes(column))
    return ['word', ...available].join(', ')
  }

  /**
   * @param {string} key
   * @param {string} sql
   * @returns {import('better-sqlite3').Statement}
   */
  function statement(key, sql) {
    if (!statements[key]) statements[key] = db.prepare(sql)
    return statements[key]
  }

  /**
   * @param {string} word 小写单词
   * @returns {Row | null}
   */
  function findByWord(word) {
    const row = statement(
      'byWord',
      `SELECT ${selectColumns()} FROM stardict WHERE word = ? LIMIT 1`
    ).get(word)
    return row ?? null
  }

  /**
   * 用 sw（去符号小写）兜底查一次。
   * @param {string} word
   * @returns {Row | null}
   */
  function findBySw(word) {
    if (!columns.includes('sw')) return null
    const sw = word.replace(/[^a-z0-9]/g, '')
    if (sw.length === 0) return null
    const row = statement(
      'bySw',
      `SELECT ${selectColumns()} FROM stardict WHERE sw = ? LIMIT 1`
    ).get(sw)
    return row ?? null
  }

  /**
   * 前缀补全。
   * @param {string} rawQuery
   * @returns {string[]}
   */
  function suggest(rawQuery) {
    ensureOpen()
    const query = normalizeWord(rawQuery)
    if (query.length === 0) return []
    const order = columns.includes('frq')
      ? 'CASE WHEN frq IS NULL OR frq <= 0 THEN 1 ELSE 0 END, frq'
      : 'word'
    const rows = statement(
      'suggest',
      `SELECT word FROM stardict WHERE word LIKE ? ESCAPE '\\' ORDER BY ${order} LIMIT ${SUGGEST_LIMIT}`
    ).all(`${escapeLike(query)}%`)
    return rows.map((row) => row.word).filter((word) => typeof word === 'string' && word.length > 0)
  }

  /**
   * 查词（02-DATA-API §6.3 / TECH-DESIGN §4.7）。
   * @param {string} rawWord
   * @returns {{ word: string, lemma: string, phonetic: string, translation: string, pos: string, collins: number | null, bnc: number | null, frq: number | null, tag: string }}
   */
  function lookup(rawWord) {
    const query = normalizeWord(rawWord)
    if (query.length === 0) {
      throw new AppError('VALIDATION', '查词内容不能为空', {
        detail: { fields: [{ path: 'word', message: '不能为空' }] }
      })
    }
    ensureOpen()

    let row = findByWord(query) ?? findBySw(query)
    let lemma = query
    /** @type {Row | null} */
    let baseRow = null

    if (row) {
      const parsedLemma = parseExchangeLemma(row.exchange)
      if (parsedLemma) lemma = parsedLemma
      if (lemma !== query) baseRow = findByWord(lemma)
    } else {
      for (const candidate of inflectedCandidates(query)) {
        const found = findByWord(candidate)
        if (!found) continue
        row = found
        lemma = parseExchangeLemma(found.exchange) || candidate
        baseRow = lemma !== candidate ? findByWord(lemma) : found
        break
      }
    }

    if (!row) {
      /** @type {string[]} */
      let suggestions = []
      try {
        suggestions = suggest(query)
      } catch {
        // 词典刚失效时不影响 NOT_FOUND 主错误
        suggestions = []
      }
      throw new AppError('NOT_FOUND', `词典未收录「${String(rawWord).trim()}」`, {
        detail: { word: query, suggestions }
      })
    }

    const entryRow = baseRow ?? row
    return {
      word: query,
      lemma: lemma || query,
      phonetic: textValue(entryRow.phonetic) || textValue(row.phonetic),
      translation: translationPreview(entryRow.translation) || translationPreview(row.translation),
      pos: textValue(entryRow.pos) || textValue(row.pos),
      collins: positiveNumber(entryRow.collins) ?? positiveNumber(row.collins),
      bnc: positiveNumber(entryRow.bnc) ?? positiveNumber(row.bnc),
      frq: positiveNumber(entryRow.frq) ?? positiveNumber(row.frq),
      tag: textValue(entryRow.tag) || textValue(row.tag)
    }
  }

  return {
    lookup,
    suggest,
    close,
    /**
     * 词典当前是否可用（会尝试打开一次，结果按失败 TTL 缓存）。
     * @returns {boolean}
     */
    isAvailable() {
      try {
        ensureOpen()
        return true
      } catch {
        return false
      }
    }
  }
}

/**
 * @typedef {Record<string, unknown>} Row
 */

export default createDictionary
