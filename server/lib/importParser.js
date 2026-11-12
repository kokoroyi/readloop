import { AppError } from './errors.js'
import { splitSentences } from './sentenceSplitter.js'
import { makePreview, normalizeContent } from './text.js'

/**
 * 导入解析器（TECH-DESIGN §4.8）：
 * - .md：去 YAML front matter / 忽略代码围栏内标题；按标题层级取叶子节点；无标题按空行分段兜底
 * - .txt：整文件一篇
 * 返回 { format, warnings, nodes:[{ id, level, title, chars, preview, content }] }，由前端勾选后 commit。
 */

/** 单篇正文上限（02-DATA-API §3） */
export const MAX_ARTICLE_CHARS = 100000
/** 标题上限（02-DATA-API §3） */
const MAX_TITLE_CHARS = 100
/** 无标题兜底：单段超过该长度时切分（TECH-DESIGN §4.8 约 2000 字符） */
const LONG_BLOCK_THRESHOLD = 4000
const LONG_BLOCK_CHUNK = 2000
const PREVIEW_LENGTH = 120
const CODE_FENCE = /^\s*(```|~~~)/
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/
const FRONT_MATTER_LIMIT_LINES = 100
/** 整行仅为 Markdown 任务标记（可带已读语义词）：直接删除整行 */
const TASK_MARKER_LINE =
  /^\s*(?:[-*+]\s*)?\[[ xX]\]\s*(?:已读|读过|已阅|完成|done|read(?:ed)?)?\s*$/i
/** 行首任务标记后跟正文：去掉标记与列表符号、保留正文 */
const TASK_MARKER_PREFIX = /^\s*(?:[-*+]\s*)?\[[ xX]\]\s+/i
/** 清洗发生时的统一提示（多个节点只提示一次） */
export const TASK_MARKER_WARNING = '已移除 Markdown 任务列表标记'

/**
 * 清洗 Markdown 任务列表标记（用户导入 .md 合集时常混入 `- [x] 已读`）：
 * - 整行仅为任务标记（可带 已读/读过/已阅/完成/done/read/readed 语义词）→ 删除整行；
 * - 行首任务标记后还有正文 → 去掉列表符号与标记，保留正文；
 * - 其余行原样保留（不误删正文里正常的“已读”字样）。
 * 仅做行级标记处理，导出的独立函数便于清理工具复用。
 * @param {unknown} input
 * @returns {string}
 */
export function stripMarkdownTaskMarkers(input) {
  if (typeof input !== 'string' || input.length === 0) return ''
  return input
    .split('\n')
    .filter((line) => !TASK_MARKER_LINE.test(line))
    .map((line) => line.replace(TASK_MARKER_PREFIX, ''))
    .join('\n')
}

/**
 * 在 markdown 正文上应用任务标记清洗；发生清洗时推一条 warning（同一文件去重）。
 * @param {string} text 已 normalizeContent 的正文
 * @param {string[]} warnings
 * @returns {string}
 */
function cleanMarkdownTaskMarkers(text, warnings) {
  const cleaned = stripMarkdownTaskMarkers(text)
  if (cleaned !== text && !warnings.includes(TASK_MARKER_WARNING)) {
    warnings.push(TASK_MARKER_WARNING)
  }
  return cleaned
}

/**
 * 根据文件名识别格式；不支持返回 null。
 * @param {unknown} filename
 * @returns {'markdown' | 'txt' | null}
 */
export function detectFormat(filename) {
  if (typeof filename !== 'string') return null
  const lower = filename.trim().toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
  if (lower.endsWith('.txt')) return 'txt'
  return null
}

/**
 * 去掉 YAML front matter；返回剩余文本与是否移除。
 * @param {string} text
 * @returns {{ text: string, removed: boolean }}
 */
function stripFrontMatter(text) {
  const lines = text.split('\n')
  if (lines.length === 0 || lines[0].trim() !== '---') return { text, removed: false }
  const limit = Math.min(lines.length, FRONT_MATTER_LIMIT_LINES)
  for (let index = 1; index < limit; index += 1) {
    const line = lines[index].trim()
    if (line === '---' || line === '...') {
      return { text: lines.slice(index + 1).join('\n'), removed: true }
    }
  }
  return { text, removed: false }
}

/**
 * 根据正文首行生成兜底标题。
 * @param {string} content
 * @returns {string}
 */
function deriveTitle(content) {
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  const base = (firstLine ?? content).replace(/^[#>*+\-\s]+/, '')
  const title = base.slice(0, 40).trim()
  return title.length > 0 ? title : '未命名文章'
}

/**
 * 构造导入节点。
 * @param {{ level: number, title: string, content: string }} input
 * @param {number} index
 * @param {string[]} warnings
 * @returns {{ id: string, level: number, title: string, chars: number, preview: string, content: string } | null}
 */
function makeNode(input, index, warnings) {
  const title = String(input.title ?? '')
    .trim()
    .slice(0, MAX_TITLE_CHARS)
  if (title.length === 0) return null
  const content = normalizeContent(input.content)
  if (content.length === 0) {
    warnings.push(`「${title}」没有正文，已忽略`)
    return null
  }
  if (content.length > MAX_ARTICLE_CHARS) {
    warnings.push(`「${title}」正文超过 ${MAX_ARTICLE_CHARS} 字符，提交时需要拆分`)
  }
  return {
    id: `n${index + 1}`,
    level: input.level,
    title,
    chars: content.length,
    preview: makePreview(content, PREVIEW_LENGTH),
    content
  }
}

/**
 * 无标题 Markdown 兜底：按空行/分隔线分段；过长段落按句切开。
 * @param {string} text
 * @param {string[]} warnings
 * @returns {object[]}
 */
function parseWithoutHeadings(text, warnings) {
  warnings.push('未检测到 Markdown 标题，已按空行/分隔线分段')
  const blocks = text
    .split(/\n{2,}/)
    .map((block) =>
      cleanMarkdownTaskMarkers(
        normalizeContent(block.replace(/^[ \t]*-{3,}[ \t]*$/gm, '')),
        warnings
      )
    )
    .filter((block) => block.length > 0)

  /** @type {object[]} */
  const nodes = []
  blocks.forEach((block, blockIndex) => {
    if (block.length <= LONG_BLOCK_THRESHOLD) {
      const node = makeNode(
        { level: 0, title: deriveTitle(block), content: block },
        nodes.length,
        warnings
      )
      if (node) nodes.push(node)
      return
    }
    warnings.push(`第 ${blockIndex + 1} 段超过 ${LONG_BLOCK_THRESHOLD} 字符，已自动切分`)
    for (const chunk of chunkBySentences(block)) {
      const node = makeNode(
        { level: 0, title: deriveTitle(chunk), content: chunk },
        nodes.length,
        warnings
      )
      if (node) nodes.push(node)
    }
  })
  return nodes
}

/**
 * 把长段落按句子贪心拼接到 ~2000 字符的块。
 * @param {string} block
 * @returns {string[]}
 */
function chunkBySentences(block) {
  const sentences = splitSentences(block)
  if (sentences.length === 0) return [block]
  /** @type {string[]} */
  const chunks = []
  let current = ''
  for (const sentence of sentences) {
    if (current.length > 0 && current.length + sentence.text.length > LONG_BLOCK_CHUNK) {
      chunks.push(current)
      current = sentence.text
    } else {
      current = current.length > 0 ? `${current}\n${sentence.text}` : sentence.text
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * 解析 Markdown：按标题层级取“叶子”标题作为候选文章。
 * @param {string} rawContent
 * @param {string[]} warnings
 * @returns {object[]}
 */
function parseMarkdown(rawContent, warnings) {
  const stripped = stripFrontMatter(normalizeContent(rawContent))
  if (stripped.removed) warnings.push('已忽略 YAML front matter')
  const text = stripped.text
  const lines = text.split('\n')

  /** @type {{ index: number, level: number, title: string }[]} */
  const headings = []
  let inFence = false
  lines.forEach((line, index) => {
    if (CODE_FENCE.test(line)) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const match = HEADING.exec(line)
    if (!match) return
    const title = match[2].trim()
    if (title.length === 0) {
      warnings.push(`第 ${index + 1} 行标题为空，已忽略`)
      return
    }
    headings.push({ index, level: match[1].length, title })
  })

  if (headings.length === 0) return parseWithoutHeadings(text, warnings)

  // 标题重名提示（允许存在，前端可改）
  const seenTitles = new Set()
  for (const heading of headings) {
    if (seenTitles.has(heading.title)) warnings.push(`标题重复：「${heading.title}」`)
    seenTitles.add(heading.title)
  }

  /** @type {object[]} */
  const nodes = []
  headings.forEach((heading, position) => {
    const next = headings[position + 1]
    const isLeaf = !next || next.level <= heading.level
    if (!isLeaf) return
    const endLine = next ? next.index : lines.length
    const body = cleanMarkdownTaskMarkers(
      normalizeContent(lines.slice(heading.index + 1, endLine).join('\n')),
      warnings
    )
    if (body.length === 0) {
      warnings.push(`「${heading.title}」没有正文，已忽略`)
      return
    }
    const node = makeNode(
      { level: heading.level, title: heading.title, content: body },
      nodes.length,
      warnings
    )
    if (node) nodes.push(node)
  })
  return nodes
}

/**
 * 解析导入文件（preview 用）。
 * @param {string} filename
 * @param {string} content
 * @returns {{ format: 'markdown' | 'txt', warnings: string[], nodes: object[] }}
 */
export function parseImport(filename, content) {
  const format = detectFormat(filename)
  if (!format) {
    throw new AppError('UNSUPPORTED_FORMAT', '仅支持 .txt / .md 文件', {
      detail: { filename: String(filename ?? '') }
    })
  }
  const raw = typeof content === 'string' ? content : ''
  if (normalizeContent(raw).length === 0) {
    throw new AppError('VALIDATION', '文件内容为空', {
      detail: { fields: [{ path: 'content', message: '文件内容不能为空' }] }
    })
  }

  /** @type {string[]} */
  const warnings = []
  if (format === 'txt') {
    const node = makeNode(
      { level: 0, title: basenameWithoutExtension(filename), content: raw },
      0,
      warnings
    )
    return { format, warnings, nodes: node ? [node] : [] }
  }
  return { format, warnings, nodes: parseMarkdown(raw, warnings) }
}

/**
 * 去掉目录与扩展名。
 * @param {string} filename
 * @returns {string}
 */
function basenameWithoutExtension(filename) {
  const name =
    String(filename ?? '')
      .split(/[\\/]/)
      .pop() ?? ''
  const index = name.lastIndexOf('.')
  const base = index > 0 ? name.slice(0, index) : name
  return base.trim().length > 0 ? base.trim() : '未命名文章'
}

export default parseImport
