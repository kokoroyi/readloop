/**
 * SSE 响应工具（02-DATA-API §6.4）：事件格式、15s 心跳、客户端断开检测。
 */

/**
 * 监听响应关闭以 abort 上游（客户端取消）。
 * @param {import('express').Response} res
 * @returns {{ signal: AbortSignal, isAborted: () => boolean, cleanup: () => void }}
 */
export function watchClientClose(res) {
  const controller = new AbortController()
  let aborted = false
  const onClose = () => {
    if (!res.writableEnded) {
      aborted = true
      controller.abort()
    }
  }
  res.once('close', onClose)
  return {
    signal: controller.signal,
    isAborted: () => aborted,
    cleanup: () => res.removeListener('close', onClose)
  }
}

/**
 * 建立 SSE 响应：写响应头 + 启动 15s 心跳。
 * @param {import('express').Response} res
 * @param {{ heartbeatMs?: number }} [options]
 * @returns {{ writeEvent: (event: string, data: unknown) => void, finish: () => void, isClosed: () => boolean }}
 */
export function startEventStream(res, options = {}) {
  const heartbeatMs = options.heartbeatMs ?? 15000
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  /**
   * @param {string} event
   * @param {unknown} data
   */
  const writeEvent = (event, data) => {
    if (res.writableEnded || res.destroyed) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return
    res.write(': ping\n\n')
  }, heartbeatMs)

  return {
    writeEvent,
    finish() {
      clearInterval(heartbeat)
      if (!res.writableEnded) res.end()
    },
    isClosed() {
      return res.writableEnded || res.destroyed
    }
  }
}
