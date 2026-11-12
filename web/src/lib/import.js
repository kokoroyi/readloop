/**
 * 导入器纯函数：校验上限、字数/句数预估、文件判断与标题推导。
 */

export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_CONTENT_CHARS = 100000
export const MIN_CONTENT_CHARS = 20
export const MAX_TITLE_CHARS = 100

/** 英文词数（粗略统计）。 */
export function countWords(text) {
  const matches = String(text || '').match(/[A-Za-z][A-Za-z'’-]*/g)
  return matches ? matches.length : 0
}

/** 预估句子数（与后端分句器口径接近的粗估）。 */
export function estimateSentences(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return 0
  const matches = trimmed.match(/[^.!?。！？]+[.!?。！？]+["'”’]?/g)
  return matches && matches.length ? matches.length : 1
}

/** 字节数 → "48 KB" / "1.2 MB" */
export function formatFileSize(bytes) {
  const size = Number(bytes) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** 文件扩展名（小写，不含点）。 */
export function fileExtension(name) {
  const match = /\.([^.]+)$/.exec(String(name || ''))
  return match ? match[1].toLowerCase() : ''
}

/** 导入器只接受 .txt / .md 且 ≤2MB。 */
export function validateImportFile(file) {
  if (!file) return '请选择文件'
  const ext = fileExtension(file.name)
  if (ext !== 'txt' && ext !== 'md') return '只支持 .txt 或 .md 文件'
  if (file.size > MAX_FILE_BYTES) return '文件过大，最大 2MB'
  if (file.size === 0) return '文件是空的'
  return ''
}

/** 由文件名推导默认标题（去扩展名，截断到 100 字）。 */
export function titleFromFilename(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '').trim()
  return base.slice(0, MAX_TITLE_CHARS)
}

/** UTF-8 解码失败的粗略检测（出现替换字符视为编码可疑）。 */
export function looksLikeUtf8(text) {
  return !String(text || '').includes('\uFFFD')
}

/** 粘贴正文的前若干行，用于预览。 */
export function firstLines(text, maxLines = 8) {
  const lines = String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.slice(0, maxLines).join('\n')
}

/** commit 批量上限（与后端一致）：单次 ≤300 篇、单次累计正文字符 ≤100000。 */
export const MAX_BATCH_ITEMS = 300
export const MAX_BATCH_CHARS = 100000

/** 批量导入总字符数。 */
export function totalImportChars(items) {
  return items.reduce((sum, item) => sum + String(item.content || '').length, 0)
}

/**
 * 按 commit 上限切批：每批 ≤300 篇且累计正文 ≤100k 字符，每批独立事务。
 * 单篇超过 100k 时单独成批，交给后端报 VALIDATION（前端也会先拦）。
 * @param {Array<{ title?: string, content: string, sourceFormat: string }>} items
 * @returns {Array<Array<{ title?: string, content: string, sourceFormat: string }>>}
 */
export function chunkImportItems(items) {
  const batches = []
  let current = []
  let chars = 0
  for (const item of items) {
    const length = String(item.content || '').length
    const wouldExceed = current.length >= MAX_BATCH_ITEMS || (current.length > 0 && chars + length > MAX_BATCH_CHARS)
    if (wouldExceed) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(item)
    chars += length
  }
  if (current.length) batches.push(current)
  return batches
}
