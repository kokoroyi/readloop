import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { startMockAi } from '../helpers/mock-ai.js'
import { startTestApp } from '../helpers/temp-db.js'

let contentCounter = 0

/**
 * 生成 5 句英文正文。
 * @param {string} label
 * @returns {string[]}
 */
function sentenceList(label) {
  contentCounter += 1
  return Array.from(
    { length: 5 },
    (_, index) => `${label} sample ${contentCounter} sentence ${index + 1} is here.`
  )
}

/**
 * @param {string} label
 * @returns {string}
 */
function uniqueContent(label) {
  return sentenceList(label).join(' ')
}

describe('M4 学习小结 / 重新精读（SUM-01~08）', () => {
  /** @type {Awaited<ReturnType<typeof startMockAi>>} */
  let mock
  /** @type {Awaited<ReturnType<typeof startTestApp>>} */
  let ctx

  before(async () => {
    mock = await startMockAi()
    ctx = await startTestApp()
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
   * 创建文章并进入 reading。
   * @param {string} label
   * @param {{ title?: string, sentenceTexts?: string[] }} [options]
   * @returns {Promise<{ id: number, sentenceCount: number, content: string }>}
   */
  async function createStartedArticle(label, options = {}) {
    const content = options.sentenceTexts ? options.sentenceTexts.join(' ') : uniqueContent(label)
    const created = await ctx.request('POST', '/api/articles', {
      title: options.title ?? label,
      content
    })
    assert.equal(created.status, 200, created.text)
    const { id, sentenceCount } = created.json.article
    const started = await ctx.request('POST', `/api/articles/${id}/start`)
    assert.equal(started.status, 200, started.text)
    return { id, sentenceCount, content }
  }

  /**
   * 按每句问题类型 seed 批改结果（skip 表示跳过）。
   * @param {number} articleId
   * @param {(string[] | 'skip')[]} corrections
   */
  function seedCorrections(articleId, corrections) {
    const now = new Date().toISOString()
    const updateWork = ctx.db.prepare(
      `UPDATE sentence_work SET status = ?, my_translation = ?, correction_json = ?, model = 'mock-model',
        prompt_version = 'correct-v1', submitted_at = ?, corrected_at = ?, updated_at = ?
       WHERE article_id = ? AND idx = ?`
    )
    let skipped = 0
    corrections.forEach((types, idx) => {
      if (types === 'skip') {
        skipped += 1
        updateWork.run('skipped', null, null, null, null, now, articleId, idx)
        return
      }
      const correction = JSON.stringify({
        issues: types.map((type) => ({ type, fragment: '片段', explain: '测试问题' })),
        referenceTranslation: `参考译文 ${idx + 1}`
      })
      updateWork.run('corrected', `我的译文 ${idx + 1}`, correction, now, now, now, articleId, idx)
    })
    ctx.db
      .prepare(
        'UPDATE articles SET processed_count = ?, skipped_count = ?, updated_at = ? WHERE id = ?'
      )
      .run(corrections.length, skipped, now, articleId)
  }

  /**
   * 创建一篇已处理完、可直接进入复盘的文章。
   * @param {string} label
   * @param {{ title?: string, sentenceTexts?: string[], corrections?: (string[] | 'skip')[] }} [options]
   * @returns {Promise<{ id: number, sentenceCount: number }>}
   */
  async function createRecapReadyArticle(label, options = {}) {
    const article = await createStartedArticle(label, options)
    const corrections =
      options.corrections ??
      Array.from({ length: article.sentenceCount }, (_, index) =>
        index === 0
          ? ['误译']
          : index === 1
            ? ['误译', '漏译']
            : index === 2
              ? ['理解偏差']
              : index === 3
                ? 'skip'
                : ['误译']
      )
    seedCorrections(article.id, corrections)
    return article
  }

  /**
   * 走完复盘并生成小结。
   * @param {string} label
   * @param {{ title?: string, sentenceTexts?: string[], corrections?: (string[] | 'skip')[], invalidSummary?: boolean }} [options]
   * @returns {Promise<{ id: number, sentenceCount: number, summaryId: number, degraded: boolean }>}
   */
  async function finishArticle(label, options = {}) {
    const article = await createRecapReadyArticle(label, options)
    const started = await ctx.request('POST', `/api/articles/${article.id}/recap/start`)
    assert.equal(started.status, 200, started.text)
    await ctx.request('POST', `/api/articles/${article.id}/recap/answer`, {
      questionId: 1,
      answer: '这是第一题的回答。'
    })
    if (options.invalidSummary) {
      const invalidMock = await startMockAi({ mode: 'invalid-json' })
      try {
        await configureAi(invalidMock)
        const response = await ctx.request('POST', `/api/articles/${article.id}/recap/finish`)
        assert.equal(response.status, 200, response.text)
        return {
          ...article,
          summaryId: response.json.summary.id,
          degraded: response.json.summary.degraded
        }
      } finally {
        await invalidMock.stop()
        await configureAi(mock)
      }
    }
    const response = await ctx.request('POST', `/api/articles/${article.id}/recap/finish`)
    assert.equal(response.status, 200, response.text)
    return {
      ...article,
      summaryId: response.json.summary.id,
      degraded: response.json.summary.degraded
    }
  }

  it('SUM-01 正常生成小结：issueSummary 服务端统计、结构完整、status=done', async () => {
    const result = await finishArticle('SUM-01')
    assert.equal(result.degraded, false)
    const response = await ctx.request('GET', `/api/articles/${result.id}/summary`)
    assert.equal(response.status, 200)
    assert.equal(response.json.ok, true)
    const { summary, article } = response.json
    assert.equal(summary.id, result.summaryId)
    assert.equal(summary.degraded, false)
    assert.equal(summary.promptVersion, 'summary-v1')
    assert.equal(summary.userNotes, '')
    assert.ok(summary.createdAt)
    assert.deepEqual(summary.data.issueSummary, { 漏译: 1, 误译: 3, 理解偏差: 1 })
    assert.match(summary.data.overview, /图书馆经历/)
    assert.equal(summary.data.knowledgePoints.length, 2)
    assert.equal(summary.data.weakSentences.length, 1)
    assert.equal(summary.data.suggestions.length, 2)
    assert.equal(summary.data.degraded, false)
    assert.equal(article.id, result.id)
    assert.equal(article.status, 'done')
    assert.ok(article.completedAt)
    assert.ok(article.startedAt)
    assert.equal(article.sentenceCount, 5)
  })

  it('SUM-02 模型输出非法 → 本地简版小结（degraded:true）且文章 done', async () => {
    const result = await finishArticle('SUM-02', { invalidSummary: true })
    assert.equal(result.degraded, true)
    const response = await ctx.request('GET', `/api/articles/${result.id}/summary`)
    assert.equal(response.status, 200)
    assert.equal(response.json.summary.degraded, true)
    assert.deepEqual(response.json.summary.data.knowledgePoints, [])
    assert.match(response.json.summary.data.overview, /本篇共 5 句/)
    assert.deepEqual(response.json.summary.data.issueSummary, { 漏译: 1, 误译: 3, 理解偏差: 1 })
    assert.ok(response.json.summary.data.weakSentences.length > 0)
    assert.equal(response.json.article.status, 'done')
  })

  it('SUM-03/06 导出 Markdown：章节完整、逐句对照、附件头与文件名', async () => {
    const result = await finishArticle('SUM-06')
    const response = await ctx.request('GET', `/api/articles/${result.id}/summary/export`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/markdown/)
    assert.match(
      response.headers.get('content-disposition'),
      new RegExp(`attachment; filename="readloop-summary-${result.id}\\.md"`)
    )
    const markdown = response.text
    assert.match(markdown, /^# 学习小结 · SUM-06/m)
    assert.match(markdown, /## 整体评价/)
    assert.match(markdown, /## 问题汇总/)
    assert.match(markdown, /\| 误译 \| 3 \|/)
    assert.match(markdown, /## 知识点/)
    assert.match(markdown, /## 逐句对照/)
    assert.match(markdown, /## 薄弱句/)
    assert.match(markdown, /## 建议/)
    assert.match(markdown, /## 我的笔记/)
    // 5 句对照 + 2 行表头
    const tableLines = markdown
      .split('\n')
      .filter((line) => line.startsWith('| ') && /\| (参考译文 )?\d+ \|/.test(line))
    assert.ok(markdown.includes('我的译文 1'))
    assert.ok(markdown.includes('参考译文 1'))
    assert.ok(tableLines.length >= 5)
  })

  it('SUM-04 保存笔记：PATCH 持久化、GET 返回、导出包含', async () => {
    const result = await finishArticle('SUM-04')
    const patched = await ctx.request('PATCH', `/api/articles/${result.id}/summary`, {
      userNotes: '我的笔记：\n注意 quiet 的用法。'
    })
    assert.equal(patched.status, 200)
    assert.ok(patched.json.updatedAt)
    const response = await ctx.request('GET', `/api/articles/${result.id}/summary`)
    assert.equal(response.json.summary.userNotes, '我的笔记：\n注意 quiet 的用法。')
    const row = ctx.db
      .prepare('SELECT user_notes FROM summaries WHERE article_id = ?')
      .get(result.id)
    assert.equal(row.user_notes, '我的笔记：\n注意 quiet 的用法。')
    const exported = await ctx.request('GET', `/api/articles/${result.id}/summary/export`)
    assert.match(exported.text, /我的笔记：/)
    assert.match(exported.text, /注意 quiet 的用法。/)
  })

  it('SUM-05 笔记超长 → 400 VALIDATION（字段路径 userNotes）', async () => {
    const result = await finishArticle('SUM-05')
    const response = await ctx.request('PATCH', `/api/articles/${result.id}/summary`, {
      userNotes: 'x'.repeat(20001)
    })
    assert.equal(response.status, 400)
    assert.equal(response.json.error.code, 'VALIDATION')
    assert.ok(response.json.error.detail.fields.some((field) => field.path === 'userNotes'))
  })

  it('SUM-07 特殊字符：标题与句子含 | 时导出表格转义不破坏结构', async () => {
    const result = await finishArticle('SUM-07', {
      title: '特殊|标题',
      sentenceTexts: [
        'A | pipe sentence is here.',
        'Second | sentence with pipe.',
        'Third plain sentence.',
        'Fourth plain sentence.',
        'Fifth plain sentence.'
      ]
    })
    const response = await ctx.request('GET', `/api/articles/${result.id}/summary/export`)
    assert.equal(response.status, 200)
    assert.match(response.text, /A \\\| pipe sentence is here\./)
    assert.match(response.text, /Second \\\| sentence with pipe\./)
    assert.doesNotMatch(response.text, /A \| pipe sentence is here\. \|/)
  })

  it('GET summary 不存在 → 404；PATCH 不存在 → 404', async () => {
    const created = await createStartedArticle('SUM-NONE')
    const getSummary = await ctx.request('GET', `/api/articles/${created.id}/summary`)
    assert.equal(getSummary.status, 404)
    assert.equal(getSummary.json.error.code, 'NOT_FOUND')
    const patch = await ctx.request('PATCH', `/api/articles/${created.id}/summary`, {
      userNotes: 'x'
    })
    assert.equal(patch.status, 404)
  })

  it('SUM-08 重新精读：清空 work/chats/recap/summary、计数归零、重开计时', async () => {
    const result = await finishArticle('SUM-08')
    const beforeDetail = await ctx.request('GET', `/api/articles/${result.id}`)
    assert.equal(beforeDetail.json.article.hasRecap, true)
    assert.equal(beforeDetail.json.article.hasSummary, true)
    const beforeSessionCount = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM reading_sessions WHERE article_id = ?')
      .get(result.id).c

    const response = await ctx.request('POST', `/api/articles/${result.id}/re-read`)
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json.article.id, result.id)
    assert.equal(response.json.article.status, 'reading')
    assert.deepEqual(response.json.work, { processed: 0, total: result.sentenceCount })
    assert.equal(typeof response.json.sessionId, 'number')
    assert.equal(response.json.resumed, false)

    const detail = await ctx.request('GET', `/api/articles/${result.id}`)
    assert.equal(detail.json.article.status, 'reading')
    assert.equal(detail.json.article.processedCount, 0)
    assert.equal(detail.json.article.skippedCount, 0)
    assert.equal(detail.json.article.completedAt, null)
    assert.equal(detail.json.article.hasRecap, false)
    assert.equal(detail.json.article.hasSummary, false)

    const workRows = ctx.db
      .prepare('SELECT status FROM sentence_work WHERE article_id = ? ORDER BY idx')
      .all(result.id)
    assert.equal(workRows.length, result.sentenceCount)
    assert.ok(workRows.every((row) => row.status === 'pending'))
    assert.equal(
      ctx.db.prepare('SELECT COUNT(*) AS c FROM sentence_chats WHERE article_id = ?').get(result.id)
        .c,
      0
    )
    assert.equal(
      ctx.db.prepare('SELECT COUNT(*) AS c FROM recap_sessions WHERE article_id = ?').get(result.id)
        .c,
      0
    )
    assert.equal(
      ctx.db.prepare('SELECT COUNT(*) AS c FROM summaries WHERE article_id = ?').get(result.id).c,
      0
    )
    assert.equal(
      ctx.db
        .prepare(
          'SELECT COUNT(*) AS c FROM reading_sessions WHERE article_id = ? AND ended_at IS NULL'
        )
        .get(result.id).c,
      1
    )
    assert.equal(
      ctx.db
        .prepare('SELECT COUNT(*) AS c FROM reading_sessions WHERE article_id = ?')
        .get(result.id).c,
      beforeSessionCount + 1
    )

    assert.equal((await ctx.request('GET', `/api/articles/${result.id}/summary`)).status, 404)
    assert.equal((await ctx.request('GET', `/api/articles/${result.id}/recap`)).status, 404)
  })

  it('re-read 非 done 状态 → 409 STATE_CONFLICT', async () => {
    const created = await createStartedArticle('SUM-08-READING')
    const response = await ctx.request('POST', `/api/articles/${created.id}/re-read`)
    assert.equal(response.status, 409)
    assert.equal(response.json.error.code, 'STATE_CONFLICT')
  })
})
