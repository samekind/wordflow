import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { emptyStore, importToPersonal, parseWords } from '../src/model'
import { contextStoryKey, createStudyDraft } from '../src/study'

test('actual AI proxy validates upstream output, propagates errors and never returns keys', { timeout: 30000 }, async () => {
  let mode = 'good'
  let received: Record<string, unknown> | null = null
  const upstream = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    received = body
    assert.equal(req.headers.authorization, 'Bearer fixture-only')
    if (mode === 'quota') { res.writeHead(429); res.end('{}'); return }
    if (mode === 'article') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: '文章讲述了一个坚韧的学习者。', items: [{ word: 'resilient', meaning: '有韧性的', example: 'She remained resilient.' }] }) } }] }))
      return
    }
    const words = JSON.parse(body.messages[1].content)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: mode === 'story' ? JSON.stringify({ title: 'A New Day', paragraphs: [{ english: 'She remained resilient.', translation: '她依然坚韧。' }] }) : mode === 'bad' ? '{"lessons":[]}' : JSON.stringify({
      lessons: words.map((w: { wordId: string; word: string }) => ({ wordId: mode === 'wrong-id' ? 'not-requested' : w.wordId, mnemonic: '联想练习', example: 'She remained resilient.', translation: '她依然坚韧。' })),
    }) } }] }))
  })
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r))
  const upstreamPort = (upstream.address() as { port: number }).port
  const child = spawn(process.execPath, ['server/index.mjs', '--production'], {
    env: { ...process.env, PORT: '0', WORDFLOW_DATA_DIR: `.local/server-qa-${Date.now()}`, AI_BASE_URL: `http://127.0.0.1:${upstreamPort}`, AI_MODEL: 'fixture-model', AI_API_KEY: 'fixture-only' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('server startup timed out')), 15000)
      child.stdout.on('data', data => {
        const match = String(data).match(/http:\/\/localhost:(\d+)/)
        if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}/api/`) }
      })
      child.on('exit', code => { clearTimeout(timeout); reject(new Error(`server exited ${code}`)) })
    })
    const settings = await (await fetch(`${base}settings`)).json()
    assert.equal(settings.configured, true)
    assert.equal(settings.key, undefined)
    const { revision } = await (await fetch(`${base}state`)).json()
    const imported = importToPersonal({ ...emptyStore(), goal: 5 }, parseWords('resilient,有韧性的').rows, 'test').store
    const state = { ...imported, appearance: { theme: 'dark', font: 'serif', weight: 'bold', size: 'large' } as const, aiPreferences: { autoStory: true } }
    const parked = createStudyDraft(state, 'learn')!
    state.learning.parked = [parked]
    state.learning.method = 'context'
    state.contextStories = [{ id: contextStoryKey(parked), taskId: parked.id, kind: 'learn', group: 0, title: 'A resilient day', paragraphs: [{ english: 'She remained resilient.', translation: '合成检查。' }], targets: state.words.map(({ id, word, meaning }) => ({ id, word, meaning })), createdAt: new Date().toISOString(), model: 'fixture-model' }]
    const saved = await fetch(`${base}state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, revision }) })
    assert.equal(saved.status, 200)
    const readback = await (await fetch(`${base}state`)).json()
    assert.equal(readback.apiVersion, 7)
    assert.deepEqual(readback.state.learning, state.learning)
    assert.deepEqual(readback.state.contextStories, state.contextStories)
    const downgrade = await fetch(`${base}state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: { ...state, version: 2 }, revision: readback.revision }) })
    assert.equal(downgrade.status, 409)
    assert.equal(readback.state.books[0].dailyCount, 5)
    assert.equal(readback.state.books[0].planVersion, 2)
    assert.deepEqual(readback.state.profile, state.profile)
    assert.deepEqual(readback.state.readingPreferences, state.readingPreferences)
    assert.deepEqual(readback.state.readArticleIds, [])
    assert.deepEqual(readback.state.appearance, state.appearance)
    assert.deepEqual(readback.state.aiPreferences, state.aiPreferences)
    const request = () => fetch(`${base}reinforce`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [state.words[0].id] }) })
    const success = await request()
    assert.equal(success.status, 200)
    const data = await success.json()
    assert.equal(data.lessons[0].mnemonic, '联想练习')
    assert.equal(data.lessons[0].question, '')
    assert.ok(received)
    assert.ok(!JSON.stringify(received).includes('reviews'))
    assert.ok(!JSON.stringify(received).includes('markCount'))
    mode = 'story'
    const storyRequest = () => fetch(`${base}story`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [state.words[0].id] }) })
    const story = await storyRequest()
    assert.equal(story.status, 200)
    assert.equal((await story.json()).story.title, 'A New Day')
    assert.deepEqual((received as any).messages[1].content, JSON.stringify([{ wordId: state.words[0].id, word: 'resilient', meaning: '有韧性的' }]))
    mode = 'article'
    const assist = await fetch(`${base}article-assist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'vocabulary', title: 'A resilient day', text: 'She remained resilient.' }) })
    assert.equal(assist.status, 200)
    assert.equal((await assist.json()).items[0].word, 'resilient')
    assert.ok(JSON.stringify(received).includes('A resilient day'))
    mode = 'bad'
    assert.equal((await storyRequest()).status, 502)
    mode = 'wrong-id'
    assert.equal((await request()).status, 502)
    mode = 'bad'
    assert.equal((await request()).status, 502)
    mode = 'quota'
    const quota = await request()
    assert.equal(quota.status, 502)
    assert.match((await quota.json()).error, /额度/)
    const disabled = await fetch(`${base}settings`, { method: 'DELETE' })
    assert.equal((await disabled.json()).configured, false)
    assert.equal((await request()).status, 503)
  } finally {
    child.kill()
    await new Promise<void>(r => child.exitCode !== null ? r() : child.once('exit', () => r()))
    await new Promise<void>(r => upstream.close(() => r()))
  }
})
