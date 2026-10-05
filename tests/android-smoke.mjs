import { _android } from 'playwright'
import { expect as baseExpect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const serial = process.env.WORDFLOW_TEST_SERIAL || 'emulator-5556'
const expect = baseExpect.configure({ timeout: 20000 })
const sdk = process.env.ANDROID_HOME
if (!sdk) throw new Error('Set ANDROID_HOME before running the Android smoke test')
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const command = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
if (!serial.startsWith('emulator-') || command('shell', 'getprop', 'ro.boot.qemu.avd_name').trim() !== 'Wordflow_Test_API35') throw new Error('Run only in the dedicated Wordflow_Test_API35 emulator')
let device, page, original
const errors = [], result = {}
const filename = `wordflow-books-${Date.now()}.json`
const nativeState = () => page.evaluate(() => window.Capacitor.Plugins.Wordflow.getState())
const deadline = setTimeout(() => { console.error('Native test timed out; recovery snapshot: .local/native-before-books.json'); process.exit(1) }, 300000)
async function attach() {
  device = (await _android.devices()).find(d => d.serial() === serial)
  if (!device) throw new Error('Dedicated test device is unavailable')
  device.setDefaultTimeout(15000)
  // Driver installation can detach existing WebView targets on this emulator.
  await device.wait({ clazz: 'android.webkit.WebView' })
  page = await (await device.webView({ pkg: 'com.wordflow.app' })).page()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByRole('heading', { name: '今日学习', exact: true })).toBeVisible()
}
async function nativeTap(selector) {
  await device.wait(selector)
  const { bounds } = await device.info(selector)
  await device.input.tap({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
}
async function longPress(locator) {
  await locator.scrollIntoViewIfNeeded()
  await expect(locator).toBeEnabled()
  const rect = await locator.boundingBox()
  const { bounds } = await device.info({ clazz: 'android.webkit.WebView' })
  const scale = bounds.width / await page.evaluate(() => innerWidth)
  const x = String(Math.round(bounds.x + (rect.x + rect.width / 2) * scale))
  const y = String(Math.round(bounds.y + (rect.y + rect.height / 2) * scale))
  command('shell', 'input', 'swipe', x, y, x, y, '650')
  await expect(page.getByRole('dialog', { name: '单词详情' })).toBeVisible()
}
async function closeSheet() {
  await page.locator('ion-modal').getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function navigate(name, section) {
  const tabs = page.getByRole('navigation', { name: '主导航' })
  if (name === '词库') {
    await tabs.getByRole('tab', { name: '学习', exact: true }).click()
    await page.getByRole('button', { name: '选择目标词书', exact: true }).click()
  } else {
    await tabs.getByRole('tab', { name: name === '设置' ? '我的' : name, exact: true }).click()
    if (section) await page.getByRole('button', { name: section, exact: true }).click()
  }
}
try {
  command('shell', 'am', 'start', '-W', '-n', 'com.wordflow.app/.MainActivity')
  await attach()
  original = (await nativeState()).state
  writeFileSync('.local/native-before-books.json', JSON.stringify(original))
  await navigate('词库')
  await page.getByRole('button', { name: '导入词表', exact: true }).click()
  await page.getByRole('button', { name: '导入常用 100 词', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const migrated = (await nativeState()).state
  expect(migrated.words.length).toBeGreaterThanOrEqual(100)
  expect(migrated.books.some(b => b.id === 'personal')).toBe(true)
  expect(migrated.reviews).toEqual(original.reviews)
  for (const word of original.words) {
    const current = migrated.words.find(w => w.id === word.id)
    expect(current.card).toEqual(word.card)
    expect(current.markCount).toBe(word.markCount || 0)
    expect(current.known).toBe(word.known || false)
  }
  result.migrationPreservesHistory = true
  await navigate('词库')
  await page.getByRole('button', { name: '选词书', exact: true }).click()
  await page.locator('.catalog-book').filter({ hasText: '四级词汇' }).click()
  const installStarted = Date.now()
  await page.getByRole('button', { name: '开始学习', exact: true }).click()
  const tutorial = page.locator('.tutorial-overlay')
  if (await tutorial.isVisible().catch(() => false)) await tutorial.getByRole('button', { name: '跳过' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20000 })
  console.log(JSON.stringify({ nativeBookInstallMs: Date.now() - installStarted }))
  await expect(page.locator('.english-entry')).toHaveCount(20)
  expect((await nativeState()).state.books.find(b => b.id === 'ecdict-cet4').wordIds).toHaveLength(3846)
  const reloadStarted = Date.now()
  await page.reload()
  await expect(page.locator('.english-entry')).toHaveCount(20)
  console.log(JSON.stringify({ nativeLargeBookReloadMs: Date.now() - reloadStarted }))
  expect((await nativeState()).state.words.length).toBeGreaterThan(3800)
  result.largeWordbookReadback = true
  await page.getByRole('button', { name: '速览', exact: true }).click()
  await expect(page.locator('.card-meaning')).toHaveCount(20)
  await page.reload()
  await expect(page.getByRole('button', { name: '速览', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect((await nativeState()).state.studyLayout).toBe('preview')
  await device.screenshot({ path: 'outputs/cards-preview-android.png' })
  await page.getByRole('button', { name: '复习计划', exact: true }).click()
  await expect(page.locator('.memory-table tbody tr')).toHaveCount(8)
  await closeSheet()
  await page.getByRole('button', { name: '自测', exact: true }).click()
  await expect(page.locator('.card-meaning')).toHaveCount(0)
  result.cardModesPersist = true
  await navigate('词库')
  await page.locator('.owned-book').filter({ hasText: '我的词本' }).click()
  await page.getByRole('button', { name: '继续学习', exact: true }).click()
  await page.getByRole('button', { name: '选择学习日', exact: true }).click()
  await page.locator('ion-modal .choice-list h3').filter({ hasText: /^Day 1$/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.english-entry')).toHaveCount(20)
  const first = page.locator('.english-entry').first()
  const id = await first.getAttribute('data-word-id')
  const startCount = (await nativeState()).state.words.find(w => w.id === id).markCount
  const countAfter = amount => startCount >= 6 ? startCount : Math.min(6, startCount + amount)
  await expect(page.locator('.meaning-entry').first()).not.toBeInViewport()
  for (const count of [1, 2]) {
    await first.locator('.english-line').click()
    await expect(first).toHaveAttribute('data-mark-count', String(Math.min(6, countAfter(count))))
  }
  await longPress(first.locator('.english-line'))
  await expect(page.getByLabel('标记等级', { exact: true }).locator('.mark-dots')).toHaveAttribute('data-level', String(Math.min(6, countAfter(2))))
  result.nativeLongPressAndCounts = true
  await page.getByRole('switch', { name: '熟词', exact: true }).click()
  await expect.poll(async () => (await nativeState()).state.words.find(w => w.id === id).known).toBe(true)
  await closeSheet()
  await expect(page.locator(`.english-entry[data-word-id="${id}"]`)).toHaveCount(0)
  await page.getByRole('button', { name: '复习计划', exact: true }).click()
  await page.getByRole('group', { name: '本组操作' }).getByRole('button', { name: '撤销上一步', exact: true }).click()
  await expect(page.locator(`.english-entry[data-word-id="${id}"]`)).toHaveCount(1)
  result.knownAndUndo = true
  await page.getByRole('button', { name: '后一天', exact: true }).click()
  await expect(page.locator('.day-title')).toContainText('Day 2')
  const dayTwo = await page.locator('.english-entry').first().getAttribute('data-word-id')
  await navigate('词库')
  await expect(page.getByRole('heading', { name: '目标词书', exact: true })).toBeVisible()
  command('shell', 'input', 'keyevent', '4')
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', dayTwo)
  await expect(page.locator('.day-title')).toContainText('Day 2')
  result.dayPositionAfterBack = true
  await page.getByRole('button', { name: '前一天', exact: true }).click()
  await page.getByRole('button', { name: '完成本组', exact: true }).click()
  await expect(page.getByRole('button', { name: '本组已完成', exact: true })).toBeDisabled()
  const reviewed = (await nativeState()).state.reviews.length
  expect(reviewed).toBeGreaterThan(original.reviews.length)
  const scheduled = (await nativeState()).state.words.find(w => w.id === id)
  expect(scheduled.memoryStage).toBe(0)
  expect(new Date(scheduled.card.due).getTime() - new Date(scheduled.card.last_review).getTime()).toBe(5 * 60000)
  result.fixedMemorySchedule = true
  await device.close()
  command('shell', 'am', 'force-stop', 'com.wordflow.app')
  command('shell', 'am', 'start', '-W', '-n', 'com.wordflow.app/.MainActivity')
  await attach()
  expect((await nativeState()).state.words.find(w => w.id === id).markCount).toBe(countAfter(2))
  await expect(page.getByRole('button', { name: '本组已完成', exact: true })).toBeDisabled()
  result.persistenceAfterRestart = true
  await page.evaluate(async () => {
    const { state, revision } = await window.Capacitor.Plugins.Wordflow.getState()
    const book = state.books.find(b => b.id === state.activeBookId)
    book.currentDay = 0; book.dailyCount = 20
    const words = book.wordIds.slice(0, 20).map(id => state.words.find(w => w.id === id))
    const story = {
      id: `${book.id}:0:0`, bookId: book.id, day: 0, part: 0,
      title: 'Synthetic native test fixture',
      paragraphs: [{ english: `Test vocabulary: ${words.map(w => w.word).join(', ')}.`, translation: '合成原生流程测试样例，未调用 AI。' }],
      targets: words.map(({ id, word, meaning }) => ({ id, word, meaning })), createdAt: new Date().toISOString(), model: 'fixture-no-network',
    }
    state.stories = [...state.stories.filter(s => s.id !== story.id), story]
    await window.Capacitor.Plugins.Wordflow.saveState({ state, revision })
  })
  await page.reload()
  await expect.poll(async () => (await nativeState()).state.stories.some(s => s.title === 'Synthetic native test fixture')).toBe(true)
  result.storyPersistence = true
  await navigate('设置', 'AI 服务')
  await expect(page.getByLabel('AI 模型', { exact: true })).toBeVisible()
  await navigate('设置', '数据与备份')
  await page.getByRole('button', { name: '导出备份', exact: true }).click()
  await device.fill({ clazz: 'android.widget.EditText' }, filename)
  await nativeTap({ text: /^SAVE$/i })
  await expect(page.getByText('备份已保存', { exact: true })).toBeVisible()
  const backup = JSON.parse(command('shell', 'cat', `/sdcard/Download/${filename}`))
  expect(backup.stories.some(s => s.title === 'Synthetic native test fixture')).toBe(true)
  expect(backup.books.length).toBeGreaterThan(0)
  expect(backup.studyLayout).toBe('test')
  expect(backup.reviewMethod).toBe('ebbinghaus')
  await navigate('学习')
  await page.locator(`.english-entry[data-word-id="${id}"] .english-line`).click()
  await expect.poll(async () => (await nativeState()).state.words.find(w => w.id === id).markCount).toBe(countAfter(3))
  await navigate('设置', '数据与备份')
  await page.getByRole('button', { name: '恢复备份', exact: true }).click()
  try { await nativeTap({ text: filename }) }
  catch { await nativeTap({ desc: 'Show roots' }); await nativeTap({ text: 'Downloads' }); await nativeTap({ text: filename }) }
  await page.getByRole('button', { name: '确认恢复', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => (await nativeState()).state.words.find(w => w.id === id).markCount).toBe(countAfter(2))
  expect((await nativeState()).state.stories).toEqual(backup.stories)
  expect((await nativeState()).state.books).toEqual(backup.books)
  result.backupRoundTrip = true
  expect(errors).toEqual([])
} catch (error) {
  console.error(JSON.stringify(await page?.evaluate(() => ({
    visibility: document.visibilityState,
    loading: document.querySelector('.boot-splash')?.textContent,
    content: document.querySelector('.view-transition')?.getAttribute('style'),
    dialogs: [...document.querySelectorAll('ion-modal')].map(node => ({ open: node.isOpen, top: node.getBoundingClientRect().top })),
    animations: document.getAnimations().slice(0, 8).map(animation => ({ state: animation.playState, time: animation.currentTime })),
  })).catch(() => ({}))))
  await device?.screenshot({ path: '.local/android-books-failure.png' }).catch(() => {})
  console.error(JSON.stringify({ completed: result, pageErrors: errors }))
  throw error
} finally {
  clearTimeout(deadline)
  try {
    if (original) {
      if (!page || page.isClosed()) {
        await device?.close().catch(() => {})
        command('shell', 'am', 'force-stop', 'com.wordflow.app')
        command('shell', 'am', 'start', '-W', '-n', 'com.wordflow.app/.MainActivity')
        await attach()
      }
      await page.evaluate(async snapshot => {
        const { revision } = await window.Capacitor.Plugins.Wordflow.getState()
        await window.Capacitor.Plugins.Wordflow.saveState({ state: snapshot, revision })
      }, original)
      await page.reload()
      expect((await nativeState()).state).toEqual(original)
      await device.screenshot({ path: 'outputs/reading-redesign-android.png' })
    }
  } finally { await device?.close() }
}
console.log(JSON.stringify({ result: 'PASS', ...result, originalStateRestored: true }, null, 2))
process.exit(0)
