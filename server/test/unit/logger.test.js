import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { initLogger, logger, sanitizeDetail } from '../../lib/logger.js'

/** 本文件创建的临时目录，测试结束统一清理 */
const tempDirs = []

/**
 * @returns {string}
 */
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readloop-logger-test-'))
  tempDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // 清理失败不影响测试结论
    }
  }
})

describe('logger 敏感字段过滤', () => {
  it('apiKey / Authorization 打码，prompt 只保留前 500 字', () => {
    const longPrompt = 'p'.repeat(600)
    const sanitized = sanitizeDetail({
      apiKey: 'sk-secret-key',
      Authorization: 'Bearer abc',
      prompt: longPrompt,
      nested: { apiKey: 'sk-inner', model: 'deepseek-chat' }
    })
    assert.equal(sanitized.apiKey, '[REDACTED]')
    assert.equal(sanitized.Authorization, '[REDACTED]')
    assert.equal(sanitized.nested.apiKey, '[REDACTED]')
    assert.equal(sanitized.nested.model, 'deepseek-chat')
    assert.match(sanitized.prompt, /^pppp/)
    assert.ok(sanitized.prompt.length < longPrompt.length)
    assert.match(sanitized.prompt, /\[截断\]$/)
  })

  it('循环引用与 Error 对象可安全序列化', () => {
    const circular = { name: 'loop' }
    circular.self = circular
    const sanitized = sanitizeDetail(circular)
    assert.equal(sanitized.self, '[circular]')

    const errorSanitized = sanitizeDetail(new Error('boom'))
    assert.equal(errorSanitized.name, 'Error')
    assert.equal(errorSanitized.message, 'boom')
  })

  it('写文件时同样过滤 apiKey，且包含时间/级别/模块', () => {
    const logDir = makeTempDir()
    initLogger({ db: null, logDir })
    logger.info('unit-test', '日志过滤检查', { apiKey: 'sk-file-secret' })
    const file = path.join(logDir, 'server.log')
    const content = fs.readFileSync(file, 'utf8')
    assert.match(content, /\[unit-test\] 日志过滤检查/)
    assert.match(content, /\[REDACTED\]/)
    assert.doesNotMatch(content, /sk-file-secret/)
    initLogger({ db: null })
  })
})
