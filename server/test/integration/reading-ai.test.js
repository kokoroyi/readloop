import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { startMockAi } from '../helpers/mock-ai.js'
import { startTestApp } from '../helpers/temp-db.js'

let contentCounter = 0

/**
 * 生成 4 句英文正文（唯一内容避免 hash 重复）。
 * @param {string} label
 * @returns {string}
 */
function uniqueContent(label) {
  contentCounter += 1
  return `${label} sentence ${contentCounter}. The old librarian smiled and pointed me to a shelf of travel books. I found a seat near the window and opened my notebook. I spent the whole afternoon reading about distant islands.`
}

describe('M3 批改/跳过/进度（Mock AI，READ-01~16）', () => {
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
   * 把应用指向指定 mock（success 默认）。
   * @param {{ baseUrl: string }} target
   * @param {Record<string, unknown>} [overrides]
   */
  async function configureAi(target, overrides = {}) {
    const response = await ctx.request('PUT', '/api/settings', {
      ai: {
        baseUrl: target.baseUrl,
        apiKey: 'sk-mock-test',
        model: 'mock-model',
        timeoutMs: 5000,
        retry: 0,
        ...overrides
      }
    })
    assert.equal(response.status, 200, `保存 AI 配置失败: ${response.text}`)
  }

  /**
   * @param {string} label
   * @returns {Promise<{ id: number, sentenceCount: number }>}
   */
  async function createStartedArticle(label) {
    const created = await ctx.request('POST', '/api/articles', {
      title: label,
      content: uniqueContent(label)
    })
    assert.equal(created.status, 200, created.text)
    const { id, sentenceCount } = created.json.article
    const started = await ctx.request('POST', `/api/articles/${id}/start`)
    assert.equal(started.status, 200, started.text)
    return { id, sentenceCount }
  }

  /**
   * @param {number} articleId
   * @param {number} idx
   * @param {string} translation
   */
  async function submit(articleId, idx, translation = '我到的时候图书馆几乎没人。') {
    return ctx.request('POST', `/api/articles/${articleId}/sentences/${idx}/submit`, {
      translation
    })
  }

  /**
   * @returns {Promise<number>}
   */
  async function aiCallsCount() {
    return Number(ctx.db.prepare('SELECT COUNT(*) AS c FROM ai_calls').get().c)
  }

  /**
   * @param {string} purpose
   * @returns {object | undefined}
   */
  function lastAiCall(purpose) {
    return ctx.db
      .prepare('SELECT * FROM ai_calls WHERE purpose = ? ORDER BY id DESC LIMIT 1')
      .get(purpose)
  }

  it('READ-01 正常批改：corrected + correction 落库 + progress + ai_calls 一条', async () => {
    const { id, sentenceCount } = await createStartedArticle('READ-01')
    const beforeCalls = await aiCallsCount()
    const response = await submit(id, 0)
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json.ok, true)
    const { work, progress } = response.json
    assert.equal(work.idx, 0)
    assert.equal(work.status, 'corrected')
    assert.equal(work.myTranslation, '我到的时候图书馆几乎没人。')
    assert.equal(work.model, 'mock-model')
    assert.equal(work.promptVersion, 'correct-v1')
    assert.ok(work.submittedAt)
    assert.ok(work.correctedAt)
    assert.equal(work.correction.issues.length, 1)
    assert.equal(work.correction.issues[0].type, '误译')
    assert.equal(work.correction.referenceTranslation, '我到的时候，安静的图书馆几乎空无一人。')
    assert.deepEqual(progress, { processed: 1, total: sentenceCount, skipped: 0 })

    const workRow = ctx.db
      .prepare(
        'SELECT status, correction_json, model, prompt_version FROM sentence_work WHERE article_id = ? AND idx = 0'
      )
      .get(id)
    assert.equal(workRow.status, 'corrected')
    assert.equal(workRow.model, 'mock-model')
    assert.equal(workRow.prompt_version, 'correct-v1')
    assert.equal(JSON.parse(workRow.correction_json).referenceTranslation, '我到的时候，安静的图书馆几乎空无一人。')

    assert.equal(await aiCallsCount(), beforeCalls + 1)
    const call = lastAiCall('correct')
    assert.equal(call.status, 'ok')
    assert.equal(call.prompt_id, 'correct')
    assert.equal(call.prompt_version, 'correct-v1')
    assert.equal(call.model, 'mock-model')
    assert.equal(call.input_tokens, 100)
    assert.equal(call.output_tokens, 80)
    assert.ok(call.duration_ms >= 0)
    assert.ok(call.prompt_preview.length <= 500)
    assert.match(call.prompt_preview, /【当前句】/)
    assert.equal(call.error, null)
  })

  it('READ-02 空译文/超长译文 400 VALIDATION，句子状态不变', async () => {
    const { id } = await createStartedArticle('READ-02')
    const empty = await submit(id, 0, '   ')
    assert.equal(empty.status, 400)
    assert.equal(empty.json.error.code, 'VALIDATION')
    const long = await submit(id, 0, '译'.repeat(2001))
    assert.equal(long.status, 400)
    assert.equal(long.json.error.code, 'VALIDATION')

    const work = await ctx.request('GET', `/api/articles/${id}/work`)
    assert.equal(work.json.sentences[0].work.status, 'pending')
    assert.equal(work.json.sentences[0].work.correction, null)
  })

  it('03 §2 前缀稳定：同文章两次批改 system/文章前缀逐字节一致，参数正确', async () => {
    await mock.reset()
    const { id } = await createStartedArticle('PREFIX')
    assert.equal((await submit(id, 0)).status, 200)
    assert.equal((await submit(id, 1)).status, 200)
    const requests = (await mock.requests()).filter(
      (request) => request.purpose === 'correct' && !request.stream
    )
    assert.equal(requests.length, 2)
    assert.equal(requests[0].messages[0].content, requests[1].messages[0].content)
    assert.equal(requests[0].messages[1].content, requests[1].messages[1].content)
    assert.match(requests[0].messages[1].content, /【文章标题】PREFIX/)
    assert.match(requests[0].messages[1].content, /<article>/)
    assert.notEqual(requests[0].messages[2].content, requests[1].messages[2].content)
    assert.equal(requests[0].model, 'mock-model')
    assert.equal(requests[0].temperature, 0.2)
    assert.deepEqual(requests[0].response_format, { type: 'json_object' })
  })

  it('READ-03 已批改重复提交 409 ALREADY_CORRECTED，不覆盖旧结果', async () => {
    const { id } = await createStartedArticle('READ-03')
    assert.equal((await submit(id, 0, '第一次译文')).status, 200)
    const before = ctx.db
      .prepare('SELECT correction_json FROM sentence_work WHERE article_id = ? AND idx = 0')
      .get(id)
    const again = await submit(id, 0, '第二次译文')
    assert.equal(again.status, 409)
    assert.equal(again.json.error.code, 'ALREADY_CORRECTED')
    const after = ctx.db
      .prepare(
        'SELECT correction_json, my_translation FROM sentence_work WHERE article_id = ? AND idx = 0'
      )
      .get(id)
    assert.equal(after.correction_json, before.correction_json)
    assert.equal(after.my_translation, '第一次译文')
  })

  it('READ-08 正在 submitting 的句子并发提交 409 STATE_CONFLICT', async () => {
    const { id } = await createStartedArticle('READ-08')
    ctx.db
      .prepare("UPDATE sentence_work SET status = 'submitting' WHERE article_id = ? AND idx = 0")
      .run(id)
    const conflict = await submit(id, 0)
    assert.equal(conflict.status, 409)
    assert.equal(conflict.json.error.code, 'STATE_CONFLICT')
    ctx.db
      .prepare("UPDATE sentence_work SET status = 'pending' WHERE article_id = ? AND idx = 0")
      .run(id)
  })

  it('READ-05 AI 返回非法 JSON → 格式修复后仍失败，降级 corrected + ai_calls degraded', async () => {
    const invalidMock = await startMockAi({ mode: 'invalid-json' })
    try {
      await configureAi(invalidMock)
      const { id } = await createStartedArticle('READ-05')
      const response = await submit(id, 0)
      assert.equal(response.status, 200, response.text)
      const { work } = response.json
      assert.equal(work.status, 'corrected')
      assert.equal(work.correction.degraded, true)
      assert.deepEqual(work.correction.issues, [])
      assert.equal(work.correction.referenceTranslation, '')
      assert.equal(work.correction.rawText, 'not json at all')
      assert.equal((await invalidMock.requests()).length, 2)
      const call = lastAiCall('correct')
      assert.equal(call.status, 'degraded')
      assert.ok(call.duration_ms >= 0)
    } finally {
      await invalidMock.stop()
    }
  })

  it('READ-04 AI 超时 → 504 AI_TIMEOUT，句子置 error，可重试成功', async () => {
    const timeoutMock = await startMockAi({ mode: 'timeout' })
    try {
      await configureAi(timeoutMock, { timeoutMs: 1000, retry: 0 })
      const { id } = await createStartedArticle('READ-04')
      const failed = await submit(id, 0)
      assert.equal(failed.status, 504)
      assert.equal(failed.json.error.code, 'AI_TIMEOUT')
      assert.equal(failed.json.error.retryable, true)
      const work = await ctx.request('GET', `/api/articles/${id}/work`)
      assert.equal(work.json.sentences[0].work.status, 'error')
      assert.equal(work.json.sentences[0].work.correction, null)
      assert.match(lastAiCall('correct').error, /AI_TIMEOUT/)
    } finally {
      await timeoutMock.stop()
    }
    await configureAi(mock)
    // 重新拿同一 idx 重试（error 允许再次 submit）
    const retried = await submit(
      (await ctx.request('GET', '/api/articles?q=READ-04')).json.items[0].id,
      0
    )
    assert.equal(retried.status, 200, retried.text)
    assert.equal(retried.json.work.status, 'corrected')
  })

  it('上游 5xx 按 retry 重试，最终 AI_UPSTREAM 502 且只记一条 error ai_calls', async () => {
    const errorMock = await startMockAi({ mode: 'http-500' })
    try {
      await configureAi(errorMock, { retry: 1 })
      const { id } = await createStartedArticle('READ-500')
      const beforeCalls = await aiCallsCount()
      const response = await submit(id, 0)
      assert.equal(response.status, 502)
      assert.equal(response.json.error.code, 'AI_UPSTREAM')
      const requests = await errorMock.requests()
      assert.equal(requests.length, 2)
      assert.equal(await aiCallsCount(), beforeCalls + 1)
      const call = lastAiCall('correct')
      assert.equal(call.status, 'error')
      assert.match(call.error, /AI_UPSTREAM/)
      assert.ok(call.duration_ms >= 500)
    } finally {
      await errorMock.stop()
    }
  })

  it('429 退避 1 次后仍限流 → AI_RATE_LIMIT 429', async () => {
    const rateMock = await startMockAi({ mode: 'rate-limit' })
    try {
      await configureAi(rateMock, { retry: 0 })
      const { id } = await createStartedArticle('READ-429')
      const startedAt = Date.now()
      const response = await submit(id, 0)
      assert.equal(response.status, 429)
      assert.equal(response.json.error.code, 'AI_RATE_LIMIT')
      assert.equal((await rateMock.requests()).length, 2)
      assert.ok(Date.now() - startedAt >= 1000)
      assert.match(lastAiCall('correct').error, /AI_RATE_LIMIT/)
    } finally {
      await rateMock.stop()
    }
  })

  it('READ-09 客户端取消：回 pending、不写 correction、ai_calls 记 CANCELLED', async () => {
    const slowMock = await startMockAi({ mode: 'slow' })
    try {
      await configureAi(slowMock, { timeoutMs: 10000, retry: 0 })
      const { id } = await createStartedArticle('READ-09')
      const controller = new AbortController()
      const pending = fetch(`${ctx.baseUrl}/api/articles/${id}/sentences/0/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ translation: '取消测试译文' }),
        signal: controller.signal
      }).catch((error) => error)
      setTimeout(() => controller.abort(), 200)
      const outcome = await pending
      assert.ok(outcome instanceof Error, 'fetch 应被 abort')
      await new Promise((resolve) => setTimeout(resolve, 400))

      const work = await ctx.request('GET', `/api/articles/${id}/work`)
      assert.equal(work.json.sentences[0].work.status, 'pending')
      assert.equal(work.json.sentences[0].work.correction, null)
      const row = ctx.db
        .prepare(
          'SELECT status, correction_json FROM sentence_work WHERE article_id = ? AND idx = 0'
        )
        .get(id)
      assert.equal(row.status, 'pending')
      assert.equal(row.correction_json, null)
      assert.match(lastAiCall('correct').error, /CANCELLED/)
    } finally {
      await slowMock.stop()
    }
  })

  it('READ-06/07 跳过：幂等 200、进度更新；已批改跳过 409', async () => {
    const { id, sentenceCount } = await createStartedArticle('READ-06')
    const first = await ctx.request('POST', `/api/articles/${id}/sentences/0/skip`, {})
    assert.equal(first.status, 200)
    assert.deepEqual(first.json.progress, { processed: 1, total: sentenceCount, skipped: 1 })
    const again = await ctx.request('POST', `/api/articles/${id}/sentences/0/skip`, {})
    assert.equal(again.status, 200)
    assert.deepEqual(again.json.progress, { processed: 1, total: sentenceCount, skipped: 1 })

    assert.equal((await submit(id, 1)).status, 200)
    const skipCorrected = await ctx.request('POST', `/api/articles/${id}/sentences/1/skip`, {})
    assert.equal(skipCorrected.status, 409)
    assert.equal(skipCorrected.json.error.code, 'ALREADY_CORRECTED')
  })

  it('READ-10/12 刷新恢复与进度一致性（I3）', async () => {
    const { id, sentenceCount } = await createStartedArticle('READ-12')
    assert.equal((await submit(id, 0)).status, 200)
    assert.equal(
      (await ctx.request('POST', `/api/articles/${id}/sentences/1/skip`, {})).status,
      200
    )

    const work = await ctx.request('GET', `/api/articles/${id}/work`)
    assert.equal(work.status, 200)
    assert.equal(work.json.article.processed, 2)
    assert.equal(work.json.article.skipped, 1)
    assert.equal(work.json.article.currentIdx, 2)
    assert.equal(work.json.sentences[0].work.status, 'corrected')
    assert.ok(work.json.sentences[0].work.correction)
    assert.equal(work.json.sentences[1].work.status, 'skipped')
    assert.deepEqual(work.json.progress, {
      processed: 2,
      total: sentenceCount,
      skipped: 1
    })
    const article = ctx.db
      .prepare('SELECT processed_count, skipped_count FROM articles WHERE id = ?')
      .get(id)
    assert.equal(article.processed_count, 2)
    assert.equal(article.skipped_count, 1)
  })

  it('AI 未配置：submit 400 AI_NOT_CONFIGURED，不改句子状态', async () => {
    const fresh = await startTestApp()
    try {
      const created = await fresh.request('POST', '/api/articles', {
        content: uniqueContent('NO-CONFIG')
      })
      const id = created.json.article.id
      await fresh.request('POST', `/api/articles/${id}/start`)
      const response = await fresh.request('POST', `/api/articles/${id}/sentences/0/submit`, {
        translation: '测试译文'
      })
      assert.equal(response.status, 400)
      assert.equal(response.json.error.code, 'AI_NOT_CONFIGURED')
      const work = await fresh.request('GET', `/api/articles/${id}/work`)
      assert.equal(work.json.sentences[0].work.status, 'pending')
    } finally {
      await fresh.close()
    }
  })

  it('READ-15 文章被删除后提交 → 404 NOT_FOUND', async () => {
    const { id } = await createStartedArticle('READ-15')
    assert.equal((await ctx.request('DELETE', `/api/articles/${id}`)).status, 200)
    const response = await submit(id, 0)
    assert.equal(response.status, 404)
    assert.equal(response.json.error.code, 'NOT_FOUND')
  })

  it('READ-16 全部处理完：processed=total、currentIdx=最后一句、文章仍 reading', async () => {
    const { id, sentenceCount } = await createStartedArticle('READ-16')
    for (let idx = 0; idx < sentenceCount - 1; idx += 1) {
      assert.equal((await submit(id, idx)).status, 200)
    }
    assert.equal(
      (await ctx.request('POST', `/api/articles/${id}/sentences/${sentenceCount - 1}/skip`, {}))
        .status,
      200
    )
    const work = await ctx.request('GET', `/api/articles/${id}/work`)
    assert.equal(work.json.article.processed, sentenceCount)
    assert.equal(work.json.article.currentIdx, sentenceCount - 1)
    assert.equal(work.json.article.status, 'reading')
    const detail = await ctx.request('GET', `/api/articles/${id}`)
    assert.equal(detail.json.article.status, 'reading')
    assert.equal(detail.json.article.processedCount, sentenceCount)
  })

  it('READ-11 启动清理把 submitting 恢复为 pending', async () => {
    const { id } = await createStartedArticle('READ-11')
    ctx.db
      .prepare("UPDATE sentence_work SET status = 'submitting' WHERE article_id = ? AND idx = 0")
      .run(id)
    ctx.modules.runStartupCleanup(ctx.db)
    const row = ctx.db
      .prepare('SELECT status FROM sentence_work WHERE article_id = ? AND idx = 0')
      .get(id)
    assert.equal(row.status, 'pending')
  })
})
