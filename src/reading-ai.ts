import { z } from 'zod'
import { cloudBase } from './cloud'
import { lessonSchema, storyContentSchema } from './model'

/** 内置 AI for reading: served by the Wordflow cloud with its own key, so it works without any setup. */
export type ReadingAIMode = 'translate' | 'summary' | 'vocabulary' | 'explain' | 'ask'
export type ReadingAIRequest = { mode: ReadingAIMode; title: string; paragraphs: string[]; focus?: string; question?: string }
const resultSchema = z.object({
  answer: z.string().max(6000).default(''),
  items: z.array(z.object({ word: z.string().max(100), meaning: z.string().max(300), example: z.string().max(300).optional() })).max(12).default([]),
  paragraphs: z.array(z.string().max(6000)).max(30).optional(),
  model: z.string().max(100).optional(),
})
export type ReadingAIResult = z.infer<typeof resultSchema>

async function postBuiltIn(body: unknown, fetcher: typeof fetch): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(`${cloudBase}/v1/ai/reading`, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(170000),
    })
  } catch (error) {
    throw new Error((error as Error).name === 'TimeoutError' ? 'AI 响应超时，请稍后重试' : '连不上内置 AI，请检查网络')
  }
  const data = await response.json().catch(() => null) as { error?: unknown } | null
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `内置 AI 暂时不可用 (${response.status})`)
  return data
}

export type BuiltInWord = { id: string; word: string; meaning: string }
const storyResult = z.object({ story: storyContentSchema, model: z.string().max(100).optional() })
const lessonsResult = z.object({ lessons: z.array(lessonSchema).max(8), model: z.string().max(100).optional() })

/** A short story that uses the given words (the same shape the user's own AI key returns). */
export async function builtInStory(words: BuiltInWord[], fetcher: typeof fetch = fetch) {
  const parsed = storyResult.safeParse(await postBuiltIn({ mode: 'story', words }, fetcher))
  if (!parsed.success) throw new Error('AI 返回的内容不完整，请重试')
  return { story: parsed.data.story, model: parsed.data.model || '内置 AI' }
}
export async function builtInLessons(words: BuiltInWord[], fetcher: typeof fetch = fetch) {
  const parsed = lessonsResult.safeParse(await postBuiltIn({ mode: 'lessons', words }, fetcher))
  if (!parsed.success || parsed.data.lessons.length !== words.length) throw new Error('AI 返回的内容不完整，请重试')
  return { lessons: parsed.data.lessons, model: parsed.data.model || '内置 AI' }
}

export async function askReadingAI(request: ReadingAIRequest, fetcher: typeof fetch = fetch): Promise<ReadingAIResult> {
  const parsed = resultSchema.safeParse(await postBuiltIn(request, fetcher))
  if (!parsed.success) throw new Error('AI 返回的内容不完整，请重试')
  if (request.mode === 'translate' && parsed.data.paragraphs?.length !== request.paragraphs.length) throw new Error('AI 译文段落对不上，请重试')
  return parsed.data
}

const translationKey = (id: string) => `wordflow.reading.ai-translation.${id}.v1`
/** AI translations are kept per article (and checked against its paragraph count) so reopening is instant and offline. */
export function cachedAITranslation(id: string, count: number): string[] | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(translationKey(id)) || 'null')
    return Array.isArray(value) && value.length === count && value.every(item => typeof item === 'string') ? value : undefined
  } catch { return undefined }
}
export function saveAITranslation(id: string, paragraphs: string[]) {
  try { localStorage.setItem(translationKey(id), JSON.stringify(paragraphs)) } catch { /* Not cached; it can be requested again. */ }
}
