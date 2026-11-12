/**
 * 浏览器下载助手：fetch → blob，便于捕获接口错误（导出失败给 toast 而不是跳到错误页）。
 */

/** 从 Content-Disposition 解析文件名（兼容 filename*=UTF-8'' 形式）。 */
function filenameFromDisposition(disposition) {
  if (!disposition) return ''
  const encoded = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].replace(/"/g, '').trim())
    } catch {
      return encoded[1].trim()
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1].trim() : ''
}

/**
 * 下载一个返回附件的接口。
 * @param {string} url 以 /api 开头的地址
 * @param {{ filename?: string, fallbackName?: string }} [options]
 * @returns {Promise<string>} 实际保存的文件名
 */
export async function downloadFile(url, { filename = '', fallbackName = 'readloop-export' } = {}) {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) {
    let message = `导出失败（HTTP ${res.status}）`
    try {
      const data = await res.json()
      if (data && data.error && data.error.message) message = data.error.message
    } catch {
      /* 非 JSON 错误体，保留默认文案 */
    }
    throw new Error(message)
  }
  const blob = await res.blob()
  const name = filename || filenameFromDisposition(res.headers.get('Content-Disposition')) || fallbackName
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = name
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  return name
}
