import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { startTestApp } from '../helpers/temp-db.js'

let contentCounter = 0

/**
 * @param {string} label
 * @returns {string}
 */
function uniqueContent(label) {
  contentCounter += 1
  return `${label} sentence ${contentCounter}. Another sentence follows here.`
}

describe('M2-04 导入 preview / commit（IMPORT-08/09/10）', () => {
  /** @type {Awaited<ReturnType<typeof startTestApp>>} */
  let ctx

  before(async () => {
    ctx = await startTestApp()
  })

  after(async () => {
    await ctx.close()
  })

  it('preview：多篇 md 返回大纲节点', async () => {
    const content = ['# Lesson 1', '', 'Body one.', '', '# Lesson 2', '', 'Body two.'].join('\n')
    const response = await ctx.request('POST', '/api/articles/import/preview', {
      filename: 'book.md',
      content
    })
    assert.equal(response.status, 200)
    assert.equal(response.json.ok, true)
    assert.equal(response.json.format, 'markdown')
    assert.equal(response.json.nodes.length, 2)
    const node = response.json.nodes[0]
    for (const key of ['id', 'level', 'title', 'chars', 'preview', 'content']) {
      assert.ok(key in node, `node 缺少字段 ${key}`)
    }
    assert.deepEqual(
      response.json.nodes.map((item) => item.title),
      ['Lesson 1', 'Lesson 2']
    )
    assert.ok(Array.isArray(response.json.warnings))
  })

  it('preview：txt 整文件一篇，标题取文件名', async () => {
    const response = await ctx.request('POST', '/api/articles/import/preview', {
      filename: 'my-passage.txt',
      content: 'Hello world. This is the text.'
    })
    assert.equal(response.status, 200)
    assert.equal(response.json.format, 'txt')
    assert.equal(response.json.nodes.length, 1)
    assert.equal(response.json.nodes[0].title, 'my-passage')
  })

  it('preview：非法扩展名 415、空内容 400', async () => {
    const unsupported = await ctx.request('POST', '/api/articles/import/preview', {
      filename: 'doc.pdf',
      content: 'hello world content'
    })
    assert.equal(unsupported.status, 415)
    assert.equal(unsupported.json.error.code, 'UNSUPPORTED_FORMAT')

    const empty = await ctx.request('POST', '/api/articles/import/preview', {
      filename: 'doc.md',
      content: ''
    })
    assert.equal(empty.status, 400)
    assert.equal(empty.json.error.code, 'VALIDATION')
  })

  it('IMPORT-08 commit：批量入库、句子落库、队列顺序连续', async () => {
    const preview = await ctx.request('POST', '/api/articles/import/preview', {
      filename: 'collection.md',
      content: [
        '# One',
        '',
        'First body sentence. Second body sentence.',
        '',
        '# Two',
        '',
        'Third body sentence.'
      ].join('\n')
    })
    const items = preview.json.nodes.map((node) => ({
      title: node.title,
      content: node.content,
      sourceFormat: 'md'
    }))
    const before = (await ctx.request('GET', '/api/articles')).json.total
    const commit = await ctx.request('POST', '/api/articles/import/commit', { items })
    assert.equal(commit.status, 200)
    assert.equal(commit.json.count, 2)
    assert.equal(commit.json.articles.length, 2)
    assert.deepEqual(commit.json.skipped, [])

    const after = await ctx.request('GET', '/api/articles')
    assert.equal(after.json.total, before + 2)
    const created = commit.json.articles[0]
    const sentences = ctx.db
      .prepare('SELECT COUNT(*) AS c FROM sentences WHERE article_id = ?')
      .get(created.id)
    assert.ok(sentences.c >= 1)
    const queueOrders = after.json.items
      .filter((row) => row.status === 'queued')
      .map((row) => row.id)
    assert.ok(queueOrders.includes(created.id))
  })

  it('IMPORT-09 commit 重复内容：skipped 返回且不重复建文章', async () => {
    const content = uniqueContent('duplicate-import')
    const first = await ctx.request('POST', '/api/articles/import/commit', {
      items: [{ content, sourceFormat: 'md' }]
    })
    assert.equal(first.status, 200)
    assert.equal(first.json.count, 1)
    const existingId = first.json.articles[0].id

    const second = await ctx.request('POST', '/api/articles/import/commit', {
      items: [{ content, sourceFormat: 'md' }]
    })
    assert.equal(second.status, 200)
    assert.equal(second.json.count, 0)
    assert.equal(second.json.skipped.length, 1)
    assert.equal(second.json.skipped[0].reason, 'DUPLICATE_CONTENT')
    assert.equal(second.json.skipped[0].existingId, existingId)
  })

  it('IMPORT-10 commit 事务失败整体回滚（service 层）', async () => {
    const articleService = ctx.app.locals.services.articleService
    const before = (await ctx.request('GET', '/api/articles')).json.total
    assert.throws(
      () =>
        articleService.commitImport([
          { content: uniqueContent('rollback-ok'), sourceFormat: 'md' },
          { content: '', sourceFormat: 'md' }
        ]),
      (error) => error.code === 'VALIDATION'
    )
    const after = (await ctx.request('GET', '/api/articles')).json.total
    assert.equal(after, before)
    const leaked = ctx.db
      .prepare("SELECT COUNT(*) AS c FROM articles WHERE content LIKE '%rollback-ok%'")
      .get()
    assert.equal(leaked.c, 0)
  })

  it('commit 批量上限：>300 篇、累计 >100000 字符均 400', async () => {
    const tooMany = await ctx.request('POST', '/api/articles/import/commit', {
      items: Array.from({ length: 301 }, (_, index) => ({
        content: `Sentence for item ${index}.`,
        sourceFormat: 'md'
      }))
    })
    assert.equal(tooMany.status, 400)
    assert.equal(tooMany.json.error.code, 'VALIDATION')

    const tooLong = await ctx.request('POST', '/api/articles/import/commit', {
      items: [
        { content: `${'a'.repeat(60000)}.`, sourceFormat: 'md' },
        { content: `${'b'.repeat(60000)}.`, sourceFormat: 'md' }
      ]
    })
    assert.equal(tooLong.status, 400)
    assert.equal(tooLong.json.error.code, 'VALIDATION')
    assert.ok(tooLong.json.error.detail.fields.some((field) => field.path === 'items'))
  })

  it('commit 单篇正文超过 100000 字符返回 400', async () => {
    const response = await ctx.request('POST', '/api/articles/import/commit', {
      items: [{ content: `${'c'.repeat(100001)}.`, sourceFormat: 'md' }]
    })
    assert.equal(response.status, 400)
    assert.equal(response.json.error.code, 'VALIDATION')
  })
})
