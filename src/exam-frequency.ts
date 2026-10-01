import { z } from 'zod'
import type { Store } from './model'

export const examChoices = [
  ['cet4', '四级'], ['cet6', '六级'], ['ky1', '考研英语一'], ['ky2', '考研英语二'],
] as const
export type ExamKey = typeof examChoices[number][0]
const wordSchema = z.object({
  word: z.string(), papers: z.number().int().nonnegative(),
  occurrences: z.number().int().nonnegative(), sessions: z.number().int().nonnegative(),
})
const examSchema = z.object({
  title: z.string(), paperCount: z.number().int().positive(),
  sessionCount: z.number().int().positive(), matchedWords: z.number().int().nonnegative(),
  words: z.array(wordSchema).max(30000),
}).superRefine((exam, context) => {
  if (exam.words.some(word => word.papers > exam.paperCount || word.sessions > exam.sessionCount || word.occurrences < word.papers) ||
      new Set(exam.words.map(word => word.word.toLowerCase())).size !== exam.words.length ||
      exam.matchedWords !== exam.words.filter(word => word.papers > 0).length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '考频计数不一致' })
  }
})
const hitSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
export const frequencySchema = z.object({
  version: z.literal(1), fromYear: z.literal(2022), toYear: z.literal(2026),
  generatedAt: z.string(), source: z.literal('https://english-exam.lazynote.cn'),
  exams: z.object({ cet4: examSchema, cet6: examSchema, ky1: examSchema, ky2: examSchema }),
  lexiconCounts: z.record(z.object({
    cet4: hitSchema.optional(), cet6: hitSchema.optional(), ky1: hitSchema.optional(), ky2: hitSchema.optional(),
  })).optional(),
})
export function examFrequencyFor(data: ExamFrequencyData, exam: ExamKey, word: string) {
  const key = word.trim().toLowerCase()
  const counted = data.lexiconCounts?.[key]?.[exam]
  if (counted) return { papers: counted[0], occurrences: counted[1] }
  const listed = data.exams[exam].words.find(item => item.word.toLowerCase() === key)
  return { papers: listed?.papers || 0, occurrences: listed?.occurrences || 0 }
}
export function combinedExamRank(data: ExamFrequencyData, word: string) {
  return examChoices.reduce((total, [exam]) => {
    const hit = examFrequencyFor(data, exam, word)
    return { papers: total.papers + hit.papers, occurrences: total.occurrences + hit.occurrences }
  }, { papers: 0, occurrences: 0 })
}
export function orderPersonalBook(store: Store, data: ExamFrequencyData, preservedIds: string[] = []): Store {
  const labels = new Map(store.words.map(word => [word.id, word.word]))
  let changed = false
  const books = store.books.map(book => {
    if (book.id !== 'personal') return book
    const preserved = preservedIds.filter(id => book.wordIds.includes(id))
    const fixed = new Set(preserved)
    const ordered = book.wordIds.filter(id => !fixed.has(id))
      .map((id, index) => ({ id, index, ...combinedExamRank(data, labels.get(id) || '') }))
      .sort((a, b) => b.papers - a.papers || b.occurrences - a.occurrences || a.index - b.index)
      .map(item => item.id)
    const wordIds = [...preserved, ...ordered]
    if (wordIds.every((id, index) => id === book.wordIds[index])) return book
    changed = true
    return { ...book, wordIds, currentDay: preserved.length ? book.currentDay : 0 }
  })
  return changed ? { ...store, books } : store
}
export type ExamFrequencyData = z.infer<typeof frequencySchema>
let cached: Promise<ExamFrequencyData> | undefined
export function loadExamFrequency(): Promise<ExamFrequencyData> {
  cached ??= fetch('/vocabulary/exam-frequency-2022-2026.json').then(async response => {
    if (!response.ok) throw new Error('考频数据读取失败')
    return frequencySchema.parse(await response.json())
  }).catch(error => { cached = undefined; throw error })
  return cached
}
