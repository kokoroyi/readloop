/**
 * 分句器：输入清洗后的正文，输出 [{ idx, text, start, end }]（start/end 为正文 UTF-16 偏移）。
 * 规则见 TECH-DESIGN §4.6；offset 保证 text === content.slice(start, end)。
 */

/** 句末终止符（省略号按终止符处理，连续点由 isProtectedDot 保护） */
const TERMINATORS = new Set(['.', '!', '?', '。', '！', '？', '…'])

/** 句末标点后归属本句的闭合引号/括号 */
const CLOSERS = new Set(['"', "'", '”', '’', '」', '』', '）', ')', ']', '}', '》', '»'])

/** 缩写词（小写、不含末尾点），保护其后的句点 */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'st',
  'no',
  'e.g',
  'i.e',
  'etc',
  'vs',
  'a.m',
  'p.m'
])

/** 中间点缩写（如 e.g. 的第一个点）：前后字母组合 */
const PAIR_ABBREVIATIONS = new Set(['eg', 'ie', 'am', 'pm'])

/**
 * @param {string} ch
 * @returns {boolean}
 */
function isDigit(ch) {
  return ch >= '0' && ch <= '9'
}

/**
 * @param {string} ch
 * @returns {boolean}
 */
function isAsciiLetter(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

/**
 * @param {string} ch
 * @returns {boolean}
 */
function isUpperLetter(ch) {
  return ch >= 'A' && ch <= 'Z'
}

/**
 * 判断句点是否属于“不应断句”的场景：省略号、小数、版本号、缩写、首字母缩写。
 * @param {string} text
 * @param {number} index 句点下标
 * @param {number} paraStart
 * @param {number} paraEnd
 * @returns {boolean}
 */
function isProtectedDot(text, index, paraStart, paraEnd) {
  const prev = index > paraStart ? text[index - 1] : ''
  const next = index + 1 < paraEnd ? text[index + 1] : ''
  if (next === '.' || prev === '.') return true
  if (isDigit(prev) && isDigit(next)) return true
  if (isAsciiLetter(prev) && isAsciiLetter(next)) {
    const pair = (prev + next).toLowerCase()
    if (PAIR_ABBREVIATIONS.has(pair)) return true
    if (isUpperLetter(prev) && isUpperLetter(next)) return true
  }
  const wordMatch = /([A-Za-z.]+)$/.exec(text.slice(Math.max(paraStart, index - 16), index))
  if (wordMatch && ABBREVIATIONS.has(wordMatch[1].toLowerCase())) return true
  return false
}

/**
 * 把 [start, end) 内首尾空白裁掉后作为一个句子追加。
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {{ text: string, start: number, end: number }[]} output
 */
function pushTrimmed(text, start, end, output) {
  let from = start
  let to = end
  while (from < to && /\s/.test(text[from])) from += 1
  while (to > from && /\s/.test(text[to - 1])) to -= 1
  if (to <= from) return
  output.push({ text: text.slice(from, to), start: from, end: to })
}

/**
 * 按空行切段落区间（返回 [start, end) 列表）。
 * @param {string} text
 * @returns {[number, number][]}
 */
function findParagraphRanges(text) {
  /** @type {[number, number][]} */
  const ranges = []
  const blankLine = /\n[ \t]*\n/g
  let start = 0
  let match
  while ((match = blankLine.exec(text)) !== null) {
    if (match.index > start) ranges.push([start, match.index])
    start = match.index + match[0].length
  }
  if (start < text.length) ranges.push([start, text.length])
  return ranges
}

/**
 * 段落内分句。
 * @param {string} text
 * @param {number} paraStart
 * @param {number} paraEnd
 * @param {{ text: string, start: number, end: number }[]} output
 */
function splitParagraph(text, paraStart, paraEnd, output) {
  let sentenceStart = paraStart
  let index = paraStart
  while (index < paraEnd) {
    const ch = text[index]
    if (!TERMINATORS.has(ch)) {
      index += 1
      continue
    }
    if (ch === '.' && isProtectedDot(text, index, paraStart, paraEnd)) {
      index += 1
      continue
    }
    let end = index + 1
    while (end < paraEnd && TERMINATORS.has(text[end])) {
      if (text[end] === '.' && isProtectedDot(text, end, paraStart, paraEnd)) break
      end += 1
    }
    while (end < paraEnd && CLOSERS.has(text[end])) end += 1
    pushTrimmed(text, sentenceStart, end, output)
    let next = end
    while (next < paraEnd && /\s/.test(text[next])) next += 1
    sentenceStart = next
    index = next
  }
  if (sentenceStart < paraEnd) pushTrimmed(text, sentenceStart, paraEnd, output)
}

/**
 * 分句入口。
 * @param {string} content 清洗后的正文
 * @returns {{ idx: number, text: string, start: number, end: number }[]}
 */
export function splitSentences(content) {
  const text = typeof content === 'string' ? content : ''
  if (text.trim().length === 0) return []
  /** @type {{ text: string, start: number, end: number }[]} */
  const collected = []
  for (const [start, end] of findParagraphRanges(text)) {
    splitParagraph(text, start, end, collected)
  }
  return collected.map((sentence, idx) => ({ idx, ...sentence }))
}

export default splitSentences
