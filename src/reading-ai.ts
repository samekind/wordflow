import { z } from 'zod'
import { cloudBase } from './cloud'

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

export async function askReadingAI(request: ReadingAIRequest, fetcher: typeof fetch = fetch): Promise<ReadingAIResult> {
  let response: Response
  try {
    response = await fetcher(`${cloudBase}/v1/ai/reading`, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal: AbortSignal.timeout(100000),
    })
  } catch (error) {
    throw new Error((error as Error).name === 'TimeoutError' ? 'AI 响应超时，请稍后重试' : '连不上内置 AI，请检查网络')
  }
  const data = await response.json().catch(() => null) as { error?: unknown } | null
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `内置 AI 暂时不可用 (${response.status})`)
  const parsed = resultSchema.safeParse(data)
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
