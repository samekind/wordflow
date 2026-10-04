import assert from 'node:assert/strict'
import test from 'node:test'
import { builtInStory } from '../src/ai'

const words = [{ id: 'a', word: 'hello', meaning: '你好' }]
const reply = () => new Response(JSON.stringify({ story: { title: 'Hi', paragraphs: [{ english: 'Hello.', translation: '你好' }] }, model: 'fixture' }), { status: 200, headers: { 'Content-Type': 'application/json' } })

test('a request that never reached the server is sent again, a slow or timed-out one is not', async () => {
  let calls = 0
  const flaky = (async () => { calls++; if (calls < 3) throw new TypeError('Failed to fetch'); return reply() }) as typeof fetch
  assert.equal((await builtInStory(words, flaky)).story.title, 'Hi')
  assert.equal(calls, 3)

  calls = 0
  const down = (async () => { calls++; throw new TypeError('Failed to fetch') }) as typeof fetch
  await assert.rejects(builtInStory(words, down), /连不上内置 AI/)
  assert.equal(calls, 3)

  calls = 0
  const slow = (async () => { calls++; throw new DOMException('timeout', 'TimeoutError') }) as typeof fetch
  await assert.rejects(builtInStory(words, slow), /响应超时/)
  assert.equal(calls, 1)
})
