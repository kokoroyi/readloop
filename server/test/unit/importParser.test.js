import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  TASK_MARKER_WARNING,
  detectFormat,
  parseImport,
  stripMarkdownTaskMarkers
} from '../../lib/importParser.js'

/** 长段落（>4000 字符） */
const LONG_BLOCK = Array.from(
  { length: 200 },
  (_, index) => `Sentence number ${index} is here.`
).join(' ')

describe('importParser（05 §3.2 IMPORT-01~14）', () => {
  it('IMPORT-01 单篇 md（# 标题）解析为一个候选', () => {
    const result = parseImport(
      'lesson.md',
      '# Lesson 1 The quiet library\n\nThe quiet library was almost empty when I arrived.'
    )
    assert.equal(result.format, 'markdown')
    assert.equal(result.nodes.length, 1)
    assert.equal(result.nodes[0].title, 'Lesson 1 The quiet library')
    assert.equal(result.nodes[0].level, 1)
    assert.equal(result.nodes[0].content, 'The quiet library was almost empty when I arrived.')
    assert.equal(result.nodes[0].chars, result.nodes[0].content.length)
    assert.match(result.nodes[0].preview, /quiet library/)
    assert.equal(result.nodes[0].id, 'n1')
  })

  it('IMPORT-02 多篇 md（# + ##）按标题层级拆叶子节点', () => {
    const content = [
      '# Book One',
      '',
      '## Lesson 1',
      '',
      'First body.',
      '',
      '## Lesson 2',
      '',
      'Second body.'
    ].join('\n')
    const result = parseImport('book.md', content)
    assert.deepEqual(
      result.nodes.map((node) => node.title),
      ['Lesson 1', 'Lesson 2']
    )
    assert.deepEqual(
      result.nodes.map((node) => node.level),
      [2, 2]
    )
    assert.equal(result.nodes[0].content, 'First body.')
  })

  it('IMPORT-03 无标题 md：按空行分段并给出 warning', () => {
    const result = parseImport('notes.md', 'First paragraph here.\n\nSecond paragraph here.')
    assert.equal(result.nodes.length, 2)
    assert.ok(result.warnings.some((warning) => warning.includes('未检测到 Markdown 标题')))
    assert.ok(result.nodes.every((node) => node.level === 0))
    assert.equal(result.nodes[0].content, 'First paragraph here.')
  })

  it('IMPORT-04 YAML front matter 忽略且 warning', () => {
    const content = [
      '---',
      'title: Lesson',
      'tags: [a, b]',
      '---',
      '',
      '# Real Title',
      '',
      'Body text.'
    ].join('\n')
    const result = parseImport('front.md', content)
    assert.ok(result.warnings.some((warning) => warning.includes('front matter')))
    assert.equal(result.nodes.length, 1)
    assert.equal(result.nodes[0].title, 'Real Title')
    assert.equal(result.nodes[0].content, 'Body text.')
  })

  it('IMPORT-05 重复标题产生两个节点并 warning', () => {
    const content = '# Same\n\nBody one.\n\n# Same\n\nBody two.'
    const result = parseImport('dup.md', content)
    assert.equal(result.nodes.length, 2)
    assert.deepEqual(
      result.nodes.map((node) => node.title),
      ['Same', 'Same']
    )
    assert.ok(result.warnings.some((warning) => warning.includes('标题重复')))
  })

  it('IMPORT-06 空文件 / 仅空白返回 VALIDATION', () => {
    assert.throws(
      () => parseImport('empty.md', '   \n\n '),
      (error) => error.code === 'VALIDATION'
    )
  })

  it('IMPORT-07 无标题超长段落会切分并 warning', () => {
    const result = parseImport('long.md', LONG_BLOCK)
    assert.ok(result.nodes.length > 1)
    assert.ok(result.warnings.some((warning) => warning.includes('超过 4000 字符')))
    assert.ok(result.nodes.every((node) => node.chars <= 2100))
  })

  it('IMPORT-08 代码围栏内的 # 不作为标题', () => {
    const content = [
      '# Real Title',
      '',
      '```',
      '# not a heading',
      'const a = 1',
      '```',
      '',
      'After code.'
    ].join('\n')
    const result = parseImport('code.md', content)
    assert.equal(result.nodes.length, 1)
    assert.equal(result.nodes[0].title, 'Real Title')
    assert.match(result.nodes[0].content, /# not a heading/)
  })

  it('IMPORT-09 标题层级：父标题不产出节点，最深叶子产出', () => {
    const content = ['# Part', '', 'Intro ignored?', '', '### Deep', '', 'Deep body.'].join('\n')
    const result = parseImport('deep.md', content)
    assert.equal(result.nodes.length, 1)
    assert.equal(result.nodes[0].title, 'Deep')
    assert.equal(result.nodes[0].level, 3)
  })

  it('IMPORT-10 空节点被跳过并 warning', () => {
    const content = '# Empty One\n\n# Has Body\n\nSome body.'
    const result = parseImport('empty-node.md', content)
    assert.deepEqual(
      result.nodes.map((node) => node.title),
      ['Has Body']
    )
    assert.ok(result.warnings.some((warning) => warning.includes('没有正文')))
  })

  it('IMPORT-11 txt 整文件一篇，标题取文件名', () => {
    const result = parseImport('dir/my-article.txt', 'Hello world. This is a test.')
    assert.equal(result.format, 'txt')
    assert.equal(result.nodes.length, 1)
    assert.equal(result.nodes[0].title, 'my-article')
    assert.equal(result.nodes[0].level, 0)
    assert.equal(result.nodes[0].content, 'Hello world. This is a test.')
  })

  it('IMPORT-12 不支持的扩展名返回 UNSUPPORTED_FORMAT', () => {
    assert.equal(detectFormat('a.md'), 'markdown')
    assert.equal(detectFormat('A.MARKDOWN'), 'markdown')
    assert.equal(detectFormat('a.txt'), 'txt')
    assert.equal(detectFormat('a.pdf'), null)
    assert.throws(
      () => parseImport('a.pdf', 'content'),
      (error) => error.code === 'UNSUPPORTED_FORMAT'
    )
  })

  it('IMPORT-13 md 任务标记整行删除，其余正文/句数正确，warning 只推一次', () => {
    const content = [
      '# Lesson 1',
      '',
      'The quiet library was almost empty when I arrived.',
      '',
      '- [x] 已读',
      '',
      'I found a seat near the window and opened my notebook.',
      '',
      '* [X] 完成',
      '  + [ ] 读过  ',
      '　- [x]　已读　',
      '[x]',
      '',
      'The old librarian smiled and pointed me to a shelf of travel books.'
    ].join('\n')
    const result = parseImport('tasks.md', content)
    assert.equal(result.nodes.length, 1)
    const node = result.nodes[0]
    assert.equal(
      node.content,
      'The quiet library was almost empty when I arrived.\n\nI found a seat near the window and opened my notebook.\n\nThe old librarian smiled and pointed me to a shelf of travel books.'
    )
    assert.doesNotMatch(node.content, /\[[ xX]\]/)
    assert.doesNotMatch(node.content, /已读|完成|读过/)
    // 其余正文句数正确（未被标记行污染）
    assert.equal(node.content.split('.').filter((part) => part.trim()).length, 3)
    assert.ok(result.warnings.includes(TASK_MARKER_WARNING))
    assert.equal(result.warnings.filter((warning) => warning === TASK_MARKER_WARNING).length, 1)

    // 无标题兜底块同样生效
    const fallback = parseImport(
      'tasks-fallback.md',
      ['First paragraph.', '', '- [x] 已读', '', 'Second paragraph.'].join('\n')
    )
    assert.equal(fallback.nodes.length, 2)
    assert.equal(fallback.nodes[0].content, 'First paragraph.')
    assert.equal(fallback.nodes[1].content, 'Second paragraph.')
    assert.ok(fallback.warnings.includes(TASK_MARKER_WARNING))
  })

  it('IMPORT-14 行首标记保留正文；不误删正常“已读”字样；txt 不清洗', () => {
    const content = [
      '# Tasks',
      '',
      '- [ ] 未读',
      '[x] 有正文',
      '我已经读过这本书了。',
      '- 正常列表项',
      '- [x] 已读：准备下一章'
    ].join('\n')
    const result = parseImport('tasks-body.md', content)
    assert.equal(result.nodes.length, 1)
    const body = result.nodes[0].content
    assert.equal(
      body,
      ['未读', '有正文', '我已经读过这本书了。', '- 正常列表项', '已读：准备下一章'].join('\n')
    )
    assert.doesNotMatch(body, /\[[ xX]\]/)
    // 正文里正常的“已读/读过”不被删除
    assert.match(body, /我已经读过这本书了。/)
    assert.match(body, /已读：准备下一章/)
    assert.ok(result.warnings.includes(TASK_MARKER_WARNING))

    // 独立导出函数：只处理行级任务标记
    assert.equal(stripMarkdownTaskMarkers('A\n- [x] 已读\nB'), 'A\nB')
    assert.equal(stripMarkdownTaskMarkers('Already read this page.'), 'Already read this page.')
    assert.equal(stripMarkdownTaskMarkers('- [x] 有正文'), '有正文')

    // .txt 不走 markdown 清洗（保持原样，不产生 warning）
    const txt = parseImport('tasks.txt', '- [x] 已读\nBody text.')
    assert.equal(txt.format, 'txt')
    assert.match(txt.nodes[0].content, /- \[x\] 已读/)
    assert.ok(!txt.warnings.includes(TASK_MARKER_WARNING))
  })
})
