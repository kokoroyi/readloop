import { AppError } from './errors.js'

/**
 * 客户端取消（不属于 02 §6.5 错误码表，仅内部使用）：
 * readingService 捕获后把句子状态回 pending、不写缓存，不向前端返回错误信封。
 */
export class CancelledError extends Error {
  /**
   * @param {string} [message]
   */
  constructor(message = '请求已取消') {
    super(message)
    this.name = 'CancelledError'
    this.code = 'CANCELLED'
  }
}

/**
 * 全局串行 AI 队列（03-AI-SPEC §1.2）：
 * - 容量 32：排队数达到容量直接 QUEUE_TIMEOUT（429）；
 * - 排队超时 120s → QUEUE_TIMEOUT；
 * - 同一时刻只执行一个任务（一个上游请求）；
 * - 支持 AbortSignal：排队中取消立即出队并抛 CancelledError。
 *
 * @param {{ capacity?: number, queueTimeoutMs?: number }} [options]
 */
export function createAiQueue({ capacity = 32, queueTimeoutMs = 120000 } = {}) {
  /** @type {{ task: () => Promise<unknown>, resolve: (value: unknown) => void, reject: (reason: unknown) => void, timer: NodeJS.Timeout | null, cleanup: (() => void) | null }[]} */
  const waiting = []
  let running = false

  /**
   * 从等待队列移除任务（清定时器与 abort 监听）。
   * @param {{ timer: NodeJS.Timeout | null, cleanup: (() => void) | null }} item
   * @returns {boolean}
   */
  function remove(item) {
    const index = waiting.indexOf(item)
    if (index < 0) return false
    waiting.splice(index, 1)
    if (item.timer) {
      clearTimeout(item.timer)
      item.timer = null
    }
    if (item.cleanup) {
      item.cleanup()
      item.cleanup = null
    }
    return true
  }

  /**
   * 串行调度：取出队首执行，完成后继续下一个。
   */
  function pump() {
    if (running) return
    const item = waiting.shift()
    if (!item) return
    running = true
    if (item.timer) {
      clearTimeout(item.timer)
      item.timer = null
    }
    if (item.cleanup) {
      item.cleanup()
      item.cleanup = null
    }
    Promise.resolve()
      .then(() => item.task())
      .then(
        (value) => item.resolve(value),
        (error) => item.reject(error)
      )
      .finally(() => {
        running = false
        pump()
      })
  }

  return {
    /**
     * 入队执行一个串行任务。
     * @template T
     * @param {() => Promise<T>} task
     * @param {{ signal?: AbortSignal }} [options]
     * @returns {Promise<T>}
     */
    run(task, options = {}) {
      const signal = options.signal
      return new Promise((resolve, reject) => {
        if (waiting.length >= capacity) {
          reject(new AppError('QUEUE_TIMEOUT', 'AI 队列已满，请稍后重试'))
          return
        }
        if (signal?.aborted) {
          reject(new CancelledError())
          return
        }
        /** @type {{ task: () => Promise<unknown>, resolve: (value: unknown) => void, reject: (reason: unknown) => void, timer: NodeJS.Timeout | null, cleanup: (() => void) | null }} */
        const item = { task, resolve, reject, timer: null, cleanup: null }
        item.timer = setTimeout(() => {
          if (remove(item)) reject(new AppError('QUEUE_TIMEOUT', 'AI 排队超时，请稍后重试'))
        }, queueTimeoutMs)
        if (signal) {
          const onAbort = () => {
            if (remove(item)) reject(new CancelledError())
          }
          signal.addEventListener('abort', onAbort, { once: true })
          item.cleanup = () => signal.removeEventListener('abort', onAbort)
        }
        waiting.push(item)
        pump()
      })
    },

    /** 当前等待数 */
    get queued() {
      return waiting.length
    },

    /** 是否有任务在执行 */
    get busy() {
      return running
    },

    capacity
  }
}

export default createAiQueue
