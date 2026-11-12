import { spawn } from 'node:child_process'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

/**
 * 以子进程方式启动 tools/mock-ai.mjs（M3 集成测试专用；不修改该文件）。
 * 每个实例使用随机端口；故障注入通过 MOCK_AI_MODE 环境变量在启动时指定。
 * @param {{ mode?: 'success' | 'invalid-json' | 'timeout' | 'http-500' | 'http-401' | 'rate-limit' | 'slow' | 'cancel' }} [options]
 * @returns {Promise<{
 *   baseUrl: string,
 *   port: number,
 *   stop: () => Promise<void>,
 *   reset: () => Promise<void>,
 *   requests: () => Promise<object[]>
 * }>}
 */
export async function startMockAi(options = {}) {
  const mode = options.mode ?? 'success'
  const scriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../tools/mock-ai.mjs'
  )
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = 20000 + Math.floor(Math.random() * 30000)
    /** @type {import('node:child_process').ChildProcess} */
    const child = spawn(process.execPath, [scriptPath], {
      env: { ...process.env, MOCK_AI_PORT: String(port), MOCK_AI_MODE: mode },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.stdout.on('data', () => {
      // 保留 stdout 引用，避免管道缓冲阻塞子进程
    })

    const baseUrl = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 6000
    let ready = false
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        lastError = new Error(
          `mock-ai 启动失败（mode=${mode}）: ${stderr || `exit ${child.exitCode}`}`
        )
        break
      }
      try {
        const response = await fetch(`${baseUrl}/__health`)
        if (response.ok) {
          ready = true
          break
        }
      } catch {
        // 端口尚未就绪，继续重试
      }
      await delay(100)
    }
    if (!ready) {
      try {
        child.kill()
      } catch {
        // 子进程可能已退出
      }
      continue
    }

    /** @type {(() => Promise<void>) | null} */
    let stopping = null
    const stop = () => {
      if (stopping) return stopping
      stopping = new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve()
          return
        }
        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // 进程可能已退出
          }
          resolve()
        }, 2000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        child.kill()
      })
      return stopping
    }

    return {
      baseUrl,
      port,
      stop,
      async reset() {
        await fetch(`${baseUrl}/__reset`, { method: 'POST' })
      },
      async requests() {
        const response = await fetch(`${baseUrl}/__requests`)
        const payload = await response.json()
        return payload.requests ?? []
      }
    }
  }
  throw lastError ?? new Error('mock-ai 启动失败')
}

export default startMockAi
