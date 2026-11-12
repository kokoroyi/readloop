/**
 * 正文清洗：统一换行、去 BOM/NBSP、压缩空行、去行尾空白。
 * 清洗后的文本才是入库正文（articles.content），分句偏移也基于它。
 */

/**
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeContent(input) {
  if (typeof input !== 'string') return ''
  let text = input
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  text = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

/**
 * 取正文预览：把空白折叠为单空格，截到指定长度。
 * @param {unknown} content
 * @param {number} [maxLength]
 * @returns {string}
 */
export function makePreview(content, maxLength = 120) {
  const text = String(content ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}…`
}
