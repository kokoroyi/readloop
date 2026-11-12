import fs from 'node:fs'

/**
 * 轻量文件可读性探测（health 的 dict、system info 的 dictOk 共用）。
 * 只做 stat + 读前 16 字节，不做全表/行数校验。
 * @param {string} filePath
 * @returns {boolean}
 */
export function isFileReadable(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size === 0) return false
    const fd = fs.openSync(filePath, 'r')
    try {
      const buffer = Buffer.alloc(16)
      fs.readSync(fd, buffer, 0, 16, 0)
    } finally {
      fs.closeSync(fd)
    }
    return true
  } catch {
    // 文件缺失/被占用/权限不足都视为不可用
    return false
  }
}

export default isFileReadable
