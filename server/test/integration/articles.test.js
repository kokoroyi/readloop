import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { startTestApp } from '../helpers/temp-db.js'

let contentCounter = 0

/**
 * 生成唯一正文（长度 ≥20，含 3 句），避免 content_hash 冲突。
 * @param {string} label
 * @returns {string}
 */
function uniqueContent(label) {
  contentCounter += 1
  return `${label} marker ${contentCounter}. This is the second sentence. And a third one.`
}

describe('M2-03 文章服务与路由（ART-01~05/07/08/09/10 + work）', () => {
  /** @type {Awaited<ReturnType<typeof startTestApp>>} */
  let ctx

  before(async () => {
    ctx = await startTestApp()
  })

  after(async () => {
    await ctx.close()
  })

  it('ART-01 创建文章：queued、句子落库、queue_order 末尾', async () => {
    const content = uniqueContent('ART-01')
    const response = await ctx.request('POST', '/api/articles', {
      title: 'The quiet library',
      content
    })
    assert.equal(response.status, 200)
    const { article } = response.json
    assert.equal(response.json.ok, true)
    assert.equal(article.status, 'queued')
    assert.equal(article.title, 'The quiet library')
    assert.equal(article.duplicate, false)
    assert.ok(article.sentenceCount >= 3)
    assert.ok(article.queueOrder >= 1)

    const sentenceRows = ctx.db
      .prepare(
        'SELECT idx, text, start_off, end_off FROM sentences WHERE article_id = ? ORDER BY idx'
      )
      .all(article.id)
    assert.equal(sentenceRows.length, article.sentenceCount)
    assert.equal(sentenceRows[0].idx, 0)
    assert.equal(
      content.slice(sentenceRows[0].start_off, sentenceRows[0].end_off),
      sentenceRows[0].text
    )
  })

  it('详情 / PATCH 标题 / 句数进度字段', async () => {
    const created = await ctx.request('POST', '/api/articles', {
      content: uniqueContent('详情')
    })
    const id = created.json.article.id
    // 空标题由首句生成
    assert.ok(created.json.article.title.length > 0)

    const detail = await ctx.request('GET', `/api/articles/${id}`)
    assert.equal(detail.status, 200)
    assert.equal(detail.json.article.hasRecap, false)
    assert.equal(detail.json.article.hasSummary, false)
    assert.equal(typeof detail.json.article.content, 'string')
    assert.equal(detail.json.article.progress, 0)

    const patched = await ctx.request('PATCH', `/api/articles/${id}`, { title: '新标题' })
    assert.equal(patched.status, 200)
    assert.equal(patched.json.article.title, '新标题')
    const reread = await ctx.request('GET', `/api/articles/${id}`)
    assert.equal(reread.json.article.title, '新标题')
  })

  it('ART-02/03 列表筛选、搜索与排序', async () => {
    await ctx.request('POST', '/api/articles', {
      title: 'Filter target',
      content: uniqueContent('filterable-keyword')
    })
    const all = await ctx.request('GET', '/api/articles')
    assert.equal(all.status, 200)
    assert.ok(all.json.total >= 2)
    const item = all.json.items[0]
    for (const key of [
      'id',
      'title',
      'status',
      'sourceFormat',
      'sentenceCount',
      'processedCount',
      'skippedCount',
      'updatedAt',
      'progress'
    ]) {
      assert.ok(key in item, `列表项缺少字段 ${key}`)
    }

    const filtered = await ctx.request('GET', '/api/articles?status=queued')
    assert.equal(filtered.status, 200)
    assert.ok(filtered.json.items.every((row) => row.status === 'queued'))

    const searched = await ctx.request(
      'GET',
      `/api/articles?q=${encodeURIComponent('filterable-keyword')}`
    )
    assert.equal(searched.json.total, 1)

    const sorted = await ctx.request('GET', '/api/articles?sort=updated')
    assert.equal(sorted.status, 200)
    const timestamps = sorted.json.items.map((row) => row.updatedAt)
    assert.deepEqual(timestamps, [...timestamps].sort().reverse())

    const badStatus = await ctx.request('GET', '/api/articles?status=bogus')
    assert.equal(badStatus.status, 400)
    assert.equal(badStatus.json.error.code, 'VALIDATION')
  })

  it('ART-04 重排队列：事务重写 queue_order 并持久化', async () => {
    const ids = []
    for (const label of ['reorder-a', 'reorder-b', 'reorder-c']) {
      const response = await ctx.request('POST', '/api/articles', {
        title: label,
        content: uniqueContent(label)
      })
      ids.push(response.json.article.id)
    }
    const reversed = [...ids].reverse()
    const reorder = await ctx.request('POST', '/api/articles/reorder', { ids: reversed })
    assert.equal(reorder.status, 200)
    assert.equal(reorder.json.ok, true)

    const list = await ctx.request('GET', '/api/articles?status=queued')
    const positions = reversed.map((id) => list.json.items.findIndex((row) => row.id === id))
    assert.ok(positions.every((position) => position >= 0))
    assert.deepEqual(
      positions,
      [...positions].sort((a, b) => a - b)
    )

    const badReorder = await ctx.request('POST', '/api/articles/reorder', { ids: [999999] })
    assert.equal(badReorder.status, 404)
    assert.equal(badReorder.json.error.code, 'NOT_FOUND')
  })

  it('ART-07 重复内容：409 + existingId；force 幂等 no-op 不写库', async () => {
    const content = uniqueContent('duplicate')
    const first = await ctx.request('POST', '/api/articles', { title: '第一次', content })
    const existingId = first.json.article.id
    const totalBefore = (await ctx.request('GET', '/api/articles')).json.total

    const duplicate = await ctx.request('POST', '/api/articles', { title: '重复', content })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.json.error.code, 'DUPLICATE_ARTICLE')
    assert.equal(duplicate.json.error.retryable, false)
    assert.equal(duplicate.json.error.detail.existingId, existingId)

    const forced = await ctx.request('POST', '/api/articles', {
      title: '重复',
      content,
      force: true
    })
    assert.equal(forced.status, 200)
    assert.equal(forced.json.ok, true)
    assert.equal(forced.json.duplicate, true)
    assert.equal(forced.json.existingId, existingId)
    assert.equal(forced.json.article.id, existingId)
    assert.equal(forced.json.article.status, 'queued')

    const totalAfter = (await ctx.request('GET', '/api/articles')).json.total
    assert.equal(totalAfter, totalBefore)
    const stored = await ctx.request('GET', `/api/articles/${existingId}`)
    assert.equal(stored.json.article.title, '第一次')
  })

  it('ART-08/09 start：批量建 pending work、返回 sessionId、重复调用幂等', async () => {
    const created = await ctx.request('POST', '/api/articles', {
      title: 'start-target',
      content: uniqueContent('start')
    })
    const id = created.json.article.id
    const expectedSentences = created.json.article.sentenceCount

    const first = await ctx.request('POST', `/api/articles/${id}/start`)
    assert.equal(first.status, 200)
    assert.equal(first.json.article.id, id)
    assert.equal(first.json.article.status, 'reading')
    assert.equal(first.json.work.total, expectedSentences)
    assert.equal(first.json.work.processed, 0)
    assert.equal(typeof first.json.sessionId, 'number')
    assert.equal(first.json.resumed, false)

    const workCount = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM sentence_work WHERE article_id = ?')
      .get(id).c
    assert.equal(workCount, expectedSentences)
    const session = ctx.db
      .prepare('SELECT * FROM reading_sessions WHERE id = ?')
      .get(first.json.sessionId)
    assert.equal(session.article_id, id)
    assert.equal(session.ended_at, null)

    const second = await ctx.request('POST', `/api/articles/${id}/start`)
    assert.equal(second.status, 200)
    assert.equal(second.json.sessionId, first.json.sessionId)
    assert.equal(second.json.article.status, 'reading')
    assert.equal(second.json.resumed, true)
    const workCountAgain = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM sentence_work WHERE article_id = ?')
      .get(id).c
    assert.equal(workCountAgain, expectedSentences)
  })

  it('GET /api/articles/:id/work：M2 最小工作台数据', async () => {
    const created = await ctx.request('POST', '/api/articles', {
      title: 'work-target',
      content: uniqueContent('work')
    })
    const id = created.json.article.id
    await ctx.request('POST', `/api/articles/${id}/start`)

    const work = await ctx.request('GET', `/api/articles/${id}/work`)
    assert.equal(work.status, 200)
    assert.equal(work.json.ok, true)
    assert.equal(work.json.article.id, id)
    assert.equal(work.json.article.processed, 0)
    assert.equal(work.json.article.skipped, 0)
    assert.equal(work.json.article.currentIdx, 0)
    assert.equal(work.json.sentences.length, created.json.article.sentenceCount)
    const first = work.json.sentences[0]
    assert.equal(first.idx, 0)
    assert.equal(first.work.status, 'pending')
    assert.equal(first.work.myTranslation, null)
    assert.equal(first.work.correction, null)
    assert.deepEqual(work.json.chats, {})
  })

  it('ART-05 删除文章：级联句子/工作', async () => {
    const created = await ctx.request('POST', '/api/articles', {
      title: 'delete-target',
      content: uniqueContent('delete')
    })
    const id = created.json.article.id
    await ctx.request('POST', `/api/articles/${id}/start`)

    const removed = await ctx.request('DELETE', `/api/articles/${id}`)
    assert.equal(removed.status, 200)
    assert.equal(removed.json.ok, true)
    assert.equal((await ctx.request('GET', `/api/articles/${id}`)).status, 404)
    const sentenceCount = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM sentences WHERE article_id = ?')
      .get(id).c
    const workCount = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM sentence_work WHERE article_id = ?')
      .get(id).c
    assert.equal(sentenceCount, 0)
    assert.equal(workCount, 0)
  })

  it('ART-10 不存在/非法 id 与参数校验', async () => {
    assert.equal((await ctx.request('GET', '/api/articles/999999')).status, 404)
    assert.equal((await ctx.request('POST', '/api/articles/999999/start')).status, 404)
    assert.equal((await ctx.request('GET', '/api/articles/999999/work')).status, 404)
    assert.equal((await ctx.request('DELETE', '/api/articles/999999')).status, 404)
    const badId = await ctx.request('GET', '/api/articles/abc')
    assert.equal(badId.status, 400)
    assert.equal(badId.json.error.code, 'VALIDATION')
    const shortContent = await ctx.request('POST', '/api/articles', { content: 'too short' })
    assert.equal(shortContent.status, 400)
    assert.equal(shortContent.json.error.code, 'VALIDATION')
    assert.ok(shortContent.json.error.detail.fields.some((field) => field.path === 'content'))
    const badPatch = await ctx.request('PATCH', '/api/articles/1', { title: '' })
    assert.equal(badPatch.status, 400)
  })
})
