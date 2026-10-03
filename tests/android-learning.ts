import { _android, type AndroidDevice, type Locator, type Page } from 'playwright'
import { expect as baseExpect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import { emptyStore, importToPersonal, validateStore, type Store } from '../src/model'
import { starterRows } from '../src/vocabulary'
import { contextStoryKey } from '../src/study'

const serial = process.env.WORDFLOW_TEST_SERIAL || 'emulator-5556'
const sdk = process.env.ANDROID_HOME
if (!sdk) throw new Error('Set ANDROID_HOME first')
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const pkg = 'com.wordflow.app'
function command(...args: string[]) { return execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 20 * 1024 * 1024 }).trim() }
function binary(args: string[], input?: Buffer) { return execFileSync(adb, ['-s', serial, ...args], { input, timeout: 60000, maxBuffer: 20 * 1024 * 1024 }) }
if (!serial.startsWith('emulator-') || command('shell', 'getprop', 'ro.boot.qemu.avd_name') !== 'Wordflow_Test_API35') throw new Error('Use only the dedicated Wordflow_Test_API35 emulator')
if (!command('shell', 'pm', 'path', pkg).startsWith('package:')) throw new Error('An existing debug installation is required so its database can be backed up and restored')
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function restore(archive: Buffer) {
  command('shell', 'am', 'force-stop', pkg)
  command('shell', 'run-as', pkg, 'rm', '-f', 'databases/wordflow.db', 'databases/wordflow.db-wal', 'databases/wordflow.db-shm', 'databases/wordflow.db-journal')
  binary(['exec-in', 'run-as', pkg, 'tar', '-xf', '-'], archive)
}
// Raw SQLite backup preserves the original schema while the bridge rejects format downgrades.
// Keep the app stopped during backup and restoration, including WAL files and encrypted settings.
if (process.argv[2] === '--restore') {
  const path = resolve(process.argv[3] || '')
  if (!path.startsWith(resolve('.local') + sep) || !path.endsWith('.tar')) throw new Error('Recovery archive must be a .local/*.tar file')
  restore(readFileSync(path)); console.log('Dedicated emulator database restored'); process.exit(0)
}
mkdirSync('.local', { recursive: true }); mkdirSync('test-results', { recursive: true })
command('shell', 'am', 'force-stop', pkg)
const beforeHash = digest(binary(['exec-out', 'run-as', pkg, 'cat', 'databases/wordflow.db']))
const archive = binary(['exec-out', 'run-as', pkg, 'tar', '-cf', '-', 'databases'])
const backupPath = `.local/native-before-learning-${Date.now()}.tar`
writeFileSync(backupPath, archive)
console.log(`Recovery archive: ${backupPath}`)
const expect = baseExpect.configure({ timeout: 20000 })
let device: AndroidDevice | undefined
let page!: Page
const errors: string[] = []
async function attach() {
  command('shell', 'am', 'start', '-W', '-n', `${pkg}/.MainActivity`)
  device ||= (await _android.devices()).find(item => item.serial() === serial)
  if (!device) throw new Error('Dedicated emulator not available')
  device.setDefaultTimeout(25000)
  await device.wait({ clazz: 'android.webkit.WebView' })
  page = await (await device.webView({ pkg })).page()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByRole('heading', { name: '学习', exact: true })).toBeVisible()
}
async function state(): Promise<{ state: Store; revision: number; apiVersion: number }> {
  return page.evaluate(() => (window as any).Capacitor.Plugins.Wordflow.getState())
}
async function tap(locator: Locator) {
  await locator.scrollIntoViewIfNeeded(); await expect(locator).toBeEnabled()
  const rect = (await locator.boundingBox())!
  const { bounds } = await device!.info({ clazz: 'android.webkit.WebView' })
  const scale = bounds.width / await page.evaluate(() => innerWidth)
  await device!.input.tap({ x: bounds.x + (rect.x + rect.width / 2) * scale, y: bounds.y + (rect.y + rect.height / 2) * scale })
}
try {
  console.log(command('install', '-r', resolve('android/app/build/outputs/apk/debug/app-debug.apk')))
  await attach()
  const original = await state()
  expect(original.apiVersion).toBe(7)
  const fixture = validateStore(importToPersonal({ ...emptyStore(), goal: 40 }, starterRows.slice(0, 81), 'Android 合成学习检查').store)
  await page.evaluate(async ({ next, revision }) => (window as any).Capacitor.Plugins.Wordflow.saveState({ state: next, revision }), { next: fixture, revision: original.revision })
  await page.reload()
  await expect(page.locator('.english-entry')).toHaveCount(20)
  const nav = page.getByRole('navigation', { name: '主导航' })
  await expect(nav.getByRole('tab')).toHaveCount(4)
  for (const [label, slug] of [['词书', 'books'], ['阅读', 'reading'], ['我的', 'profile']]) {
    await tap(nav.getByRole('tab', { name: label, exact: true }))
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
    await expect(page.locator('.view-transition')).toHaveCSS('opacity', '1')
    if (label === '阅读') await expect(page.locator('.source-article')).toBeVisible()
    expect(await page.locator('.content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.waitForTimeout(150)
    writeFileSync(`test-results/android-flow-${slug}.png`, await device!.screenshot())
  }
  await tap(page.getByRole('button', { name: '数据与备份', exact: true }))
  await expect(page.getByRole('heading', { name: '数据与备份', exact: true })).toBeVisible()
  writeFileSync('test-results/android-flow-data.png', await device!.screenshot())
  command('shell', 'input', 'keyevent', '4')
  await expect(page.locator('.profile-summary')).toBeVisible()
  await tap(nav.getByRole('tab', { name: '学习', exact: true }))
  await expect(page.locator('.english-entry')).toHaveCount(20)
  await tap(page.getByRole('button', { name: '看词', exact: true }))
  await expect(page.locator('.card-meaning')).toHaveCount(20)
  await tap(page.getByRole('button', { name: '自测', exact: true }))
  await expect(page.locator('.card-meaning')).toHaveCount(0)
  for (let index = 0; index < 5; index++) {
    await tap(page.locator('.english-line').nth(index))
    await expect(page.locator('.english-entry').nth(index)).toHaveAttribute('data-forgotten', 'true')
  }
  await tap(page.locator('.english-line').first())
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-mark-count', '1')
  await page.getByRole('slider', { name: '词组', exact: true }).focus(); await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await state()).state.learning.drafts.learn?.page).toBe(1)
  // Reconnect the instrumentation and WebView target after process death.
  await device!.close(); device = undefined
  command('shell', 'am', 'force-stop', pkg)
  await attach()
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', fixture.books[0].wordIds[20])
  await tap(page.getByRole('button', { name: '下一单元', exact: true }))
  await expect(page.locator('.day-title')).toHaveText('第 2 单元')
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', fixture.books[0].wordIds[40])
  await tap(page.locator('.english-line').first())
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-forgotten', 'true')
  await tap(page.getByRole('button', { name: '上一单元', exact: true }))
  await expect(page.locator('.english-entry').first()).toHaveAttribute('data-word-id', fixture.books[0].wordIds[20])
  await page.getByRole('button', { name: '上一组', exact: true }).click()
  await expect(page.locator('.english-entry[data-forgotten=true]')).toHaveCount(5)
  expect((await state()).state.reviews).toHaveLength(0)
  await page.screenshot({ path: 'test-results/android-learning-draft.png' })
  writeFileSync('test-results/android-learning-device.png', await device!.screenshot())
  await page.getByRole('button', { name: '读短文', exact: true }).click()
  await expect(page.locator('.context-reader')).toBeVisible()
  const reading = await state(), draft = reading.state.learning.drafts.learn!
  const targets = draft.groups[draft.page].map(id => reading.state.words.find(word => word.id === id)!)
  reading.state.contextStories = [{ id: contextStoryKey(draft), taskId: draft.id, kind: 'learn', group: draft.page, title: 'Learning in Context', paragraphs: [{ english: `A learning journey includes ${targets.map(word => word.word).join(', ')}.`, translation: 'Android 合成检查短文，非实际 AI 生成。' }], targets: targets.map(({ id, word, meaning }) => ({ id, word, meaning })), createdAt: new Date().toISOString(), model: 'fixture' }]
  await page.evaluate(async ({ state, revision }) => (window as any).Capacitor.Plugins.Wordflow.saveState({ state, revision }), reading)
  await page.reload()
  await expect(page.locator('.context-reader .story-article')).toBeVisible()
  await expect(page.locator('.context-reader')).toHaveAttribute('data-task-id', draft.id)
  expect((await state()).state.reviews).toHaveLength(0)
  expect((await state()).state.words.map(word => word.card)).toEqual(reading.state.words.map(word => word.card))
  await page.waitForTimeout(300)
  writeFileSync('test-results/android-context-device.png', await device!.screenshot())
  await tap(page.getByRole('button', { name: '进入本组遮义自测', exact: true }))
  await expect(page.locator('.english-entry[data-forgotten=true]')).toHaveCount(5)
  await expect(page.locator('.chinese-meaning')).toHaveCount(0)
  expect((await state()).state.learning.drafts.learn!.groups[0]).toEqual(draft.groups[0])
  await page.getByRole('button', { name: '本组已检查完', exact: true }).click()
  await expect.poll(async () => (await state()).state.reviews.length).toBe(20)
  const submitted = (await state()).state
  expect(submitted.reviews.filter(item => item.rating === 1)).toHaveLength(5)
  expect(submitted.words.filter(item => item.firstLearnedAt)).toHaveLength(20)
  expect(submitted.learning.receipts).toHaveLength(1)
  await expect(page.getByRole('button', { name: '本组已检查完', exact: true })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '复习计划', exact: true }).click()
  await page.getByRole('group', { name: '本组操作' }).getByRole('button', { name: '撤销上一步', exact: true }).click()
  await expect.poll(async () => (await state()).state.reviews.length).toBe(0)
  expect((await state()).state.learning.receipts[0].status).toBe('undone')
  await page.reload()
  await expect(page.locator('.english-entry[data-forgotten=true]')).toHaveCount(5)
  await page.getByRole('button', { name: '本组已检查完', exact: true }).click()
  await expect.poll(async () => (await state()).state.reviews.length).toBe(20)
  // Old clients cannot silently replace the richer state, even at the correct revision.
  const current = await state()
  const downgradeRejected = await page.evaluate(async ({ revision, state }) => {
    try { await (window as any).Capacitor.Plugins.Wordflow.saveState({ revision, state: { ...state, version: 2 } }); return false }
    catch { return true }
  }, current)
  expect(downgradeRejected).toBe(true)
  expect((await state()).revision).toBe(current.revision)
  await page.getByRole('button', { name: '复习计划', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '复习计划' })).toBeVisible()
  command('shell', 'input', 'keyevent', '4')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
  console.log('PASS: four-page navigation, reading and settings, study stages, native unit switching, context cache and same-group self-test, restart, 5 forgotten / 15 remembered, durable undo, duplicate/downgrade protection and Android back')
} finally {
  await device?.close().catch(() => {})
  restore(archive)
  const afterHash = digest(binary(['exec-out', 'run-as', pkg, 'cat', 'databases/wordflow.db']))
  if (beforeHash !== afterHash) throw new Error(`Database restoration hash differs; archive: ${backupPath}`)
  console.log('Original emulator SQLite restored; SHA-256 matches')
}
// Match the existing native harnesses: reconnecting instrumentation can keep a transport alive.
// Exit only after every assertion and the database restoration have completed successfully.
process.exit(0)
