import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { frequencySchema, orderPersonalBook } from '../src/exam-frequency'
import { coreGloss } from '../src/gloss'
import { emptyStore, importToPersonal, importWords, reviewWord, storyKey, validateStore, type DailyStory, type Store } from '../src/model'
import { starterRows } from '../src/vocabulary'
import { newWords } from '../src/study'

/** 朗读本组 / 回看当天 / 撤销上一步 / 重新开始本组 sit in the 复习计划 sheet; open it once and query inside. */
async function studyMenu(page: Page) {
  const tools = page.getByRole('group', { name: '本组操作' })
  if (!(await tools.isVisible())) await page.getByRole('button', { name: '复习计划', exact: true }).click()
  await expect(tools).toBeVisible()
  return tools
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
    // 词书管理 lives under 我的.
    await tabs.getByRole('tab', { name: '我的', exact: true }).click()
    await page.getByRole('button', { name: '管理目标词书', exact: true }).click()
  } else {
    await tabs.getByRole('tab', { name: name === '当日助记' || name === '选读' ? '阅读' : name === '设置' ? '我的' : name, exact: true }).click()
    if (name === '当日助记') await page.getByRole('button', { name: '语境记忆', exact: true }).click()
    if (name === '选读') await page.getByRole('button', { name: '每日英语选读', exact: true }).click()
  }
}
/** List choices open a bottom sheet (SelectButton); pick the option by its title. */
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  // The dialog role is on Ionic's shadow wrapper; the list is slotted light DOM, so scope by ion-modal.
  const sheet = page.locator('ion-modal').filter({ has: page.getByRole('heading', { name: label, exact: true }) })
  await sheet.locator('.choice-list ion-item').filter({ has: page.locator('h3', { hasText: new RegExp(`^${option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).click()
  await expect(sheet).toHaveCount(0)
}async function settings(page: Page, section: string) {
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
  await expect(page.locator('.boot-splash')).toHaveCount(0)
  await button.hover(); await page.mouse.down()
  await expect(page.getByRole('dialog', { name: '单词详情', exact: true })).toBeVisible()
  await page.mouse.up()
}
const libraryUrl = '**/v1/library**'
const emptyLibrary = { version: 1, cursor: 0, more: false, ids: [], articles: [] }
function libraryArticle(id: string, over: Record<string, unknown> = {}) {
  return {
    id, title: 'Fixture ' + id.slice(-1).toUpperCase(), wikiTitle: 'Fixture', lang: 'simple', level: 'easy', cefr: 'B1', topic: '自然', tags: ['测试', '样例'],
    intro: '合成的在线选读库样例。', paragraphs: ['The fixture article explains a small idea in clear words for every reader.', 'A second paragraph keeps the translation count honest and easy to check.'],
    translations: ['合成样例第一段译文。', '合成样例第二段译文。'], source: 'Simple English Wikipedia', sourceUrl: 'https://simple.wikipedia.org/wiki/Fixture',
    author: 'Wikipedia contributors', license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    retrievedAt: '2026-10-01T00:00:00.000Z', revision: '1', stats: { words: 200, avgSentence: 12, rareRatio: 0.03, grade: 7, rare: [['fixtureword', 6]] }, ...over,
  }
}
const cors = { 'access-control-allow-origin': '*' }
/** A decodable 50 ms silent clip, so the browser never fires an audio error that would trigger the system-voice fallback. */
const silentWav = (() => { const data = Buffer.alloc(800); const head = Buffer.alloc(44); head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(8000, 24); head.writeUInt32LE(16000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40); return Buffer.concat([head, data]) })()
test.beforeEach(async ({ page }) => {
  // Cloud speech and Youdao meanings are unreachable unless a test opts in, so reading falls back to the system voice.
  await page.route('**/v1/tts**', route => route.fulfill({ status: 503, headers: cors, json: { error: 'offline' } }))
  await page.route('https://dict.youdao.com/suggest**', route => route.fulfill({ headers: cors, json: { data: { entries: [] } } }))
  await page.route(libraryUrl, route => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: emptyLibrary }))
  await page.addInitScript(() => {
    ;(window as any).__speech = []
    ;(window as any).__recordings = []
    speechSynthesis.speak = utterance => { (window as any).__speech.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate }) }
    HTMLMediaElement.prototype.play = function () {
      (window as any).__recordings.push(this.src); (window as any).__recordingRate = this.playbackRate
      setTimeout(() => this.dispatchEvent(new Event('ended')), 10)
      return Promise.resolve()
    }
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
  await nav(page, '统计')
  await page.getByRole('button', { name: '考频查询', exact: true }).click()
  await expect(page.getByRole('table', { name: '四级近五年考频' })).toBeVisible()
  await expect(page.locator('.frequency-summary')).toContainText('33 套 · 11 个考期')
  await expect(page.locator('.frequency-row[data-word]')).toHaveCount(100)
  await page.getByLabel('搜索考频单词').fill('research')
  await expect(page.locator('.frequency-row[data-word="research"]')).toContainText('/ 33')
  await choose(page, '考频考试类型', '考研英语二')
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
  expect(await tabs.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))).toEqual(['学习', '统计', '阅读', '我的'])
  const first = page.locator('.english-entry').first()
  await expect(first.locator('.mark-grid i')).toHaveCount(6)
  await expect(first.locator('.mark-grid i[data-filled=true]')).toHaveCount(6)
  expect((await state(page)).words.find(word => word.id === head.id)?.markCount).toBe(85)
  const second = page.locator('.english-entry').nth(1)
  await page.getByRole('button', { name: '快速记忆', exact: true }).click()
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
  await expect(page.getByRole('heading', { name: '词书管理', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.locator('.profile-summary')).toBeVisible()
  await nav(page, '统计')
  await page.getByRole('button', { name: '我的单词', exact: true }).click()
  await expect(page.getByRole('heading', { name: '我的单词', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: '统计', exact: true })).toBeVisible()
  await nav(page, '我的')
  await expect(page.locator('.profile-summary')).toBeVisible()
  expect((await state(page)).books).toEqual(initial.books)
})

test('daily English works offline, records reading separately, handles lookup and safely refreshes excerpts', async ({ page }) => {
  const initial = studied(importToPersonal(emptyStore(), starterRows.slice(0, 40), '阅读测试').store)
  await seed(page, initial)
  const external: string[] = []
  page.on('request', request => { if (request.url().startsWith('https:') && !request.url().includes('/v1/library')) external.push(request.url()) })
  await page.route('https://**/*', route => route.abort())
  await page.route('**/api/settings', route => route.fulfill({ json: { provider: 'deepseek', model: 'fixture-model', configured: true } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await nav(page, '选读')
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
  await expect.poll(() => page.evaluate(() => (window as any).__recordings.at(-1))).toBe('https://dict.youdao.com/dictvoice?audio=library&type=2')
  await page.getByRole('button', { name: '关闭查词', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '阅读查词' })).toHaveCount(0)
  await page.getByRole('button', { name: '完成阅读', exact: true }).click()
  await expect(page.getByRole('button', { name: '已读', exact: true })).toBeDisabled()
  expect((await state(page)).readArticleIds).toEqual(['simple-library'])
  expect((await state(page)).reviews).toEqual([])
  expect((await state(page)).books).toEqual(initial.books)
  await settings(page, '发音与阅读')
  await choose(page, '文章难度', '进阶选读')
  await expect.poll(async () => (await state(page)).readingPreferences.level).toBe('standard')
  await page.getByRole('button', { name: '大字', exact: true }).click()
  await expect.poll(async () => (await state(page)).readingPreferences.textSize).toBe('large')
  await nav(page, '选读')
  await page.getByRole('button', { name: '英语选读', exact: true }).click()
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
  await nav(page, '选读')
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
  await page.getByRole('button', { name: '快速记忆', exact: true }).click()
  const background = await card.evaluate(el => getComputedStyle(el).backgroundColor)
  for (let count = 1; count <= 5; count++) {
    await card.locator('.english-line').click()
    await expect(card).toHaveAttribute('data-mark-count', String(count))
    await expect(card).toHaveCSS('background-color', background)
  }
  await expect(card.locator('.mark-dots')).toHaveAttribute('data-level', '5')
  await settings(page, '学习设置')
  const input = page.getByLabel('新词书每天词量', { exact: true })
  await input.fill('0')
  await expect(page.getByRole('button', { name: '保存每天词量' })).toBeDisabled()
  await input.fill('10')
  await page.getByRole('button', { name: '保存每天词量' }).click()
  await expect.poll(async () => (await state(page)).goal).toBe(10)
  expect((await state(page)).books).toEqual(original.books)
  await page.reload()
  await nav(page, '词库')
  await page.getByRole('button', { name: '添加词书', exact: true }).click()
  await page.locator('.catalog-book').filter({ hasText: '四级词汇' }).click()
  await expect(page.getByLabel('每天学多少词', { exact: true })).toHaveValue('10')
  await page.getByLabel('每天学多少词', { exact: true }).fill('17')
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
  await page.getByRole('button', { name: '复习计划', exact: true }).click()
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.locator('.memory-table tbody tr')).toHaveCount(6)
    expect(await page.locator('.memory-table').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await expect(page.locator('ion-modal .sheet-heading')).toBeInViewport()
    await page.screenshot({ path: `test-results/memory-table-${width}.png` })
  }
  await closeSheet(page)
  await settings(page, '学习设置')
  await choose(page, '复习方法', 'FSRS 自适应')
  await expect.poll(async () => (await state(page)).reviewMethod).toBe('fsrs')
  await nav(page, '学习')
  await page.getByRole('button', { name: '复习计划', exact: true }).click()
  await expect(page.getByRole('table', { name: 'FSRS 复习规则' })).toBeVisible()
})

test('card layouts persist and spaced reviews support due completion and undo', async ({ page }) => {
  let initial = studied(importToPersonal(emptyStore(), starterRows.slice(0, 40), '卡片测试').store)
  const reviewedId = initial.books[0].wordIds[0]
  initial = reviewWord(initial, reviewedId, 3, new Date(Date.now() - 21 * 60000))
  const reviewed = initial.words.find(word => word.id === reviewedId)!
  await seed(page, initial)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '自己自查', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // 艾宾浩斯 follows study days: day 1 has nothing to review yet.
  await expect(page.locator('.day-title')).toHaveText('第 1 天')
  await expect(page.getByRole('button', { name: '需要复习', exact: true })).toHaveText('需要复习 0')
  await expect(page.getByLabel('当天计划')).toHaveText(/第 1 天 · 新学 \d+ 词 · 第一天没有复习/)
  await (await studyMenu(page)).getByRole('button', { name: /^回看当天/ }).click()
  await expect(page.locator('.english-entry')).toHaveCount(20)
  await expect(page.locator('.card-meaning')).toHaveCount(0)
  await page.getByRole('button', { name: '快速记忆', exact: true }).click()
  await expect(page.locator('.card-meaning')).toHaveCount(20)
  const head = listed(initial, 0)
  await expect(page.locator('.english-entry').first().locator('.card-meaning')).toHaveText(coreGloss(head.meaning))
  await expect(page.locator('.english-entry .card-phonetic')).toHaveCount(0)
  await expect(page.locator('.meaning-section')).toHaveCount(0)
  await expect(page.locator('.english-entry').nth(1)).toHaveAttribute('data-next', '20 分钟')
  expect((await state(page)).reviews).toHaveLength(1)
  await (await studyMenu(page)).getByRole('button', { name: '朗读本组', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__recordings.length)).toBeGreaterThan(1)
  expect(await page.evaluate(() => (window as any).__recordings[0])).toContain(`audio=${encodeURIComponent(listed(initial, 0).word)}&`)
  await page.locator('.english-entry').nth(1).locator('.english-line').click()
  await expect(page.locator('.english-entry').nth(1)).toHaveAttribute('data-mark-count', '1')
  await expect(page.locator('.english-entry').nth(1)).toHaveAttribute('data-next', '20 分钟')
  await expect(page.locator('.english-entry')).toHaveCount(20)
  expect((await state(page)).reviews).toHaveLength(1)
  await page.getByRole('button', { name: '后一天', exact: true }).click()
  await expect(page.locator('.day-title')).toHaveText('第 2 天')
  await expect(page.locator('.english-entry')).toHaveCount(20)
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', initial.books[0].wordIds[20])
  await page.reload()
  await expect(page.locator('.day-title')).toHaveText('第 2 天')
  await expect(page.getByRole('button', { name: '快速记忆', exact: true })).toHaveAttribute('aria-pressed', 'true')
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
    const symmetry = await page.locator('.study-card').evaluate(el => {
      // The study card spans the content width with equal side insets.
    const bar = el.getBoundingClientRect(), page = el.closest('.content')!.getBoundingClientRect()
      return Math.abs((bar.left - page.left) - (page.right - bar.right))
    })
    expect(symmetry).toBeLessThan(1)
    await page.screenshot({ path: `test-results/cards-preview-${width}.png`, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '复习计划', exact: true }).click()
  await expect(page.locator('.memory-table tbody tr')).toHaveCount(6)
  await page.screenshot({ path: 'test-results/memory-plan-390.png', animations: 'disabled' })
  await page.getByRole('button', { name: '开始复习 · 1 词', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.english-entry')).toHaveCount(1)
  await page.getByRole('button', { name: '自己自查', exact: true }).click()
  await page.getByRole('button', { name: '本组已检查完', exact: true }).click()
  await expect.poll(async () => (await state(page)).words.find(word => word.id === reviewed.id)?.memoryStage).toBe(2)
  await expect(page.locator('.study-submit-area')).toContainText('本组已检查完，下次复习已安排')
  await page.locator('ion-toast').getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.english-entry')).toHaveCount(1)
  expect((await state(page)).words.find(word => word.id === reviewed.id)?.memoryStage).toBe(1)
  expect(new Date((await state(page)).words.find(word => word.id === reviewed.id)!.card.due).getTime()).toBe(reviewed.card.due.getTime())
  await closeToast(page)
  await settings(page, '学习设置')
  await choose(page, '复习方法', 'FSRS 自适应')
  await expect.poll(async () => (await state(page)).reviewMethod).toBe('fsrs')
  await page.reload()
  await page.getByRole('button', { name: '自己自查', exact: true }).click()
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
  // Every tap adds a mark; the first one also records 本轮不熟.
  for (const count of [1, 2]) {
    await first.locator('.english-line').click()
    await expect(first).toHaveAttribute('data-mark-count', String(count))
  }
  expect(await page.evaluate(() => (window as any).__speech)).toEqual([])
  expect((await state(page)).reviews).toHaveLength(0)
  await holdWord(page, firstWord.word)
  await expect(page.getByLabel('标记等级', { exact: true }).locator('.mark-dots')).toHaveAttribute('data-level', '2')
  await page.getByRole('button', { name: '美', exact: true }).click()
  await page.getByRole('button', { name: '英', exact: true }).click()
  // Words play human recordings: type=2 is US, type=1 is UK.
  await expect.poll(() => page.evaluate(() => (window as any).__recordings.length)).toBe(2)
  const recordings = await page.evaluate(() => (window as any).__recordings as string[])
  expect(recordings[0]).toBe(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(firstWord.word)}&type=2`)
  expect(recordings[1]).toBe(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(firstWord.word)}&type=1`)
  expect(await page.evaluate(() => (window as any).__recordingRate)).toBeCloseTo(.85)
  expect(await page.evaluate(() => (window as any).__speech)).toEqual([])
  await expect(page.getByLabel('标记等级', { exact: true }).locator('.mark-dots')).toHaveAttribute('data-level', '2')
  await page.getByRole('switch', { name: '熟词', exact: true }).click()
  await expect.poll(async () => (await state(page)).words.find(w => w.id === id)?.known).toBe(true)
  await closeSheet(page)
  await expect(page.locator('.english-entry')).toHaveCount(19)
  await expect(page.locator('.known-note')).toContainText('已隐藏 1 个熟词')
  await page.locator('.known-note').getByRole('button', { name: '显示', exact: true }).click()
  await expect(page.locator('.english-entry')).toHaveCount(20)
  await expect(first).toContainText('熟词')
  await page.locator('.known-note').getByRole('button', { name: '再次隐藏', exact: true }).click()
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
  await page.getByRole('button', { name: '后一天', exact: true }).click()
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', planned.books[0].wordIds[planned.books[0].dailyCount])
  await nav(page, '词库')
  await page.locator('.owned-book').click()
  await page.getByRole('button', { name: '继续学习', exact: true }).click()
  await expect(page.locator('.day-title')).toContainText('第 2 天')
  await page.reload()
  await expect(page.locator('.day-title')).toContainText('第 2 天')
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
  // The backup holds both taps: the 本轮不熟 mark (undone with the group) and the extra second mark.
  expect((await state(page)).words.find(word => word.id === firstId)?.markCount).toBe(2)
})

test('bundled wordbooks install real tagged data, plan days, retain shared progress and use local assets', async ({ page }) => {
  await seed(page, { ...emptyStore(), onboarded: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await nav(page, '词库')
  await expect(page.locator('.catalog-book')).toHaveCount(7)
  await page.screenshot({ path: 'test-results/wordbooks-390.png', animations: 'disabled' })
  await page.locator('.catalog-book').filter({ hasText: '四级词汇' }).click()
  await page.getByLabel('每天学多少词', { exact: true }).fill('40')
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

test('first launch needs a one-time setup before the app opens, and does not repeat', async ({ page }) => {
  await seed(page, emptyStore())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('region', { name: '欢迎使用拾词' })).toBeVisible()
  // Nothing of the app is reachable yet: no tab bar, no way past the setup.
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/onboarding-welcome-390.png', animations: 'disabled' })
  await page.getByRole('button', { name: /开始设置/ }).click()

  const next = page.getByRole('button', { name: /下一步/ })
  await expect(next).toBeDisabled()
  await page.getByLabel('昵称', { exact: true }).fill('  小林 ')
  await next.click()

  await expect(next).toBeDisabled()
  await page.locator('.start-book').filter({ hasText: '四级词汇' }).click()
  await next.click()

  await page.getByLabel('每天新词', { exact: true }).fill('3')
  await expect(next).toBeDisabled()
  await page.getByLabel('每天新词', { exact: true }).fill('30')
  await next.click()

  await page.getByRole('radio', { name: /^进阶/ }).click()
  await page.screenshot({ path: 'test-results/onboarding-reading-390.png', animations: 'disabled' })
  await next.click()

  const recap = page.locator('.onboarding-recap')
  await expect(recap).toContainText('小林')
  await expect(recap).toContainText('四级词汇')
  await expect(recap).toContainText('30 词')
  await page.getByRole('button', { name: '上一步' }).click()
  await next.click()
  await page.getByRole('button', { name: '开始学习', exact: true }).click()

  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await expect(page.locator('.english-entry')).toHaveCount(20)
  const saved = await state(page)
  expect(saved.onboarded).toBe(true)
  expect(saved.profile.nickname).toBe('小林')
  expect(saved.goal).toBe(30)
  expect(saved.readingPreferences.level).toBe('standard')
  expect(saved.books.map(book => book.id)).toEqual(['ecdict-cet4'])
  expect(saved.books[0].dailyCount).toBe(30)

  await page.reload()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await expect(page.getByRole('region', { name: '欢迎使用拾词' })).toHaveCount(0)
})

test('welcome page offers restoring a backup and skips setup afterwards; existing users never see it', async ({ page }) => {
  const backup = studied(importToPersonal(emptyStore(), starterRows.slice(0, 20), '备份').store)
  await seed(page, emptyStore())
  await page.goto('/')
  await expect(page.getByRole('region', { name: '欢迎使用拾词' })).toBeVisible()
  await page.locator('input[type=file][accept=".json"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole('button', { name: '确认恢复', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  expect((await state(page)).words).toHaveLength(20)
  expect((await state(page)).onboarded).toBe(true)

  // A store saved before onboarding existed has words and books but no flag.
  await seed(page, importToPersonal(emptyStore(), starterRows.slice(0, 20), '旧用户').store)
  await page.reload()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
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
  // The meaning comes first: it is already on screen, above the marks and the tabs, whichever tab is open.
  await expect(page.locator('.word-detail .word-action-meaning')).toHaveText(coreGloss(initial.words[0].meaning))
  const meaningBox = (await page.locator('.word-detail .word-action-meaning').boundingBox())!
  expect(meaningBox.y + meaningBox.height).toBeLessThan(500)
  expect(meaningBox.y).toBeLessThan((await page.getByRole('group', { name: '详情分页' }).boundingBox())!.y)
  expect(meaningBox.y).toBeLessThan((await page.getByLabel('标记等级').boundingBox())!.y)
  await expect(page.getByRole('button', { name: '助记', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '在线词典', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '词典', exact: true }).click()
  const builtIn = page.getByRole('region', { name: '内置词典' })
  await expect(builtIn.getByLabel('中文释义')).toContainText(initial.words[0].meaning.split('\n')[0].replace(/^[a-z]+\.\s*/, '').slice(0, 2))
  await expect(builtIn).toContainText('内置词典')
  expect(requested).toHaveLength(0)
  await page.getByRole('button', { name: '在线词典', exact: true }).click()
  await expect(page.getByText('An unexpected fortunate discovery.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '词条来源', exact: true })).toHaveAttribute('href', 'https://en.wiktionary.org/wiki/serendipity')
  await page.getByRole('button', { name: '/fixture/', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__recordings.length)).toBe(1)
  await page.screenshot({ path: 'test-results/dictionary-390.png' })
  await closeSheet(page)
  await holdWord(page, initial.words[1].word)
  await page.getByRole('button', { name: '词典', exact: true }).click()
  await page.getByRole('button', { name: '在线词典', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('未收录')
  await expect(page.locator('.word-action-meaning')).toHaveText(coreGloss(initial.words[1].meaning))
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
    expect(await page.locator('.mobile-nav').evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none')
    await page.locator('.english-entry').last().evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await expect.poll(async () => page.locator('.english-entry').last().evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector('.mobile-nav')!.getBoundingClientRect().top)).toBe(true)
    await page.locator('#app-scroll').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }))
    await page.screenshot({ path: `test-results/reading-${size.width}.png`, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await settings(page, 'AI 服务')
  await expect(page.getByRole('button', { name: 'AI 模型', exact: true })).toHaveAttribute('data-value', 'deepseek-flash')
  await choose(page, 'AI 服务商', '通义千问')
  await expect(page.getByRole('button', { name: 'AI 模型', exact: true })).toHaveAttribute('data-value', 'qwen-plus')
  await choose(page, 'AI 模型', '自定义模型名称')
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
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.locator('#app-scroll').evaluate(node => getComputedStyle(node).scrollBehavior)).toBe('auto')
})

test('reading hub offers the daily selection and 语境记忆; a short difficulty opens its list and the reader stays inside it', async ({ page }) => {
  await seed(page, studied(importToPersonal(emptyStore(), starterRows.slice(0, 40), '选读库').store))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await nav(page, '阅读')
  await expect(page.locator('.reading-entry')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '语境记忆', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '每日英语选读', exact: true }).click()
  await page.screenshot({ path: 'test-results/reading-hub-390.png', animations: 'disabled' })
  const levels = page.getByRole('region', { name: '按难度选读' })
  await expect(levels.locator('.level-tile')).toHaveCount(5)
  await expect(levels.getByRole('button', { name: 'A2 入门，0 篇' })).toBeDisabled()
  await expect(levels.getByRole('button', { name: /^B1 初级，11 篇/ })).toBeEnabled()
  await levels.getByRole('button', { name: /^B1 初级/ }).click()
  await expect(page.getByRole('heading', { name: 'B1 初级' })).toBeVisible()
  await expect(page.locator('.reading-shelf .reading-list-item')).toHaveCount(11)
  await page.locator('.reading-shelf .reading-list-item', { hasText: '健康' }).click()
  await expect(page.locator('.daily-english')).toHaveAttribute('data-article-id', 'simple-sleep')
  await expect(page.locator('.article-picker-title')).toContainText(/B1 · 第 \d+ \/ 11 篇/)
  await page.getByRole('button', { name: '下一篇文章', exact: true }).click()
  await expect(page.locator('.daily-english')).not.toHaveAttribute('data-article-id', 'simple-sleep')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'B1 初级' })).toBeVisible()
})

test('a large difficulty is chosen in steps: difficulty, topic, then a short paged list', async ({ page }) => {
  await seed(page, studied(importToPersonal(emptyStore(), starterRows.slice(0, 40), '分步').store))
  const bulk = Array.from({ length: 18 }, (_, i) => libraryArticle(`lib-simple-bulk-${i}`, { title: `Bulk ${i}`, cefr: 'C1', level: 'standard', topic: i < 17 ? '科学' : '艺术' }))
  await page.route(libraryUrl, route => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { version: 1, cursor: 18, more: false, ids: bulk.map(a => a.id), articles: bulk } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await nav(page, '选读')
  await page.getByRole('button', { name: /^C1 高级，18 篇/ }).click()
  await expect(page.locator('.reading-shelf .reading-list-item')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '艺术，1 篇' })).toBeVisible()
  await page.screenshot({ path: 'test-results/reading-topics-390.png', animations: 'disabled' })
  await page.getByRole('button', { name: '科学，17 篇' }).click()
  await expect(page.getByRole('heading', { name: 'C1 高级 · 科学' })).toBeVisible()
  await expect(page.locator('.reading-shelf .reading-list-item')).toHaveCount(15)
  await page.getByRole('button', { name: /显示更多（还有 2 篇）/ }).click()
  await expect(page.locator('.reading-shelf .reading-list-item')).toHaveCount(17)
  await page.locator('.reading-shelf .reading-list-item').first().click()
  await expect(page.locator('.article-picker-title')).toContainText('C1 · 科学 · 第 1 / 17 篇')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'C1 高级', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '艺术，1 篇' })).toBeVisible()
})

test('update page shows the current version, auto-checks, pops new versions and asks before installing', async ({ page }) => {
  await seed(page, studied(importToPersonal(emptyStore(), starterRows.slice(0, 20), '更新').store))
  let release = { versionCode: 1, versionName: '0.0.1' }
  await page.route('**/v1/release', route => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { ...release, url: 'https://example.invalid/app.apk', sha256: 'a'.repeat(64), notes: '合成更新说明' } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await settings(page, '检查更新')
  const current = page.getByRole('region', { name: '当前版本' })
  await expect(current.locator('.update-version')).toHaveText(/^\d+\.\d+\.\d+$/)
  await expect(page.getByRole('region', { name: '最新版本' })).toContainText('已是最新版本')
  await expect(page.getByRole('region', { name: '下载安装' })).toHaveCount(0)
  release = { versionCode: 9999, versionName: '99.0.0' }
  await page.getByRole('button', { name: '重新检查', exact: true }).click()
  const popup = page.locator('ion-alert:not(.overlay-hidden)')
  await expect(popup).toContainText('发现新版本 99.0.0')
  await expect(popup).toContainText('合成更新说明')
  await popup.getByRole('button', { name: '稍后' }).click()
  await expect(popup).toHaveCount(0)
  await expect(page.getByRole('region', { name: '下载安装' })).toBeVisible()
})

test('online reading library syncs, recommends, filters by level, reads with translation and stays readable offline', async ({ page }) => {
  await seed(page, studied(importToPersonal(emptyStore(), starterRows.slice(0, 40), '在线库').store))
  const articles = [
    libraryArticle('lib-simple-fixture-a', { cefr: 'A2' }), libraryArticle('lib-simple-fixture-b'),
    libraryArticle('lib-en-fixture-c', { lang: 'en', level: 'standard', cefr: 'C1', source: 'Wikipedia', sourceUrl: 'https://en.wikipedia.org/wiki/Fixture' }),
  ]
  const requested: string[] = []
  await page.route(libraryUrl, route => {
    requested.push(route.request().url())
    return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { version: 1, cursor: 3, more: false, ids: articles.map(a => a.id), articles } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await nav(page, '选读')
  await expect(page.getByRole('region', { name: '适合你' }).getByRole('button')).toHaveCount(3)
  await expect(page.getByText('在线选读库 3 篇')).toBeVisible()
  expect(requested[0]).toContain('since=0')
  const levels = page.getByRole('region', { name: '按难度选读' })
  await expect(levels.getByRole('button', { name: /^A2 入门，1 篇/ })).toBeEnabled()
  await expect(levels.getByRole('button', { name: /^B1 初级，12 篇/ })).toBeEnabled()
  await expect(levels.getByRole('button', { name: /^C1 高级，1 篇/ })).toBeEnabled()
  await expect(levels.getByRole('button', { name: /^C2 精通/ })).toBeDisabled()
  await levels.getByRole('button', { name: /^B1 初级/ }).click()
  await expect(page.locator('.reading-shelf .reading-list-item')).toHaveCount(12)
  await page.locator('.reading-shelf .reading-list-item', { hasText: 'Fixture B' }).click()
  await expect(page.locator('.daily-english')).toHaveAttribute('data-article-id', 'lib-simple-fixture-b')
  await expect(page.locator('.article-intro')).toContainText('合成的在线选读库样例')
  await expect(page.getByRole('button', { name: '更新英语文章', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '显示译文', exact: true }).click()
  await expect(page.locator('.article-translation').first()).toHaveText('合成样例第一段译文。')
  await page.getByRole('button', { name: '完成阅读', exact: true }).click()
  await expect.poll(async () => (await state(page)).readArticleIds).toEqual(['lib-simple-fixture-b'])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.unroute(libraryUrl)
  await page.route(libraryUrl, route => route.abort())
  await page.reload()
  await nav(page, '选读')
  await expect(page.locator('.level-tile[data-level="B1"]')).toContainText('12 篇 · 已读 1')
  await expect(page.getByText('在线选读库 3 篇')).toBeVisible()
})

test('the magazine contents filter by level, topic and length, and the reader has no chat assistant', async ({ page }) => {
  await seed(page, studied(importToPersonal(emptyStore(), starterRows.slice(0, 40), '外刊').store))
  const articles = [
    libraryArticle('lib-simple-fixture-a', { cefr: 'A2', topic: '科技', translations: undefined }),
    libraryArticle('lib-simple-fixture-b'),
    libraryArticle('lib-en-fixture-l', { lang: 'en', level: 'standard', cefr: 'C1', topic: '科技', source: 'Wikipedia', sourceUrl: 'https://en.wikipedia.org/wiki/Fixture', stats: { words: 800, avgSentence: 20, rareRatio: 0.06, grade: 12, rare: [] } }),
  ]
  await page.route(libraryUrl, route => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { version: 1, cursor: 3, more: false, ids: articles.map(a => a.id), articles } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await nav(page, '选读')
  await expect(page.locator('.magazine-masthead')).toContainText('每日外刊')
  await page.screenshot({ path: 'test-results/magazine-hub-390.png', animations: 'disabled' })
  const catalog = page.getByRole('region', { name: '文章筛选' })
  await catalog.getByRole('button', { name: /^筛选/ }).click()
  await catalog.getByRole('button', { name: '难度 A2', exact: true }).click()
  await expect(catalog.locator('.magazine-card')).toHaveCount(1)
  await expect(catalog.getByRole('status')).toHaveText('找到 1 篇')
  await catalog.getByRole('button', { name: '篇幅 长篇', exact: true }).click()
  await expect(catalog.locator('.magazine-card')).toHaveCount(0)
  await expect(catalog.getByRole('status')).toContainText('没有符合条件的文章')
  await catalog.getByRole('button', { name: '全部难度', exact: true }).click()
  await catalog.getByRole('button', { name: '主题 科技', exact: true }).click()
  await expect(catalog.getByRole('button', { name: '目录 Fixture L', exact: true })).toBeVisible()
  await expect(catalog.getByRole('button', { name: '目录 Fixture A', exact: true })).toHaveCount(0)
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/magazine-filter-${width}.png`, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await catalog.getByRole('button', { name: '目录 Fixture L', exact: true }).click()
  await expect(page.locator('.daily-english')).toHaveAttribute('data-article-id', 'lib-en-fixture-l')
  await expect(page.locator('.article-picker-title')).toContainText(/科技 · 长篇 · 第 \d+ \/ \d+ 篇/)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(catalog.getByRole('button', { name: '主题 科技', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await catalog.getByRole('button', { name: '全部篇幅', exact: true }).click()
  await catalog.getByRole('button', { name: '难度 A2', exact: true }).click()
  await catalog.getByRole('button', { name: '目录 Fixture A', exact: true }).click()
  await expect(page.locator('.daily-english')).toHaveAttribute('data-article-id', 'lib-simple-fixture-a')
  await expect(page.getByRole('button', { name: '显示译文', exact: true })).toHaveCount(0)
  // No AI panel, per-paragraph buttons or chat assistant: reading is just reading, with 点词 help.
  await expect(page.getByRole('region', { name: 'AI 助读' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 翻译全文', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 助手', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a word without a mnemonic only offers writing one, no chat assistant exists, and the settings page explains the allowance', async ({ page }) => {
  await seed(page, importToPersonal(emptyStore(), [{ word: 'qzxwvut', meaning: 'n. 合成测试词', phonetic: '', example: '', definition: '', exchange: '', source: '测试' }], '内置联想').store)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'AI 助手', exact: true })).toHaveCount(0)
  const word = listed(await state(page), 0)
  await holdWord(page, word.word)
  await page.getByRole('button', { name: '助记', exact: true }).click()
  await expect(page.getByRole('button', { name: 'AI 生成联想', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '问 AI 怎么记', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 助手', exact: true })).toHaveCount(0)
  await expect(page.locator('.mnemonic-line')).toHaveText('这条助记还在整理，可以先自己写一句。')
  await expect(page.getByRole('button', { name: '自己写助记' })).toBeVisible()
  await page.locator('ion-modal').getByRole('button', { name: '关闭', exact: true }).click()
  await settings(page, 'AI 服务')
  await expect(page.getByText('使用内置 AI', { exact: true })).toBeVisible()
  await expect(page.getByText('每台设备每天有 60 点额度')).toBeVisible()
})

test('marking a word pops the new dot, 熟词 is struck through before it leaves, and reduced motion keeps all of it still', async ({ page }) => {
  await seed(page, importToPersonal({ ...emptyStore(), goal: 40 }, starterRows.slice(0, 70), '卡片动效').store)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const first = page.locator('.english-entry').first()
  await expect(first.locator('.mark-grid i[data-fresh=true]')).toHaveCount(0)
  await first.locator('.english-line').click()
  await expect(first).toHaveAttribute('data-mark-count', '1')
  const pop = first.locator('.mark-grid i[data-fresh=true]')
  await expect(pop).toHaveCount(1)
  expect(await pop.evaluate(el => getComputedStyle(el).animationName)).toBe('mark-pop')
  await expect(pop).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await first.locator('.english-line').click()
  await expect(first).toHaveAttribute('data-mark-count', '2')
  expect(await first.locator('.mark-grid i[data-filled=true]').last().evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  const target = page.locator('.english-entry').nth(1), id = (await target.getAttribute('data-word-id'))!, word = (await target.locator('.english-word').textContent())!
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2)
  await page.mouse.down(); await page.mouse.move(box.x + box.width - 110, box.y + box.height / 2, { steps: 8 }); await page.mouse.up()
  await page.getByRole('button', { name: `把 ${word} 设为熟词`, exact: true }).click()
  const alert = page.locator('ion-alert:not(.overlay-hidden)')
  await alert.getByRole('button', { name: '设为熟词' }).click()
  const row = page.locator(`.english-entry[data-word-id="${id}"]`)
  const strike = await row.locator('.english-word').evaluate(el => getComputedStyle(el, '::after').animationName).catch(() => 'gone')
  expect(['strike-draw', 'gone']).toContain(strike)
  await expect(row).toHaveCount(0)
})

test('switching tabs lifts the new page into place, and stays still when motion is reduced', async ({ page }) => {
  await seed(page, studied(importToPersonal(emptyStore(), starterRows.slice(0, 20), '页面动效').store))
  await page.goto('/')
  const view = page.locator('.view-transition')
  await expect(view).toHaveAttribute('data-enter', 'tab')
  await nav(page, '统计')
  await expect(view).toHaveAttribute('data-enter', 'tab')
  await expect.poll(() => view.evaluate(el => getComputedStyle(el).animationName)).toBe('screen-tab')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await view.evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  await nav(page, '学习')
  await expect(page.locator('.study-view')).toBeVisible()
  expect(await view.evaluate(el => getComputedStyle(el).animationName)).toBe('none')
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
      paragraphs: [{ words: [{ word: initial.words.find(w => w.id === ids[0])!.word, meaning: '编造的义项' }], english: `Today we remember ${ids.slice(0, -1).map(id => initial.words.find(w => w.id === id)!.word).join(', ')}.`, translation: '合成接口测试短文，非实际 AI 生成。' }],
    } } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  try {
    await nav(page, '当日助记')
    await page.getByRole('button', { name: '选择单词', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '选择单词' })).toBeVisible()
    await page.getByRole('button', { name: '全选', exact: true }).click()
    await expect(page.getByText('20 已选 · 约 5 段', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '生成短文 · 20 词', exact: true }).click()
    await expect.poll(() => !!release).toBe(true)
    expect(requests[0]).toEqual(dayWords.map(word => word.id))
    await nav(page, '学习')
    await page.locator('.english-entry').first().locator('.english-line').click()
    await expect(page.locator('.english-entry').first()).toHaveAttribute('data-mark-count', '1')
    await page.getByRole('button', { name: '后一天', exact: true }).click()
    release!()
    await expect.poll(async () => (await state(page)).stories.length).toBe(1)
    expect((await state(page)).words.find(word => word.id === dayWords[0].id)?.markCount).toBe(1)
    await nav(page, '当日助记')
    await expect(page.locator('.compact-day')).toContainText('第 2 天')
    await expect(page.locator('.story-article')).toHaveCount(0)
    await page.getByRole('button', { name: '短文前一天' }).click()
    await expect(page.locator('.story-article')).toBeVisible()
    await expect(page.getByText('覆盖 19/20 词', { exact: true })).toBeVisible()
    await expect(page.locator('.missing-words')).toContainText(dayWords[19].word)
    await expect(page.getByLabel('本段单词')).toContainText(dayWords[0].word)
    await expect(page.locator('.story-translation')).toHaveCount(0)
    await page.getByRole('button', { name: '显示译文', exact: true }).click()
    await expect(page.locator('.story-translation')).toBeVisible()
    await page.getByRole('button', { name: '朗读短文', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => (window as any).__speech)).at(-1)?.text).toContain('Today we remember')
    await closeToast(page)
    await page.getByRole('button', { name: '查词 Today', exact: true }).first().click()
    await expect(page.getByRole('dialog', { name: '阅读查词' })).toBeVisible()
    await page.getByRole('button', { name: '关闭查词', exact: true }).click()
    await page.screenshot({ path: 'test-results/daily-story-fixture-390.png', animations: 'disabled' })
    await page.getByRole('button', { name: `查看 ${dayWords[0].word}`, exact: true }).click()
    const peek = page.getByRole('dialog', { name: '阅读查词' })
    await expect(peek).toContainText(coreGloss(dayWords[0].meaning))
    await expect(peek.getByRole('button', { name: '在线词典' })).toHaveCount(0)
    await expect(page.locator('.paragraph-words').first()).toContainText(coreGloss(dayWords[0].meaning))
    await peek.getByRole('button', { name: '词条详情', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '单词详情' })).toBeVisible()
    await page.locator('ion-modal').getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '关闭查词', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    await nav(page, '当日助记')
    await page.getByRole('button', { name: '短文前一天' }).click()
    await expect(page.locator('.story-article')).toBeVisible()
    expect(requests).toHaveLength(1)
    const reviewsBeforeCheck = (await state(page)).reviews
    await nav(page, '学习')
    await expect(page.locator('.day-title')).toHaveText('第 2 天')
    await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', initial.books[0].wordIds[20])
    expect((await state(page)).reviews).toEqual(reviewsBeforeCheck)
    await nav(page, '当日助记')
    await page.getByRole('button', { name: '短文前一天' }).click()
    await expect(page.locator('.story-article')).toBeVisible()
    delayed = false; fail = true
    await page.getByRole('button', { name: '重新生成短文', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('测试额度不足')
    expect((await state(page)).stories).toHaveLength(1)
    await page.getByRole('button', { name: `查看 ${dayWords[0].word}`, exact: true }).click()
    await page.getByRole('button', { name: '词条详情', exact: true }).click()
    await page.getByRole('button', { name: '编辑单词', exact: true }).click()
    await page.getByRole('textbox', { name: '释义', exact: true }).fill('已修订的释义')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('button', { name: '关闭查词', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(async () => (await state(page)).stories.length).toBe(0)
    await expect(page.locator('.story-article')).toHaveCount(0)
    expect((await state(page)).words.find(word => word.id === dayWords[0].id)?.markCount).toBe(1)
  } finally { release?.() }
})


test('a CC0 cartoon avatar is saved as a PNG profile picture', async ({ page }) => {
  await seed(page, studied(importToPersonal(emptyStore(), starterRows.slice(0, 20), '头像').store))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await nav(page, '我的')
  await page.getByRole('button', { name: '编辑个人资料' }).click()
  await page.getByRole('button', { name: '选择卡通头像', exact: true }).click()
  const sheet = page.locator('.avatar-picker')
  await expect(sheet.locator('.avatar-choice')).toHaveCount(36)
  await expect(sheet.getByRole('region', { name: 'Lorelei' }).locator('.avatar-choice img').first()).toHaveJSProperty('complete', true)
  await expect(sheet).toContainText('CC0 1.0')
  await page.screenshot({ path: 'test-results/avatar-picker-390.png', animations: 'disabled' })
  await sheet.getByRole('button', { name: '卡通头像 lorelei-1', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.profile-avatar-editor img')).toHaveAttribute('src', /^data:image\/png;base64,/)
  await page.getByRole('button', { name: '保存资料' }).click()
  await expect.poll(async () => (await state(page)).profile.avatar).toMatch(/^data:image\/png;base64,/)
  const avatar = (await state(page)).profile.avatar
  expect(avatar.length).toBeLessThan(200000)
  expect(await page.locator('.profile-summary .profile-avatar img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(256)
})

test('articles the server takes down disappear after the next sync', async ({ page }) => {
  await seed(page, studied(importToPersonal(emptyStore(), starterRows.slice(0, 20), '下架').store))
  let articles = [libraryArticle('lib-simple-fixture-a'), libraryArticle('lib-simple-fixture-b')]
  await page.route(libraryUrl, route => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { version: 1, cursor: 2, more: false, ids: articles.map(a => a.id), articles: route.request().url().includes('since=0') ? articles : [] } }))
  await page.goto('/')
  await nav(page, '选读')
  const tile = page.getByRole('region', { name: '按难度选读' }).locator('.level-tile[data-level="B1"]')
  await expect(tile).toContainText('13 篇')
  articles = [articles[0]]
  await page.getByRole('button', { name: '更新选读库', exact: true }).click()
  await expect(tile).toContainText('12 篇')
})

test('word and Chinese text sizes are set separately and persist', async ({ page }) => {
  await seed(page, studied(importToPersonal(emptyStore(), starterRows.slice(0, 20), '字号').store))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const size = (selector: string) => page.locator(selector).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))
  const word = await size('.english-word')
  await settings(page, '外观')
  const sampleWord = await size('.size-sample .english-word')
  const sampleMeaning = await size('.size-sample .chinese-meaning')
  const sampleOther = await size('.size-sample small')
  await page.getByRole('group', { name: '单词字号' }).getByRole('button', { name: '特大', exact: true }).click()
  await expect.poll(async () => (await state(page)).appearance.wordSize).toBe('xlarge')
  await page.getByRole('group', { name: '中文字号' }).getByRole('button', { name: '小', exact: true }).click()
  await expect.poll(async () => (await state(page)).appearance.meaningSize).toBe('small')
  expect((await state(page)).appearance.size).toBe('standard')
  await expect.poll(() => size('.size-sample .english-word')).toBeGreaterThan(sampleWord * 1.2)
  await expect.poll(() => size('.size-sample .chinese-meaning')).toBeLessThan(sampleMeaning)
  expect(await size('.size-sample small')).toBe(sampleOther)
  await page.reload()
  await nav(page, '学习')
  await expect.poll(() => size('.english-word')).toBeGreaterThan(word * 1.2)
})

test('swiping a word slides the whole card, and 熟词 asks first, then fades the word out until undone', async ({ page }) => {
  await seed(page, importToPersonal({ ...emptyStore(), goal: 40 }, starterRows.slice(0, 70), '滑动').store)
  await page.goto('/')
  const rows = page.locator('.english-entry')
  await expect(rows).toHaveCount(20)
  const target = rows.nth(1), id = (await target.getAttribute('data-word-id'))!, word = (await target.locator('.english-word').textContent())!
  const frame = target.locator('.swipe-layer')
  const before = (await frame.boundingBox())!
  const box = (await target.boundingBox())!
  await expect(page.locator('.boot-splash')).toHaveCount(0)
  const swipe = async () => {
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2)
    await page.mouse.down(); await page.mouse.move(box.x + box.width - 110, box.y + box.height / 2, { steps: 8 }); await page.mouse.up()
  }
  await swipe()
  // The bordered frame itself moves; the words are not the only thing sliding.
  await expect.poll(async () => before.x - (await frame.boundingBox())!.x).toBeGreaterThan(100)
  await page.getByRole('button', { name: `把 ${word} 设为熟词`, exact: true }).click()
  const alert = page.locator('ion-alert:not(.overlay-hidden)')
  await expect(alert).toContainText('设为熟词？')
  await alert.getByRole('button', { name: '取消' }).click()
  await expect(alert).toHaveCount(0)
  await expect(rows).toHaveCount(20)
  expect((await state(page)).words.find(w => w.id === id)?.known).toBe(false)
  if ((await frame.getAttribute('data-swiped')) === null) await swipe()
  await page.getByRole('button', { name: `把 ${word} 设为熟词`, exact: true }).click()
  await alert.getByRole('button', { name: '设为熟词' }).click()
  await expect.poll(async () => (await state(page)).words.find(w => w.id === id)?.known).toBe(true)
  await expect(page.locator(`.english-entry[data-word-id="${id}"]`)).toHaveCount(0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await state(page)).words.find(w => w.id === id)?.known).toBe(false)
  await expect(page.locator(`.english-entry[data-word-id="${id}"]`)).toHaveCount(1)
  // Ticking 以后不再提醒 once makes later 熟词 swipes go straight through (撤销 stays on the toast).
  await page.waitForTimeout(500)
  await swipe()
  await page.getByRole('button', { name: `把 ${word} 设为熟词`, exact: true }).click()
  await alert.getByText('以后不再提醒').click()
  await alert.getByRole('button', { name: '设为熟词' }).click()
  await expect.poll(async () => (await state(page)).words.find(w => w.id === id)?.known).toBe(true)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await state(page)).words.find(w => w.id === id)?.known).toBe(false)
  await page.waitForTimeout(500)
  await swipe()
  await page.getByRole('button', { name: `把 ${word} 设为熟词`, exact: true }).click()
  await expect.poll(async () => (await state(page)).words.find(w => w.id === id)?.known).toBe(true)
  await expect(page.locator('ion-alert:not(.overlay-hidden)')).toHaveCount(0)
})

test('tapping any word shows its meaning, glosses can be prepared inline, and articles are read with the cloud voice', async ({ page }) => {
  await seed(page, studied(importToPersonal(emptyStore(), starterRows.slice(0, 40), '点词').store))
  const sentence = 'The zymurgy article explains a small idea in clear words for every reader.'
  const article = libraryArticle('lib-simple-fixture-a', { cefr: 'A2', paragraphs: [sentence, 'A second paragraph keeps the translation count honest and easy to check.'] })
  await page.route(libraryUrl, route => route.fulfill({ headers: cors, json: { version: 1, cursor: 1, more: false, ids: [article.id], articles: [article] } }))
  await page.route('https://dict.youdao.com/suggest**', route => {
    const word = new URL(route.request().url()).searchParams.get('q')
    route.fulfill({ headers: cors, json: { data: { entries: word === 'zymurgy' ? [{ entry: 'zymurgy', explain: 'n. 酿造学' }] : [] } } })
  })
  // Tapping words never calls the AI: the card is only the dictionary.
  const aiCalls: string[] = []
  await page.route('**/v1/ai/**', route => { aiCalls.push(route.request().url()); return route.abort() })
  const clips: string[] = []
  await page.route('**/v1/tts**', route => {
    clips.push(decodeURIComponent(new URL(route.request().url()).searchParams.get('text') || ''))
    route.fulfill({ headers: { ...cors, 'content-type': 'audio/wav' }, body: silentWav })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await nav(page, '选读')
  const catalog = page.getByRole('region', { name: '文章筛选' })
  await catalog.getByRole('button', { name: /^筛选/ }).click()
  await catalog.getByRole('button', { name: '难度 A2', exact: true }).click()
  await catalog.getByRole('button', { name: '目录 Fixture A', exact: true }).click()
  await expect(page.locator('.daily-english')).toHaveAttribute('data-article-id', 'lib-simple-fixture-a')

  // A word the exam dictionary does not know still gets a meaning, from the online service.
  await page.getByRole('button', { name: '查词 zymurgy', exact: true }).first().click()
  const card = page.getByRole('dialog', { name: '阅读查词' })
  await expect(card.locator('.word-action-meaning')).toHaveText('n. 酿造学')
  await expect(card).toContainText('有道词典')
  await expect(card.getByRole('region', { name: '内置词典' })).toHaveCount(0)
  await card.getByRole('button', { name: '词典', exact: true }).click()
  await expect(card.getByRole('region', { name: '内置词典' })).toContainText('没有这个词')
  await card.getByRole('button', { name: '词典', exact: true }).click()
  await page.screenshot({ path: 'test-results/word-peek-390.png', animations: 'disabled' })
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const box = (await card.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width)
    await page.screenshot({ path: `test-results/word-peek-${width}.png`, animations: 'disabled' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(card.getByRole('button', { name: '翻译本句', exact: true })).toHaveCount(0)
  await expect(card.getByRole('button', { name: '语境释义', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '查词 article', exact: true }).first().click()
  await expect(card.locator('h3')).toHaveText('article')
  await card.getByRole('button', { name: '关闭查词', exact: true }).click()
  await expect(card).toHaveCount(0)

  // A word picked while reading goes to its own 生词本; the book being studied and its day stay exactly as they were.
  const before = await state(page)
  await page.getByRole('button', { name: '查词 reader', exact: true }).first().click()
  await card.getByRole('button', { name: '加入生词本', exact: true }).click()
  await expect(card).toHaveCount(0)
  const after = await state(page)
  expect(after.activeBookId).toBe(before.activeBookId)
  expect(after.books.find(book => book.id === 'personal')).toEqual(before.books.find(book => book.id === 'personal'))
  const vocab = after.books.find(book => book.id === 'vocab')!
  expect(vocab.title).toBe('生词本')
  expect(vocab.wordIds.map(id => after.words.find(word => word.id === id)?.word)).toEqual(['reader'])
  // The toast after collecting jumps straight to the list; it is also one tap away from 我的.
  await page.getByRole('button', { name: '查看', exact: true }).click()
  await expect(page.getByRole('heading', { name: '生词本', exact: true })).toBeVisible()
  await expect(page.locator('.vocab-row')).toHaveCount(1)
  await expect(page.locator('.vocab-row').first()).toContainText('reader')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await nav(page, '设置')
  await page.getByRole('button', { name: '生词本', exact: true }).click()
  await expect(page.locator('.vocab-row')).toHaveCount(1)
  // Flipping through the words never switches the book being studied; 还不熟 only adds a mark.
  await page.getByRole('button', { name: /翻看这 1 个词/ }).click()
  await page.getByRole('button', { name: '看意思', exact: true }).click()
  await page.getByRole('button', { name: '还不熟', exact: true }).click()
  await expect(page.getByText('这一轮看完了')).toBeVisible()
  const drilled = await state(page)
  expect(drilled.activeBookId).toBe(before.activeBookId)
  expect(drilled.books.find(book => book.id === 'personal')).toEqual(before.books.find(book => book.id === 'personal'))
  expect(drilled.words.find(word => word.word === 'reader')!.markCount).toBe(1)
  await page.getByRole('button', { name: '回到列表', exact: true }).click()
  await page.getByRole('button', { name: '移出生词本 reader', exact: true }).click()
  await expect(page.getByRole('heading', { name: '生词本还是空的' })).toBeVisible()
  expect((await state(page)).books.find(book => book.id === 'vocab')!.wordIds).toEqual([])
  expect((await state(page)).words.some(word => word.word === 'reader')).toBe(true)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await nav(page, '选读')
  // The list keeps its filters while the app stays open.
  await catalog.getByRole('button', { name: '目录 Fixture A', exact: true }).click()

  // Meanings are prepared ahead: hard words get a small gloss above them, basic words stay clean.
  await expect(page.locator('.reading-token rt')).toHaveCount(0)
  await page.getByRole('button', { name: '词义标注', exact: true }).click()
  await expect(page.locator('.reading-token[data-glossed] rt').first()).toBeVisible()
  await expect(page.locator('.reading-token[data-glossed]').filter({ hasText: 'zymurgy' }).locator('rt')).toHaveText('酿造学')
  await expect(page.locator('.reading-token[data-glossed]').filter({ hasText: /^article/ })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/word-gloss-390.png', animations: 'disabled' })
  await page.reload()
  await nav(page, '选读')
  await catalog.getByRole('button', { name: /^筛选/ }).click()
  await catalog.getByRole('button', { name: '难度 A2', exact: true }).click()
  await catalog.getByRole('button', { name: '目录 Fixture A', exact: true }).click()
  await expect(page.getByRole('button', { name: '词义标注', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // The speed sits next to the speaker, steps through the speeds, is the same saved setting, and the clip plays at it.
  const speed = page.getByRole('button', { name: '朗读速度', exact: true })
  await expect(speed).toHaveText('0.85x')
  await speed.click(); await expect(speed).toHaveText('1x')
  await speed.click(); await expect(speed).toHaveText('1.15x')
  expect((await state(page)).pronunciation.rate).toBe(1.15)
  const tools = (await page.locator('.reader-tools').boundingBox())!
  const pill = (await speed.boundingBox())!
  expect(pill.x).toBeGreaterThanOrEqual(0); expect(pill.x + pill.width).toBeLessThanOrEqual(tools.x + tools.width + 1)
  await page.screenshot({ path: 'test-results/reading-speed-390.png', animations: 'disabled' })

  // Sentences and articles use the cloud voice, one clip per sentence group, played from local blobs.
  await page.getByRole('button', { name: '朗读英语文章', exact: true }).click()
  await expect.poll(() => clips.length).toBeGreaterThan(0)
  expect(clips[0]).toContain('The zymurgy article explains')
  await expect.poll(() => page.evaluate(() => (window as any).__recordings.at(-1) as string)).toMatch(/^blob:/)
  expect(await page.evaluate(() => (window as any).__recordingRate)).toBeCloseTo(1.15, 2)
  expect(aiCalls).toEqual([])
  expect(await page.evaluate(() => (window as any).__speech)).toEqual([])
})