import { test, expect } from '@playwright/test'
import { createArticle, resetSettings, uniqueSuffix } from './helpers.js'

/**
 * 阅读台待读队列拖拽排序（M5 迭代）：
 * 鼠标拖拽 → 保存到后端 → 刷新保持；键盘替代；失败回滚。
 */

/** 清空当前待读队列，保证首页队列干净且顺序可控。 */
async function clearQueued(request) {
  const res = await request.get('/api/articles?status=queued')
  if (!res.ok()) return
  const json = await res.json()
  for (const item of json.items || []) {
    await request.delete(`/api/articles/${item.id}`)
  }
}

/** 造 n 篇待读文章，返回按队列入队顺序的 id 列表。 */
async function seedQueue(request, token, n) {
  const ids = []
  for (let i = 0; i < n; i += 1) {
    const article = await createArticle(request, {
      title: `E2E queue ${i + 1} ${token}`,
      content: `Queue sample ${i + 1} for ${token}. This sentence exists only for the drag test.`
    })
    ids.push(article.id)
  }
  return ids
}

/** 读取页面上可见队列条目的 data-queue-id 顺序。 */
async function visibleQueueIds(page) {
  return page.locator('.queue-item').evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute('data-queue-id')))
  )
}

/** 把第 from 条拖到第 to 条之后（用鼠标事件，匹配前端实现）。 */
async function dragRowTo(page, from, to) {
  const handle = page.locator('.queue-handle').nth(from)
  const target = page.locator('.queue-item').nth(to)
  const hb = await handle.boundingBox()
  const tb = await target.boundingBox()
  if (!hb || !tb) throw new Error('拿不到拖拽坐标')
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 12, { steps: 3 })
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height * 0.75, { steps: 10 })
  await page.mouse.up()
}

async function waitQueueSaved(page) {
  await page.waitForFunction(
    () => document.querySelector('.queue-live')?.textContent?.includes('队列顺序已保存'),
    undefined,
    { timeout: 10_000 }
  )
}

test.describe('阅读台队列拖拽', () => {
  test.beforeEach(async ({ request }) => {
    await resetSettings(request)
    await clearQueued(request)
  })

  test('鼠标拖拽重排 → 保存 → 刷新保持', async ({ page, request }) => {
    const token = uniqueSuffix()
    const ids = await seedQueue(request, token, 6)
    try {
      await page.goto('/')
      await expect(page.locator('.home-queue')).toBeVisible()
      const before = await visibleQueueIds(page)
      expect(before.length).toBe(5)
      expect(before).toEqual(ids.slice(0, 5))

      // 第 1 条拖到列表末尾（可见第 5 行下半部）——落点确定，避免行高变化带来的边界歧义
      await dragRowTo(page, 0, 4)
      await waitQueueSaved(page)

      const after = await visibleQueueIds(page)
      expect(after).toEqual([before[1], before[2], before[3], before[4], before[0]])

      // 服务端完整队列顺序：前 5 条重排 + 第 6 条保持末位
      const listRes = await request.get('/api/articles?status=queued&sort=queue')
      const listJson = await listRes.json()
      const serverIds = (listJson.items || []).map((item) => item.id)
      expect(serverIds).toEqual([...after, ids[5]])

      // 刷新后保持
      await page.reload()
      await expect(page.locator('.home-queue')).toBeVisible()
      const reloaded = await visibleQueueIds(page)
      expect(reloaded).toEqual(after)
    } finally {
      await page.close()
      await clearQueued(request)
    }
  })

  test('键盘 ↑/↓ 移动一位并保存', async ({ page, request }) => {
    const token = uniqueSuffix()
    const ids = await seedQueue(request, token, 3)
    try {
      await page.goto('/')
      await expect(page.locator('.home-queue')).toBeVisible()
      const before = await visibleQueueIds(page)
      expect(before).toEqual(ids)

      // 聚焦第 1 条手柄，↓ 移动一位
      await page.locator('.queue-handle').first().focus()
      await page.keyboard.press('ArrowDown')
      await waitQueueSaved(page)

      const after = await visibleQueueIds(page)
      expect(after).toEqual([before[1], before[0], before[2]])
    } finally {
      await page.close()
      await clearQueued(request)
    }
  })

  test('保存失败时回滚并提示', async ({ page, request }) => {
    const token = uniqueSuffix()
    const ids = await seedQueue(request, token, 3)
    try {
      await page.route('**/api/articles/reorder', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            ok: false,
            error: { code: 'INTERNAL', message: '模拟保存失败', retryable: true }
          })
        })
      )
      await page.goto('/')
      await expect(page.locator('.home-queue')).toBeVisible()
      const before = await visibleQueueIds(page)
      expect(before).toEqual(ids)

      await dragRowTo(page, 0, 1)
      await expect(page.locator('.toast-error')).toContainText('排序保存失败', { timeout: 10_000 })
      // 页面顺序回滚
      await expect
        .poll(async () => visibleQueueIds(page))
        .toEqual(before)
      // 服务端顺序未变
      const listRes = await request.get('/api/articles?status=queued&sort=queue')
      const listJson = await listRes.json()
      expect((listJson.items || []).map((item) => item.id)).toEqual(ids)
    } finally {
      await page.unroute('**/api/articles/reorder')
      await page.close()
      await clearQueued(request)
    }
  })
})
