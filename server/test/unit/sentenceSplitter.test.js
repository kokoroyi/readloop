import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { splitSentences } from '../../lib/sentenceSplitter.js'

/**
 * 断言所有句子的 start/end 偏移与 text 严格对应（SPLIT-11）。
 * @param {string} content
 */
function assertOffsets(content) {
  for (const sentence of splitSentences(content)) {
    assert.equal(content.slice(sentence.start, sentence.end), sentence.text)
  }
}

/**
 * 空白归一化，用于 SPLIT-09 的“拼接恒等”。
 * @param {string} text
 * @returns {string}
 */
function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim()
}

describe('sentenceSplitter（05 §3.1 SPLIT-01~12）', () => {
  it('SPLIT-01 常规多句：3 句且偏移正确', () => {
    const content = 'Hello. How are you? Fine!'
    const sentences = splitSentences(content)
    assert.equal(sentences.length, 3)
    assert.deepEqual(
      sentences.map((item) => item.text),
      ['Hello.', 'How are you?', 'Fine!']
    )
    assertOffsets(content)
  })

  it('SPLIT-02 缩写不切句（Mr./Dr./p.m. 等）', () => {
    assert.equal(splitSentences('Mr. Smith went home.').length, 1)
    assert.equal(splitSentences('Dr. Smith left at 5 p.m. yesterday.').length, 1)
    assert.equal(splitSentences('Use A, e.g. B, and C etc. in the list.').length, 1)
  })

  it('SPLIT-03 小数与版本号不切句', () => {
    assert.equal(splitSentences('It is 3.14 meters.').length, 1)
    assert.equal(splitSentences('Version v1.2 is out.').length, 1)
  })

  it('SPLIT-04 引号闭合：引号归前句', () => {
    const content = '"Stop." He left.'
    const sentences = splitSentences(content)
    assert.equal(sentences.length, 2)
    assert.equal(sentences[0].text, '"Stop."')
    assert.equal(sentences[1].text, 'He left.')
    assertOffsets(content)
  })

  it('SPLIT-05 省略号不产生空句', () => {
    const sentences = splitSentences('Well... I think so.')
    assert.ok(sentences.length >= 1 && sentences.length <= 2)
    assert.ok(sentences.every((item) => item.text.trim().length > 0))
  })

  it('SPLIT-06 段落边界：句子不跨段', () => {
    const sentences = splitSentences('First paragraph.\n\nSecond paragraph.')
    assert.equal(sentences.length, 2)
    assert.equal(sentences[0].text, 'First paragraph.')
    assert.equal(sentences[1].text, 'Second paragraph.')
  })

  it('SPLIT-07 超长无标点句不拆', () => {
    const content = 'a'.repeat(400)
    const sentences = splitSentences(content)
    assert.equal(sentences.length, 1)
    assert.equal(sentences[0].text, content)
  })

  it('SPLIT-08 中英标点混排', () => {
    const sentences = splitSentences('Hello。How are you？')
    assert.deepEqual(
      sentences.map((item) => item.text),
      ['Hello。', 'How are you？']
    )
  })

  it('SPLIT-09 拼接恒等（允许空白归一）', () => {
    const content = 'A sentence.\n\nAnother one!\n\nAnd a third?'
    const joined = splitSentences(content)
      .map((item) => item.text)
      .join(' ')
    assert.equal(normalizeWhitespace(joined), normalizeWhitespace(content))
  })

  it('SPLIT-10 空文本返回空数组', () => {
    assert.deepEqual(splitSentences(''), [])
    assert.deepEqual(splitSentences('   \n\n  '), [])
  })

  it('SPLIT-11 偏移定位：slice(start,end) === text', () => {
    const content =
      'The quiet library was almost empty when I arrived.\n\nI found a seat near the window and opened my notebook.\nThe old librarian smiled and pointed me to a shelf of travel books!'
    assertOffsets(content)
    const sentences = splitSentences(content)
    assert.equal(sentences.length, 3)
    assert.equal(sentences[2].text, 'The old librarian smiled and pointed me to a shelf of travel books!')
  })

  it('SPLIT-12 连续标点不产生空句', () => {
    const sentences = splitSentences('What?! Really.')
    assert.equal(sentences.length, 2)
    assert.equal(sentences[0].text, 'What?!')
    assert.equal(sentences[1].text, 'Really.')
  })
})
