import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { createDictFixture, startTestApp } from '../helpers/temp-db.js'

const CSV_HEADER = 'lemma,display,phonetic,translation,pos,collins,bnc,frq,createdAt'

describe('M2-08 词典服务 + 词库（WORD-01~05/07/08）', () => {
  /** @type {Awaited<ReturnType<typeof startTestApp>>} */
  let ctx

  before(async () => {
    ctx = await startTestApp({
      setup({ config }) {
        createDictFixture(config.dictPath)
      }
    })
  })

  beforeEach(() => {
    ctx.db.prepare('DELETE FROM words').run()
  })

  after(async () => {
    await ctx.close()
  })

  it('dict lookup：精确词返回 02 §6.3 字段', async () => {
    const response = await ctx.request('GET', '/api/dict/lookup?word=go')
    assert.equal(response.status, 200)
    const { entry } = response.json
    assert.equal(entry.word, 'go')
    assert.equal(entry.lemma, 'go')
    assert.equal(entry.phonetic, 'ɡəʊ')
    assert.match(entry.translation, /去/)
    assert.equal(entry.pos, 'v:100')
    assert.equal(entry.collins, 5)
    assert.equal(entry.bnc, 44)
    assert.equal(entry.frq, 35)
    assert.match(entry.tag, /zk/)
  })

  it('dict lookup：exchange 0: 归并原型（went→go、studies→study、better→good）', async () => {
    const went = await ctx.request('GET', '/api/dict/lookup?word=Went')
    assert.equal(went.status, 200)
    assert.equal(went.json.entry.word, 'went')
    assert.equal(went.json.entry.lemma, 'go')
    assert.match(went.json.entry.translation, /去/)

    const studies = await ctx.request('GET', '/api/dict/lookup?word=studies')
    assert.equal(studies.json.entry.lemma, 'study')
    assert.match(studies.json.entry.translation, /学习/)

    const better = await ctx.request('GET', '/api/dict/lookup?word=better')
    assert.equal(better.json.entry.lemma, 'good')
    assert.match(better.json.entry.translation, /好的/)
  })

  it('dict lookup：常见词形回退（walked→walk）', async () => {
    const response = await ctx.request('GET', '/api/dict/lookup?word=walked')
    assert.equal(response.status, 200)
    assert.equal(response.json.entry.lemma, 'walk')
    assert.match(response.json.entry.translation, /步行/)
  })

  it('dict lookup：未收录 404 NOT_FOUND + suggestions；词典字段完整', async () => {
    const response = await ctx.request('GET', '/api/dict/lookup?word=zzzqqq')
    assert.equal(response.status, 404)
    assert.equal(response.json.error.code, 'NOT_FOUND')
    assert.ok(Array.isArray(response.json.error.detail.suggestions))
    const empty = await ctx.request('GET', '/api/dict/lookup?word=')
    assert.equal(empty.status, 400)
    assert.equal(empty.json.error.code, 'VALIDATION')
  })

  it('dict suggest：前缀补全 ≤10 条', async () => {
    const response = await ctx.request('GET', '/api/dict/suggest?q=libr')
    assert.equal(response.status, 200)
    assert.ok(response.json.items.length >= 1)
    assert.ok(response.json.items.length <= 10)
    assert.ok(response.json.items.includes('library'))
    const empty = await ctx.request('GET', '/api/dict/suggest?q=')
    assert.equal(empty.status, 400)
  })

  it('WORD-01/02 收藏词：词典补字段、lemma 幂等', async () => {
    const article = await ctx.request('POST', '/api/articles', {
      title: 'word-source',
      content: 'He visited the library last week. It was quiet.'
    })
    const articleId = article.json.article.id

    const added = await ctx.request('POST', '/api/words', { word: 'went', articleId })
    assert.equal(added.status, 200)
    assert.equal(added.json.duplicated, false)
    const word = added.json.word
    assert.equal(word.lemma, 'go')
    assert.equal(word.display, 'went')
    assert.match(word.translation, /去/)
    assert.equal(word.collins, 5)
    assert.equal(word.sourceArticleId, articleId)
    assert.equal(word.sourceArticleTitle, 'word-source')

    const again = await ctx.request('POST', '/api/words', { word: 'go', articleId })
    assert.equal(again.status, 200)
    assert.equal(again.json.duplicated, true)
    assert.equal(again.json.word.id, word.id)
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM words').get().c, 1)
  })

  it('WORD-04 列表/搜索/排序', async () => {
    await ctx.request('POST', '/api/words', { word: 'go' })
    await ctx.request('POST', '/api/words', { word: 'walk' })
    await ctx.request('POST', '/api/words', { word: 'library' })

    const all = await ctx.request('GET', '/api/words')
    assert.equal(all.status, 200)
    assert.equal(all.json.total, 3)
    const item = all.json.items[0]
    for (const key of ['id', 'lemma', 'display', 'phonetic', 'translation', 'pos', 'createdAt']) {
      assert.ok(key in item, `词条缺少字段 ${key}`)
    }

    const searched = await ctx.request('GET', '/api/words?q=go')
    assert.equal(searched.json.total, 1)
    assert.equal(searched.json.items[0].lemma, 'go')

    const alpha = await ctx.request('GET', '/api/words?sort=alpha')
    const lemmas = alpha.json.items.map((row) => row.lemma)
    assert.deepEqual(lemmas, [...lemmas].sort())
  })

  it('WORD-05 导出 CSV（UTF-8 BOM + 固定表头）与 JSON', async () => {
    await ctx.request('POST', '/api/words', { word: 'go' })
    await ctx.request('POST', '/api/words', { word: 'library' })

    // fetch 的 text() 会吞掉 BOM，必须按原始字节断言 UTF-8 BOM
    const csvResponse = await fetch(`${ctx.baseUrl}/api/words/export?format=csv`)
    assert.equal(csvResponse.status, 200)
    assert.match(csvResponse.headers.get('content-type'), /text\/csv/)
    assert.match(csvResponse.headers.get('content-disposition'), /attachment/)
    const buffer = Buffer.from(await csvResponse.arrayBuffer())
    assert.deepEqual([...buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf])
    const csvText = buffer.toString('utf8')
    const lines = csvText.slice(1).split('\r\n')
    assert.equal(lines[0], CSV_HEADER)
    assert.ok(lines.some((line) => line.includes('go')))

    const json = await ctx.request('GET', '/api/words/export?format=json')
    assert.equal(json.status, 200)
    assert.equal(json.json.ok, true)
    assert.equal(json.json.items.length, 2)

    const badFormat = await ctx.request('GET', '/api/words/export?format=xml')
    assert.equal(badFormat.status, 400)
  })

  it('WORD-03 取消收藏与重复取消 404', async () => {
    const added = await ctx.request('POST', '/api/words', { word: 'go' })
    const id = added.json.word.id
    const removed = await ctx.request('DELETE', `/api/words/${id}`)
    assert.equal(removed.status, 200)
    assert.equal((await ctx.request('GET', '/api/words')).json.total, 0)
    const again = await ctx.request('DELETE', `/api/words/${id}`)
    assert.equal(again.status, 404)
    assert.equal(again.json.error.code, 'NOT_FOUND')
  })

  it('WORD-07 来源文章删除后 source_article_id 置空、列表不崩', async () => {
    const article = await ctx.request('POST', '/api/articles', {
      title: 'to-be-deleted',
      content: 'A walking man appears in this sentence. He walks slowly.'
    })
    const articleId = article.json.article.id
    const added = await ctx.request('POST', '/api/words', { word: 'walking', articleId })
    assert.equal(added.status, 200)
    assert.equal(added.json.word.sourceArticleId, articleId)

    await ctx.request('DELETE', `/api/articles/${articleId}`)
    const list = await ctx.request('GET', '/api/words')
    assert.equal(list.status, 200)
    const word = list.json.items.find((row) => row.lemma === added.json.word.lemma)
    assert.ok(word)
    assert.equal(word.sourceArticleId, null)
    assert.equal(word.sourceArticleTitle, null)
  })

  it('WORD-08 词典缺失：lookup 与收藏均 503 DICT_UNAVAILABLE', async () => {
    const noDict = await startTestApp()
    try {
      const lookup = await noDict.request('GET', '/api/dict/lookup?word=go')
      assert.equal(lookup.status, 503)
      assert.equal(lookup.json.error.code, 'DICT_UNAVAILABLE')
      const added = await noDict.request('POST', '/api/words', { word: 'go' })
      assert.equal(added.status, 503)
      assert.equal(added.json.error.code, 'DICT_UNAVAILABLE')
    } finally {
      await noDict.close()
    }
  })
})
