import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createAiQueue } from '../../lib/aiQueue.js'

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('aiQueue 全局串行队列（03-AI-SPEC §1.2）', () => {
  it('串行执行：同一时刻只有一个任务', async () => {
    const queue = createAiQueue({ capacity: 32, queueTimeoutMs: 1000 })
    const events = []
    let concurrent = 0
    let maxConcurrent = 0
    const makeTask = (name, wait) => async () => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      events.push(`start:${name}`)
      await delay(wait)
      concurrent -= 1
      events.push(`end:${name}`)
      return name
    }
    const [first, second] = await Promise.all([
      queue.run(makeTask('a', 60)),
      queue.run(makeTask('b', 10))
    ])
    assert.equal(first, 'a')
    assert.equal(second, 'b')
    assert.equal(maxConcurrent, 1)
    assert.deepEqual(events, ['start:a', 'end:a', 'start:b', 'end:b'])
  })

  it('排队超时 → QUEUE_TIMEOUT', async () => {
    const queue = createAiQueue({ capacity: 32, queueTimeoutMs: 60 })
    const blocker = queue.run(async () => delay(200))
    await assert.rejects(
      queue.run(async () => 'never'),
      (error) => error.code === 'QUEUE_TIMEOUT'
    )
    await blocker
  })

  it('容量耗尽 → QUEUE_TIMEOUT', async () => {
    const queue = createAiQueue({ capacity: 1, queueTimeoutMs: 2000 })
    const blocker = queue.run(async () => delay(120))
    const waiting = queue.run(async () => 'waiting')
    await assert.rejects(
      queue.run(async () => 'overflow'),
      (error) => error.code === 'QUEUE_TIMEOUT'
    )
    await blocker
    assert.equal(await waiting, 'waiting')
  })

  it('排队中取消 → CancelledError 且任务不执行', async () => {
    const queue = createAiQueue({ capacity: 32, queueTimeoutMs: 2000 })
    let executed = false
    const blocker = queue.run(async () => delay(100))
    const controller = new AbortController()
    const queued = queue.run(
      async () => {
        executed = true
        return 'should-not-run'
      },
      { signal: controller.signal }
    )
    controller.abort()
    await assert.rejects(queued, (error) => error.code === 'CANCELLED')
    await blocker
    assert.equal(executed, false)
  })

  it('入队前已取消 → CancelledError', async () => {
    const queue = createAiQueue()
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      queue.run(async () => 'never', { signal: controller.signal }),
      (error) => error.code === 'CANCELLED'
    )
  })

  it('任务抛错后队列继续可用', async () => {
    const queue = createAiQueue()
    await assert.rejects(
      queue.run(async () => {
        throw new Error('boom')
      }),
      /boom/
    )
    assert.equal(await queue.run(async () => 'after-error'), 'after-error')
  })
})
