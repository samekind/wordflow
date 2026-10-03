import { createEmptyCard, fsrs, type Card, type Grade } from 'ts-fsrs'
import Papa from 'papaparse'
import { z } from 'zod'
import { emptyLearning, restoreLearning, type LearningState } from './study-state'

export const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false })
export const memoryIntervals = [
  { minutes: 20, label: '20 分钟' }, { minutes: 1440, label: '1 天' },
  { minutes: 2880, label: '2 天' }, { minutes: 5760, label: '4 天' },
  { minutes: 10080, label: '7 天' }, { minutes: 21600, label: '15 天' },
  { minutes: 43200, label: '30 天' },
] as const
export type Word = {
  id: string; word: string; meaning: string; phonetic: string; example: string;
  addedAt: string; batch: string; card: Card; failures: number;
  markCount: number; markedAt: string | null; known: boolean;
  definition?: string; exchange?: string; source?: string;
  memoryStage?: number;
  learned?: boolean; firstLearnedAt?: string | null; markRevision?: number;
}
/** `forDay` ("bookId:day") marks a review done for that study day's fixed list (按天复习). */
export type Review = { id: string; wordId: string; rating: number; at: string; kind?: 'learn' | 'review'; submissionId?: string; forDay?: string }
/** One per calendar date, written only when the user checks in after finishing the day; stats and streaks read these. */
export type CheckIn = { date: string; bookId: string; day: number; newCount: number; reviewCount: number; at: string }
export type Lesson = { wordId: string; mnemonic: string; example: string; translation: string; question: string; answer: string; explanation: string }
export type WordBook = {
  id: string; title: string; source: string; wordIds: string[];
  dailyCount: number; currentDay: number; completedWordIds: string[];
  planVersion?: 2;
}
export type DailyStory = {
  id: string; bookId: string; day: number; part: number; title: string;
  paragraphs: { english: string; translation: string }[];
  targets: { id: string; word: string; meaning: string }[];
  createdAt: string; model: string;
}
export type ContextStory = Omit<DailyStory, 'bookId' | 'day' | 'part'> & {
  taskId: string; kind: 'learn' | 'review'; group: number;
}
export type Profile = { nickname: string; avatar: string; goal: string }
export type ReadingPreferences = { textSize: 'standard' | 'large'; level: 'auto' | 'easy' | 'standard' }
export type Appearance = {
  theme: 'light' | 'dark'
  font: 'system' | 'serif' | 'gothic' | 'mono'
  weight: 'regular' | 'medium' | 'bold'
  /** Everything except English words and Chinese meanings, which have their own sizes below. */
  size: 'standard' | 'large'
  wordSize?: TextSize
  meaningSize?: TextSize
  /** Per-page overrides; anything unset follows the global font / weight. */
  study?: PageFont
  reading?: PageFont
}
export type TextSize = 'small' | 'standard' | 'large' | 'xlarge'
export type PageFont = { font?: Appearance['font']; weight?: Appearance['weight'] }
/** Attributes that scope a page's own font / weight (see .font-scope in appearance.css). */
export const pageFontAttrs = (page?: PageFont) => ({ 'data-font': page?.font, 'data-weight': page?.weight })
const pageFontSchema = z.object({ font: z.enum(['system', 'serif', 'gothic', 'mono']).optional(), weight: z.enum(['regular', 'medium', 'bold']).optional() })
export const defaultAppearance: Appearance = { theme: 'light', font: 'system', weight: 'regular', size: 'standard' }
export type AIPreferences = { autoStory: boolean }
export type Store = {
  version: 3; words: Word[]; reviews: Review[]; lessons: Lesson[]; goal: number;
  books: WordBook[]; activeBookId: string; stories: DailyStory[];
  contextStories: ContextStory[];
  pronunciation: { accent: 'us' | 'uk'; rate: number };
  studyLayout: 'preview' | 'test'; reviewMethod: 'ebbinghaus' | 'fsrs';
  profile: Profile; readingPreferences: ReadingPreferences; appearance: Appearance; aiPreferences: AIPreferences; readArticleIds: string[];
  learning: LearningState;
  checkins: CheckIn[];
  /** Set once the first-run setup has been completed; stores from before it existed are treated as set up by `needsSetup`. */
  onboarded?: true;
}
export type ImportRow = Pick<Word, 'word' | 'meaning' | 'phonetic' | 'example' | 'definition' | 'exchange' | 'source'>
export const emptyStore = (): Store => ({
  version: 3, words: [], reviews: [], lessons: [], goal: 20,
  books: [], activeBookId: '', stories: [], contextStories: [], pronunciation: { accent: 'us', rate: 0.85 },
  studyLayout: 'test', reviewMethod: 'ebbinghaus',
  profile: { nickname: '学习者', avatar: '', goal: '' },
  learning: emptyLearning(), checkins: [],
  readingPreferences: { textSize: 'standard', level: 'auto' }, appearance: { ...defaultAppearance }, aiPreferences: { autoStory: false }, readArticleIds: [],
})
/** First run: nothing chosen yet. Anyone who already has words or a book skips the welcome setup. */
export const needsSetup = (store: Pick<Store, 'onboarded' | 'books' | 'words'>) => !store.onboarded && !store.books.length && !store.words.length
export function dayKey(date: Date | string = new Date()) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const normalize = (s: string) => s.trim().normalize('NFKC').toLocaleLowerCase()
export const markLevel = (count: number) => Math.max(0, Math.min(6, count))
export function hydrate(word: Word): Word {
  return { ...word, card: { ...word.card, due: new Date(word.card.due), ...(word.card.last_review ? { last_review: new Date(word.card.last_review) } : {}) } }
}
const dateSchema = z.union([z.string(), z.date()]).refine(v => Number.isFinite(new Date(v).getTime()), '无效日期')
const boundedText = z.string().max(5000)
const wordSchema = z.object({
  id: z.string().min(1), word: z.string().trim().min(1).max(100),
  meaning: z.string().trim().min(1).max(2000), phonetic: boundedText, example: boundedText,
    addedAt: dateSchema, batch: boundedText, failures: z.number().int().nonnegative(),
    markCount: z.number().int().min(0).max(9999).default(0),
    markedAt: z.string().datetime().nullable().default(null),
    known: z.boolean().default(false),
    definition: boundedText.optional(), exchange: boundedText.optional(), source: z.string().max(200).optional(),
    memoryStage: z.number().int().min(0).max(memoryIntervals.length).optional(),
    learned: z.boolean().default(false), firstLearnedAt: z.string().datetime().nullable().default(null),
    markRevision: z.number().int().nonnegative().default(0),
  card: z.object({
    due: dateSchema, stability: z.number().nonnegative(), difficulty: z.number().min(0).max(10),
    elapsed_days: z.number().nonnegative(), scheduled_days: z.number().nonnegative(),
    reps: z.number().int().nonnegative(), lapses: z.number().int().nonnegative(),
    state: z.number().int().min(0).max(3), learning_steps: z.number().int().nonnegative(),
    last_review: dateSchema.optional(),
  }),
})
export const lessonSchema = z.object({
  wordId: z.string(), mnemonic: boundedText, example: boundedText, translation: boundedText,
  question: boundedText.default(''), answer: boundedText.default(''), explanation: boundedText.default(''),
})
const bookSchema = z.object({
  id: z.string().min(1).max(200), title: z.string().min(1).max(200), source: z.string().max(300),
  wordIds: z.array(z.string()).max(30000), dailyCount: z.number().int().min(5).max(100),
  planVersion: z.literal(2).optional(),
  currentDay: z.number().int().min(0).max(30000), completedWordIds: z.array(z.string()).max(30000),
})
export const storyContentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  paragraphs: z.array(z.object({
    english: z.string().trim().min(1).max(3000), translation: z.string().trim().min(1).max(3000),
  })).min(1).max(4),
})
const storySchema = storyContentSchema.extend({
  id: z.string().min(1).max(300), bookId: z.string().min(1), day: z.number().int().nonnegative(),
  part: z.number().int().nonnegative(), createdAt: z.string().datetime(), model: z.string().max(100),
  targets: z.array(z.object({ id: z.string(), word: z.string().max(100), meaning: z.string().max(2000) })).min(1).max(40),
})
const contextStorySchema = storyContentSchema.extend({
  id: z.string().min(1).max(300), taskId: z.string().min(1).max(200), kind: z.enum(['learn', 'review']),
  group: z.number().int().min(0).max(4), createdAt: z.string().datetime(), model: z.string().max(100),
  targets: storySchema.shape.targets,
})
type ParsedWord = z.infer<typeof wordSchema>
const reviewSchema = z.object({ id: z.string(), wordId: z.string(), rating: z.number().int().min(1).max(4), at: dateSchema,
  kind: z.enum(['learn', 'review']).optional(), submissionId: z.string().max(200).optional(), forDay: z.string().max(300).optional() })
const checkInSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), bookId: z.string().max(200), day: z.number().int().min(0).max(30000),
  newCount: z.number().int().min(0).max(100000), reviewCount: z.number().int().min(0).max(100000), at: z.string().datetime(),
})
/** Words and reviews that already came out of validateStore. Saving after a small change would otherwise re-parse
 * every word (tens of milliseconds per thousand on a phone) on each tap; unchanged objects keep their identity. */
const checkedWords = new WeakSet<object>(), checkedReviews = new WeakSet<object>()
function parseEach<T extends object>(items: unknown[], schema: z.ZodType<T, z.ZodTypeDef, unknown>, checked: WeakSet<object>, path: string): T[] {
  return items.map((item, index) => {
    if (item && typeof item === 'object' && checked.has(item)) return item as T
    const result = schema.safeParse(item)
    if (!result.success) throw new z.ZodError(result.error.issues.map(issue => ({ ...issue, path: [path, index, ...issue.path] })))
    return result.data
  })
}
export function validateStore(input: unknown): Store {
  const data = z.object({
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]), words: z.array(z.unknown()).max(30000),
    reviews: z.array(z.unknown()).max(500000),
    lessons: z.array(lessonSchema).max(30000), goal: z.number().int().min(1).max(200),
    books: z.array(bookSchema).max(100).optional(), activeBookId: z.string().default(''),
    stories: z.array(storySchema).max(2000).default([]),
    contextStories: z.array(contextStorySchema).max(2000).default([]),
    pronunciation: z.object({ accent: z.enum(['us', 'uk']), rate: z.number().min(0.5).max(1.2) }).default({ accent: 'us', rate: 0.85 }),
    studyLayout: z.enum(['preview', 'test']).default('test'),
    reviewMethod: z.enum(['ebbinghaus', 'fsrs']).default('ebbinghaus'),
    profile: z.object({
      nickname: z.string().trim().min(1).max(24), goal: z.string().trim().max(80),
      avatar: z.string().max(200000).refine(value => !value || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)),
    }).default({ nickname: '学习者', avatar: '', goal: '' }),
    readingPreferences: z.object({
      textSize: z.enum(['standard', 'large']), level: z.enum(['auto', 'easy', 'standard']),
    }).default({ textSize: 'standard', level: 'auto' }),
    appearance: z.object({
      theme: z.enum(['light', 'dark']),
      font: z.enum(['system', 'serif', 'gothic', 'mono']),
      weight: z.enum(['regular', 'medium', 'bold']),
      size: z.enum(['standard', 'large']),
      wordSize: z.enum(['small', 'standard', 'large', 'xlarge']).optional(),
      meaningSize: z.enum(['small', 'standard', 'large', 'xlarge']).optional(),
      study: pageFontSchema.optional(),
      reading: pageFontSchema.optional(),
    }).default(defaultAppearance),
    aiPreferences: z.object({ autoStory: z.boolean() }).default({ autoStory: false }),
    readArticleIds: z.array(z.string().min(1).max(200)).max(2000).default([]),
    onboarded: z.literal(true).optional(),
    learning: z.unknown().optional(),
    checkins: z.array(checkInSchema).max(20000).default([]),
  }).parse(input)
  if (new Set(data.checkins.map(item => item.date)).size !== data.checkins.length) throw new Error('打卡记录重复')
  const parsedWords = parseEach<ParsedWord>(data.words, wordSchema, checkedWords, 'words')
  const parsedReviews = parseEach(data.reviews, reviewSchema, checkedReviews, 'reviews')
  if (new Set(parsedWords.map(w => w.id)).size !== parsedWords.length ||
      new Set(parsedWords.map(w => normalize(w.word))).size !== parsedWords.length) throw new Error('备份含重复单词')
  const ids = new Set(parsedWords.map(w => w.id))
  if (parsedReviews.some(r => !ids.has(r.wordId)) || data.lessons.some(l => !ids.has(l.wordId))) throw new Error('备份记录不完整')
  const books = data.books ?? (parsedWords.length ? [{
    id: 'personal', title: '我的词本', source: '原有词库', wordIds: parsedWords.map(w => w.id),
    dailyCount: Math.min(100, Math.max(20, data.goal)), currentDay: 0, completedWordIds: [],
  }] : [])
  if (new Set(books.map(b => b.id)).size !== books.length || books.some(b => {
    const members = new Set(b.wordIds)
    return members.size !== b.wordIds.length || b.wordIds.some(id => !ids.has(id)) ||
      new Set(b.completedWordIds).size !== b.completedWordIds.length || b.completedWordIds.some(id => !members.has(id))
  })) {
    throw new Error('词书记录不完整或重复')
  }
  if (new Set(data.stories.map(s => s.id)).size !== data.stories.length ||
      data.stories.some(s => !books.some(b => b.id === s.bookId) || s.targets.some(w => !ids.has(w.id)))) {
    throw new Error('短文记录不完整或重复')
  }
  if (new Set(data.contextStories.map(s => s.id)).size !== data.contextStories.length ||
      data.contextStories.some(s => new Set(s.targets.map(w => w.id)).size !== s.targets.length || s.targets.some(w => !ids.has(w.id)))) throw new Error('语境短文记录不完整或重复')
  const activeBookId = books.some(b => b.id === data.activeBookId) ? data.activeBookId : books[0]?.id || ''
  const learnedIds = new Set([...parsedReviews.map(review => review.wordId), ...books.flatMap(book => book.completedWordIds)])
  const learning = restoreLearning(data.learning, new Set(books.map(book => book.id)))
  const selectedBook = books.find(book => book.id === activeBookId), activeDraft = learning.drafts.learn
  // Older clients could leave the unit selector pointing away from its unfinished task.
  // Keep that task in its own unit instead of showing it under another unit's title.
  if (activeDraft && (activeDraft.bookId !== activeBookId || activeDraft.day !== selectedBook?.currentDay)) {
    const selected = learning.parked.find(draft => draft.bookId === activeBookId && draft.day === selectedBook?.currentDay) || null
    learning.parked = [...learning.parked.filter(draft => draft.id !== selected?.id), activeDraft]
    learning.drafts.learn = selected
  }
  const words = parsedWords.map(w => {
    const learned = w.learned || w.card.reps > 0 || learnedIds.has(w.id)
    if (checkedWords.has(w) && w.learned === learned) return w as unknown as Word
    const next = hydrate({ ...w, learned } as Word)
    checkedWords.add(next)
    return next
  })
  for (const review of parsedReviews) checkedReviews.add(review)
  return { ...data, version: 3, books, activeBookId, learning, words, reviews: parsedReviews } as Store
}
export function parseWords(text: string) {
  const clean = text.replace(/^\uFEFF/, '').trim()
  if (!clean) return { rows: [] as ImportRow[], errors: [] as string[] }
  let records: string[][]
  if (/[\t,]/.test(clean.split(/\r?\n/)[0])) {
    const parsed = Papa.parse<string[]>(clean, { skipEmptyLines: 'greedy' })
    if (parsed.errors.length) return { rows: [] as ImportRow[], errors: parsed.errors.map(e => `第 ${(e.row ?? 0) + 1} 行：${e.message}`) }
    records = parsed.data
  } else {
    records = clean.split(/\r?\n/).map(line => line.split(/\s*[|｜]\s*|\s+[—–-]\s+|\s{2,}|\s+(?=[\u3400-\u9fff])/))
  }
  const header = records[0]?.[0]?.trim().toLowerCase()
  if (['word', '单词', '英文'].includes(header)) records.shift()
  const rows: ImportRow[] = [], errors: string[] = []
  records.forEach((record, i) => {
    const [word = '', meaning = '', phonetic = '', ...examples] = record.map(s => s.trim())
    if (!word || !meaning) { errors.push(`第 ${i + 1} 行缺少单词或释义`); return }
    if (word.length > 100 || meaning.length > 2000) { errors.push(`第 ${i + 1} 行内容过长`); return }
    rows.push({ word, meaning, phonetic, example: examples.join(', ') })
  })
  return { rows, errors }
}
export function importWords(store: Store, rows: ImportRow[], batch: string, now = new Date()) {
  const seen = new Set(store.words.map(w => normalize(w.word)))
  const fresh: Word[] = []
  for (const row of rows) {
    const key = normalize(row.word)
    if (seen.has(key)) continue
    seen.add(key)
    fresh.push({ ...row, id: crypto.randomUUID(), addedAt: now.toISOString(), batch, card: createEmptyCard(now), failures: 0, markCount: 0, markedAt: null, known: false, learned: false, firstLearnedAt: null, markRevision: 0 })
  }
  return { store: { ...store, words: [...store.words, ...fresh] }, added: fresh.length, skipped: rows.length - fresh.length }
}
export function mastery(word: Word) {
  if (word.card.reps === 0) return 0
  return Math.min(100, Math.round(100 * (1 - Math.exp(-word.card.stability / 20))))
}
export function dueWords(words: Word[], now = new Date()) {
  return words.filter(w => !w.known && new Date(w.card.due) <= now).sort((a, b) =>
    (a.card.reps === 0 ? 1 : 0) - (b.card.reps === 0 ? 1 : 0) ||
    mastery(a) - mastery(b) || new Date(a.card.due).getTime() - new Date(b.card.due).getTime())
}
export function reviewWord(store: Store, id: string, grade: Grade, now = new Date()): Store {
  const target = store.words.find(w => w.id === id)
  if (!target) return store
  const next = { ...scheduledWord(target, store.reviewMethod, grade, now), learned: true }
  return {
    ...store,
    words: store.words.map(w => w.id === id ? next : w),
    reviews: [...store.reviews, { id: crypto.randomUUID(), wordId: id, rating: grade, at: now.toISOString() }],
  }
}
export function setUserMnemonic(store: Store, wordId: string, fields: { mnemonic: string; example: string; translation: string }): Store {
  const lesson = {
    wordId,
    mnemonic: fields.mnemonic.trim(),
    example: fields.example.trim(),
    translation: fields.translation.trim(),
    question: '', answer: '', explanation: '',
  }
  const lessons = store.lessons.filter(item => item.wordId !== wordId)
  if (!lesson.mnemonic && !lesson.example && !lesson.translation) return { ...store, lessons }
  return { ...store, lessons: [...lessons, lesson] }
}
export function forgottenSinceReview(word: Word) {
  return word.markedAt !== null && new Date(word.markedAt).getTime() > new Date(word.card.last_review || 0).getTime()
}
export function ebbNextLabel(word: Word, forgotten = forgottenSinceReview(word)) {
  if (forgotten) return '5 分钟'
  return memoryIntervals[Math.min(word.memoryStage ?? 0, memoryIntervals.length - 1)].label
}
export const studyPeriods = [
  { id: 'relearn', label: '5 分钟' }, { id: 'm20', label: '20 分钟' }, { id: 'd1', label: '1 天' },
  { id: 'd2', label: '2 天' }, { id: 'd4', label: '4 天' }, { id: 'd7', label: '7 天' },
  { id: 'd15', label: '15 天' }, { id: 'd30', label: '30 天' },
] as const
export type StudyPeriodId = typeof studyPeriods[number]['id'] | 'new' | 'due'
export function waitingPeriod(word: Word, method: Store['reviewMethod']): Exclude<StudyPeriodId, 'new'> | null {
  if (word.known || !word.card.reps) return null
  if (method !== 'ebbinghaus') return 'due'
  const stage = Math.max(0, Math.min(word.memoryStage ?? 0, studyPeriods.length - 1))
  return studyPeriods[stage].id
}
export function isDueReview(word: Word, now = new Date()) {
  return !word.known && word.card.reps > 0 && new Date(word.card.due).getTime() <= now.getTime()
}
export function holdsFinishedIntro(word: Word, now = new Date()) {
  return !word.known && word.card.reps > 0 && (word.memoryStage ?? 0) === 1 && new Date(word.card.due).getTime() > now.getTime()
}
export function dueBuckets(words: Word[], method: Store['reviewMethod'], now = new Date()) {
  const due = words.filter(word => isDueReview(word, now))
  if (!due.length) return [] as { id: string; label: string; words: Word[] }[]
  if (method !== 'ebbinghaus') return [{ id: 'due', label: '到期', words: due }]
  return studyPeriods.map(period => ({
    id: period.id, label: period.label, words: due.filter(word => waitingPeriod(word, method) === period.id),
  })).filter(bucket => bucket.words.length)
}
export function nextPassSummary(words: Word[], method: Store['reviewMethod']) {
  if (!words.length) return ''
  if (method !== 'ebbinghaus') return '按记忆状态'
  const counts = new Map<string, number>()
  for (const word of words) {
    const label = ebbNextLabel(word)
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
  return parts.length === 1 ? parts[0][0] : parts.map(([label, count]) => `${label} ${count}`).join(' · ')
}
function scheduledWord(word: Word, method: Store['reviewMethod'], grade: Grade, now: Date): Word {
  const card = scheduler.next(hydrate(word).card, now, grade).card
  if (method === 'fsrs') return { ...word, card, memoryStage: 0, failures: word.failures + (grade === 1 ? 1 : 0) }
  const stage = Math.min(word.memoryStage ?? 0, memoryIntervals.length - 1)
  const minutes = grade <= 2 ? 5 : memoryIntervals[stage].minutes
  // Keep FSRS card statistics, but use exactly one active due date.
  return { ...word, card: { ...card, due: new Date(now.getTime() + minutes * 60000), scheduled_days: minutes / 1440 },
    memoryStage: grade <= 2 ? 0 : Math.min(stage + 1, memoryIntervals.length),
    failures: word.failures + (grade === 1 ? 1 : 0) }
}
export function weakToday(store: Store, now = new Date()) {
  const latest = new Map<string, Review>()
  store.reviews.filter(r => dayKey(r.at) === dayKey(now)).forEach(r => latest.set(r.wordId, r))
  return store.words.filter(w => !w.known && (latest.get(w.id)?.rating ?? 4) <= 2).sort((a, b) => b.failures - a.failures)
}
export function markWord(store: Store, id: string, delta: 1 | -1, now = new Date()): Store {
  const word = store.words.find(w => w.id === id)
  if (!word) return store
  const markCount = delta > 0 && word.markCount >= 6 ? word.markCount : markLevel(markLevel(word.markCount) + delta)
  if (markCount === word.markCount) return store
  return { ...store,
    words: store.words.map(w => w.id === id ? {
    ...w, markCount, markRevision: (w.markRevision || 0) + 1,
    markedAt: markCount === 0 ? null : delta > 0 ? now.toISOString() : w.markedAt,
  } : w) }
}
export function setKnown(store: Store, id: string, known: boolean): Store {
  const word = store.words.find(w => w.id === id)
  if (!word || word.known === known) return store
  return { ...store,
    words: store.words.map(w => w.id === id ? { ...w, known } : w) }
}
export function bookDays(book: WordBook): string[][] {
  if (!book.wordIds.length) return []
  const days = Array.from({ length: Math.ceil(book.wordIds.length / book.dailyCount) }, (_, i) => book.wordIds.slice(i * book.dailyCount, (i + 1) * book.dailyCount))
  if (book.planVersion !== 2 && days.length > 1 && days[days.length - 1].length < 20) days[days.length - 2].push(...days.pop()!)
  return days
}
export const listReviewOffsets = [1, 2, 4, 7, 15, 30] as const
export type StudyListBlock = { list: number; role: 'recall' | 'new'; ids: string[] }
export function listsForStudyDay(days: string[][], day: number): StudyListBlock[] {
  if (!days.length) return []
  const index = Math.min(Math.max(0, day), days.length - 1)
  const reviews = listReviewOffsets.map(offset => index - offset).filter(list => list >= 0).sort((a, b) => a - b)
  return [...reviews.map(list => ({ list, role: 'recall' as const, ids: days[list] })), { list: index, role: 'new' as const, ids: days[index] }]
}
export function wordsForDay(store: Store, book: WordBook, day = book.currentDay): Word[] {
  const days = bookDays(book)
  const ids = days[Math.min(day, Math.max(0, days.length - 1))] || []
  const map = new Map(store.words.map(w => [w.id, w]))
  return ids.map(id => map.get(id)).filter((w): w is Word => !!w)
}
export function installBook(store: Store, id: string, title: string, source: string, rows: ImportRow[], dailyCount = store.goal): Store {
  if (store.books.some(b => b.id === id)) return { ...store, activeBookId: id }
  const imported = importWords(store, rows, title).store
  const details = new Map(rows.map(row => [normalize(row.word), row]))
  imported.words = imported.words.map(word => {
    const row = details.get(normalize(word.word))
    return row ? { ...word, phonetic: word.phonetic || row.phonetic, definition: word.definition || row.definition, exchange: word.exchange || row.exchange } : word
  })
  const ids = new Map(imported.words.map(w => [normalize(w.word), w.id]))
  const wordIds = [...new Set(rows.map(row => ids.get(normalize(row.word))!))]
  if (!wordIds.length) return store
  return { ...imported, activeBookId: id, books: [...store.books, {
    id, title, source, wordIds, dailyCount: Math.max(5, Math.min(100, Math.round(dailyCount) || 20)), planVersion: 2, currentDay: 0, completedWordIds: [],
  }] }
}
export function importToPersonal(store: Store, rows: ImportRow[], batch: string) {
  const result = importWords(store, rows, batch)
  const ids = new Map(result.store.words.map(w => [normalize(w.word), w.id]))
  const importedIds = rows.map(row => ids.get(normalize(row.word))!)
  const personal = store.books.find(b => b.id === 'personal')
  result.store = {
    ...result.store, activeBookId: 'personal',
    books: personal ? store.books.map(b => b.id === 'personal' ? { ...b, wordIds: [...new Set([...b.wordIds, ...importedIds])] } : b) :
      [...store.books, { id: 'personal', title: '我的词本', source: '个人导入', wordIds: [...new Set(importedIds)], dailyCount: Math.min(100, Math.max(5, store.goal)), planVersion: 2, currentDay: 0, completedWordIds: [] }],
  }
  return result
}
export function completeBookGroup(store: Store, bookId: string, ids: string[], now = new Date(), dueReview = false): Store {
  const next = dueReview ? ids.reduce((current, id) => {
    const word = current.words.find(w => w.id === id)
    if (!word || word.known || !word.card.reps || new Date(word.card.due) > now) return current
    const marked = forgottenSinceReview(word)
    return reviewWord(current, id, marked ? 1 : 3, now)
  }, store) : completeGroup(store, ids, now)
  return { ...next, books: next.books.map(book => book.id === bookId ? {
    ...book, completedWordIds: [...new Set([...book.completedWordIds, ...ids.filter(id => book.wordIds.includes(id))])],
  } : book) }
}
export function storyKey(bookId: string, day: number, part: number) { return `${bookId}:${day}:${part}` }
export function storyIsCurrent(story: Pick<DailyStory, 'targets'>, words: Pick<Word, 'id' | 'word' | 'meaning'>[]) {
  return words.length === story.targets.length && words.every((w, i) =>
    story.targets[i].id === w.id && story.targets[i].word === w.word && story.targets[i].meaning === w.meaning)
}
export function wordPattern(word: string) { return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
export function storyCoverage(story: Pick<DailyStory, 'paragraphs'>, words: Pick<Word, 'id' | 'word'>[]) {
  const text = story.paragraphs.map(p => p.english).join('\n')
  return words.filter(w => new RegExp(`(^|[^a-z])${wordPattern(w.word)}(?=$|[^a-z])`, 'i').test(text)).map(w => w.id)
}
export function studyGroups<T>(words: T[]): T[][] {
  if (!words.length) return []
  const count = Math.max(1, Math.floor(words.length / 20))
  return Array.from({ length: count }, (_, index) => words.slice(index * 20, index === count - 1 ? words.length : (index + 1) * 20))
}
function pendingGroupWords(store: Store, ids: string[], now: Date) {
  const selected = new Set(ids)
  return store.words.filter(w => {
    if (!selected.has(w.id) || w.known) return false
    return !w.card.reps || new Date(w.card.due) <= now || forgottenSinceReview(w)
  })
}
export function groupComplete(store: Store, ids: string[], now = new Date()) {
  return ids.length > 0 && pendingGroupWords(store, ids, now).length === 0
}
export function completeGroup(store: Store, ids: string[], now = new Date()): Store {
  const pending = pendingGroupWords(store, ids, now)
  if (!pending.length) return store
  const changes = new Map<string, Word>()
  const reviews: Review[] = []
  for (const word of pending) {
    const rating: Grade = forgottenSinceReview(word) ? 1 : 3
    changes.set(word.id, { ...scheduledWord(word, store.reviewMethod, rating, now), learned: true })
    reviews.push({ id: crypto.randomUUID(), wordId: word.id, rating, at: now.toISOString() })
  }
  return { ...store, words: store.words.map(w => changes.get(w.id) || w), reviews: [...store.reviews, ...reviews] }
}
export function mnemonicWords(store: Store, now = new Date()) {
  const relevant = new Set([...weakToday(store, now).map(w => w.id), ...store.lessons.map(l => l.wordId)])
  return store.words.filter(w => !w.known && (w.markCount > 0 || relevant.has(w.id)))
    .sort((a, b) => b.markCount - a.markCount || b.failures - a.failures)
}
export function intervalLabel(due: Date | string, now = new Date()) {
  const minutes = Math.max(1, Math.round((new Date(due).getTime() - now.getTime()) / 60000))
  if (minutes < 60) return `${minutes} 分钟`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`
  return `${Math.round(minutes / 1440)} 天`
}
export const demoRows: ImportRow[] = [
  ['serendipity', 'n. 意外发现美好事物的机缘；意外之喜', '/ˌserənˈdɪpəti/', 'Finding that little bookshop was pure serendipity.'],
  ['resilient', 'adj. 有韧性的；能迅速恢复的', '/rɪˈzɪliənt/', 'She remained resilient in the face of change.'],
  ['ephemeral', 'adj. 短暂的；转瞬即逝的', '/ɪˈfemərəl/', 'The beauty of cherry blossoms is ephemeral.'],
  ['deliberate', 'adj. 深思熟虑的；故意的', '/dɪˈlɪbərət/', 'He made a deliberate choice to slow down.'],
  ['embrace', 'v. 拥抱；欣然接受', '/ɪmˈbreɪs/', 'We should embrace new opportunities.'],
  ['subtle', 'adj. 微妙的；不易察觉的', '/ˈsʌtəl/', 'There is a subtle difference between the two.'],
  ['flourish', 'v. 茁壮成长；繁荣', '/ˈflʌrɪʃ/', 'These plants flourish in sunlight.'],
  ['perspective', 'n. 观点；看待问题的角度', '/pərˈspektɪv/', 'Travel can change your perspective.'],
  ['tranquil', 'adj. 安宁的；平静的', '/ˈtræŋkwɪl/', 'We spent a tranquil morning by the lake.'],
  ['curiosity', 'n. 好奇心；求知欲', '/ˌkjʊriˈɑːsəti/', 'Curiosity leads to new discoveries.'],
  ['consistent', 'adj. 始终如一的；持续的', '/kənˈsɪstənt/', 'Consistent practice makes a difference.'],
  ['cherish', 'v. 珍惜；珍爱', '/ˈtʃerɪʃ/', 'Cherish the little moments in life.'],
].map(([word, meaning, phonetic, example]) => ({ word, meaning, phonetic, example }))
