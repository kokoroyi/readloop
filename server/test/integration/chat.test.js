import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { startMockAi } from '../helpers/mock-ai.js'
import { startTestApp } from '../helpers/temp-db.js'

let contentCounter = 0

/**
 * @param {string} label
 * @returns {string}
 */
function uniqueContent(label) {
  contentCounter += 1
  return `${label} sentence ${contentCounter}. The old librarian smiled and pointed me to a shelf of travel books. I found a seat near the window and opened my notebook.`
}

/**
 * 解析 SSE 响应文本为 [{ event, data }]，忽略心跳注释。
 * @param {string} text
 * @returns {{ event: string, data: any }[]}
 */
function parseSse(text) {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const lines = block.split('\n')
      const eventLine = lines.find((line) => line.startsWith('event:'))
      const dataLine = lines.find((line) => line.startsWith('data:'))
      if (!eventLine || !dataLine) return null
      return {
        event: eventLine.slice('event:'.length).trim(),
        data: JSON.parse(dataLine.slice('data:'.length).trim())
      }
    })
    .filter(Boolean)
}

describe('M3-05 句内追问 SSE（Mock AI）', () => {
  /** @type {Awaited<ReturnType<typeof startMockAi>>} */
  let mock
  /** @type {Awaited<ReturnType<typeof startTestApp>>} */
  let ctx

  before(async () => {
    mock = await startMockAi()
    ctx = await startTestApp()
    await configureAi(mock)
  })

  beforeEach(async () => {
    await configureAi(mock)
  })

  after(async () => {
    await ctx.close()
    await mock.stop()
  })

  /**
   * @param {{ baseUrl: string }} target
   */
  async function configureAi(target) {
    const response = await ctx.request('PUT', '/api/settings', {
      ai: {
        baseUrl: target.baseUrl,
        apiKey: 'sk-mock-test',
        model: 'mock-model',
        timeoutMs: 5000,
        retry: 0
      }
    })
    assert.equal(response.status, 200, `保存 AI 配置失败: ${response.text}`)
  }

  /**
   * @param {string} label
   * @returns {Promise<number>}
   */
  async function createStartedArticle(label) {
    const created = await ctx.request('POST', '/api/articles', {
      title: label,
      content: uniqueContent(label)
    })
    assert.equal(created.status, 200, created.text)
    const id = created.json.article.id
    await ctx.request('POST', `/api/articles/${id}/start`)
    return id
  }

  /**
   * @param {number} articleId
   * @param {number} idx
   * @param {string} message
   * @returns {Promise<{ response: Response, text: string }>}
   */
  async function chat(articleId, idx, message) {
    const response = await fetch(`${ctx.baseUrl}/api/articles/${articleId}/sentences/${idx}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    })
    const text = await response.text()
    return { response, text }
  }

  it('SSE 成功：delta 累积、done 事件、user+assistant 持久化、work.chats 恢复', async () => {
    const id = await createStartedArticle('CHAT-01')
    const { response, text } = await chat(id, 0, '为什么这里用 quiet？')
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/event-stream/)
    const events = parseSse(text)
    const deltas = events.filter((event) => event.event === 'delta')
    assert.ok(deltas.length > 0)
    const done = events.find((event) => event.event === 'done')
    assert.ok(done, `缺少 done 事件: ${text.slice(0, 500)}`)
    const streamed = deltas.map((event) => event.data.text).join('')
    assert.equal(done.data.content, streamed)
    assert.match(done.data.content, /library/)
    assert.equal(typeof done.data.messageId, 'number')
    // mock-ai 的流式响应不带 usage 分片，客户端按 0 记录（真实服务商可能给出）
    assert.deepEqual(done.data.usage, { input: 0, output: 0 })

    const rows = ctx.db
      .prepare(
        'SELECT role, content, partial FROM sentence_chats WHERE article_id = ? AND idx = 0 ORDER BY id'
      )
      .all(id)
    assert.equal(rows.length, 2)
    assert.equal(rows[0].role, 'user')
    assert.equal(rows[0].partial, 0)
    assert.equal(rows[1].role, 'assistant')
    assert.equal(rows[1].partial, 0)

    const work = await ctx.request('GET', `/api/articles/${id}/work`)
    assert.ok(Array.isArray(work.json.chats['0']))
    assert.equal(work.json.chats['0'].length, 2)
    assert.equal(work.json.chats['0'][1].role, 'assistant')
    assert.ok(work.json.chats['0'][1].id)

    const requests = await mock.requests()
    const followup = requests.filter((request) => request.purpose === 'followup').at(-1)
    assert.equal(followup.stream, true)
    assert.equal(followup.model, 'mock-model')
    assert.equal(followup.temperature, 0.4)
    assert.match(followup.messages[0].content, /继续提问/)
    assert.match(followup.messages[1].content, /【文章标题】CHAT-01/)
    assert.match(followup.messages[2].content, /【本轮问题】为什么这里用 quiet？/)
  })

  it('追问历史进入上下文（角色标注，最近 10 条）', async () => {
    const id = await createStartedArticle('CHAT-HISTORY')
    await chat(id, 0, '第一个问题')
    await mock.reset()
    await chat(id, 0, '第二个问题')
    const requests = await mock.requests()
    const followup = requests.filter((request) => request.purpose === 'followup').at(-1)
    assert.match(followup.messages[2].content, /用户：第一个问题/)
    assert.match(followup.messages[2].content, /助手：/)
    assert.match(followup.messages[2].content, /【本轮问题】第二个问题/)
  })

  it('流式中断：保存 assistant partial=1，并返回 error 事件', async () => {
    const cancelMock = await startMockAi({ mode: 'cancel' })
    try {
      await configureAi(cancelMock)
      const id = await createStartedArticle('CHAT-CANCEL')
      const { text } = await chat(id, 0, '中断测试问题')
      const events = parseSse(text)
      assert.ok(
        events.some((event) => event.event === 'error'),
        `缺少 error 事件: ${text.slice(0, 500)}`
      )
      assert.ok(!events.some((event) => event.event === 'done'))
      const rows = ctx.db
        .prepare(
          'SELECT role, content, partial FROM sentence_chats WHERE article_id = ? ORDER BY id'
        )
        .all(id)
      const assistant = rows.filter((row) => row.role === 'assistant').at(-1)
      assert.ok(assistant, '应保存 assistant 半成品')
      assert.equal(assistant.partial, 1)
      assert.ok(assistant.content.length > 0)

      const work = await ctx.request('GET', `/api/articles/${id}/work`)
      const chats = work.json.chats['0'] ?? []
      assert.ok(chats.some((message) => message.partial === 1))
    } finally {
      await cancelMock.stop()
    }
  })

  it('AI 未配置：返回 JSON 400 AI_NOT_CONFIGURED（不是 SSE）', async () => {
    const fresh = await startTestApp()
    try {
      const created = await fresh.request('POST', '/api/articles', {
        content: uniqueContent('CHAT-NO-CONFIG')
      })
      const id = created.json.article.id
      await fresh.request('POST', `/api/articles/${id}/start`)
      const response = await fetch(`${fresh.baseUrl}/api/articles/${id}/sentences/0/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '测试问题' })
      })
      assert.equal(response.status, 400)
      assert.match(response.headers.get('content-type'), /application\/json/)
      const payload = await response.json()
      assert.equal(payload.error.code, 'AI_NOT_CONFIGURED')
    } finally {
      await fresh.close()
    }
  })

  it('文章不存在 404、空问题 400', async () => {
    const notFound = await ctx.request('POST', '/api/articles/999999/sentences/0/chat', {
      message: '测试问题'
    })
    assert.equal(notFound.status, 404)
    assert.equal(notFound.json.error.code, 'NOT_FOUND')

    const id = await createStartedArticle('CHAT-VALIDATION')
    const empty = await ctx.request('POST', `/api/articles/${id}/sentences/0/chat`, {
      message: '   '
    })
    assert.equal(empty.status, 400)
    assert.equal(empty.json.error.code, 'VALIDATION')
  })
})
