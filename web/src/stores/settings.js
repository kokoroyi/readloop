/**
 * 设置 store（reactive 单例）。
 * 负责：settings 读取/分区保存、主题解析与应用、AI 状态（health）、阅读排版变量。
 */

import { computed, reactive } from 'vue'
import { normalizeAdhdParams } from '../lib/adhd.js'
import { get, put } from '../lib/api.js'
import { toast } from './toast.js'

const DEFAULT_AI = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  apiKeySet: false,
  model: '',
  timeoutMs: 60000,
  retry: 2
}

const DEFAULT_APPEARANCE = {
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
}

const DEFAULT_RECAP = {
  questions: 'auto',
  showReference: true,
  floatWindowDefaultOpen: true
}

export const THEME_OPTIONS = [
  { value: 'light', label: '纸感浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' }
]

export const ADHD_OPTIONS = [
  { value: 'off', label: '普通', hint: '不额外强调' },
  { value: 'bionic', label: 'Bionic', hint: '单词分段渐变加粗' },
  { value: 'semantic', label: '语义加粗', hint: '关键词加粗，重点更粗' },
  { value: 'highlight', label: '语义高亮', hint: '关键词暖色底，重点更深' }
]

export const PRIMARY_NAV = [
  { path: '/', label: '阅读台' },
  { path: '/library', label: '文章库' },
  { path: '/words', label: '词库' },
  { path: '/settings', label: '设置' }
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 用默认值深合并：仅补齐缺失字段，不丢后端未知键。 */
function mergeDefaults(defaults, incoming) {
  if (!isPlainObject(incoming)) return clone(defaults)
  const merged = clone(defaults)
  for (const key of Object.keys(incoming)) {
    const value = incoming[key]
    if (value === undefined) continue
    merged[key] = isPlainObject(value) && isPlainObject(merged[key]) ? mergeDefaults(merged[key], value) : clone(value)
  }
  return merged
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampInt(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback))
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

/** 归一化后端返回/本地草稿，保证数值范围与枚举合法。 */
export function normalizeSettings(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const ai = mergeDefaults(DEFAULT_AI, source.ai)
  const appearance = mergeDefaults(DEFAULT_APPEARANCE, source.appearance)
  const recap = mergeDefaults(DEFAULT_RECAP, source.recap)

  const apiKey = typeof ai.apiKey === 'string' ? ai.apiKey : ''
  const apiKeySet =
    typeof ai.apiKeySet === 'boolean' ? ai.apiKeySet : Boolean(apiKey) && /^\*{4}/.test(apiKey)

  return {
    ai: {
      baseUrl: typeof ai.baseUrl === 'string' ? ai.baseUrl.trim() : DEFAULT_AI.baseUrl,
      apiKey,
      apiKeySet,
      model: typeof ai.model === 'string' ? ai.model.trim() : '',
      timeoutMs: clampInt(ai.timeoutMs, 1000, 600000, DEFAULT_AI.timeoutMs),
      retry: clampInt(ai.retry, 0, 5, DEFAULT_AI.retry)
    },
    appearance: {
      ...appearance,
      theme: pickEnum(appearance.theme, ['light', 'dark', 'system'], 'light'),
      fontSize: clampInt(appearance.fontSize, 16, 22, DEFAULT_APPEARANCE.fontSize),
      lineHeight: clampNumber(appearance.lineHeight, 1.6, 2.2, DEFAULT_APPEARANCE.lineHeight),
      maxWidth: clampInt(appearance.maxWidth, 640, 860, DEFAULT_APPEARANCE.maxWidth),
      adhd: normalizeAdhdParams({
        ...appearance.adhd,
        mode: pickEnum(appearance.adhd.mode, ['off', 'bionic', 'semantic', 'highlight'], 'off')
      })
    },
    recap
  }
}

const darkQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

function resolveTheme(mode) {
  if (mode === 'system') return darkQuery && darkQuery.matches ? 'dark' : 'light'
  return mode === 'dark' ? 'dark' : 'light'
}

export const settingsStore = reactive({
  settings: normalizeSettings(null),
  loading: true,
  loadError: null,
  saving: false,
  saveError: null,
  ready: false,
  health: null,
  healthError: null,
  healthLoading: false,
  theme: 'light'
})

/** 把外观设置写到 documentElement（主题）与 CSS 变量（阅读排版）。 */
export function applyAppearance() {
  const appearance = settingsStore.settings.appearance
  const resolved = resolveTheme(appearance.theme)
  settingsStore.theme = resolved
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.setProperty('--reading-font-size', `${appearance.fontSize}px`)
  root.style.setProperty('--reading-line-height', String(appearance.lineHeight))
  root.style.setProperty('--reading-width', `${appearance.maxWidth}px`)

  // ADHD v3：参数经 CSS 变量驱动句子正文（Bionic / 语义加粗 / 语义高亮）
  const adhd = normalizeAdhdParams(appearance.adhd)
  const adhdActive = adhd.mode !== 'off'
  root.dataset.adhd = adhd.mode
  root.style.setProperty('--adhd-base-scale', adhdActive ? String(adhd.baseScale) : '1')
  root.style.setProperty('--adhd-letter-spacing', adhdActive ? `${adhd.letterSpacing}em` : '0em')
  root.style.setProperty('--adhd-word-spacing', adhdActive ? `${adhd.wordSpacing}em` : '0em')
  const emphasisWeight = Math.round(600 + (adhd.leadScale - 1) * 400)
  const emphasisScale = 1 + (adhd.leadScale - 1) * 0.12
  root.style.setProperty('--adhd-emphasis-weight', String(emphasisWeight))
  root.style.setProperty('--adhd-emphasis-scale', emphasisScale.toFixed(3))
  root.style.setProperty('--adhd-bionic-lead-scale', (1 + (adhd.leadScale - 1) * 0.06).toFixed(3))
  root.style.setProperty('--adhd-semantic-weight', String(Math.round(550 + (adhd.leadScale - 1) * 200)))
  root.style.setProperty('--adhd-mid-opacity', '0.65')
  root.style.setProperty('--adhd-tail-opacity', '0.45')
}

/** 仅预览主题（设置页未保存时使用），不写回 settings。 */
export function previewTheme(mode) {
  const resolved = resolveTheme(mode)
  document.documentElement.dataset.theme = resolved
}

function providerLabel(baseUrl) {
  const url = String(baseUrl || '').toLowerCase()
  if (url.includes('deepseek')) return 'DeepSeek'
  if (url.includes('openai')) return 'OpenAI'
  if (url.includes('127.0.0.1') || url.includes('localhost')) return '本地接口'
  return 'AI'
}

/** 顶栏 AI 状态胶囊：state = ok | idle | error。 */
export const aiStatus = computed(() => {
  const ai = settingsStore.settings.ai
  const healthAi = settingsStore.health && isPlainObject(settingsStore.health.ai) ? settingsStore.health.ai : null
  const configured = healthAi && typeof healthAi.configured === 'boolean' ? healthAi.configured : Boolean(ai.apiKeySet && ai.model)
  const model = (healthAi && healthAi.model) || ai.model || ''
  if (settingsStore.healthError) return { state: 'error', label: '连接异常', detail: '本地服务不可达', model }
  if (settingsStore.healthLoading && !settingsStore.health) return { state: 'idle', label: '检测中', detail: '', model }
  if (!configured) return { state: 'idle', label: '未配置', detail: '点击去设置 AI 配置', model }
  return { state: 'ok', label: '已连接', detail: 'AI 可用', model, provider: providerLabel(ai.baseUrl) }
})

/** 本地服务是否不可达（整页错误状态）。 */
export const serviceDown = computed(() => Boolean(settingsStore.healthError))

export async function loadSettings() {
  settingsStore.loading = true
  settingsStore.loadError = null
  try {
    const data = await get('/api/settings')
    const payload = data && isPlainObject(data.settings) ? data.settings : data
    const normalized = normalizeSettings(payload)
    if (data && typeof data.apiKeySet === 'boolean') normalized.ai.apiKeySet = data.apiKeySet
    settingsStore.settings = normalized
    settingsStore.ready = true
    applyAppearance()
  } catch (err) {
    settingsStore.loadError = err
  } finally {
    settingsStore.loading = false
  }
}

export async function loadHealth() {
  settingsStore.healthLoading = true
  try {
    settingsStore.health = await get('/api/health')
    settingsStore.healthError = null
  } catch (err) {
    settingsStore.health = null
    settingsStore.healthError = err
  } finally {
    settingsStore.healthLoading = false
  }
}

/** 保存分区设置；成功返回归一化后的完整设置。 */
export async function saveSettings(sections) {
  settingsStore.saving = true
  settingsStore.saveError = null
  try {
    const data = await put('/api/settings', sections)
    const payload = data && isPlainObject(data.settings) ? data.settings : null
    if (payload) {
      const normalized = normalizeSettings(payload)
      if (typeof data.apiKeySet === 'boolean') normalized.ai.apiKeySet = data.apiKeySet
      settingsStore.settings = normalized
    } else {
      settingsStore.settings = normalizeSettings(mergeDefaults(settingsStore.settings, sections))
    }
    settingsStore.ready = true
    applyAppearance()
    return settingsStore.settings
  } catch (err) {
    settingsStore.saveError = err
    throw err
  } finally {
    settingsStore.saving = false
  }
}

/** 顶栏主题按钮：浅色 ↔ 深色，立即生效并持久化。 */
export async function toggleTheme() {
  const next = settingsStore.theme === 'dark' ? 'light' : 'dark'
  settingsStore.settings.appearance.theme = next
  applyAppearance()
  try {
    await saveSettings({ appearance: { theme: next } })
    await loadHealth()
  } catch {
    toast.error('主题保存失败，刷新后可能恢复原样')
  }
}

export async function retryBoot() {
  await Promise.all([loadHealth(), loadSettings()])
}

let themeListenerBound = false

function bindSystemTheme() {
  if (themeListenerBound || !darkQuery) return
  themeListenerBound = true
  const onChange = () => {
    if (settingsStore.settings.appearance.theme === 'system') applyAppearance()
  }
  if (typeof darkQuery.addEventListener === 'function') darkQuery.addEventListener('change', onChange)
  else if (typeof darkQuery.addListener === 'function') darkQuery.addListener(onChange)
}

let booted = false

/** 应用启动时调用：绑定系统主题、拉取 health 与 settings。 */
export async function initSettings() {
  bindSystemTheme()
  if (booted) return
  booted = true
  await Promise.all([loadHealth(), loadSettings()])
}
