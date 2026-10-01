import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { frequencySchema, orderPersonalBook } from '../src/exam-frequency'
import { coreGloss } from '../src/gloss'
import { emptyStore, importToPersonal, importWords, reviewWord, storyKey, validateStore, type DailyStory, type Store } from '../src/model'
import { starterRows } from '../src/vocabulary'
import { newWords } from '../src/study'

/** The study page keeps secondary actions behind ⋯; open it (once) and query inside. */
async function studyMenu(page: Page) {
  const more = page.getByRole('button', { name: '更多操作', exact: true })
  if (await more.getAttribute('aria-expanded') !== 'true') await more.click()
  return page.getByRole('group', { name: '更多操作' })
}


const examFrequency = frequencySchema.parse(JSON.parse(readFileSync('public/vocabulary/exam-frequency-2022-2026.json', 'utf8')))
function studied(store: Store) { return orderPersonalBook(store, examFrequency) }
function listed(store: Store, index: number) { return store.words.find(word => word.id === store.books[0].wordIds[index])! }

/** Saves run in the background now; wait until the page has nothing in flight, then read the device copy. */
async function settled(page: Page) {
  if (page.url().startsWith('http')) await page.waitForFunction(() => document.documentElement.dataset.saving !== 'true', null, { timeout: 15000 })
}
async function state(page: Page): Promise<Store> { await settled(page); return (await (await page.request.get('/api/state')).json()).state }
async function seed(page: Page, next: unknown) {
  const { revision } = await (await page.request.get('/api/state')).json()
  expect((await page.request.put('/api/state', { data: { state: validateStore(next), revision } })).status()).toBe(200)
}
async function nav(page: Page, name: string) {
  const tabs = page.getByRole('navigation', { name: '主导航' })
  if (name === '词库') {
    await tabs.getByRole('tab', { name: '词书', exact: true }).click()
  } else {
    await tabs.getByRole('tab', { name: name === '当日助记' ? '阅读' : name === '设置' ? '我的' : name, exact: true }).click()
    if (name === '当日助记') await page.getByRole('button', { name: '自选词短文', exact: true }).click()
  }
}
async function settings(page: Page, section: string) {
  await nav(page, '我的')
  await page.getByRole('button', { name: section, exact: true }).click()
}
async function selectArticle(page: Page, title: string) {
  await page.getByRole('button', { name: '选择英语文章', exact: true }).click()
  await page.locator('ion-modal .choice-list h3').filter({ hasText: new RegExp(`^${title}(?:\\s|$)`) }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function closeSheet(page: Page) {
  await page.locator('ion-modal').getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function closeToast(page: Page) {
  const button = page.locator('ion-toast').getByRole('button', { name: '关闭', exact: true })
  if (await button.isVisible()) { await button.click(); await expect(button).not.toBeVisible() }
}
async function holdWord(page: Page, word: string) {
  const button = page.locator('.english-line').filter({ has: page.locator('.english-word', { hasText: word }) })
  await expect(button).toBeVisible()
  await expect(page.locator('.view-transition')).toHaveCSS('opacity', '1')
  await button.hover(); await page.mouse.down()
  await expect(page.getByRole('dialog', { name: '单词详情', exact: true })).toBeVisible()
  await page.mouse.up()
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__speech = []
    ;(window as any).__recordings = []
    speechSynthesis.speak = utterance => { (window as any).__speech.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate }) }
    HTMLMediaElement.prototype.play = function () { (window as any).__recordings.push(this.src); return Promise.resolve() }
  })
})
test.afterEach(async ({ page, context }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) await page.screenshot({ path: info.outputPath('failure.png'), fullPage: true }).catch(() => {})
  for (const ownedPage of context.pages()) if (!ownedPage.isClosed()) await ownedPage.close()
  await expect.poll(() => context.pages().filter(p => !p.isClosed()).map(p => p.url())).toEqual([])
  await context.close()
})

test('recent exam counts are searchable and the study list stays in frequency order', async ({ page }) => {
  const initial = studied(importToPersonal(emptyStore(), starterRows.slice(0, 40), '考频测试').store)
  await seed(page, initial)
  await page.goto('/')
  await nav(page, '词库')
  await page.getByRole('button', { name: '考频查询', exact: true }).click()
  await expect(page.getByRole('table', { name: '四级近五年考频' })).toBeVisible()
  await expect(page.locator('.frequency-summary')).toContainText('33 套 · 11 个考期')
  await expect(page.locator('.frequency-row[data-word]')).toHaveCount(100)
  await page.getByLabel('搜索考频单词').fill('research')
  await expect(page.locator('.frequency-row[data-word="research"]')).toContainText('/ 33')
  await page.getByLabel('考频考试类型').selectOption('ky2')
  await expect(page.getByRole('table', { name: '考研英语二近五年考频' })).toBeVisible()
  await expect(page.locator('.frequency-row[data-word="research"]')).toContainText('/ 5')
  await page.getByLabel('搜索考频单词').fill('not-a-vocabulary-entry')
  await expect(page.getByText('没有匹配的单词', { exact: true })).toBeVisible()
  await page.getByLabel('搜索考频单词').fill('')
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.frequency-row').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth))).toBe(true)
    await page.screenshot({ path: `test-results/exam-frequency-${width}.png`, animations: 'disabled' })
  }
  expect(await state(page)).toEqual(JSON.parse(JSON.stringify(initial)))
  await nav(page, '学习')
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', initial.books[0].wordIds[0])
})

test('four tabs, compact memory progress and local profile settings retain their state without layout overflow', async ({ page }) => {
  const initial = studied(importToPersonal(emptyStore(), starterRows.slice(0, 40), '资料测试').store)
  const head = listed(initial, 0), secondWord = listed(initial, 1)
  head.markCount = 85
  head.markedAt = new Date().toISOString()
  await seed(page, initial)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const tabs = page.getByRole('navigation', { name: '主导航' }).getByRole('tab')
  await expect(tabs).toHaveCount(4)
  expect(await tabs.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual(['学习', '词书', '阅读', '我的'])
  const first = page.locator('.english-entry').first()
  await expect(first.locator('.mark-grid i')).toHaveCount(6)
  await expect(first.locator('.mark-grid i[data-filled=true]')).toHaveCount(6)
  expect((await state(page)).words.find(word => word.id === head.id)?.markCount).toBe(85)
  const second = page.locator('.english-entry').nth(1)
  await page.getByRole('button', { name: '看词', exact: true }).click()
  const background = await second.evaluate(element => getComputedStyle(element).backgroundColor)
  for (let i = 1; i <= 7; i++) {
    await second.locator('.english-line').click()
    await expect(second.locator('.mark-dots')).toHaveAttribute('data-level', String(Math.min(6, i)))
  }
  await expect(second).toHaveCSS('background-color', background)
  expect((await state(page)).words.find(word => word.id === secondWord.id)?.markCount).toBe(6)
  expect((await state(page)).reviews).toEqual([])
  await page.screenshot({ path: 'test-results/memory-progress-390.png', animations: 'disabled' })
  await nav(page, '我的')
  await expect(page.getByLabel('AI 服务商')).toHaveCount(0)
  await page.getByRole('button', { name: '编辑个人资料' }).click()
  await page.getByLabel('昵称', { exact: true }).fill('每天认真检查记忆')
  await page.getByLabel('学习目标', { exact: true }).fill('完成当前目标词书，反复阅读、反复检查，把单词放进真实的句子里。')
  const avatar = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8
    const context = canvas.getContext('2d')!; context.fillStyle = '#7ca6a4'; context.fillRect(0, 0, 8, 8)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.locator('.profile-form input[type=file]').setInputFiles({ name: 'synthetic-avatar.png', mimeType: 'image/png', buffer: Buffer.from(avatar, 'base64') })
  await expect(page.getByRole('button', { name: '保存资料' })).toBeEnabled()
  await page.getByRole('button', { name: '保存资料' }).click()
  await expect(page.locator('.profile-summary')).toContainText('每天认真检查记忆')
  await expect(page.locator('.profile-avatar img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
  await page.reload()
  await nav(page, '我的')
  await expect(page.locator('.profile-summary')).toContainText('每天认真检查记忆')
  expect((await state(page)).profile.goal).toContain('反复检查')
  for (const width of [320, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.profile-summary,.settings-menu').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true)
    await expect.poll(async () => page.locator('.mobile-nav').evaluate(element => {
      const selected = element.querySelector('ion-tab-button.tab-selected')!.getBoundingClientRect()
      const glass = element.querySelector('.tab-glass-selection')!.getBoundingClientRect()
      return Math.abs((selected.left + selected.right) / 2 - (glass.left + glass.right) / 2)
    })).toBeLessThan(2)
    await page.screenshot({ path: `test-results/my-page-${width}.png`, animations: 'disabled' })
  }
  await page.getByRole('button', { name: '管理目标词书', exact: true }).click()
  await expect(page.getByRole('heading', { name: '词书', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '我的单词', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的单词', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: '词书', exact: true })).toBeVisible()
  await nav(page, '我的')
  await expect(page.locator('.profile-summary')).toBeVisible()
  expect((await state(page)).books).toEqual(initial.books)
})

test('daily English works offline, records reading separately, handles lookup and safely refreshes excerpts', async ({ page }) => {
  const initial = studied(importToPersonal(emptyStore(), starterRows.slice(0, 40), '阅读测试').store)
  await seed(page, initial)
  const external: string[] = []
  page.on('request', request => { if (request.url().startsWith('https:')) external.push(request.url()) })
  await page.route('https://**/*', route => route.abort())
  await page.route('**/api/settings', route => route.fulfill({ json: { provider: 'deepseek', model: 'fixture-model', configured: true } }))
  await page.route('**/api/article-assist', async route => route.fulfill({ json: { model: 'fixture-model', answer: '合成摘要：文章介绍了一个主题。', items: [] } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await nav(page, '阅读')
  await page.getByRole('button', { name: '英语选读', exact: true }).click()
  await expect(page.locator('.source-article')).toBeVisible()
  await selectArticle(page, 'Library')
  await expect(page.locator('.daily-english')).toHaveAttribute('data-article-id', 'simple-library')
  await expect(page.locator('.reading-image img')).toBeVisible()
  expect(await page.locator('.reading-image img').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  expect(external).toEqual([])
  await expect(page.locator('.article-translation')).toHaveCount(0)
  await page.getByRole('button', { name: '显示译文', exact: true }).click()
  await expect(page.locator('.article-translation').first()).toContainText('图书馆')
  await page.getByRole('button', { name: '隐藏译文', exact: true }).click()
  await expect(page.locator('.article-translation')).toHaveCount(0)
  await page.getByRole('button', { name: '查词 library', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: '阅读查词' })).toBeVisible()
  await expect(page.locator('.reading-word .word-action-meaning')).toContainText('图书馆')
  await page.getByRole('button', { name: '朗读阅读单词', exact: true }).click()
  expect((await page.evaluate(() => (window as any).__speech)).at(-1).text).toBe('library')
  await closeSheet(page)
  await page.getByRole('button', { name: '完成阅读', exact: true }).click()
  await expect(page.getByRole('button', { name: '已读', exact: true })).toBeDisabled()
  expect((await state(page)).readArticleIds).toEqual(['simple-library'])
  expect((await state(page)).reviews).toEqual([])
  expect((await state(page)).books).toEqual(initial.books)
  await settings(page, '发音与阅读')
  await page.getByLabel('文章难度', { exact: true }).selectOption('standard')
  await expect.poll(async () => (await state(page)).readingPreferences.level).toBe('standard')
  await page.getByRole('button', { name: '大字', exact: true }).click()
  await expect.poll(async () => (await state(page)).readingPreferences.textSize).toBe('large')
  await nav(page, '阅读')
  await selectArticle(page, 'Library')
  await expect(page.locator('.daily-english')).toHaveAttribute('data-article-id', 'en-library')
  await expect(page.locator('.article-paragraphs p').first()).toHaveCSS('font-size', '20px')
  for (const width of [320, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.source-article').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: `test-results/daily-english-${width}.png`, animations: 'disabled' })
  }
  const before = await page.locator('.article-paragraphs').innerText()
  await page.getByRole('button', { name: '更新英语文章', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('已保留离线选读')
  expect(await page.locator('.article-paragraphs').innerText()).toBe(before)
  // Synthetic HTML tests parsing and caching, not the real article source.
  await page.route('https://*.wikipedia.org/api/rest_v1/page/mobile-html/**', route => route.fulfill({ contentType: 'text/html', body: '<section data-mw-section-id="0"><table><tr><td><p>Table text should never become a paragraph in the reading excerpt.</p></td></tr></table><p>This synthetic reading fixture checks that complete paragraphs remain readable after a successful update and reload.<sup>[999]</sup><img src="https://unsafe.invalid/beacon.png" onerror="window.__injected=1"></p><script>window.__injected=1</script></section>' }))
  await page.getByRole('button', { name: '更新英语文章', exact: true }).click()
  await expect(page.locator('.article-paragraphs')).toContainText('This synthetic reading fixture')
  await expect(page.locator('.article-paragraphs')).not.toContainText('Table text')
  await expect(page.locator('.article-paragraphs')).not.toContainText('[999]')
  expect(await page.evaluate(() => (window as any).__injected)).toBeUndefined()
  expect(external.some(url => url.includes('unsafe.invalid'))).toBe(false)
  await page.reload()
  await nav(page, '阅读')
  await page.getByRole('button', { name: '英语选读', exact: true }).click()
  await selectArticle(page, 'Library')
  await expect(page.locator('.article-paragraphs')).toContainText('This synthetic reading fixture')
  expect((await state(page)).words).toEqual(JSON.parse(JSON.stringify(initial.words)))
  expect((await state(page)).readArticleIds).toEqual(['simple-library'])
})

test('custom daily volumes persist, preserve old plans and marks keep a neutral card', async ({ page }) => {
  const original = studied(importToPersonal(emptyStore(), starterRows.slice(0, 41), '原有词书').store)
  delete original.books[0].planVersion
  await seed(page, original)
  await page.goto('/')
  const card = page.locator('.english-entry').first()
  await page.getByRole('button', { name: '看词', exact: true }).click()
  const background = await card.evaluate(el => getComputedStyle(el).backgroundColor)
  for (let count = 1; count <= 5; count++) {
    await card.locator('.english-line').click()
    await expect(card).toHaveAttribute('data-mark-count', String(count))
    await expect(card).toHaveCSS('background-color', background)
  }
  await expect(card.locator('.mark-dots')).toHaveAttribute('data-level', '5')
  await settings(page, '学习设置')
  const input = page.getByLabel('新词书每单元词量', { exact: true })
  await input.fill('0')
  await expect(page.getByRole('button', { name: '保存单元词量' })).toBeDisabled()
  await input.fill('10')
  await page.getByRole('button', { name: '保存单元词量' }).click()
  await expect.poll(async () => (await state(page)).goal).toBe(10)
  expect((await state(page)).books).toEqual(original.books)
  await page.reload()
  await nav(page, '词库')
  await page.getByRole('button', { name: '添加词书', exact: true }).click()
  await page.locator('.catalog-book').filter({ hasText: '四级词汇' }).click()
  await expect(page.getByLabel('本书每单元词量', { exact: true })).toHaveValue('10')
  await page.getByLabel('本书每单元词量', { exact: true }).fill('17')
  await page.getByRole('dialog').evaluate(async el => {
    await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})))
  })
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.locator('.daily-count').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await expect(page.locator('ion-modal .sheet-heading')).toBeInViewport()
    await page.screenshot({ path: `test-results/daily-count-${width}.png` })
  }
  await page.getByRole('button', { name: '开始学习', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.english-entry')).toHaveCount(17)
  expect((await state(page)).books.find(book => book.id === 'ecdict-cet4')?.dailyCount).toBe(17)
  const installed = await state(page)
  const frequency = await (await page.request.get('/vocabulary/exam-frequency-2022-2026.json')).json()
  const words = new Map(installed.words.map(word => [word.id, word.word.toLowerCase()]))
  expect(installed.books.find(book => book.id === 'ecdict-cet4')!.wordIds.slice(0, 17).map(id => words.get(id)))
    .toEqual(frequency.exams.cet4.words.slice(0, 17).map((word: { word: string }) => word.word.toLowerCase()))
  await page.reload()
  await expect(page.locator('.english-entry')).toHaveCount(17)
  await (await studyMenu(page)).getByRole('button', { name: '复习计划', exact: true }).click()
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.memory-table tbody tr')).toHaveCount(8)
    expect(await page.locator('.memory-table').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await expect(page.locator('ion-modal .sheet-heading')).toBeInViewport()
    await page.screenshot({ path: `test-results/memory-table-${width}.png` })
  }
  await closeSheet(page)
  await settings(page, '学习设置')
  await page.getByLabel('复习方法', { exact: true }).selectOption('fsrs')
  await expect.poll(async () => (await state(page)).reviewMethod).toBe('fsrs')
  await nav(page, '学习')
  await (await studyMenu(page)).getByRole('button', { name: '复习计划', exact: true }).click()
  await expect(page.getByRole('table', { name: 'FSRS 复习规则' })).toBeVisible()
})

test('card layouts persist and spaced reviews support due completion and undo', async ({ page }) => {
  let initial = importToPersonal(emptyStore(), starterRows.slice(0, 40), '卡片测试').store
  const reviewedId = initial.words[0].id
  initial = studied(reviewWord(initial, reviewedId, 3, new Date(Date.now() - 21 * 60000)))
  const reviewed = initial.words.find(word => word.id === reviewedId)!
  await seed(page, initial)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '自测', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.day-title')).toHaveText('到期复习')
  await expect(page.locator('.english-entry')).toHaveCount(1)
  await page.getByRole('button', { name: '新词', exact: true }).click()
  await (await studyMenu(page)).getByRole('button', { name: /^回看本单元/ }).click()
  await expect(page.locator('.english-entry')).toHaveCount(20)
  await expect(page.locator('.card-meaning')).toHaveCount(0)
  await page.getByRole('button', { name: '看词', exact: true }).click()
  await expect(page.locator('.card-meaning')).toHaveCount(20)
  const head = listed(initial, 0)
  await expect(page.locator('.english-entry').first().locator('.card-meaning')).toHaveText(coreGloss(head.meaning))
  await expect(page.locator('.english-entry').first().locator('.card-phonetic')).toHaveCount(head.phonetic ? 1 : 0)
  await expect(page.locator('.meaning-section')).toHaveCount(0)
  await expect(page.locator('.english-entry').nth(1)).toHaveAttribute('data-next', '20 分钟')
  expect((await state(page)).reviews).toHaveLength(1)
  await (await studyMenu(page)).getByRole('button', { name: '朗读本组', exact: true }).click()
  expect((await page.evaluate(() => (window as any).__speech)).at(-1).text).toContain(listed(initial, 0).word)
  await page.locator('.english-entry').nth(1).locator('.english-line').click()
  await expect(page.locator('.english-entry').nth(1)).toHaveAttribute('data-mark-count', '1')
  await expect(page.locator('.english-entry').nth(1)).toHaveAttribute('data-next', '20 分钟')
  await expect(page.locator('.english-entry')).toHaveCount(20)
  expect((await state(page)).reviews).toHaveLength(1)
  await page.getByRole('button', { name: '下一单元', exact: true }).click()
  await expect(page.locator('.day-title')).toHaveText('第 2 单元')
  await expect(page.locator('.english-entry')).toHaveCount(20)
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', initial.books[0].wordIds[20])
  await page.reload()
  await expect(page.locator('.day-title')).toHaveText('第 2 单元')
  await expect(page.getByRole('button', { name: '看词', exact: true })).toHaveAttribute('aria-pressed', 'true')
  for (const width of [320, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.english-entry').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth))).toBe(true)
    expect(await page.locator('.english-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1)
    expect(await page.locator('.english-entry').evaluateAll(rows => rows.every(row => {
      const english = row.querySelector('.english-stack')!.getBoundingClientRect()
      const meaning = row.querySelector('.card-meaning')!.getBoundingClientRect()
      return english.right <= meaning.left && Math.abs((english.top + english.bottom) / 2 - (meaning.top + meaning.bottom) / 2) < 1
    }))).toBe(true)
    const symmetry = await page.locator('.study-scope').evaluate(el => {
      const bar = el.getBoundingClientRect(), title = el.querySelector('.study-date-nav')!.getBoundingClientRect()
      return Math.abs((bar.left + bar.right) / 2 - (title.left + title.right) / 2)
    })
    expect(symmetry).toBeLessThan(1)
    await page.screenshot({ path: `test-results/cards-preview-${width}.png`, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await (await studyMenu(page)).getByRole('button', { name: '复习计划', exact: true }).click()
  await expect(page.locator('.memory-table tbody tr')).toHaveCount(8)
  await page.screenshot({ path: 'test-results/memory-plan-390.png', animations: 'disabled' })
  await page.getByRole('button', { name: '开始到期复习 · 1 词', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.english-entry')).toHaveCount(1)
  await page.getByRole('button', { name: '自测', exact: true }).click()
  await page.getByRole('button', { name: '本组已检查完', exact: true }).click()
  await expect.poll(async () => (await state(page)).words.find(word => word.id === reviewed.id)?.memoryStage).toBe(2)
  await expect(page.locator('.study-submit-area')).toContainText('本组已检查完，下次复习已安排')
  await page.locator('ion-toast').getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.english-entry')).toHaveCount(1)
  expect((await state(page)).words.find(word => word.id === reviewed.id)?.memoryStage).toBe(1)
  expect(new Date((await state(page)).words.find(word => word.id === reviewed.id)!.card.due).getTime()).toBe(reviewed.card.due.getTime())
  await closeToast(page)
  await settings(page, '学习设置')
  await page.getByLabel('复习方法', { exact: true }).selectOption('fsrs')
  await expect.poll(async () => (await state(page)).reviewMethod).toBe('fsrs')
  await page.reload()
  await page.getByRole('button', { name: '自测', exact: true }).click()
  await expect(page.locator('.card-meaning')).toHaveCount(0)
  expect((await state(page)).reviewMethod).toBe('fsrs')
})

test('legacy migration, independent pronunciation and marks, known words, day position and backup', async ({ page }) => {
  const initial = importWords(emptyStore(), starterRows.slice(0, 40), '旧词表').store
  const { books, activeBookId, stories, pronunciation, ...legacy } = initial
  await seed(page, legacy)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.english-entry')).toHaveCount(20)
  await page.screenshot({ path: 'test-results/glass-restored-390.png' })
  await expect(page.getByRole('navigation').getByRole('tab')).toHaveCount(4)
  await expect(page.getByRole('tab', { name: '我的', exact: true })).toBeVisible()
  const planned = await state(page)
  const firstId = planned.books[0].wordIds[0]
  const firstWord = planned.words.find(word => word.id === firstId)!
  const first = page.locator('.english-entry').first(), id = firstId
  await expect(first).toHaveAttribute('data-mark-count', '0')
  await expect(page.locator('.meaning-entry').first()).not.toBeInViewport()
  await expect(page.locator('.chinese-meaning')).toHaveCount(0)
  await page.getByRole('button', { name: '显示全部释义', exact: true }).click()
  await expect(page.locator('.chinese-meaning').first()).toHaveText(coreGloss(firstWord.meaning))
  await page.getByRole('button', { name: '返回英文词表', exact: true }).click()
  for (const count of [1, 1]) {
    await first.locator('.english-line').click()
    await expect(first).toHaveAttribute('data-mark-count', String(count))
  }
  expect(await page.evaluate(() => (window as any).__speech)).toEqual([])
  expect((await state(page)).reviews).toHaveLength(0)
  await holdWord(page, firstWord.word)
  await expect(page.getByLabel('标记等级', { exact: true }).locator('.mark-dots')).toHaveAttribute('data-level', '1')
  await page.getByRole('button', { name: '美', exact: true }).click()
  await page.getByRole('button', { name: '英', exact: true }).click()
  const speech = await page.evaluate(() => (window as any).__speech)
  expect(speech[0].lang).toBe('en-US')
  expect(speech[0].rate).toBeCloseTo(.85)
  expect(speech.at(-1).lang).toBe('en-GB')
  await expect(page.getByLabel('标记等级', { exact: true }).locator('.mark-dots')).toHaveAttribute('data-level', '1')
  await page.getByRole('switch', { name: '熟词', exact: true }).click()
  await expect.poll(async () => (await state(page)).words.find(w => w.id === id)?.known).toBe(true)
  await closeSheet(page)
  await expect(page.locator('.english-entry')).toHaveCount(20)
  await expect(first).toContainText('熟词')
  await (await studyMenu(page)).getByRole('button', { name: '撤销上一步', exact: true }).click()
  await expect(first).toHaveAttribute('data-word-id', id)
  await expect(page.locator('.english-entry')).toHaveCount(20)
  await closeToast(page)
  await page.getByRole('button', { name: '本组已检查完', exact: true }).click()
  await expect.poll(async () => (await state(page)).books[0].completedWordIds.length).toBe(20)
  await expect(page.locator('.study-submit-area')).toContainText('本组已检查完，下次复习已安排')
  expect((await state(page)).reviews).toHaveLength(20)
  await (await studyMenu(page)).getByRole('button', { name: '撤销上一步' }).click()
  await expect.poll(async () => (await state(page)).reviews.length).toBe(0)
  expect((await state(page)).books[0].completedWordIds).toHaveLength(0)
  await page.getByRole('button', { name: '下一单元', exact: true }).click()
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', planned.books[0].wordIds[planned.books[0].dailyCount])
  await nav(page, '词库')
  await page.locator('.owned-book').click()
  await page.getByRole('button', { name: '继续学习', exact: true }).click()
  await expect(page.locator('.day-title')).toContainText('第 2 单元')
  await page.reload()
  await expect(page.locator('.day-title')).toContainText('第 2 单元')
  await settings(page, '数据与备份')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  const backup = await (await downloadEvent).path()
  await nav(page, '词库')
  await page.getByRole('button', { name: '导入词表', exact: true }).click()
  await page.getByLabel('或粘贴词表').fill('word,meaning\nSerendipity,不覆盖旧释义\nluminous,明亮的')
  await expect(page.getByText('1 个新词 · 复用 1 个已有词')).toBeVisible()
  await page.getByRole('button', { name: '加入我的词本', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => (await state(page)).words.length).toBe(41)
  expect((await state(page)).words[0].meaning).toBe(initial.words[0].meaning)
  await page.locator('input[type=file][accept=".json"]').setInputFiles(backup!)
  await page.getByRole('button', { name: '确认恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => (await state(page)).words.length).toBe(40)
  expect((await state(page)).books[0].currentDay).toBe(1)
  expect((await state(page)).words.find(word => word.id === firstId)?.markCount).toBe(1)
})

test('bundled wordbooks install real tagged data, plan days, retain shared progress and use local assets', async ({ page }) => {
  await seed(page, emptyStore())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await nav(page, '词库')
  await expect(page.locator('.catalog-book')).toHaveCount(7)
  await page.screenshot({ path: 'test-results/wordbooks-390.png', animations: 'disabled' })
  await page.locator('.catalog-book').filter({ hasText: '四级词汇' }).click()
  await page.getByLabel('本书每单元词量', { exact: true }).fill('40')
  await page.getByRole('button', { name: '开始学习', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.english-entry')).toHaveCount(20)
  let saved = await state(page)
  expect(saved.books[0].wordIds).toHaveLength(3846)
  expect(saved.books[0].dailyCount).toBe(40)
  const firstId = (await page.locator('.english-entry').first().getAttribute('data-word-id'))!
  const firstWord = saved.words.find(w => w.id === firstId)!
  expect(firstWord.source).toBe('ECDICT')
  expect(firstWord.phonetic.length).toBeGreaterThan(0)
  await page.locator('.english-entry').first().locator('.english-line').click()
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-mark-count', '1')
  await page.getByRole('button', { name: '本组已检查完', exact: true }).click()
  await expect.poll(async () => (await state(page)).books[0].completedWordIds.length).toBe(20)
  await page.getByRole('slider', { name: '词组', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', saved.books[0].wordIds[20])
  await nav(page, '词库')
  await page.getByRole('button', { name: '添加词书', exact: true }).click()
  await page.locator('.catalog-book').filter({ hasText: '六级词汇' }).click()
  await page.getByRole('button', { name: '开始学习', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  saved = await state(page)
  expect(saved.books).toHaveLength(2)
  expect(saved.words.length).toBeLessThan(3846 + 5406)
  expect(saved.words.find(w => w.id === firstId)?.markCount).toBe(1)
  expect(saved.books.find(b => b.id === 'ecdict-cet4')?.completedWordIds).toHaveLength(20)
  const remainingNew = newWords(saved).slice(0, 20).map(word => word.id)
  expect(remainingNew.length).toBeGreaterThan(0)
  expect(remainingNew).not.toContain(firstId)
  await page.route('https://**/*', route => route.abort())
  await page.reload()
  await expect(page.locator('.english-entry')).toHaveCount(remainingNew.length)
  expect(await page.locator('.english-entry').evaluateAll(rows => rows.map(row => row.getAttribute('data-word-id')))).toEqual(remainingNew)
})

test('online dictionary renders definitions, audio and attribution; missing entries retain local meaning', async ({ page }) => {
  const initial = importToPersonal(emptyStore(), starterRows.slice(0, 20), '词典测试').store
  await seed(page, initial)
  const requested: string[] = []
  await page.route('https://api.dictionaryapi.dev/**', route => {
    requested.push(route.request().url())
    if (requested.length > 1) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, json: { title: 'No Definitions Found' } })
    return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: [{
      word: 'serendipity', phonetics: [{ text: '/fixture/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/serendipity-us.mp3', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.ogg', license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' } }],
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'An unexpected fortunate discovery.', example: 'A moment of serendipity.' }] }],
      sourceUrls: ['https://en.wiktionary.org/wiki/serendipity'], license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' },
    }] })
  })
  await page.route('**/media/pronunciations/**', route => route.fulfill({ status: 204 }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await holdWord(page, initial.words[0].word)
  expect(requested).toHaveLength(0)
  await page.getByRole('button', { name: '在线词典', exact: true }).click()
  await expect(page.getByText('An unexpected fortunate discovery.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '词条来源', exact: true })).toHaveAttribute('href', 'https://en.wiktionary.org/wiki/serendipity')
  await page.getByRole('button', { name: '/fixture/', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__recordings.length)).toBe(1)
  await page.screenshot({ path: 'test-results/dictionary-390.png' })
  await closeSheet(page)
  await holdWord(page, initial.words[1].word)
  await page.getByRole('button', { name: '在线词典', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('未收录')
  await expect(page.locator('.word-action-meaning')).toHaveText(coreGloss(initial.words[1].meaning))
})

test('daily story uses planned words, preserves concurrent marks, caches by day and invalidates after edits', async ({ page }) => {
  const initial = studied(importToPersonal(emptyStore(), starterRows.slice(0, 61), '短文测试').store)
  const dayWords = initial.books[0].wordIds.slice(0, 20).map(id => initial.words.find(word => word.id === id)!)
  await seed(page, initial)
  await page.route('**/api/settings', route => route.fulfill({ json: { provider: 'deepseek', model: 'fixture-model', configured: true } }))
  const requests: string[][] = []
  let release: (() => void) | undefined
  let delayed = true
  let fail = false
  await page.route('**/api/story', async route => {
    const ids = route.request().postDataJSON().ids as string[]
    requests.push(ids)
    if (delayed) await new Promise<void>(resolve => { release = resolve })
    if (fail) { await route.fulfill({ status: 502, json: { error: '测试额度不足' } }); return }
    await route.fulfill({ json: { model: 'fixture-model', story: {
      title: 'A Day Together (test fixture)',
      paragraphs: [{ english: `Today we remember ${ids.slice(0, -1).map(id => initial.words.find(w => w.id === id)!.word).join(', ')}.`, translation: '合成接口测试短文，非实际 AI 生成。' }],
    } } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  try {
    await nav(page, '当日助记')
    await page.getByRole('button', { name: '选择单词', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '选择单词' })).toBeVisible()
    await page.getByRole('button', { name: '全选', exact: true }).click()
    await page.getByRole('button', { name: '生成短文 · 20 词', exact: true }).click()
    await expect.poll(() => !!release).toBe(true)
    expect(requests[0]).toEqual(dayWords.map(word => word.id))
    await nav(page, '学习')
    await page.locator('.english-entry').first().locator('.english-line').click()
    await expect(page.locator('.english-entry').first()).toHaveAttribute('data-mark-count', '1')
    await page.getByRole('button', { name: '下一单元', exact: true }).click()
    release!()
    await expect.poll(async () => (await state(page)).stories.length).toBe(1)
    expect((await state(page)).words.find(word => word.id === dayWords[0].id)?.markCount).toBe(1)
    await nav(page, '当日助记')
    await expect(page.locator('.compact-day')).toContainText('第 2 单元')
    await expect(page.locator('.story-article')).toHaveCount(0)
    await page.getByRole('button', { name: '短文上一单元' }).click()
    await expect(page.locator('.story-article')).toBeVisible()
    await expect(page.getByText('覆盖 19/20 词', { exact: true })).toBeVisible()
    await expect(page.locator('.missing-words')).toContainText(dayWords[19].word)
    await expect(page.locator('.story-translation')).toHaveCount(0)
    await page.getByRole('button', { name: '显示译文', exact: true }).click()
    await expect(page.locator('.story-translation')).toBeVisible()
    await page.getByRole('button', { name: '朗读短文', exact: true }).click()
    expect((await page.evaluate(() => (window as any).__speech)).at(-1).text).toContain('Today we remember')
    await closeToast(page)
    await page.screenshot({ path: 'test-results/daily-story-fixture-390.png', animations: 'disabled' })
    await page.getByRole('button', { name: `查看 ${dayWords[0].word}`, exact: true }).click()
    await expect(page.getByRole('dialog', { name: '单词详情' })).toBeVisible()
    await closeSheet(page)
    await page.reload()
    await nav(page, '当日助记')
    await page.getByRole('button', { name: '短文上一单元' }).click()
    await expect(page.locator('.story-article')).toBeVisible()
    expect(requests).toHaveLength(1)
    const reviewsBeforeCheck = (await state(page)).reviews
    await nav(page, '学习')
    await expect(page.locator('.day-title')).toHaveText('第 2 单元')
    await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', initial.books[0].wordIds[20])
    expect((await state(page)).reviews).toEqual(reviewsBeforeCheck)
    await nav(page, '当日助记')
    await page.getByRole('button', { name: '短文上一单元' }).click()
    await expect(page.locator('.story-article')).toBeVisible()
    delayed = false; fail = true
    await page.getByRole('button', { name: '重新生成短文', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('测试额度不足')
    expect((await state(page)).stories).toHaveLength(1)
    await page.getByRole('button', { name: `查看 ${dayWords[0].word}`, exact: true }).click()
    await page.getByRole('button', { name: '编辑单词', exact: true }).click()
    await page.getByRole('textbox', { name: '释义', exact: true }).fill('已修订的释义')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(async () => (await state(page)).stories.length).toBe(0)
    await expect(page.locator('.story-article')).toHaveCount(0)
    expect((await state(page)).words.find(word => word.id === dayWords[0].id)?.markCount).toBe(1)
  } finally { release?.() }
})

test('settings contain model presets and responsive reading surfaces do not overlap', async ({ page }) => {
  const rows = starterRows.slice(0, 20).map((row, i) => i ? row : { ...row, word: 'pneumonoultramicroscopicsilicovolcanoconiosis' })
  const initial = studied(importToPersonal(emptyStore(), rows, '布局测试').store)
  const dayWords = initial.books[0].wordIds.slice(0, 20).map(id => initial.words.find(word => word.id === id)!)
  initial.words[1].markCount = 3
  const book = initial.books[0]
  initial.stories = [{
    id: storyKey(book.id, 0, 0), bookId: book.id, day: 0, part: 0, createdAt: new Date().toISOString(), model: 'fixture',
    title: 'A Small Discovery (test fixture)', paragraphs: [{ english: 'A resilient friend can embrace a subtle change and flourish with a new perspective.', translation: '合成界面测试样例。' }],
    targets: dayWords.map(({ id, word, meaning }) => ({ id, word, meaning })),
  } satisfies DailyStory]
  await seed(page, initial)
  await page.goto('/')
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size)
    await expect(page.locator('.english-entry')).toHaveCount(20)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.english-entry').evaluateAll(rows => rows.every(row => {
      const word = row.querySelector('.english-word')!.getBoundingClientRect()
      const number = row.querySelector('.word-index')!.getBoundingClientRect()
      const dots = row.querySelector('.mark-dots')!.getBoundingClientRect()
      return word.left >= number.right && word.left >= dots.right && row.scrollWidth <= row.clientWidth
    }))).toBe(true)
    expect(await page.locator('.english-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(2)
    await expect(page.locator('.meaning-entry').first()).not.toBeInViewport()
    await expect(page.locator('.mobile-nav')).toHaveCSS('position', 'absolute')
    await expect(page.locator('.mobile-nav')).toHaveCSS('border-radius', '38px')
    expect(await page.locator('.mobile-nav').evaluate(el => getComputedStyle(el).backdropFilter)).not.toBe('none')
    await page.locator('.english-entry').last().evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await expect.poll(async () => page.locator('.english-entry').last().evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav')!.getBoundingClientRect().top)).toBe(true)
    await page.locator('#app-scroll').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }))
    await page.screenshot({ path: `test-results/reading-${size.width}.png`, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await settings(page, 'AI 服务')
  await expect(page.getByLabel('AI 模型', { exact: true })).toHaveValue('deepseek-flash')
  await page.getByLabel('AI 服务商', { exact: true }).selectOption('qwen')
  await expect(page.getByLabel('AI 模型', { exact: true })).toHaveValue('qwen-plus')
  await page.getByLabel('AI 模型', { exact: true }).selectOption('custom')
  await page.getByLabel('自定义模型名称').fill('my-model')
  await page.route('**/api/settings', route => {
    const data = route.request().postDataJSON()
    expect(data.provider).toBe('qwen'); expect(data.model).toBe('my-model'); expect(data.key).toBe('fixture-not-a-real-key')
    return route.fulfill({ json: { provider: data.provider, model: data.model, configured: true } })
  })
  await page.getByLabel('API Key', { exact: true }).fill('fixture-not-a-real-key')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('')
  await closeToast(page)
  await page.screenshot({ path: 'test-results/settings-390.png', animations: 'disabled' })
  await nav(page, '当日助记')
  await expect(page.locator('.story-article')).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.locator('#app-scroll').evaluate(node => getComputedStyle(node).scrollBehavior)).toBe('auto')
})
