/**
 * SSE 客户端（M3 句内追问 / 复盘自由问答使用）。
 * 用 fetch + ReadableStream 解析 `event:` / `data:` 帧，支持 AbortSignal 与一次自动重连。
 *
 * 事件约定见 02-DATA-API §6.4：delta / done / error。
 */

/** 解析一帧 SSE 文本块，返回 { event, data } 或 null（心跳/空行）。 */
function parseFrame(chunk) {
  let event = 'message'
  const dataLines = []
  for (const rawLine of chunk.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith(':')) continue
    const sep = line.indexOf(':')
    const field = sep < 0 ? line : line.slice(0, sep)
    const value = sep < 0 ? '' : line.slice(sep + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }
  if (!dataLines.length) return null
  const text = dataLines.join('\n')
  if (text === '[DONE]') return { event: 'done', data: null }
  try {
    return { event, data: JSON.parse(text) }
  } catch {
    return { event, data: text }
  }
}

/**
 * 消费一个 SSE 端点。
 * @param {string} path 以 /api 开头的路径
 * @param {object} options
 * @param {'POST'|'GET'} [options.method]
 * @param {unknown} [options.body]
 * @param {(event: string, data: any) => void} options.onEvent
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.retryOnce] 网络中断后是否重连一次（仅追问）
 * @returns {Promise<void>}
 */
export async function streamSse(path, { method = 'POST', body, onEvent, signal, retryOnce = false } = {}) {
  const attempt = async () => {
    const headers = { Accept: 'text/event-stream' }
    const init = { method, headers, signal, credentials: 'same-origin' }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const res = await fetch(path, init)
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      let failure = null
      try {
        const data = JSON.parse(text)
        if (data && data.error && typeof data.error.message === 'string') {
          failure = new Error(data.error.message)
          failure.code = data.error.code
          failure.retryable = Boolean(data.error.retryable)
        }
      } catch {
        /* 非 JSON 错误体 */
      }
      if (!failure) {
        failure = new Error(`SSE 连接失败（HTTP ${res.status}）`)
        failure.retryable = res.status >= 500
      }
      failure.status = res.status
      throw failure
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const frame = parseFrame(chunk)
        if (frame) onEvent(frame.event, frame.data)
        boundary = buffer.indexOf('\n\n')
      }
    }
  }

  try {
    await attempt()
  } catch (err) {
    if (!retryOnce || (err && err.name === 'AbortError')) throw err
    await attempt()
  }
}
