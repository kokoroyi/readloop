import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { startMockAi } from '../helpers/mock-ai.js'
import { startTestApp } from '../helpers/temp-db.js'

let contentCounter = 0

/**
 * 生成 6 句英文正文（唯一内容避免 hash 重复）。
 * @param {string} label
 * @returns {string}
 */
function uniqueContent(label) {
  contentCounter += 1
  const sentences = Array.from(
    { length: 6 },
    (_, index) => `${label} sample ${contentCounter} sentence ${index + 1} is here.`
  )
  return sentences.join(' ')
}

/**
 * 解析 SSE 文本（忽略心跳）。
 * @param {string} text
 * @returns {{ event: string, data: any }[]}
 */
function parseSse(text) {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n')
      const event = lines
        .find((line) => line.startsWith('event:'))
        ?.slice(6)
        .trim()
      const dataLine = lines.find((line) => line.startsWith('data:'))
      if (!event || !dataLine) return null
      return { event, data: JSON.parse(dataLine.slice(5).trim()) }
    })
    .filter(Boolean)
}

describe('M4 复盘：出题/作答/跳题/自由提问/结束（RECAP-01~14）', () => {
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
   * 创建文章并进入 reading（work 全部 pending）。
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
   * 直接 seed 已处理状态（加速复盘测试；与 M3 提交写库结果同构）。
   * @param {number} articleId
   * @param {number} sentenceCount
   * @param {{ correctedCount?: number }} [options]
   */
  function seedProcessed(articleId, sentenceCount, options = {}) {
    const correctedCount = options.correctedCount ?? sentenceCount
    const now = new Date().toISOString()
    const correction = JSON.stringify({
      issues: [{ type: '误译', fragment: '片段', explain: '测试问题' }],
      referenceTranslation: '参考译文'
    })
    const updateWork = ctx.db.prepare(
      `UPDATE sentence_work SET status = ?, my_translation = ?, correction_json = ?, model = 'mock-model',
        prompt_version = 'correct-v1', submitted_at = ?, corrected_at = ?, updated_at = ?
       WHERE article_id = ? AND idx = ?`
    )
    for (let idx = 0; idx < sentenceCount; idx += 1) {
      if (idx < correctedCount) {
        updateWork.run('corrected', `译文 ${idx + 1}`, correction, now, now, now, articleId, idx)
      } else {
        updateWork.run('skipped', null, null, null, null, now, articleId, idx)
      }
    }
    ctx.db
      .prepare(
        'UPDATE articles SET processed_count = ?, skipped_count = ?, updated_at = ? WHERE id = ?'
      )
      .run(sentenceCount, sentenceCount - correctedCount, now, articleId)
  }

  /**
   * 创建一篇「可进入复盘」的文章。
   * @param {string} label
   * @param {{ correctedCount?: number }} [options]
   * @returns {Promise<{ id: number, sentenceCount: number }>}
   */
  async function createRecapReadyArticle(label, options = {}) {
    const article = await createStartedArticle(label)
    seedProcessed(article.id, article.sentenceCount, options)
    return article
  }

  /**
   * @param {number} articleId
   */
  async function startRecap(articleId) {
    const response = await ctx.request('POST', `/api/articles/${articleId}/recap/start`)
    assert.equal(response.status, 200, response.text)
    return response.json.recap
  }

  /**
   * @returns {number}
   */
  function recapQuestionCallCount() {
    const rows = ctx.db
      .prepare("SELECT COUNT(*) AS c FROM ai_calls WHERE purpose = 'recap_questions'")
      .get()
    return Number(rows.c)
  }

  it('RECAP-01 句子未处理完 → 409 STATE_CONFLICT', async () => {
    const { id } = await createStartedArticle('RECAP-01')
    const response = await ctx.request('POST', `/api/articles/${id}/recap/start`)
    assert.equal(response.status, 409)
    assert.equal(response.json.error.code, 'STATE_CONFLICT')
    const detail = await ctx.request('GET', `/api/articles/${id}`)
    assert.equal(detail.json.article.status, 'reading')
  })

  it('RECAP-02 正常 start：题组落库、文章转 recap、ai_calls 一条、auto 题数 4', async () => {
    const { id, sentenceCount } = await createRecapReadyArticle('RECAP-02')
    await mock.reset()
    const recap = await startRecap(id)
    assert.equal(recap.status, 'asking')
    assert.equal(recap.total, 3) // mock fixture 3 道（可少于请求 N）
    assert.equal(recap.degraded, false)
    assert.equal(recap.nextQuestion.id, 1)
    assert.deepEqual(recap.answers, [])
    assert.deepEqual(recap.messages, [])
    assert.deepEqual(recap.progress, { answered: 0, total: 3, skipped: 0 })
    assert.deepEqual(
      recap.questions.map((question) => question.id),
      [1, 2, 3]
    )
    for (const question of recap.questions) {
      assert.ok(['理解', '语法', '翻译'].includes(question.type))
      assert.ok(question.stem.length > 0)
      assert.ok(question.intent.length > 0)
      assert.ok(question.sentenceRefs.every((idx) => idx >= 0 && idx < sentenceCount))
    }
    const session = ctx.db.prepare('SELECT * FROM recap_sessions WHERE article_id = ?').get(id)
    assert.equal(session.status, 'asking')
    assert.equal(session.prompt_version, 'recap-q-v2')
    assert.equal(session.model, 'mock-model')
    const article = ctx.db.prepare('SELECT status FROM articles WHERE id = ?').get(id)
    assert.equal(article.status, 'recap')
    const call = ctx.db
      .prepare("SELECT * FROM ai_calls WHERE purpose = 'recap_questions' ORDER BY id DESC LIMIT 1")
      .get()
    assert.equal(call.status, 'ok')
    assert.equal(call.prompt_version, 'recap-q-v2')
    assert.ok(call.prompt_preview.includes('【复盘题数要求】4 道'))
    assert.equal(recapQuestionCallCount() >= 1, true)
    const requests = await mock.requests()
    const taskRequest = requests.filter((request) => request.purpose === 'recap-questions').at(-1)
    assert.match(taskRequest.messages[2].content, /【复盘题数要求】4 道/)
    assert.equal(taskRequest.temperature, 0.7)
    assert.deepEqual(taskRequest.response_format, { type: 'json_object' })
  })

  it('题数读设置：固定 8 写入 prompt（模型仍可少出）', async () => {
    const settings = await ctx.request('PUT', '/api/settings', { recap: { questions: 8 } })
    assert.equal(settings.status, 200)
    try {
      const { id } = await createRecapReadyArticle('RECAP-FIXED-N')
      await mock.reset()
      const recap = await startRecap(id)
      assert.equal(recap.total, 3)
      const requests = await mock.requests()
      const taskRequest = requests.filter((request) => request.purpose === 'recap-questions').at(-1)
      assert.match(taskRequest.messages[2].content, /【复盘题数要求】8 道/)
    } finally {
      await ctx.request('PUT', '/api/settings', { recap: { questions: 'auto' } })
    }
  })

  it('RECAP-03 重复 start 幂等：返回已有会话、不重复调用 AI', async () => {
    const { id } = await createRecapReadyArticle('RECAP-03')
    const first = await startRecap(id)
    await mock.reset()
    const second = await startRecap(id)
    assert.equal(second.id, first.id)
    assert.deepEqual(second.questions, first.questions)
    assert.deepEqual(await mock.requests(), [])
  })

  it('RECAP-04 出题非法 → 降级通用题（degraded:true，仍可复盘）', async () => {
    const invalidMock = await startMockAi({ mode: 'invalid-json' })
    try {
      await configureAi(invalidMock)
      const { id } = await createRecapReadyArticle('RECAP-04')
      const recap = await startRecap(id)
      assert.equal(recap.degraded, true)
      assert.equal(recap.total, 4)
      assert.deepEqual(
        recap.questions.map((question) => question.id),
        [1, 2, 3, 4]
      )
      const types = new Set(recap.questions.map((question) => question.type))
      assert.ok(types.has('理解') && types.has('语法') && types.has('翻译'))
      const session = ctx.db
        .prepare('SELECT prompt_version FROM recap_sessions WHERE article_id = ?')
        .get(id)
      assert.equal(session.prompt_version, 'recap-q-v2-degraded')
      const reread = await ctx.request('GET', `/api/articles/${id}/recap`)
      assert.equal(reread.json.recap.degraded, true)
      const article = ctx.db.prepare('SELECT status FROM articles WHERE id = ?').get(id)
      assert.equal(article.status, 'recap')
    } finally {
      await invalidMock.stop()
    }
  })

  it('RECAP-05 answer：评估返回、追加 answers、下一题与进度正确', async () => {
    const { id } = await createRecapReadyArticle('RECAP-05')
    const recap = await startRecap(id)
    const response = await ctx.request('POST', `/api/articles/${id}/recap/answer`, {
      questionId: 1,
      answer: '因为后面的人太吵，作者听不清演员。'
    })
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json.answer.questionId, 1)
    assert.equal(response.json.answer.evaluation.verdict, '部分正确')
    assert.match(response.json.answer.evaluation.comment, /方向对/)
    assert.equal(response.json.answer.skipped, false)
    assert.equal(response.json.answer.degraded, false)
    assert.equal(response.json.nextQuestion.id, 2)
    assert.deepEqual(response.json.progress, { answered: 1, total: recap.total, skipped: 0 })
    const stored = ctx.db
      .prepare('SELECT answers_json FROM recap_sessions WHERE article_id = ?')
      .get(id)
    const answers = JSON.parse(stored.answers_json)
    assert.equal(answers.length, 1)
    assert.equal(answers[0].questionId, 1)
    assert.ok(answers[0].answeredAt)
  })

  it('RECAP-06 重复作答 409；不存在题目 400', async () => {
    const { id } = await createRecapReadyArticle('RECAP-06')
    await startRecap(id)
    assert.equal(
      (
        await ctx.request('POST', `/api/articles/${id}/recap/answer`, {
          questionId: 1,
          answer: '第一次'
        })
      ).status,
      200
    )
    const duplicate = await ctx.request('POST', `/api/articles/${id}/recap/answer`, {
      questionId: 1,
      answer: '第二次'
    })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.json.error.code, 'ALREADY_ANSWERED')
    const missing = await ctx.request('POST', `/api/articles/${id}/recap/answer`, {
      questionId: 99,
      answer: '不存在'
    })
    assert.equal(missing.status, 400)
    assert.equal(missing.json.error.code, 'VALIDATION')
  })

  it('RECAP-07 评估失败 → 答案照存 + evaluation:null + degraded:true', async () => {
    const invalidMock = await startMockAi({ mode: 'invalid-json' })
    try {
      const { id } = await createRecapReadyArticle('RECAP-07')
      await configureAi(mock)
      await startRecap(id)
      await configureAi(invalidMock)
      const response = await ctx.request('POST', `/api/articles/${id}/recap/answer`, {
        questionId: 1,
        answer: '评估会失败的答案'
      })
      assert.equal(response.status, 200, response.text)
      assert.equal(response.json.answer.evaluation, null)
      assert.equal(response.json.answer.degraded, true)
      assert.equal(response.json.degraded, true)
      assert.equal(response.json.progress.answered, 1)
      const stored = ctx.db
        .prepare('SELECT answers_json FROM recap_sessions WHERE article_id = ?')
        .get(id)
      assert.equal(JSON.parse(stored.answers_json)[0].degraded, true)
    } finally {
      await invalidMock.stop()
    }
  })

  it('RECAP-09 skip：不回补答、nextQuestion 前进、进度不增加、重复幂等', async () => {
    const { id } = await createRecapReadyArticle('RECAP-09')
    const recap = await startRecap(id)
    const skipped = await ctx.request('POST', `/api/articles/${id}/recap/skip`, { questionId: 1 })
    assert.equal(skipped.status, 200, skipped.text)
    assert.equal(skipped.json.nextQuestion.id, 2)
    assert.deepEqual(skipped.json.progress, { answered: 0, total: recap.total, skipped: 1 })
    const again = await ctx.request('POST', `/api/articles/${id}/recap/skip`, { questionId: 1 })
    assert.equal(again.status, 200)
    assert.deepEqual(again.json.progress, { answered: 0, total: recap.total, skipped: 1 })
    const answeredSkip = await ctx.request('POST', `/api/articles/${id}/recap/answer`, {
      questionId: 1,
      answer: '试图补答'
    })
    assert.equal(answeredSkip.status, 409)
    assert.equal(answeredSkip.json.error.code, 'ALREADY_ANSWERED')
    const reread = await ctx.request('GET', `/api/articles/${id}/recap`)
    assert.equal(reread.json.recap.answers[0].skipped, true)
    assert.equal(reread.json.recap.nextQuestion.id, 2)
  })

  it('RECAP-08 自由提问 SSE：delta/done、messages 持久化、写库', async () => {
    const { id } = await createRecapReadyArticle('RECAP-08')
    await startRecap(id)
    await mock.reset()
    const response = await fetch(`${ctx.baseUrl}/api/articles/${id}/recap/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '这篇文章主要讲了什么？' })
    })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/event-stream/)
    const text = await response.text()
    const events = parseSse(text)
    const deltas = events.filter((event) => event.event === 'delta')
    const done = events.find((event) => event.event === 'done')
    assert.ok(deltas.length > 0)
    assert.ok(done)
    assert.equal(done.data.content, deltas.map((event) => event.data.text).join(''))
    const session = ctx.db
      .prepare('SELECT messages_json FROM recap_sessions WHERE article_id = ?')
      .get(id)
    const messages = JSON.parse(session.messages_json)
    assert.equal(messages.length, 2)
    assert.equal(messages[0].role, 'user')
    assert.equal(messages[1].role, 'assistant')
    assert.equal(messages[1].partial, 0)
    const recap = await ctx.request('GET', `/api/articles/${id}/recap`)
    assert.equal(recap.json.recap.messages.length, 2)
    const requests = await mock.requests()
    const chatRequest = requests.filter((request) => request.purpose === 'recap-chat').at(-1)
    assert.equal(chatRequest.stream, true)
    assert.match(chatRequest.messages[0].content, /复盘环节回答学生的问题/)
    assert.match(chatRequest.messages[2].content, /【本轮问题】这篇文章主要讲了什么？/)
  })

  it('RECAP-13 刷新恢复：GET recap 同构返回题组/作答/消息/nextQuestion', async () => {
    const { id } = await createRecapReadyArticle('RECAP-13')
    const started = await startRecap(id)
    await ctx.request('POST', `/api/articles/${id}/recap/answer`, {
      questionId: 1,
      answer: '答案一'
    })
    await ctx.request('POST', `/api/articles/${id}/recap/skip`, { questionId: 2 })
    const restored = await ctx.request('GET', `/api/articles/${id}/recap`)
    assert.equal(restored.status, 200)
    const recap = restored.json.recap
    assert.equal(recap.id, started.id)
    assert.equal(recap.status, 'asking')
    assert.deepEqual(recap.questions, started.questions)
    assert.equal(recap.answers.length, 2)
    assert.equal(recap.nextQuestion.id, 3)
    assert.deepEqual(recap.progress, { answered: 1, total: started.total, skipped: 1 })
  })

  it('RECAP-10/12 finish：提前结束生成小结、状态 done、completed_at、重复 finish 幂等', async () => {
    const { id } = await createRecapReadyArticle('RECAP-12')
    await startRecap(id)
    await ctx.request('POST', `/api/articles/${id}/recap/answer`, {
      questionId: 1,
      answer: '答案一'
    })
    await ctx.request('POST', `/api/articles/${id}/recap/skip`, { questionId: 2 })
    // 第 3 题未答，允许提前结束
    const response = await ctx.request('POST', `/api/articles/${id}/recap/finish`)
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json.summary.articleId, id)
    assert.equal(response.json.summary.degraded, false)
    const summaryId = response.json.summary.id
    const article = ctx.db.prepare('SELECT status, completed_at FROM articles WHERE id = ?').get(id)
    assert.equal(article.status, 'done')
    assert.ok(article.completed_at)
    const session = ctx.db
      .prepare('SELECT status, finished_at FROM recap_sessions WHERE article_id = ?')
      .get(id)
    assert.equal(session.status, 'finished')
    assert.ok(session.finished_at)
    const summaryRow = ctx.db.prepare('SELECT * FROM summaries WHERE article_id = ?').get(id)
    assert.equal(summaryRow.degraded, 0)
    const data = JSON.parse(summaryRow.data_json)
    assert.match(data.overview, /图书馆经历/)
    assert.deepEqual(data.issueSummary, { 漏译: 0, 误译: 6, 理解偏差: 0 })
    assert.equal(data.knowledgePoints.length, 2)
    assert.equal(data.weakSentences.length, 1)

    const again = await ctx.request('POST', `/api/articles/${id}/recap/finish`)
    assert.equal(again.status, 200)
    assert.equal(again.json.summary.id, summaryId)

    const detail = await ctx.request('GET', `/api/articles/${id}`)
    assert.equal(detail.json.article.status, 'done')
    assert.equal(detail.json.article.hasSummary, true)
    assert.equal(detail.json.article.hasRecap, true)
  })

  it('RECAP-11 小结 AI 失败 → 本地简版 SummaryData（degraded:true）且仍置 done', async () => {
    const { id } = await createRecapReadyArticle('RECAP-11')
    await startRecap(id)
    const invalidMock = await startMockAi({ mode: 'invalid-json' })
    try {
      await configureAi(invalidMock)
      const response = await ctx.request('POST', `/api/articles/${id}/recap/finish`)
      assert.equal(response.status, 200, response.text)
      assert.equal(response.json.summary.degraded, true)
      const summaryRow = ctx.db.prepare('SELECT * FROM summaries WHERE article_id = ?').get(id)
      assert.equal(summaryRow.degraded, 1)
      assert.equal(summaryRow.prompt_version, 'summary-v1-degraded')
      const data = JSON.parse(summaryRow.data_json)
      assert.equal(data.degraded, true)
      assert.deepEqual(data.knowledgePoints, [])
      assert.match(data.overview, /本篇共 6 句/)
      assert.deepEqual(data.issueSummary, { 漏译: 0, 误译: 6, 理解偏差: 0 })
      const article = ctx.db.prepare('SELECT status FROM articles WHERE id = ?').get(id)
      assert.equal(article.status, 'done')
      const getSummary = await ctx.request('GET', `/api/articles/${id}/summary`)
      assert.equal(getSummary.json.summary.degraded, true)
    } finally {
      await invalidMock.stop()
    }
  })

  it('AI 未配置：start 返回 400 AI_NOT_CONFIGURED，文章保持 reading', async () => {
    const fresh = await startTestApp()
    try {
      const created = await fresh.request('POST', '/api/articles', {
        content: uniqueContent('RECAP-NO-CONFIG')
      })
      const id = created.json.article.id
      await fresh.request('POST', `/api/articles/${id}/start`)
      fresh.db.prepare("UPDATE sentence_work SET status = 'skipped' WHERE article_id = ?").run(id)
      fresh.db
        .prepare(
          "UPDATE articles SET processed_count = sentence_count, status = 'reading' WHERE id = ?"
        )
        .run(id)
      const response = await fresh.request('POST', `/api/articles/${id}/recap/start`)
      assert.equal(response.status, 400)
      assert.equal(response.json.error.code, 'AI_NOT_CONFIGURED')
      const article = fresh.db.prepare('SELECT status FROM articles WHERE id = ?').get(id)
      assert.equal(article.status, 'reading')
    } finally {
      await fresh.close()
    }
  })
})
