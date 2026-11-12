import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { createArticle, resetSettings, uniqueSuffix } from './helpers.js'

/** 通过接口按标题关键字清理本次运行创建的文章。 */
async function cleanupByToken(request, token) {
  const res = await request.get('/api/articles')
  if (!res.ok()) return
  const json = await res.json()
  for (const item of json.items || []) {
    if (item.title && item.title.includes(token)) {
      await request.delete(`/api/articles/${item.id}`)
    }
  }
}

/** 生成一份本次运行唯一的 md 合集文件（避免 content_hash 重复导致 skipped）。 */
function writeMdFixture(token) {
  const dir = path.resolve('test-results', 'fixtures')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `e2e-lessons-${token}.md`)
  const lessons = [
    {
      title: 'Chapter 1 The quiet library',
      body:
        'The quiet library was almost empty when I arrived. I found a seat near the window and opened my notebook. The old librarian was very kind, but I did not look up. ' +
        `A woman in a red coat was reading poems by the door. ${token} one.`
    },
    {
      title: 'Chapter 2 A bright morning',
      body:
        'The morning was bright and calm. I usually arrive at the library before nine. I sometimes read the same page twice. ' +
        `Last Saturday I stayed until closing time. ${token} two.`
    },
    {
      title: 'Chapter 3 A quiet afternoon',
      body:
        'Postcards always spoil my holidays. Last summer, I went to Italy. I visited museums and sat in public gardens. ' +
        `A friendly waiter taught me a few words of Italian. ${token} three.`
    }
  ]
  const content = lessons
    .map((lesson) => `## ${lesson.title} ${token}\n\n${lesson.body}`)
    .join('\n\n')
  fs.writeFileSync(file, content, 'utf8')
  return file
}

test.describe('E2E-2 导入与文章库', () => {
  test.beforeEach(async ({ request }) => {
    await resetSettings(request)
  })

  test('粘贴导入进入待读队列', async ({ page, request }) => {
    const token = `paste-${uniqueSuffix()}`
    try {
      await page.goto('/library')
      await page.getByRole('button', { name: '导入文章' }).first().click()

      const title = `E2E paste ${token}`
      const content =
        'Reading slowly is useful. It helps you notice how sentences are built. ' +
        `This paragraph is created by ${token}. The last sentence closes the sample.`

      await page.getByPlaceholder(/例如：The quiet library/).fill(title)
      await page.getByPlaceholder('粘贴英文原文…').fill(content)
      await expect(page.getByText(/预估 \d+ 句/)).toBeVisible()
      await page.getByRole('button', { name: '导入文章' }).last().click()

      await expect(page.getByText('已导入 1 篇，进入待读队列')).toBeVisible({ timeout: 10_000 })
      // 弹窗关闭后列表出现新文章（待读）
      const row = page.getByRole('row').filter({ hasText: token })
      await expect(row).toContainText(title)
      await expect(row).toContainText('待读')
    } finally {
      await cleanupByToken(request, token)
    }
  })

  test('md 大纲勾选后导入多篇', async ({ page, request }) => {
    const token = `md-${uniqueSuffix()}`
    try {
      await page.goto('/library')
      await page.getByRole('button', { name: '导入文章' }).first().click()
      await page.getByRole('tab', { name: '文件导入' }).click()

      const file = writeMdFixture(token)
      await page.locator('input[type="file"]').setInputFiles(file)

      // 大纲：3 个候选，取消第 3 个
      await expect(page.getByText(`Chapter 3 A quiet afternoon ${token}`)).toBeVisible({
        timeout: 10_000
      })
      await page.getByRole('checkbox').nth(2).uncheck()
      await expect(page.getByRole('button', { name: /导入 2 篇/ })).toBeVisible()
      await page.getByRole('button', { name: /导入 2 篇/ }).click()

      await expect(page.getByText(/已导入 2 篇/)).toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: '完成', exact: true }).click()
      // 用搜索过滤，避免分页/历史数据影响断言
      const search = page.getByPlaceholder(/搜索标题或正文/)
      await search.fill(token)
      await expect(
        page.getByRole('row').filter({ hasText: `Chapter 1 The quiet library ${token}` })
      ).toHaveCount(1)
      await expect(
        page.getByRole('row').filter({ hasText: `Chapter 2 A bright morning ${token}` })
      ).toHaveCount(1)
      await expect(
        page.getByRole('row').filter({ hasText: `Chapter 3 A quiet afternoon ${token}` })
      ).toHaveCount(0)
    } finally {
      await cleanupByToken(request, token)
    }
  })

  test('队列置顶后刷新顺序保持', async ({ page, request }) => {
    const token = `order-${uniqueSuffix()}`
    try {
      await createArticle(request, { title: `E2E order A ${token}` })
      await createArticle(request, { title: `E2E order B ${token}` })

      await page.goto('/library')
      await expect(page.getByRole('button', { name: '队列排序' })).toBeVisible()
      await page.getByRole('button', { name: '队列排序' }).click()

      // 把 B 置顶
      const rowB = page.getByRole('row').filter({ hasText: `E2E order B ${token}` })
      await rowB.getByRole('button', { name: '置顶' }).click()
      await page.getByRole('button', { name: '完成排序' }).click()

      await page.reload()
      const firstRow = page.locator('table.lib-table tbody tr').first()
      await expect(firstRow).toContainText(`E2E order B ${token}`)
    } finally {
      await cleanupByToken(request, token)
    }
  })

  test('md 任务标记被清洗、预览展示完整清洗后正文', async ({ page, request }) => {
    const token = `marker-${uniqueSuffix()}`
    try {
      const dir = path.resolve('test-results', 'fixtures')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `e2e-marker-${token}.md`)
      fs.writeFileSync(
        file,
        `## Lesson marker ${token}\n\n` +
          '- [x] 已读\n\n' +
          'First sentence for the marker test. Second sentence follows it.\n\n' +
          '- [ ] 未读\n',
        'utf8'
      )

      await page.goto('/library')
      await page.getByRole('button', { name: '导入文章' }).first().click()
      await page.getByRole('tab', { name: '文件导入' }).click()
      await page.locator('input[type="file"]').setInputFiles(file)

      await expect(page.getByText(/Lesson marker/)).toBeVisible({ timeout: 10_000 })
      // 清洗 warning
      await expect(page.locator('.note-warn.warnings')).toContainText(
        '已移除 Markdown 任务列表标记'
      )

      // 预览：完整清洗后正文、不含 [x]、框高度不过度拉伸
      const preview = page.locator('[data-import-preview-scroll]')
      await expect(preview).toBeVisible()
      const previewText = await preview.innerText()
      expect(previewText).not.toContain('[x]')
      expect(previewText).not.toContain('已读')
      expect(previewText).toContain('First sentence for the marker test.')
      const box = await preview.boundingBox()
      expect(box.height).toBeLessThan(340)

      // 导入并核对落库句子不含标记
      await page.getByRole('button', { name: /导入 1 篇/ }).click()
      await expect(page.getByText(/已导入 1 篇/)).toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: '完成', exact: true }).click()

      const listRes = await request.get('/api/articles?status=queued')
      const listJson = await listRes.json()
      const article = (listJson.items || []).find((item) => item.title.includes(token))
      expect(article).toBeTruthy()
      const workRes = await request.get(`/api/articles/${article.id}/work`)
      const work = await workRes.json()
      const texts = work.sentences.map((item) => item.text)
      expect(texts.join(' ')).not.toContain('[x]')
      expect(texts.join(' ')).not.toContain('已读')
      expect(texts.length).toBeGreaterThanOrEqual(2)
    } finally {
      await cleanupByToken(request, token)
    }
  })
})


