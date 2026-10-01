import { bookDays, dayKey, hydrate, markWord, reviewWord, wordsForDay, type Store, type Word } from './model'
import { studyDraftSchema, type StudyDraft, type StudyKind, type StudyView } from './study-state'

export type StudyAction =
  | { type: 'forget'; wordId: string }
  | { type: 'cancel'; wordId: string }
  | { type: 'page'; page: number }
  | { type: 'submit'; token: string }
  | { type: 'refresh' }
  | { type: 'method'; method: 'list' | 'context' }
  | { type: 'self-test' }
  | { type: 'preview' }

export const hasLearned = (word: Word) => !!word.learned || word.card.reps > 0
export const draftComplete = (draft: StudyDraft) => draft.completed.length === draft.groups.length
export function reviewQueue(store: Store, now = new Date()) {
  return store.words.filter(word => !word.known && hasLearned(word) && +new Date(word.card.due) <= +now)
    .sort((a, b) => +new Date(a.card.due) - +new Date(b.card.due) || a.id.localeCompare(b.id))
}
export function newWords(store: Store) {
  const book = store.books.find(item => item.id === store.activeBookId)
  return book ? wordsForDay(store, book).filter(word => !word.known && !hasLearned(word)) : []
}
export function studyView(store: Store, now = new Date()): Exclude<StudyView, 'auto'> {
  if (store.learning.view !== 'auto') return store.learning.view
  const pending = [store.learning.drafts.learn, store.learning.drafts.review].filter((draft): draft is StudyDraft => !!draft && !draftComplete(draft))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return pending[0]?.kind || (reviewQueue(store, now).length ? 'review' : 'learn')
}

// Only scheduling fields participate in conflicts and undo. Later marks/edits remain intact.
export function scheduleSnapshot(word: Word) {
  const card = hydrate(word).card
  return JSON.stringify({ card: { due: card.due.toISOString(), stability: card.stability, difficulty: card.difficulty,
    elapsed_days: card.elapsed_days, scheduled_days: card.scheduled_days, reps: card.reps, lapses: card.lapses,
    state: card.state, learning_steps: card.learning_steps, last_review: card.last_review?.toISOString() }, failures: word.failures, memoryStage: word.memoryStage,
    learned: !!word.learned, firstLearnedAt: word.firstLearnedAt ?? null })
}
function snapshot(word: Word) { return { id: word.id, word: word.word, meaning: word.meaning, schedule: scheduleSnapshot(word) } }
function markSnapshot(word: Word) { return { count: word.markCount, at: word.markedAt, revision: word.markRevision || 0 } }

export function createStudyDraft(store: Store, kind: StudyKind, now = new Date()): StudyDraft | null {
  const book = store.books.find(item => item.id === store.activeBookId)
  const words = (kind === 'review' ? reviewQueue(store, now) : newWords(store)).slice(0, 100)
  if (!words.length) return null
  const groups = Array.from({ length: Math.ceil(words.length / 20) }, (_, index) => words.slice(index * 20, index * 20 + 20).map(word => word.id))
  return {
    id: crypto.randomUUID(), kind, bookId: kind === 'learn' ? book!.id : '', title: kind === 'learn' ? book!.title : '全部词书',
    day: kind === 'learn' ? book!.currentDay : 0, createdAt: now.toISOString(), page: 0,
    groups, tokens: groups.map(() => crypto.randomUUID()), completed: [], words: words.map(snapshot), forgotten: {},
  }
}
export function currentStudyDraft(store: Store, kind: StudyKind, now = new Date()): StudyDraft | null {
  const saved = store.learning.drafts[kind]
  const book = store.books.find(item => item.id === store.activeBookId)
  if (saved && (kind === 'review' || (saved.bookId === book?.id && saved.day === book.currentDay))) return saved
  if (kind === 'learn') {
    const parked = store.learning.parked.find(draft => draft.bookId === book?.id && draft.day === book.currentDay)
    if (parked) return parked
  }
  return createStudyDraft(store, kind, now)
}
export function selectStudyUnit(store: Store, bookId: string, day: number): Store {
  const book = store.books.find(item => item.id === bookId)
  if (!book || !Number.isInteger(day) || day < 0 || day >= Math.max(1, bookDays(book).length)) throw new Error('这个学习单元不存在')
  const active = store.learning.drafts.learn
  const matching = active?.bookId === bookId && active.day === day ? active : store.learning.parked.find(draft => draft.bookId === bookId && draft.day === day) || null
  const parked = store.learning.parked.filter(draft => draft.id !== matching?.id && draft.id !== active?.id && (!draftComplete(draft) || draft.id === store.learning.undo?.draftId))
  if (active && active.id !== matching?.id && (!draftComplete(active) || active.id === store.learning.undo?.draftId)) parked.push(active)
  if (parked.length > 200) throw new Error('未完成单元较多，请先完成已有任务后再开始新单元')
  return { ...store, activeBookId: bookId, books: store.books.map(item => item.id === bookId ? { ...item, currentDay: day } : item),
    learning: { ...store.learning, view: store.learning.view === 'practice' ? 'practice' : 'learn', parked, drafts: { ...store.learning.drafts, learn: matching } } }
}
export function studyGroupWords(store: Store, draft: StudyDraft): Word[] {
  const byId = new Map(store.words.map(word => [word.id, word]))
  return draft.groups[draft.page].map(id => byId.get(id)).filter((word): word is Word => !!word)
}
export const contextStoryKey = (draft: Pick<StudyDraft, 'id' | 'page'>) => `context:${draft.id}:${draft.page}`
function putDraft(store: Store, draft: StudyDraft): Store {
  const undo = store.learning.undo?.kind === draft.kind && store.learning.undo.draftId !== draft.id ? null : store.learning.undo
  return { ...store, learning: { ...store.learning, undo, view: draft.kind, drafts: { ...store.learning.drafts, [draft.kind]: draft } } }
}
export function startNewStudy(store: Store, kind: StudyKind, now = new Date()): Store {
  const draft = createStudyDraft(store, kind, now)
  return { ...store, learning: { ...store.learning, view: kind, undo: null, drafts: { ...store.learning.drafts, [kind]: draft } } }
}
function restoreDraftMark(store: Store, draft: StudyDraft, wordId: string): Store {
  const mark = draft.forgotten[wordId], word = store.words.find(item => item.id === wordId)
  if (!mark || !word || (word.markRevision || 0) !== mark.after.revision || word.markCount !== mark.after.count || word.markedAt !== mark.after.at) return store
  return { ...store, words: store.words.map(item => item.id === wordId ? { ...item, markCount: mark.before.count, markedAt: mark.before.at, markRevision: (item.markRevision || 0) + 1 } : item) }
}
export function studyWordStatus(store: Store, draft: StudyDraft, wordId: string, now = new Date()): string {
  const word = store.words.find(item => item.id === wordId), old = draft.words.find(item => item.id === wordId)
  if (!word) return '已删除，提交时跳过'
  if (word.known) return '熟词，提交时跳过'
  if (old && (old.word !== word.word || old.meaning !== word.meaning || old.schedule !== scheduleSnapshot(word))) return '内容或计划有变化，请重新检查本组'
  if (draft.kind === 'learn' && hasLearned(word)) return '已经学过，提交时跳过'
  if (draft.kind === 'review' && +new Date(word.card.due) > +now) return '尚未到期，提交时跳过'
  return ''
}

export function applyStudyAction(store: Store, proposed: StudyDraft, action: StudyAction, now = new Date()): Store {
  if (action.type === 'submit' && store.learning.receipts.some(receipt => receipt.id === action.token)) return store
  if (proposed.kind === 'learn') {
    const book = store.books.find(item => item.id === store.activeBookId)
    if (proposed.bookId !== book?.id || proposed.day !== book.currentDay) throw new Error('学习单元已切换，请回到原单元继续')
    const active = store.learning.drafts.learn
    if ((active && (active.bookId !== book.id || active.day !== book.currentDay)) || store.learning.parked.some(draft => draft.bookId === book.id && draft.day === book.currentDay)) store = selectStudyUnit(store, book.id, book.currentDay)
  }
  const existing = store.learning.drafts[proposed.kind]
  if (existing && existing.id !== proposed.id && !draftComplete(existing)) throw new Error('另有未完成的学习草稿，请继续或结束原任务。')
  let draft = existing?.id === proposed.id ? existing : studyDraftSchema.parse(proposed)
  let next = putDraft(store, draft)
  const ids = draft.groups[draft.page]
  if (action.type === 'method' || action.type === 'self-test' || action.type === 'preview') return { ...next,
    studyLayout: action.type === 'self-test' ? 'test' : action.type === 'preview' ? 'preview' : next.studyLayout,
    learning: { ...next.learning, method: action.type === 'method' ? action.method : 'list' } }
  if (action.type === 'page') return putDraft(next, { ...draft, page: Math.max(0, Math.min(draft.groups.length - 1, action.page)) })
  if (action.type === 'submit' && action.token !== draft.tokens[draft.page]) throw new Error('这组记录已改变，请使用当前页面重新提交。')
  if (draft.completed.includes(draft.page)) return store
  if (action.type === 'forget' || action.type === 'cancel') {
    if (!ids.includes(action.wordId)) throw new Error('该单词不在当前学习组中。')
    const word = next.words.find(item => item.id === action.wordId)
    if (!word || word.known) return store
    const forgotten = { ...draft.forgotten }
    if (action.type === 'forget') {
      if (forgotten[word.id]) return existing ? store : next
      if (studyWordStatus(next, draft, word.id, now)) throw new Error('词条有变化，请重新检查本组。')
      next = markWord(next, word.id, 1, now)
      forgotten[word.id] = { before: markSnapshot(word), after: markSnapshot(next.words.find(item => item.id === word.id)!) }
    } else {
      next = restoreDraftMark(next, draft, word.id)
      delete forgotten[word.id]
    }
    return putDraft(next, { ...draft, forgotten })
  }
  if (action.type === 'refresh') {
    const forgotten = { ...draft.forgotten }
    for (const id of ids) { next = restoreDraftMark(next, draft, id); delete forgotten[id] }
    const byId = new Map(next.words.map(word => [word.id, word]))
    return putDraft(next, { ...draft, forgotten, words: draft.words.map(old => ids.includes(old.id) && byId.has(old.id) ? snapshot(byId.get(old.id)!) : old) })
  }

  const reviewIds: string[] = [], changes: NonNullable<Store['learning']['undo']>['changes'] = []
  const completions: NonNullable<Store['learning']['undo']>['completions'] = []
  for (const id of ids) {
    const word = next.words.find(item => item.id === id)
    if (!word || word.known) continue
    const old = draft.words.find(item => item.id === id)!
    if (old.word !== word.word || old.meaning !== word.meaning || old.schedule !== scheduleSnapshot(word)) throw new Error('词条或复习状态已改变，请重新检查本组后提交。')
    if ((draft.kind === 'learn' && hasLearned(word)) || (draft.kind === 'review' && +new Date(word.card.due) > +now)) continue
    const before = scheduleSnapshot(word), learned = hasLearned(word)
    next = reviewWord(next, id, draft.forgotten[id] ? 1 : 3, now)
    next = { ...next, words: next.words.map(item => item.id === id ? { ...item, learned: true, firstLearnedAt: learned ? item.firstLearnedAt ?? null : now.toISOString() } : item) }
    const review = next.reviews[next.reviews.length - 1]
    next = { ...next, reviews: [...next.reviews.slice(0, -1), { ...review, kind: draft.kind, submissionId: action.token }] }
    reviewIds.push(review.id)
    changes.push({ id, before, after: scheduleSnapshot(next.words.find(item => item.id === id)!) })
    if (draft.kind === 'learn') next = { ...next, books: next.books.map(book => {
      if (book.id !== draft.bookId || !book.wordIds.includes(id) || book.completedWordIds.includes(id)) return book
      completions.push({ bookId: book.id, wordId: id })
      return { ...book, completedWordIds: [...book.completedWordIds, id] }
    }) }
  }
  draft = { ...draft, completed: [...draft.completed, draft.page] }
  next = putDraft(next, draft)
  return { ...next, learning: { ...next.learning,
    receipts: [...next.learning.receipts, { id: action.token, status: 'saved', at: now.toISOString() }].slice(-2000) as Store['learning']['receipts'],
    undo: { id: action.token, kind: draft.kind, draftId: draft.id, page: draft.page, reviewIds, changes, completions },
  } }
}

export function undoStudySubmission(store: Store): Store {
  const undo = store.learning.undo
  if (!undo) return store
  const draft = [store.learning.drafts[undo.kind], ...store.learning.parked].find(item => item?.id === undo.draftId)
  if (!draft || draft.id !== undo.draftId || draft.tokens[undo.page] !== undo.id) throw new Error('学习任务已改变，无法撤销这一组。')
  if (undo.changes.some(change => !store.words.some(word => word.id === change.id && scheduleSnapshot(word) === change.after)) ||
      undo.reviewIds.some(id => !store.reviews.some(review => review.id === id))) throw new Error('后续学习已更新这些单词，本次撤销未执行。')
  const changes = new Map(undo.changes.map(change => [change.id, change]))
  const next: Store = { ...store,
    words: store.words.map(word => {
      const change = changes.get(word.id)
      if (!change) return word
      const before = JSON.parse(change.before) as Pick<Word, 'card' | 'failures' | 'memoryStage' | 'learned' | 'firstLearnedAt'>
      return hydrate({ ...word, card: before.card, failures: before.failures, memoryStage: before.memoryStage, learned: before.learned, firstLearnedAt: before.firstLearnedAt })
    }),
    reviews: store.reviews.filter(review => !undo.reviewIds.includes(review.id)),
    books: store.books.map(book => ({ ...book, completedWordIds: book.completedWordIds.filter(id => !undo.completions.some(item => item.bookId === book.id && item.wordId === id)) })),
    learning: { ...store.learning, undo: null, receipts: store.learning.receipts.map(item => item.id === undo.id ? { ...item, status: 'undone' } : item) },
  }
  const tokens = [...draft.tokens]; tokens[undo.page] = crypto.randomUUID()
  const selected = draft.kind === 'learn' ? selectStudyUnit(next, draft.bookId, draft.day) : next
  return putDraft({ ...selected, learning: { ...selected.learning, method: 'list' } }, { ...draft, tokens, page: undo.page, completed: draft.completed.filter(page => page !== undo.page) })
}
export function learningStatistics(store: Store, now = new Date()) {
  const today = dayKey(now), reviews = store.reviews.filter(review => dayKey(review.at) === today)
  return {
    learned: store.words.filter(hasLearned).length,
    newToday: store.words.filter(word => word.firstLearnedAt && dayKey(word.firstLearnedAt) === today).length,
    reviewedToday: new Set(reviews.filter(review => review.kind === 'review').map(review => review.wordId)).size,
    due: reviewQueue(store, now).length, known: store.words.filter(word => word.known).length,
  }
}
