import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SETTINGS_DEFAULTS,
  cloneDefaults,
  createSettingsService,
  isAiConfigured,
  isMaskedApiKey,
  maskApiKey,
  mergeDeep
} from '../../services/settingsService.js'

/**
 * 内存版 settings repository（单元测试用，接口与 db/repositories/settings.js 一致）。
 * @param {Record<string, unknown>} [initial]
 */
function createMemoryRepository(initial = {}) {
  const store = new Map(
    Object.entries(initial).map(([key, value]) => [key, structuredClone(value)])
  )
  return {
    getAll() {
      const values = {}
      for (const [key, value] of store) values[key] = structuredClone(value)
      return { values, corruptKeys: [] }
    },
    get(key) {
      return store.has(key) ? structuredClone(store.get(key)) : undefined
    },
    setMany(values) {
      for (const [key, value] of Object.entries(values)) store.set(key, structuredClone(value))
      return Object.keys(values)
    },
    remove(key) {
      return store.delete(key) ? 1 : 0
    },
    snapshot() {
      return structuredClone(Object.fromEntries(store))
    }
  }
}

describe('settings 默认值与纯函数', () => {
  it('默认值符合 04-ENGINEERING §5.6', () => {
    assert.equal(SETTINGS_DEFAULTS.ai.baseUrl, 'https://api.deepseek.com')
    assert.equal(SETTINGS_DEFAULTS.ai.apiKey, '')
    assert.equal(SETTINGS_DEFAULTS.ai.model, '')
    assert.equal(SETTINGS_DEFAULTS.ai.timeoutMs, 60000)
    assert.equal(SETTINGS_DEFAULTS.ai.retry, 2)
    assert.equal(SETTINGS_DEFAULTS.appearance.theme, 'light')
    assert.equal(SETTINGS_DEFAULTS.appearance.fontSize, 19)
    assert.equal(SETTINGS_DEFAULTS.appearance.lineHeight, 1.9)
    assert.equal(SETTINGS_DEFAULTS.appearance.maxWidth, 720)
    assert.equal(SETTINGS_DEFAULTS.appearance.adhd.mode, 'off')
    assert.equal(SETTINGS_DEFAULTS.appearance.adhd.semanticDensity, 0.25)
    assert.equal(SETTINGS_DEFAULTS.recap.questions, 'auto')
    assert.equal(SETTINGS_DEFAULTS.recap.showReference, true)
    assert.equal(SETTINGS_DEFAULTS.recap.floatWindowDefaultOpen, true)
  })

  it('cloneDefaults 返回隔离副本', () => {
    const first = cloneDefaults()
    first.appearance.fontSize = 22
    const second = cloneDefaults()
    assert.equal(second.appearance.fontSize, 19)
  })

  it('mergeDeep 递归合并、保留未知键、不改入参', () => {
    const base = { ai: { model: 'a', extra: { keep: true } }, recap: { questions: 'auto' } }
    const patch = { ai: { model: 'b', extra: { added: 1 } }, recap: { questions: 5 } }
    const merged = mergeDeep(base, patch)
    assert.deepEqual(merged, {
      ai: { model: 'b', extra: { keep: true, added: 1 } },
      recap: { questions: 5 }
    })
    assert.equal(base.ai.model, 'a')
    assert.deepEqual(base.ai.extra, { keep: true })
  })

  it('mergeDeep 对数组与非对象值整体替换', () => {
    const merged = mergeDeep({ list: [1, 2], value: { a: 1 } }, { list: [9], value: 7 })
    assert.deepEqual(merged.list, [9])
    assert.equal(merged.value, 7)
  })

  it('maskApiKey 打码规则', () => {
    assert.equal(maskApiKey(''), '')
    assert.equal(maskApiKey('   '), '')
    assert.equal(maskApiKey(undefined), '')
    assert.equal(maskApiKey('sk-1234567890abcd'), '****abcd')
    assert.equal(maskApiKey('abc'), '****abc')
  })

  it('isMaskedApiKey 识别前端回传的打码值', () => {
    assert.equal(isMaskedApiKey('****abcd'), true)
    assert.equal(isMaskedApiKey('sk-1234'), false)
    assert.equal(isMaskedApiKey(''), false)
    assert.equal(isMaskedApiKey(undefined), false)
  })

  it('isAiConfigured 需要 baseUrl + apiKey + model 同时非空', () => {
    assert.equal(isAiConfigured(SETTINGS_DEFAULTS.ai), false)
    assert.equal(
      isAiConfigured({
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-1',
        model: 'deepseek-chat'
      }),
      true
    )
    assert.equal(
      isAiConfigured({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-1', model: '  ' }),
      false
    )
  })
})

describe('settingsService 分区合并与 apiKey 三态（内存仓库）', () => {
  it('GET 返回默认值 + 打码 Key + apiKeySet', () => {
    const service = createSettingsService({ repository: createMemoryRepository() })
    const { settings } = service.get()
    assert.deepEqual(settings.ai, {
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: '',
      timeoutMs: 60000,
      retry: 2,
      apiKeySet: false
    })
    assert.equal(settings.appearance.theme, 'light')
    assert.equal(settings.recap.questions, 'auto')
  })

  it('保存 ai 分区：明文入库、返回打码，其余分区与默认值不丢', () => {
    const repository = createMemoryRepository()
    const service = createSettingsService({ repository })
    const { settings } = service.save({
      ai: {
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-abcdefgh5678',
        model: 'deepseek-chat'
      }
    })
    assert.equal(settings.ai.apiKey, '****5678')
    assert.equal(settings.ai.apiKeySet, true)
    assert.equal(settings.appearance.fontSize, 19)
    const stored = repository.snapshot()
    assert.equal(stored.ai.apiKey, 'sk-abcdefgh5678')
    assert.equal(stored.ai.model, 'deepseek-chat')
  })

  it('apiKey 三态：打码值保留、空串清空、新值覆盖', () => {
    const repository = createMemoryRepository()
    const service = createSettingsService({ repository })
    service.save({ ai: { apiKey: 'sk-original-9999' } })

    service.save({ ai: { apiKey: '****9999' } })
    assert.equal(repository.snapshot().ai.apiKey, 'sk-original-9999')

    service.save({ ai: { apiKey: '' } })
    assert.equal(repository.snapshot().ai.apiKey, '')
    assert.equal(service.get().settings.ai.apiKeySet, false)

    service.save({ ai: { apiKey: 'sk-new-key-1234' } })
    assert.equal(service.get().settings.ai.apiKey, '****1234')
  })

  it('未提交的字段保持原值（分区内局部合并）', () => {
    const repository = createMemoryRepository()
    const service = createSettingsService({ repository })
    service.save({ ai: { model: 'deepseek-chat', timeoutMs: 30000 } })
    service.save({ appearance: { theme: 'dark' } })
    const raw = service.getRaw()
    assert.equal(raw.ai.model, 'deepseek-chat')
    assert.equal(raw.ai.timeoutMs, 30000)
    assert.equal(raw.appearance.theme, 'dark')
    assert.equal(raw.appearance.fontSize, 19)
  })

  it('保留库内未知键（未知嵌套键与未知顶层分区）', () => {
    const repository = createMemoryRepository({
      ai: { model: 'deepseek-chat', customFlag: true },
      experimental: { foo: 'bar' }
    })
    const service = createSettingsService({ repository })
    service.save({ appearance: { fontSize: 21 } })
    const { settings } = service.get()
    assert.equal(settings.ai.customFlag, true)
    assert.equal(settings.ai.model, 'deepseek-chat')
    assert.equal(settings.appearance.fontSize, 21)
    assert.deepEqual(settings.experimental, { foo: 'bar' })
    // 未提交的 ai 分区不落库新值，但仍保留原未知键
    assert.equal(repository.snapshot().ai.customFlag, true)
  })
})
