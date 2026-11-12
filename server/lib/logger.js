import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { nowIso } from './time.js'

/**
 * 统一日志：写 logs 表 + 文件（%APPDATA%\readloop\logs\server.log，5MB 轮转保留 3 份）。
 * 敏感字段过滤规则见 04-ENGINEERING §5.5：apiKey/Authorization 打码，prompt 只保留前 500 字。
 */

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 })
const MAX_DETAIL_CHARS = 2000
const PROMPT_PREVIEW_CHARS = 500
const MAX_ARRAY_ITEMS = 50
const MAX_DEPTH = 5
const MAX_PENDING_LOGS = 100

/** 需要整体打码的字段（大小写不敏感） */
const SENSITIVE_KEY = /^(?:api[-_]?key|authorization|password|secret|access[-_]?token)$/i
/** prompt 类字段只保留预览（前 500 字） */
const PROMPT_KEY = /prompt/i

const state = {
  db: null,
  logDir: config.logsDir,
  filePath: config.logFile,
  level: LEVELS[config.logLevel] ? config.logLevel : 'info',
  pendingRows: [],
  fileWarned: false
}

/**
 * 初始化日志模块。
 * - db：打开并迁移后传入，日志同时落 logs 表；迁移前的日志先缓存，建表后补写。
 * - logDir：覆盖日志目录（测试用）。
 * @param {{ db?: import('better-sqlite3').Database | null, logDir?: string, level?: string }} [options]
 */
export function initLogger(options = {}) {
  if (options.db !== undefined) state.db = options.db
  if (options.logDir) {
    state.logDir = options.logDir
    state.filePath = path.join(options.logDir, path.basename(state.filePath))
  }
  if (options.level && LEVELS[options.level]) state.level = options.level
  if (state.db) flushPendingRows()
}

/**
 * 把字符串截断到指定长度（超长补省略标记）。
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…[截断]`
}

/**
 * prompt 类字段只保留前 500 字预览（非字符串先序列化）。
 * @param {unknown} value
 * @returns {string}
 */
function promptPreview(value) {
  let text
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value) ?? String(value)
    } catch {
      // 循环引用等无法序列化时用类型占位
      text = '[unserializable prompt]'
    }
  }
  return truncate(text, PROMPT_PREVIEW_CHARS)
}

/**
 * 递归过滤敏感信息，返回可安全写入日志的值。
 * @param {unknown} detail
 * @param {number} [depth]
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
export function sanitizeDetail(detail, depth = 0, seen = new WeakSet()) {
  if (detail === undefined) return undefined
  if (detail === null || typeof detail !== 'object') return detail
  if (depth > MAX_DEPTH) return '[depth-limit]'
  if (detail instanceof Error) {
    return {
      name: detail.name,
      message: detail.message,
      stack: detail.stack ? detail.stack.split('\n').slice(0, 6).join('\n') : undefined
    }
  }
  if (seen.has(detail)) return '[circular]'
  seen.add(detail)
  if (Array.isArray(detail)) {
    return detail.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeDetail(item, depth + 1, seen))
  }
  const output = {}
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = '[REDACTED]'
      continue
    }
    if (PROMPT_KEY.test(key)) {
      output[key] = promptPreview(value)
      continue
    }
    output[key] = sanitizeDetail(value, depth + 1, seen)
  }
  return output
}

/**
 * detail 转成日志文本，最长 2000 字。
 * @param {unknown} detail
 * @returns {string}
 */
function detailToText(detail) {
  if (detail === undefined) return ''
  let text
  try {
    text = JSON.stringify(sanitizeDetail(detail))
  } catch {
    // sanitize 后仍无法序列化时退化为字符串
    text = String(detail)
  }
  if (text === undefined) return ''
  return truncate(text, MAX_DETAIL_CHARS)
}

/**
 * 日志文件到达上限后轮转：server.log → server.log.1 → server.log.2（保留 3 份）。
 */
function rotateIfNeeded() {
  let size = 0
  try {
    size = fs.statSync(state.filePath).size
  } catch {
    // 文件还不存在，无需轮转
    return
  }
  if (size < config.logRotateBytes) return
  for (let index = config.logRotateKeep - 1; index >= 1; index -= 1) {
    const to = `${state.filePath}.${index}`
    const from = index === 1 ? state.filePath : `${state.filePath}.${index - 1}`
    fs.rmSync(to, { force: true })
    try {
      fs.renameSync(from, to)
    } catch {
      // 源文件不存在时跳过该档（首次轮转的中间态）
    }
  }
}

/**
 * 追加一行日志到文件；文件不可写只告警一次，不影响主流程。
 * @param {string} line
 */
function writeFileLine(line) {
  try {
    fs.mkdirSync(state.logDir, { recursive: true })
    rotateIfNeeded()
    fs.appendFileSync(state.filePath, line, 'utf8')
  } catch (error) {
    if (!state.fileWarned) {
      state.fileWarned = true
      console.error('[logger] 写入日志文件失败:', error.message)
    }
  }
}

/**
 * 判断错误是否因 logs 表尚未创建（迁移前的日志缓存后补写）。
 * @param {Error} error
 * @returns {boolean}
 */
function isMissingTableError(error) {
  return Boolean(error && /no such table/i.test(String(error.message)))
}

/**
 * prepare 插入语句；logs 表不存在时返回 null。
 * @returns {import('better-sqlite3').Statement | null}
 */
function prepareInsert() {
  if (!state.db) return null
  try {
    return state.db.prepare(
      'INSERT INTO logs (level, module, message, detail, created_at) VALUES (?, ?, ?, ?, ?)'
    )
  } catch (error) {
    if (isMissingTableError(error)) return null
    return null
  }
}

/**
 * 把启动阶段缓存的日志补写进数据库。
 * @param {import('better-sqlite3').Statement} insert
 * @returns {boolean} 是否补写成功
 */
function flushPendingWith(insert) {
  if (state.pendingRows.length === 0) return true
  const pending = state.pendingRows
  state.pendingRows = []
  try {
    for (const row of pending) {
      insert.run(row.level, row.module, row.message, row.detail, row.createdAt)
    }
    return true
  } catch {
    // 补写失败（例如迁移仍在事务中）则保留剩余记录，下次再试
    state.pendingRows = pending.slice(-MAX_PENDING_LOGS)
    return false
  }
}

/**
 * 补写日志缓存（initLogger 传入 db 时调用）。
 */
function flushPendingRows() {
  const insert = prepareInsert()
  if (insert) flushPendingWith(insert)
}

/**
 * 写一条日志。
 * @param {'debug' | 'info' | 'warn' | 'error'} level
 * @param {string} module
 * @param {string} message
 * @param {unknown} [detail]
 */
function write(level, module, message, detail) {
  if (LEVELS[level] < LEVELS[state.level]) return
  const createdAt = nowIso()
  const safeModule = typeof module === 'string' && module.length > 0 ? module : 'app'
  const safeMessage = truncate(String(message ?? ''), 500)
  const detailText = detailToText(detail)
  const line = `${createdAt} ${level.toUpperCase().padEnd(5)} [${safeModule}] ${safeMessage}${
    detailText ? ` ${detailText}` : ''
  }\n`
  writeFileLine(line)

  const row = {
    level,
    module: safeModule,
    message: safeMessage,
    detail: detailText || null,
    createdAt
  }
  if (!state.db) return
  const insert = prepareInsert()
  if (!insert) {
    state.pendingRows.push(row)
    if (state.pendingRows.length > MAX_PENDING_LOGS) state.pendingRows.shift()
    return
  }
  if (!flushPendingWith(insert)) return
  try {
    insert.run(row.level, row.module, row.message, row.detail, row.createdAt)
  } catch {
    // 数据库写入失败时日志文件已记录，不能因日志反过来影响业务
  }
}

export const logger = {
  /**
   * @param {string} module
   * @param {string} message
   * @param {unknown} [detail]
   */
  debug(module, message, detail) {
    write('debug', module, message, detail)
  },
  /**
   * @param {string} module
   * @param {string} message
   * @param {unknown} [detail]
   */
  info(module, message, detail) {
    write('info', module, message, detail)
  },
  /**
   * @param {string} module
   * @param {string} message
   * @param {unknown} [detail]
   */
  warn(module, message, detail) {
    write('warn', module, message, detail)
  },
  /**
   * @param {string} module
   * @param {string} message
   * @param {unknown} [detail]
   */
  error(module, message, detail) {
    write('error', module, message, detail)
  }
}

export default logger
