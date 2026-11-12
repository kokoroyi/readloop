/**
 * 轻量 Markdown 解析（AI 追问/自由提问）：标题、段落、无序/有序列表、引用、分隔线、
 * GFM 表格、代码块、粗体、斜体、行内代码。
 * 只产出结构化数据，由 Vue 模板渲染文本节点，不生成 HTML，避免注入风险。
 */

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const UL_RE = /^\s*[-*+]\s+(.*)$/
const OL_RE = /^\s*(\d{1,3})[.)]\s+(.*)$/
const QUOTE_RE = /^\s*>\s?(.*)$/
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/

const INLINE_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g

/** 解析行内：粗体 / 斜体 / 行内代码 / 纯文本。 */
export function parseInline(text) {
  const source = String(text || '')
  const inlines = []
  let lastIndex = 0
  INLINE_RE.lastIndex = 0
  let match = INLINE_RE.exec(source)
  while (match) {
    if (match.index > lastIndex) {
      inlines.push({ type: 'text', text: source.slice(lastIndex, match.index) })
    }
    const token = match[0]
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      inlines.push({ type: 'code', text: token.slice(1, -1) })
    } else if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      inlines.push({ type: 'bold', text: token.slice(2, -2) })
    } else if (token.startsWith('__') && token.endsWith('__') && token.length > 4) {
      inlines.push({ type: 'bold', text: token.slice(2, -2) })
    } else if (token.length > 2) {
      inlines.push({ type: 'italic', text: token.slice(1, -1) })
    } else {
      inlines.push({ type: 'text', text: token })
    }
    lastIndex = INLINE_RE.lastIndex
    match = INLINE_RE.exec(source)
  }
  if (lastIndex < source.length) {
    inlines.push({ type: 'text', text: source.slice(lastIndex) })
  }
  return inlines
}

function splitTableRow(line) {
  let text = String(line || '').trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)
  return text.split('|').map((cell) => cell.trim())
}

function parseAlign(cell) {
  const trimmed = String(cell || '').trim()
  const left = trimmed.startsWith(':')
  const right = trimmed.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return 'left'
}

function isTableStart(lines, index) {
  const header = lines[index]
  const separator = lines[index + 1]
  if (!header || !separator) return false
  if (!header.includes('|') || !separator.includes('|')) return false
  if (!TABLE_SEPARATOR_RE.test(separator)) return false
  const headerCells = splitTableRow(header)
  const separatorCells = splitTableRow(separator)
  return headerCells.length > 0 && headerCells.length === separatorCells.length
}

/**
 * 把 AI 回答解析为 blocks：
 * p / ul / ol / quote / hr / heading / table / pre
 */
export function parseMarkdown(text) {
  const blocks = []
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  let paragraph = []
  let list = null
  let code = null

  function flushParagraph() {
    if (!paragraph.length) return
    blocks.push({ type: 'p', inlines: parseInline(paragraph.join('\n')) })
    paragraph = []
  }

  function flushList() {
    if (!list) return
    blocks.push(list)
    list = null
  }

  function flushAll() {
    flushParagraph()
    flushList()
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (line.trim().startsWith('```')) {
      if (code) {
        blocks.push({ type: 'pre', text: code.join('\n') })
        code = null
      } else {
        flushAll()
        code = []
      }
      continue
    }
    if (code) {
      code.push(line)
      continue
    }

    if (!line.trim()) {
      flushAll()
      continue
    }

    // 分隔线
    if (HR_RE.test(line)) {
      flushAll()
      blocks.push({ type: 'hr' })
      continue
    }

    // 标题
    const headingMatch = HEADING_RE.exec(line)
    if (headingMatch) {
      flushAll()
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        inlines: parseInline(headingMatch[2])
      })
      continue
    }

    // GFM 表格
    if (isTableStart(lines, index)) {
      flushAll()
      const headers = splitTableRow(line)
      const aligns = splitTableRow(lines[index + 1]).map(parseAlign)
      const rows = []
      index += 2
      while (index < lines.length) {
        const rowLine = lines[index]
        if (!rowLine.trim() || !rowLine.includes('|') || HR_RE.test(rowLine)) break
        const cells = splitTableRow(rowLine)
        const normalized = headers.map((_, cellIndex) => cells[cellIndex] || '')
        rows.push(normalized.map((cell) => parseInline(cell)))
        index += 1
      }
      index -= 1
      blocks.push({
        type: 'table',
        headers: headers.map((cell) => parseInline(cell)),
        aligns,
        rows
      })
      continue
    }

    // 引用（连续 > 行合并为一组）
    if (QUOTE_RE.test(line)) {
      flushAll()
      const quoteLines = []
      while (index < lines.length && QUOTE_RE.test(lines[index])) {
        const match = QUOTE_RE.exec(lines[index])
        quoteLines.push(parseInline(match[1]))
        index += 1
      }
      index -= 1
      blocks.push({ type: 'quote', lines: quoteLines })
      continue
    }

    // 有序列表
    const orderedMatch = OL_RE.exec(line)
    if (orderedMatch) {
      flushParagraph()
      if (!list || list.type !== 'ol') {
        flushList()
        list = { type: 'ol', start: Number(orderedMatch[1]) || 1, items: [] }
      }
      list.items.push(parseInline(orderedMatch[2]))
      continue
    }

    // 无序列表
    const unorderedMatch = UL_RE.exec(line)
    if (unorderedMatch) {
      flushParagraph()
      if (!list || list.type !== 'ul') {
        flushList()
        list = { type: 'ul', items: [] }
      }
      list.items.push(parseInline(unorderedMatch[1]))
      continue
    }

    flushList()
    paragraph.push(line)
  }

  if (code) blocks.push({ type: 'pre', text: code.join('\n') })
  flushAll()
  return blocks
}
