/**
 * AI 配置草稿的纯函数：默认值草稿、校验、脏检查、提交载荷与测试结果格式化。
 * 与组件解耦，便于复用与单测（M1 只被 AiConfigSection 使用）。
 */

/** 新建草稿的默认值（秒为 UI 单位，提交时换算成 timeoutMs）。 */
export function emptyAiDraft() {
  return { baseUrl: '', apiKey: '', model: '', timeoutSeconds: 60, retry: 2 }
}

/**
 * 从已保存设置生成表单草稿；apiKey 不回显（打码值只做占位提示）。
 * @param {{ baseUrl: string, model: string, timeoutMs: number, retry: number }} ai
 */
export function aiDraftFromSettings(ai) {
  return {
    baseUrl: ai.baseUrl,
    apiKey: '',
    model: ai.model,
    timeoutSeconds: Math.round(ai.timeoutMs / 1000),
    retry: ai.retry
  }
}

/**
 * 校验草稿，返回字段错误映射（空对象表示合法）。
 * @param {{ baseUrl: string, model: string, timeoutSeconds: number, retry: number }} draft
 * @returns {Record<string, string>}
 */
export function validateAiDraft(draft) {
  const errors = {}
  const baseUrl = draft.baseUrl.trim()
  if (!baseUrl) {
    errors.baseUrl = '请填写接口地址'
  } else {
    try {
      const parsed = new URL(baseUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.baseUrl = '只支持 http:// 或 https:// 接口'
      }
    } catch {
      errors.baseUrl = '地址格式不正确，例如 https://api.deepseek.com'
    }
  }
  if (!draft.model.trim()) errors.model = '请填写模型名称，或点「获取模型」'
  const timeout = Number(draft.timeoutSeconds)
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600) {
    errors.timeout = '超时需为 1–600 的整数秒'
  }
  const retry = Number(draft.retry)
  if (!Number.isInteger(retry) || retry < 0 || retry > 5) {
    errors.retry = '重试次数需为 0–5 的整数'
  }
  return errors
}

/**
 * 草稿与已保存值是否有差异（apiKey 只要动过就算脏，因为清空是有效操作）。
 * @param {{ baseUrl: string, model: string, timeoutSeconds: number, retry: number }} draft
 * @param {{ baseUrl: string, model: string, timeoutMs: number, retry: number }} ai
 * @param {boolean} apiKeyTouched
 */
export function isAiDraftDirty(draft, ai, apiKeyTouched) {
  return (
    draft.baseUrl.trim() !== ai.baseUrl ||
    draft.model.trim() !== ai.model ||
    Math.round(Number(draft.timeoutSeconds)) !== Math.round(ai.timeoutMs / 1000) ||
    Number(draft.retry) !== ai.retry ||
    apiKeyTouched
  )
}

/**
 * 生成 PUT /api/settings 的 ai 分区载荷。apiKey 只有用户动过才回传，
 * 避免把打码值/空值写回去覆盖已保存密钥。
 * @param {{ baseUrl: string, apiKey: string, model: string, timeoutSeconds: number, retry: number }} draft
 * @param {boolean} apiKeyTouched
 */
export function toAiPayload(draft, apiKeyTouched) {
  const payload = {
    baseUrl: draft.baseUrl.trim(),
    model: draft.model.trim(),
    timeoutMs: Math.round(Number(draft.timeoutSeconds) * 1000),
    retry: Number(draft.retry)
  }
  if (apiKeyTouched) payload.apiKey = draft.apiKey
  return payload
}

/**
 * 把 POST /api/ai/test 成功响应整理成展示用结果。
 * @param {{ mode?: string, models?: string[], modelCount?: number, latencyMs?: number }} data
 * @param {boolean} autoSaved 测试前是否自动保存过草稿
 */
export function toAiTestResult(data, autoSaved) {
  const models = Array.isArray(data && data.models) ? data.models : []
  const modelCount = typeof (data && data.modelCount) === 'number' ? data.modelCount : models.length
  const latencyMs = Number(data && data.latencyMs)
  return {
    ok: true,
    mode: data && data.mode,
    modelCount,
    latencyText: formatLatency(latencyMs),
    testedAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    autoSaved
  }
}

/**
 * 耗时展示：1 秒以内用毫秒（本地接口很常见），否则保留一位小数秒。
 * @param {number} latencyMs
 * @returns {string}
 */
export function formatLatency(latencyMs) {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return '—'
  if (latencyMs < 1000) return `${Math.round(latencyMs)}ms`
  return `${(latencyMs / 1000).toFixed(1)}s`
}
