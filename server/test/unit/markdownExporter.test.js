import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderSummaryMarkdown } from '../../lib/markdownExporter.js'

const ARTICLE = {
  id: 7,
  title: 'The quiet library',
  sentenceCount: 3,
  completedAt: '2026-11-09T02:00:00.000Z'
}

const SUMMARY = {
  data: {
    overview: '整体理解到位，个别词义需要巩固。',
    issueSummary: { 漏译: 1, 误译: 2, 理解偏差: 0 },
    knowledgePoints: [
      {
        title: 'quiet 的用法',
        explain: '物用 -ing，人用 -ed。',
        example: 'The library was quiet.'
      },
      { title: '过去时叙事', explain: '叙事常用一般过去时。' }
    ],
    weakSentences: [{ idx: 1, reason: '误译了 quiet' }],
    suggestions: ['对照参考译文重读第 2 句。'],
    degraded: false
  },
  userNotes: '我的笔记：注意时态。',
  createdAt: '2026-11-09T02:00:00.000Z',
  degraded: false,
  promptVersion: 'summary-v1',
  model: 'mock-model'
}

const SENTENCES = [
  {
    idx: 0,
    text: 'The quiet library was almost empty when I arrived.',
    myTranslation: '我到的时候图书馆几乎没人。',
    referenceTranslation: '我到的时候图书馆几乎没人。',
    issues: []
  },
  {
    idx: 1,
    text: 'The library | was almost empty.',
    myTranslation: '这个图书馆很安静。',
    referenceTranslation: '这个图书馆非常安静。',
    issues: [{ type: '误译' }, { type: '误译' }]
  },
  {
    idx: 2,
    text: 'I spent the whole afternoon reading about distant islands.',
    myTranslation: null,
    referenceTranslation: '我整个下午都在读关于远方岛屿的书。',
    issues: []
  }
]

describe('markdownExporter：学习小结导出（SUM-06/07）', () => {
  it('包含标题/日期/概览/问题汇总/知识点/逐句对照/薄弱句/建议/我的笔记', () => {
    const markdown = renderSummaryMarkdown({
      article: ARTICLE,
      summary: SUMMARY,
      sentences: SENTENCES
    })
    assert.match(markdown, /^# 学习小结 · The quiet library/m)
    assert.match(markdown, /> 日期：2026-11-09 · 句数：3 · 已处理：2 · 跳过：1 · 问题：3/)
    assert.match(markdown, /## 整体评价\n\n整体理解到位/)
    assert.match(markdown, /## 问题汇总/)
    assert.match(markdown, /\| 漏译 \| 1 \|/)
    assert.match(markdown, /\| 误译 \| 2 \|/)
    assert.match(markdown, /## 知识点/)
    assert.match(markdown, /### quiet 的用法/)
    assert.match(markdown, /> 例：The library was quiet\./)
    assert.match(markdown, /## 逐句对照/)
    assert.match(markdown, /## 薄弱句/)
    assert.match(markdown, /- 第 2 句：误译了 quiet/)
    assert.match(markdown, /## 建议/)
    assert.match(markdown, /## 我的笔记/)
    assert.match(markdown, /我的笔记：注意时态。/)
  })

  it('表格单元格转义管道符；跳过句显示（跳过）；问题标签去重', () => {
    const markdown = renderSummaryMarkdown({
      article: ARTICLE,
      summary: SUMMARY,
      sentences: SENTENCES
    })
    assert.match(markdown, /The library \\\| was almost empty\./)
    assert.match(markdown, /\| 3 \| I spent the whole afternoon reading about distant islands\. \| （跳过） \| 我整个下午都在读关于远方岛屿的书。 \| — \|/)
    assert.match(markdown, /这个图书馆很安静。 \| 这个图书馆非常安静。 \| 误译 \|/)
  })

  it('降级小结带说明且知识点为空', () => {
    const degraded = renderSummaryMarkdown({
      article: ARTICLE,
      summary: {
        ...SUMMARY,
        degraded: true,
        data: {
          ...SUMMARY.data,
          overview: '本篇共 3 句，已处理 2 句。',
          knowledgePoints: [],
          weakSentences: []
        }
      },
      sentences: SENTENCES
    })
    assert.match(degraded, /本小结由本地降级生成/)
    assert.match(degraded, /## 知识点\n\n（暂无）/)
    assert.match(degraded, /## 薄弱句\n\n（暂无）/)
  })

  it('空笔记显示（暂无）', () => {
    const markdown = renderSummaryMarkdown({
      article: ARTICLE,
      summary: { ...SUMMARY, userNotes: '' },
      sentences: SENTENCES
    })
    assert.match(markdown, /## 我的笔记\n\n（暂无）/)
  })
})
