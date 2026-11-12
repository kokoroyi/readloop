import { createHash } from 'node:crypto'

/**
 * 计算 sha256 十六进制摘要。
 * @param {string} text
 * @returns {string}
 */
export function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/**
 * 文章内容哈希（02-DATA-API §3：sha256(trim(content))）。
 * @param {string} content 已清洗正文
 * @returns {string}
 */
export function contentHash(content) {
  return sha256(String(content).trim())
}
