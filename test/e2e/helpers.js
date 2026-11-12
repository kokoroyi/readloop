/**
 * E2E 公共工具：唯一内容、接口直调、设置复位。
 * 用例通过 Playwright 的 request fixture（带 baseURL）调 /api，不影响页面状态。
 */

/** 生成本次运行唯一的后缀，避免上次运行的数据干扰（重复正文会被 409 拒绝）。 */
export function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** ECDICT 里稳定存在的简单词，用于查词断言。 */
export const KNOWN_WORD = 'the'

/**
 * 直接创建一篇文章（绕过 UI，作为其他用例的夹具）。
 * 正文带唯一后缀，避免 content_hash 撞车；万一撞车（历史残留）删除旧文章后重试一次。
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {{ title?: string, content?: string }} [options]
 */
export async function createArticle(request, options = {}) {
  const suffix = uniqueSuffix()
  const title = options.title || `E2E Article ${suffix}`
  const content =
    (options.content ||
      `This is E2E sentence one. It talks about a quiet morning in the city. ` +
        `The second point is that reading slowly helps comprehension. ` +
        `Finally, the writer suggests keeping a short note after each paragraph. ` +
        `Sample tag ${suffix}.`) + ''

  const post = () => request.post('/api/articles', { data: { title, content } })
  let res = await post()
  if (res.status() === 409) {
    const body = await res.json()
    const existingId = body?.error?.detail?.existingId
    if (existingId) {
      await request.delete(`/api/articles/${existingId}`)
      res = await post()
    }
  }
  if (!res.ok()) throw new Error(`创建文章失败：${res.status()} ${await res.text()}`)
  const json = await res.json()
  return json.article
}

/**
 * 把设置恢复为“未配置 AI + 浅色主题”，保证用例之间互不影响。
 * 注意：ai.model 不能传空串（服务端校验要求非空），因此只清 Key。
 * @param {import('@playwright/test').APIRequestContext} request
 */
export async function resetSettings(request) {
  const res = await request.put('/api/settings', {
    data: {
      ai: { apiKey: '' },
      appearance: { theme: 'light' },
      recap: { questions: 'auto', showReference: true, floatWindowDefaultOpen: true }
    }
  })
  if (!res.ok()) throw new Error(`重置设置失败：${res.status()} ${await res.text()}`)
}

/** 用 Mock AI 填好设置（成功路径）。 */
export async function configureMockAi(request) {
  const res = await request.put('/api/settings', {
    data: {
      ai: {
        baseUrl: 'http://127.0.0.1:5179/v1',
        apiKey: 'sk-mock-e2e',
        model: 'mock-model',
        timeoutMs: 30000,
        retry: 1
      }
    }
  })
  if (!res.ok()) throw new Error(`配置 Mock AI 失败：${res.status()} ${await res.text()}`)
}

