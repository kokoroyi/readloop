/**
 * CSV 工具：导出词库用（RFC 4180 转义 + UTF-8 BOM）。
 */

/** UTF-8 BOM（Excel 识别中文必需） */
export const UTF8_BOM = '\uFEFF'

/**
 * 转义单个 CSV 字段：含逗号/双引号/换行时用双引号包裹，内部双引号翻倍。
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCsvValue(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * 生成 CSV 文本（不含 BOM，调用方自行加 UTF8_BOM）。
 * @param {string[]} headers
 * @param {unknown[][]} rows
 * @returns {string}
 */
export function toCsv(headers, rows) {
  const lines = [headers.map(escapeCsvValue).join(',')]
  for (const row of rows) lines.push(row.map(escapeCsvValue).join(','))
  return lines.join('\r\n')
}
