import { z } from 'zod'

const id = z.string().min(1).max(200)
const date = z.string().datetime()
const mark = z.object({ count: z.number().int().min(0).max(9999), at: date.nullable(), revision: z.number().int().nonnegative() })
const snapshot = z.object({ id, word: z.string().max(100), meaning: z.string().max(2000), schedule: z.string().max(2000) })
export const studyDraftSchema = z.object({
  id, kind: z.enum(['learn', 'review']), bookId: z.string().max(200), title: z.string().max(200),
  day: z.number().int().nonnegative(), createdAt: date, page: z.number().int().nonnegative(),
  groups: z.array(z.array(id).min(1).max(20)).min(1).max(5),
  tokens: z.array(id).min(1).max(5), completed: z.array(z.number().int().nonnegative()).max(5),
  words: z.array(snapshot).min(1).max(100),
  forgotten: z.record(z.object({ before: mark, after: mark })),
}).superRefine((draft, context) => {
  const ids = draft.groups.flat(), members = new Set(ids)
  if (members.size !== ids.length || draft.words.length !== ids.length ||
      new Set(draft.words.map(word => word.id)).size !== ids.length || draft.words.some(word => !members.has(word.id)) ||
      Object.keys(draft.forgotten).some(key => !members.has(key)) || draft.tokens.length !== draft.groups.length ||
      new Set(draft.tokens).size !== draft.tokens.length || draft.page >= draft.groups.length ||
      new Set(draft.completed).size !== draft.completed.length || draft.completed.some(page => page >= draft.groups.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '学习草稿结构不完整' })
  }
})
export type StudyDraft = z.infer<typeof studyDraftSchema>
export type StudyKind = StudyDraft['kind']
export type StudyView = StudyKind | 'auto' | 'practice'

const receiptSchema = z.object({ id, status: z.enum(['saved', 'undone']), at: date })
const undoSchema = z.object({
  id, kind: z.enum(['learn', 'review']), draftId: id, page: z.number().int().nonnegative(),
  reviewIds: z.array(id).max(20),
  changes: z.array(z.object({ id, before: z.string().max(2000), after: z.string().max(2000) })).max(20),
  completions: z.array(z.object({ bookId: id, wordId: id })).max(2000),
})
const practiceSchema = z.object({ bookId: z.string().max(200), day: z.number().int().nonnegative(), page: z.number().int().nonnegative(), forgottenIds: z.array(id).max(100), completedAt: date.nullable() })
export type LearningState = {
  view: StudyView
  method: 'list' | 'context'
  drafts: { learn: StudyDraft | null; review: StudyDraft | null }
  parked: StudyDraft[]
  receipts: z.infer<typeof receiptSchema>[]
  undo: z.infer<typeof undoSchema> | null
  practice: z.infer<typeof practiceSchema> | null
  notice: string
}
export const emptyLearning = (): LearningState => ({ view: 'auto', method: 'list', drafts: { learn: null, review: null }, parked: [], receipts: [], undo: null, practice: null, notice: '' })

// An invalid optional draft must never prevent recovery of valid vocabulary and reviews.
export function restoreLearning(input: unknown, bookIds: Set<string>): LearningState {
  const result = emptyLearning()
  if (input === undefined) return result
  const source = z.object({ view: z.unknown().optional(), method: z.unknown().optional(), drafts: z.unknown().optional(), parked: z.unknown().optional(), receipts: z.unknown().optional(), undo: z.unknown().optional(), practice: z.unknown().optional(), notice: z.string().max(300).optional() }).safeParse(input)
  let damaged = !source.success
  if (source.success) {
    const raw = source.data
    result.view = z.enum(['auto', 'learn', 'review', 'practice']).catch('auto').parse(raw.view)
    result.method = z.enum(['list', 'context']).catch('list').parse(raw.method)
    result.notice = raw.notice || ''
    const drafts = z.object({ learn: z.unknown().optional(), review: z.unknown().optional() }).safeParse(raw.drafts)
    if (drafts.success) for (const kind of ['learn', 'review'] as const) {
      const value = drafts.data[kind]
      if (value == null) continue
      const parsed = studyDraftSchema.safeParse(value)
      if (parsed.success && parsed.data.kind === kind && (kind === 'review' || bookIds.has(parsed.data.bookId))) result.drafts[kind] = parsed.data
      else damaged = true
    }
    else if (raw.drafts !== undefined) damaged = true
    const parked = z.array(z.unknown()).max(200).safeParse(raw.parked ?? [])
    if (parked.success) for (const value of parked.data) {
      const parsed = studyDraftSchema.safeParse(value)
      if (parsed.success && parsed.data.kind === 'learn' && bookIds.has(parsed.data.bookId) &&
          ![result.drafts.learn, ...result.parked].some(item => item && (item.id === parsed.data.id || (item.bookId === parsed.data.bookId && item.day === parsed.data.day)))) result.parked.push(parsed.data)
      else damaged = true
    }
    else damaged = true
    const receipts = z.array(receiptSchema).max(2000).safeParse(raw.receipts ?? [])
    if (receipts.success && new Set(receipts.data.map(item => item.id)).size === receipts.data.length) result.receipts = receipts.data
    else damaged = true
    if (raw.undo != null) {
      const undo = undoSchema.safeParse(raw.undo)
      if (undo.success && [result.drafts[undo.data.kind], ...result.parked].some(item => item?.id === undo.data.draftId) && result.receipts.some(item => item.id === undo.data.id && item.status === 'saved')) result.undo = undo.data
      else damaged = true
    }
    if (raw.practice != null) {
      const practice = practiceSchema.safeParse(raw.practice)
      if (practice.success && bookIds.has(practice.data.bookId)) result.practice = practice.data
      else damaged = true
    }
  }
  if (damaged) result.notice = '部分学习草稿无法恢复，已保留有效词库和学习记录。请重新开始受影响的任务。'
  return result
}
