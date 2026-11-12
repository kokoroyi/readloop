import { isMaskedApiKey } from './settingsService.js'

/**
 * 把请求里的 AI 覆盖字段合并到已保存配置上（测试连接用）。
 * 打码 apiKey / 空字符串视为“沿用已保存值”；baseUrl/model 为空同样忽略。
 * @param {Record<string, unknown>} storedAi
 * @param {Record<string, unknown> | null | undefined} overrides
 * @returns {Record<string, unknown>}
 */
function mergeAiOverrides(storedAi, overrides) {
  const merged = { ...storedAi }
  if (!overrides || typeof overrides !== 'object') return merged
  if (typeof overrides.baseUrl === 'string' && overrides.baseUrl.trim().length > 0) {
    merged.baseUrl = overrides.baseUrl.trim()
  }
  if (typeof overrides.model === 'string' && overrides.model.trim().length > 0) {
    merged.model = overrides.model.trim()
  }
  if (typeof overrides.apiKey === 'string') {
    const apiKey = overrides.apiKey.trim()
    if (apiKey.length > 0 && !isMaskedApiKey(apiKey)) merged.apiKey = apiKey
  }
  if (typeof overrides.timeoutMs === 'number') merged.timeoutMs = overrides.timeoutMs
  if (typeof overrides.retry === 'number') merged.retry = overrides.retry
  return merged
}

/**
 * AI 设置测试与模型列表业务层（路由不直接调 AI，见 04-ENGINEERING §5.3）。
 * @param {{
 *   settingsService: ReturnType<typeof import('./settingsService.js').createSettingsService>,
 *   aiClient: ReturnType<typeof import('../lib/aiClient.js').createAiClient>
 * }} options
 */
export function createAiService({ settingsService, aiClient }) {
  /**
   * @param {Record<string, unknown> | null} [overrides]
   * @returns {Record<string, unknown>}
   */
  function currentAi(overrides) {
    const raw = settingsService.getRaw()
    return mergeAiOverrides(/** @type {Record<string, unknown>} */ (raw.ai ?? {}), overrides)
  }

  return {
    /**
     * GET /api/ai/models。
     * @returns {Promise<{ models: string[], baseUrl: string, endpoint: string, latencyMs: number }>}
     */
    listModels() {
      return aiClient.listModels(currentAi(null))
    },

    /**
     * POST /api/ai/test。
     * @param {Record<string, unknown> | null} [overrides]
     * @returns {Promise<{ mode: 'models' | 'chat', models: string[], model: string, latencyMs: number }>}
     */
    test(overrides) {
      return aiClient.testConnection(currentAi(overrides))
    }
  }
}

export default createAiService
