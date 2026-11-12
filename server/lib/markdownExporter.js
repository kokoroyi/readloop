import { localDateKey } from './time.js'

/**
 * 服务端 Markdown 导出（04-ENGINEERING §5.3 / 01-UX-SPEC §9.3）：
 * 标题 / 日期 / 概览 / 问题汇总 / 知识点 / 逐句对照表 / 薄弱句 / 建议 / 我的笔记。
 */

const ISSUE_TYPES = ['漏译', '误译', '理解偏差']

/**
 * Markdown 表格单元格转义（管道符与换行会破坏表格）。
 * @param {unknown} value
 * @returns {string}
 */
function escapeCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

/**
 * 行内标题/文本：换行折叠，避免破坏结构。
 * @param {unknown} value
 * @returns {string}
 */
function inline(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .trim()
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function toLines(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => inline(item)).filter((item) => item.length > 0)
}

/**
 * 渲染学习小结 Markdown。
 * @param {{
 *   article: { id: number, title: string, sentenceCount: number, completedAt?: string | null },
 *   summary: { data: object, userNotes: string, createdAt: string, degraded: boolean | number, promptVersion?: string | null, model?: string | null },
 *   sentences: { idx: number, text: string, myTranslation: string | null, referenceTranslation: string, issues: { type: string }[] }[]
 * }} input
 * @returns {string}
 */
export function renderSummaryMarkdown({ article, summary, sentences }) {
  const data = summary.data ?? {}
  const issueSummary = data.issueSummary ?? {}
  const issueTotal = ISSUE_TYPES.reduce((sum, type) => sum + Number(issueSummary[type] ?? 0), 0)
  const processed = sentences.filter((sentence) => Boolean(sentence.myTranslation)).length
  const skipped = sentences.filter((sentence) => sentence.myTranslation === null).length
  const date = localDateKey(summary.createdAt ?? new Date())
  const lines = []

  lines.push(`# 学习小结 · ${inline(article.title)}`)
  lines.push('')
  lines.push(
    `> 日期：${date} · 句数：${article.sentenceCount} · 已处理：${processed} · 跳过：${skipped} · 问题：${issueTotal}`
  )
  if (summary.model) lines.push(`> 模型：${inline(summary.model)}`)
  if (summary.degraded)
    lines.push('> 注：本小结由本地降级生成（AI 输出异常），内容为服务端统计摘要。')
  lines.push('')

  lines.push('## 整体评价')
  lines.push('')
  lines.push(inline(data.overview) || '（暂无）')
  lines.push('')

  lines.push('## 问题汇总')
  lines.push('')
  lines.push('| 类型 | 数量 |')
  lines.push('| --- | ---: |')
  for (const type of ISSUE_TYPES) lines.push(`| ${type} | ${Number(issueSummary[type] ?? 0)} |`)
  lines.push('')

  lines.push('## 知识点')
  lines.push('')
  const knowledgePoints = Array.isArray(data.knowledgePoints) ? data.knowledgePoints : []
  if (knowledgePoints.length === 0) {
    lines.push('（暂无）')
  } else {
    for (const point of knowledgePoints) {
      lines.push(`### ${inline(point.title)}`)
      lines.push('')
      lines.push(inline(point.explain))
      if (point.example && inline(point.example).length > 0) {
        lines.push('')
        lines.push(`> 例：${inline(point.example)}`)
      }
      lines.push('')
    }
  }
  lines.push('')

  lines.push('## 逐句对照')
  lines.push('')
  lines.push('| # | 原句 | 我的译文 | 参考译文 | 问题 |')
  lines.push('| ---: | --- | --- | --- | --- |')
  for (const sentence of sentences) {
    const issueTypes = Array.isArray(sentence.issues)
      ? [...new Set(sentence.issues.map((issue) => issue.type))]
      : []
    lines.push(
      `| ${sentence.idx + 1} | ${escapeCell(sentence.text)} | ${escapeCell(sentence.myTranslation ?? '（跳过）')} | ${escapeCell(sentence.referenceTranslation || '（无）')} | ${escapeCell(issueTypes.join('、') || '—')} |`
    )
  }
  lines.push('')

  lines.push('## 薄弱句')
  lines.push('')
  const weakSentences = Array.isArray(data.weakSentences) ? data.weakSentences : []
  if (weakSentences.length === 0) {
    lines.push('（暂无）')
  } else {
    for (const sentence of weakSentences) {
      lines.push(`- 第 ${Number(sentence.idx) + 1} 句：${inline(sentence.reason)}`)
    }
  }
  lines.push('')

  lines.push('## 建议')
  lines.push('')
  const suggestions = toLines(data.suggestions)
  if (suggestions.length === 0) {
    lines.push('（暂无）')
  } else {
    for (const suggestion of suggestions) lines.push(`- ${suggestion}`)
  }
  lines.push('')

  lines.push('## 我的笔记')
  lines.push('')
  lines.push(String(summary.userNotes ?? '').trim() || '（暂无）')
  lines.push('')

  return lines.join('\n')
}

export default renderSummaryMarkdown
