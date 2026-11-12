import { logger } from './logger.js'

/**
 * 02-DATA-API §6.5 错误码表：code → HTTP 状态 / 是否可重试 / 默认中文文案。
 * 新增错误码只改这里，路由与 service 用 AppError(code) 抛出。
 */
export const ERROR_DEFS = Object.freeze({
  VALIDATION: { status: 400, retryable: false, message: '请求参数不合法' },
  NOT_FOUND: { status: 404, retryable: false, message: '资源不存在' },
  DUPLICATE_ARTICLE: { status: 409, retryable: false, message: '文章内容重复' },
  STATE_CONFLICT: { status: 409, retryable: false, message: '当前状态不允许该操作' },
  ALREADY_CORRECTED: { status: 409, retryable: false, message: '该句已批改，不能重复提交' },
  ALREADY_ANSWERED: { status: 409, retryable: false, message: '该题已作答' },
  AI_NOT_CONFIGURED: { status: 400, retryable: false, message: 'AI 未配置' },
  AI_UPSTREAM: { status: 502, retryable: true, message: 'AI 服务暂时不可用' },
  AI_TIMEOUT: { status: 504, retryable: true, message: 'AI 服务响应超时' },
  AI_RATE_LIMIT: { status: 429, retryable: true, message: 'AI 服务请求过于频繁' },
  AI_FORMAT: { status: 502, retryable: true, message: 'AI 输出格式不合法' },
  QUEUE_TIMEOUT: { status: 429, retryable: true, message: 'AI 排队超时' },
  FILE_TOO_LARGE: { status: 413, retryable: false, message: '请求体过大' },
  UNSUPPORTED_FORMAT: { status: 415, retryable: false, message: '不支持的文件格式' },
  DICT_UNAVAILABLE: { status: 503, retryable: false, message: '词典缺失或不可读' },
  DB_ERROR: { status: 500, retryable: true, message: '数据库操作失败' },
  INTERNAL: { status: 500, retryable: false, message: '服务器内部错误' }
})

/**
 * 业务错误：携带 02-DATA-API §6.5 错误码、HTTP 状态、可重试标记与可选 detail。
 */
export class AppError extends Error {
  /**
   * @param {keyof typeof ERROR_DEFS} code
   * @param {string} [message] 面向用户的中文文案，缺省用错误码默认文案
   * @param {{ status?: number, retryable?: boolean, detail?: unknown, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    const def = ERROR_DEFS[code] ?? ERROR_DEFS.INTERNAL
    super(message || def.message)
    this.name = 'AppError'
    this.code = ERROR_DEFS[code] ? code : 'INTERNAL'
    this.status = Number.isInteger(options.status) ? options.status : def.status
    this.retryable = typeof options.retryable === 'boolean' ? options.retryable : def.retryable
    this.detail = options.detail
    if (options.cause !== undefined) this.cause = options.cause
    if (Error.captureStackTrace) Error.captureStackTrace(this, AppError)
  }
}

/**
 * @param {unknown} error
 * @returns {error is AppError}
 */
export function isAppError(error) {
  return error instanceof AppError
}

/**
 * 把任意异常归一成语义错误（body-parser / SQLite / 未知异常）。
 * @param {unknown} error
 * @returns {AppError}
 */
export function normalizeError(error) {
  if (error instanceof AppError) return error
  if (error && typeof error === 'object') {
    const type = /** @type {{ type?: string, status?: number, code?: string }} */ (error).type
    if (type === 'entity.too.large') {
      return new AppError('FILE_TOO_LARGE', '请求体超过 3MB 限制', {
        detail: { limit: '3mb' },
        cause: error
      })
    }
    if (type === 'entity.parse.failed') {
      return new AppError('VALIDATION', '请求体不是合法的 JSON', {
        detail: { fields: [{ path: 'body', message: 'JSON 解析失败' }] },
        cause: error
      })
    }
    if (/** @type {{ name?: string }} */ (error).name === 'SqliteError') {
      return new AppError('DB_ERROR', '数据库操作失败', {
        detail: { sqliteCode: /** @type {{ code?: string }} */ (error).code },
        cause: error
      })
    }
  }
  return new AppError('INTERNAL', '服务器内部错误', { cause: error })
}

/**
 * 统一错误信封：{ ok:false, error:{ code, message, retryable, detail? } }。
 * 4xx 不记录堆栈；5xx 记录日志并附带 requestId 方便对照日志。
 * @param {unknown} error
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
export function errorHandler(error, req, res, _next) {
  const appError = normalizeError(error)
  const requestId = req.id ?? String(res.getHeader('X-Request-Id') ?? '')
  const isServerError = appError.status >= 500
  if (isServerError) {
    logger.error('http', `${req.method} ${req.path} → ${appError.code}`, {
      requestId,
      status: appError.status,
      message: appError.message,
      detail: appError.detail,
      stack: error instanceof Error ? error.stack : String(error)
    })
  } else {
    logger.debug('http', `${req.method} ${req.path} → ${appError.code}`, {
      requestId,
      status: appError.status,
      message: appError.message
    })
  }

  /** @type {{ code: string, message: string, retryable: boolean, detail?: unknown }} */
  const payload = {
    code: appError.code,
    message: appError.message,
    retryable: appError.retryable
  }
  if (isServerError) {
    payload.detail = { ...(isPlainObject(appError.detail) ? appError.detail : {}), requestId }
  } else if (appError.detail !== undefined) {
    payload.detail = appError.detail
  }
  res.status(appError.status).json({ ok: false, error: payload })
}

/**
 * 404 兜底：/api 返回 JSON 错误信封，其余路径返回纯文本。
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function notFoundHandler(req, res) {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    res.status(404).json({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: '接口不存在',
        retryable: false,
        detail: { path: req.path }
      }
    })
    return
  }
  res.status(404).type('text/plain; charset=utf-8').send('Not Found')
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
