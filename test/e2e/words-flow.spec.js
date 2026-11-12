import { test, expect } from '@playwright/test'
import { resetSettings } from './helpers.js'

/**
 * E2E-5 词库（05-TEST-IMPL-PLAN §4）：
 * 查词收藏 → 词库列表 → 搜索 → 导出 CSV → 取消收藏。
 * 依赖真实词典（E2E 数据目录下需有 stardict.db；本机 %APPDATA%\readloop 已就位时，
 * 若测试数据目录没有词典，收藏会失败——因此这里用接口预置收藏词，并在无词典时跳过）。
 */

/** 通过接口收藏一个词（依赖词典），返回 id；词典缺失返回 null。 */
async function collectWord(request, word) {
  const res = await request.post('/api/words', { data: { word } })
  if (!res.ok()) return null
  const json = await res.json()
  return json.word ? json.word.id : null
}

test.describe('E2E-5 词库', () => {
  test.beforeEach(async ({ request }) => {
    await resetSettings(request)
  })

  test('收藏词列表、搜索、导出 CSV、取消收藏', async ({ page, request }) => {
    const wordIds = []
    // 预置两个收藏词（词典存在时才会成功）
    for (const word of ['library', 'notebook']) {
      const id = await collectWord(request, word)
      if (id) wordIds.push(id)
    }
    test.skip(wordIds.length === 0, 'E2E 数据目录缺少词典，跳过词库用例')

    try {
      await page.goto('/words')
      await expect(page.getByRole('heading', { name: '词库' })).toBeVisible()
      await expect(page.getByText(/收藏 \d+ 个词/)).toBeVisible()

      const search = page.getByPlaceholder(/搜索词、释义或来源/)
      await search.fill('quiet')
      await expect(page.getByText('quiet', { exact: true })).toBeVisible()
      await expect(page.getByText('library', { exact: true })).toHaveCount(0)

      // 导出 CSV（真实下载）
      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: /导出 CSV/ }).click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toMatch(/readloop-words-.*\.csv/)

      // 取消收藏
      await search.fill('quiet')
      const row = page.getByRole('row').filter({ hasText: 'quiet' })
      await row.getByRole('button', { name: /取消收藏/ }).click()
      const dialog = page.getByRole('dialog')
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole('button', { name: /取消收藏|确定|删除/ }).click()
      }
      await expect(page.getByText('quiet', { exact: true })).toHaveCount(0)
    } finally {
      for (const id of wordIds) await request.delete(`/api/words/${id}`)
    }
  })

  test('空词库给出空态', async ({ page, request }) => {
    const res = await request.get('/api/words')
    const json = await res.json()
    test.skip((json.items || []).length > 0, '词库非空，跳过空态用例')
    await page.goto('/words')
    await expect(page.getByText(/还没有收藏|空|去阅读|收藏/).first()).toBeVisible()
  })
})

