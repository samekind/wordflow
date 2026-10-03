import assert from 'node:assert/strict'
import test from 'node:test'
import { translateSentence } from '../src/ai'

const reply = () => new Response(JSON.stringify({ reply: '你好', remaining: 59 }), { status: 200, headers: { 'Content-Type': 'application/json' } })

test('a request that never reached the server is sent again, a slow or timed-out one is not', async () => {
  let calls = 0
  const flaky = (async () => { calls++; if (calls < 3) throw new TypeError('Failed to fetch'); return reply() }) as typeof fetch
  assert.equal(await translateSentence('Hello.', flaky), '你好')
  assert.equal(calls, 3)

  calls = 0
  const down = (async () => { calls++; throw new TypeError('Failed to fetch') }) as typeof fetch
  await assert.rejects(translateSentence('Hello.', down), /连不上内置 AI/)
  assert.equal(calls, 3)

  calls = 0
  const slow = (async () => { calls++; throw new DOMException('timeout', 'TimeoutError') }) as typeof fetch
  await assert.rejects(translateSentence('Hello.', slow), /响应超时/)
  assert.equal(calls, 1)
})
