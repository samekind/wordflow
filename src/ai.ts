import { z } from 'zod'
import { cloudBase } from './cloud'
import { storyContentSchema } from './model'

/** The only place the app talks to the built-in AI (served by the Wordflow cloud with its own key).
 * Prompts live on the server. Each device gets a daily allowance, tracked by an anonymous random id kept on this device. */

const deviceKey = 'wordflow.ai.device'
function deviceId() {
  try {
    let id = localStorage.getItem(deviceKey)
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
      localStorage.setItem(deviceKey, id)
    }
    return id
  } catch { return undefined }
}

const retryDelays = [800, 1800]
/** A request that fails within a few seconds never reached the server (a dropped mobile connection, a DNS hiccup),
 * so it is safe to send again, even for a story that costs points. A slow failure may have been charged: no retry. */
async function send(url: string, init: RequestInit, fetcher: typeof fetch) {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now()
    try { return await fetcher(url, init) }
    catch (error) {
      const quick = Date.now() - started < 4000
      if ((error as Error).name === 'TimeoutError' || !quick || attempt >= retryDelays.length) throw error
      await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]))
    }
  }
}

async function post(path: string, body: Record<string, unknown>, fetcher: typeof fetch): Promise<unknown> {
  let response: Response
  try {
    response = await send(`${cloudBase}${path}`, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, device: deviceId() }), signal: AbortSignal.timeout(170000),
    }, fetcher)
  } catch (error) {
    throw new Error((error as Error).name === 'TimeoutError' ? 'AI 响应超时，请稍后重试' : '连不上内置 AI，请检查网络后重试')
  }
  const data = await response.json().catch(() => null) as { error?: unknown } | null
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `内置 AI 暂时不可用 (${response.status})`)
  return data
}

const chatResult = z.object({ reply: z.string().min(1).max(6000), model: z.string().max(100).optional(), remaining: z.number().optional() })
async function ask(body: Record<string, unknown>, fetcher: typeof fetch) {
  const parsed = chatResult.safeParse(await post('/v1/ai/chat', body, fetcher))
  if (!parsed.success) throw new Error('AI 返回的内容不完整，请重试')
  // The bubbles are plain text, so drop the Markdown emphasis and headings models add anyway.
  return parsed.data.reply.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').trim()
}

/** One sentence into Chinese (the word card's 翻译本句). */
export const translateSentence = (sentence: string, fetcher: typeof fetch = fetch) => ask({ task: { type: 'sentence', sentence } }, fetcher)
/** What a word means in this sentence (the word card's 语境释义). */
export const explainWord = (word: string, sentence: string, fetcher: typeof fetch = fetch) => ask({ task: { type: 'word', word, sentence } }, fetcher)

export type BuiltInWord = { id: string; word: string; meaning: string }
const storyResult = z.object({ story: storyContentSchema, model: z.string().max(100).optional() })

/** A short story that uses the given words (the same shape the user's own AI key returns). Costs five units. */
export async function builtInStory(words: BuiltInWord[], fetcher: typeof fetch = fetch) {
  const parsed = storyResult.safeParse(await post('/v1/ai/reading', { mode: 'story', words }, fetcher))
  if (!parsed.success) throw new Error('AI 返回的内容不完整，请重试')
  return { story: parsed.data.story, model: parsed.data.model || '内置 AI' }
}
