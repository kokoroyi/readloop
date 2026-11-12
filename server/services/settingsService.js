/**
 * 设置业务：默认值深合并、分区合并保存、apiKey 打码与三态语义。
 * 契约见 02-DATA-API §6、04-ENGINEERING §5.6；本模块不直接访问 SQL（走 settings repository）。
 */

/**
 * 设置默认值（04-ENGINEERING §5.6）。新增设置项只改这里；使用前必须 structuredClone，
 * 禁止直接修改本对象。
 */
export const SETTINGS_DEFAULTS = Object.freeze({
  ai: {
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: '',
    timeoutMs: 60000,
    retry: 2
  },
  appearance: {
    theme: 'light',
    fontSize: 19,
    lineHeight: 1.9,
    maxWidth: 720,
    adhd: {
      mode: 'off',
      semanticDensity: 0.25,
      splitRatio: 0.35,
      leadScale: 1.12,
      letterSpacing: 0.04,
      wordSpacing: 0.1,
      baseScale: 1.08
    }
  },
  recap: {
    questions: 'auto',
    showReference: true,
    floatWindowDefaultOpen: true
  }
})

/** 打码前缀：GET /api/settings 的 apiKey 一律为 "****"+末 4 位 */
const MASKED_API_KEY_PATTERN = /^\*{4}/

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 深合并：patch 里出现的键覆盖 base，对象递归合并，数组/原始值整体替换。
 * 返回新对象，不修改入参（base 与 patch 都不会被改写）。
 * @template T
 * @param {T} base
 * @param {unknown} patch
 * @returns {T}
 */
export function mergeDeep(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === undefined ? base : patch
  }
  const output = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergeDeep(output[key], value)
    } else {
      output[key] = value
    }
  }
  return output
}

/**
 * 默认值副本（每次返回全新对象，可安全修改）。
 * @returns {typeof SETTINGS_DEFAULTS}
 */
export function cloneDefaults() {
  return structuredClone(SETTINGS_DEFAULTS)
}

/**
 * 是否打码串（前端回传打码值表示“保留原 Key”）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isMaskedApiKey(value) {
  return typeof value === 'string' && MASKED_API_KEY_PATTERN.test(value)
}

/**
 * apiKey 打码：未设置返回空串，已设置返回 "****"+末 4 位。
 * @param {unknown} apiKey
 * @returns {string}
 */
export function maskApiKey(apiKey) {
  if (typeof apiKey !== 'string') return ''
  const trimmed = apiKey.trim()
  if (trimmed.length === 0) return ''
  return `****${trimmed.slice(-4)}`
}

/**
 * AI 是否配置完整（baseUrl + apiKey + model 均非空）。
 * @param {unknown} ai settings.ai
 * @returns {boolean}
 */
export function isAiConfigured(ai) {
  if (!isPlainObject(ai)) return false
  const { baseUrl, apiKey, model } = /** @type {Record<string, unknown>} */ (ai)
  return (
    typeof baseUrl === 'string' &&
    baseUrl.trim().length > 0 &&
    typeof apiKey === 'string' &&
    apiKey.trim().length > 0 &&
    typeof model === 'string' &&
    model.trim().length > 0
  )
}

/**
 * 应用 apiKey 三态：省略或打码 → 保留原值；空串 → 清空；新值 → 覆盖。
 * @param {Record<string, unknown>} next 合并后的 ai 分区
 * @param {Record<string, unknown>} current 库内现有 ai 分区（含默认值）
 * @param {Record<string, unknown>} incoming 本次提交的 ai 分区
 * @returns {Record<string, unknown>} 新 ai 分区（不含计算字段 apiKeySet）
 */
function applyApiKeyRule(next, current, incoming) {
  const currentKey = typeof current.apiKey === 'string' ? current.apiKey : ''
  let apiKey = currentKey
  if (Object.prototype.hasOwnProperty.call(incoming, 'apiKey')) {
    const submitted = typeof incoming.apiKey === 'string' ? incoming.apiKey.trim() : ''
    if (submitted.length === 0) {
      apiKey = ''
    } else if (isMaskedApiKey(submitted)) {
      apiKey = currentKey
    } else {
      apiKey = submitted
    }
  }
  const output = { ...next, apiKey }
  delete output.apiKeySet
  return output
}

/** 设置分区名（顺序稳定，便于日志与测试） */
const SECTIONS = ['ai', 'appearance', 'recap']

/**
 * 创建设置服务。
 * @param {{
 *   repository: ReturnType<typeof import('../db/repositories/settings.js').createSettingsRepository>,
 *   logger?: { warn: (module: string, message: string, detail?: unknown) => void }
 * }} options
 */
export function createSettingsService({ repository, logger } = {}) {
  /**
   * 读取“默认值 + 库值”深合并后的明文设置（内部使用，绝不直接返回给前端）。
   * @returns {typeof SETTINGS_DEFAULTS}
   */
  function readRaw() {
    const { values, corruptKeys } = repository.getAll()
    if (corruptKeys.length > 0 && logger) {
      logger.warn('settings', '部分设置 JSON 损坏，已回退默认值', { corruptKeys })
    }
    return mergeDeep(cloneDefaults(), values)
  }

  /**
   * 转成前端可见的设置：apiKey 打码、补 apiKeySet。
   * @param {typeof SETTINGS_DEFAULTS} raw
   * @returns {typeof SETTINGS_DEFAULTS & { ai: { apiKeySet: boolean } }}
   */
  function toPublic(raw) {
    const settings = structuredClone(raw)
    if (!isPlainObject(settings.ai)) settings.ai = cloneDefaults().ai
    const apiKey = typeof settings.ai.apiKey === 'string' ? settings.ai.apiKey : ''
    settings.ai.apiKey = maskApiKey(apiKey)
    settings.ai.apiKeySet = apiKey.trim().length > 0
    return settings
  }

  return {
    /**
     * GET /api/settings 的业务结果。
     * @returns {{ settings: ReturnType<typeof toPublic> }}
     */
    get() {
      return { settings: toPublic(readRaw()) }
    },

    /**
     * 内部读取明文设置（AI 调用/health 使用，禁止直接响应给前端）。
     * @returns {typeof SETTINGS_DEFAULTS}
     */
    getRaw() {
      return structuredClone(readRaw())
    },

    /**
     * PUT /api/settings：分区合并保存（保留未知键与未提交分区）。
     * @param {{ ai?: Record<string, unknown>, appearance?: Record<string, unknown>, recap?: Record<string, unknown> }} patch zod 校验后的分区子集
     * @returns {{ settings: ReturnType<typeof toPublic> }}
     */
    save(patch) {
      const raw = readRaw()
      /** @type {Record<string, unknown>} */
      const writes = {}
      for (const section of SECTIONS) {
        if (!patch || !Object.prototype.hasOwnProperty.call(patch, section)) continue
        const incoming = isPlainObject(patch[section]) ? patch[section] : {}
        const current = isPlainObject(raw[section]) ? raw[section] : {}
        let next = mergeDeep(current, incoming)
        if (section === 'ai') next = applyApiKeyRule(next, current, incoming)
        writes[section] = next
      }
      if (Object.keys(writes).length > 0) repository.setMany(writes)
      return { settings: toPublic(readRaw()) }
    },

    /**
     * AI 是否已配置（health 与 AI 路由使用）。
     * @returns {boolean}
     */
    isAiConfigured() {
      return isAiConfigured(readRaw().ai)
    }
  }
}
