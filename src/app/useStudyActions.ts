import { useState } from 'react'
import { bookDays, intervalLabel, markWord, setKnown, type Store, type Word, type WordBook } from '../model'
import { applyStudyAction, selectStudyUnit, startNewStudy, undoStudySubmission, type StudyAction } from '../study'
import type { StudyDraft, StudyKind } from '../study-state'

type CompletionChange = { bookId: string; wordId: string; completed: boolean }
export type UndoAction = { changes: { id: string; patch: Partial<Word> }[]; reviewIds: string[]; completions: CompletionChange[] }
type Deps = {
  storeRef: { current: Store }
  saving: boolean
  commit: (next: Store) => Promise<boolean>
  notify: (message: string, allowUndo?: boolean) => void
  stopSpeech: () => void
  /** Called after a book becomes the study target, to show the study tab. */
  onStudyBook: () => void
}

function completionChanges(before: Store, after: Store, ids: string[]): CompletionChange[] {
  return before.books.flatMap(book => ids.filter(id => book.completedWordIds.includes(id) !== !!after.books.find(b => b.id === book.id)?.completedWordIds.includes(id))
    .map(wordId => ({ bookId: book.id, wordId, completed: book.completedWordIds.includes(wordId) })))
}

/** Study flow, marks, known words and the single-step undo they share. */
export function useStudyActions({ storeRef, saving, commit, notify, stopSpeech, onStudyBook }: Deps) {
  const [undo, setUndo] = useState<UndoAction | null>(null)

  async function changeStudy(draft: StudyDraft, action: StudyAction) {
    if (saving) return false
    try {
      const next = applyStudyAction(storeRef.current, draft, action)
      if (next === storeRef.current) return true
      setUndo(null)
      if (!await commit(next)) return false
      if (action.type === 'submit') {
        const changed = next.learning.undo?.changes || []
        const labels = [...new Set(changed.map(change => intervalLabel(next.words.find(word => word.id === change.id)!.card.due)))]
        notify(changed.length ? `本组已检查完 · ${changed.length} 词${labels.length === 1 ? ` · 下次 ${labels[0]}` : ''}` : '本组已结束，熟词及失效词已跳过', true)
      }
      return true
    } catch (error) { notify((error as Error).message); return false }
  }
  async function restartStudy(kind: StudyKind) {
    setUndo(null)
    return commit(startNewStudy(storeRef.current, kind))
  }
  async function changeMarks(id: string, delta: 1 | -1) {
    const previous = storeRef.current, word = previous.words.find(w => w.id === id)
    if (!word) return false
    const next = markWord(previous, id, delta)
    if (next === previous) {
      notify(delta > 0 ? `${word.word} 已到六级标记；本轮自测结果仍会单独记录` : `${word.word} 还没有标记可减`)
      return false
    }
    setUndo({ changes: [{ id, patch: { markCount: word.markCount, markedAt: word.markedAt, markRevision: (word.markRevision || 0) + 2, known: word.known } }], reviewIds: [], completions: completionChanges(previous, next, [id]) })
    return commit(next)
  }
  async function changeKnown(id: string, known: boolean) {
    const previous = storeRef.current, word = previous.words.find(w => w.id === id)
    if (!word) return false
    const next = setKnown(previous, id, known)
    if (next === previous || !await commit(next)) return false
    setUndo({ changes: [{ id, patch: { known: word.known } }], reviewIds: [], completions: completionChanges(previous, next, [id]) })
    notify(`${word.word} · ${known ? '已移入熟词' : '已放回学习'}`, true); return true
  }
  async function undoLastAction() {
    if (!undo) {
      try { if (await commit(undoStudySubmission(storeRef.current))) notify('已撤销本组，学习草稿已恢复') }
      catch (error) { notify((error as Error).message) }
      return
    }
    const current = storeRef.current
    if (await commit({ ...current,
      words: current.words.map(w => ({ ...w, ...undo.changes.find(change => change.id === w.id)?.patch })),
      reviews: current.reviews.filter(r => !undo.reviewIds.includes(r.id)),
      books: current.books.map(book => {
        const completed = new Set(book.completedWordIds)
        undo.completions.filter(change => change.bookId === book.id && book.wordIds.includes(change.wordId)).forEach(change => change.completed ? completed.add(change.wordId) : completed.delete(change.wordId))
        return { ...book, completedWordIds: [...completed] }
      }),
    })) { setUndo(null); notify('已撤销上一步') }
  }
  async function selectDay(book: WordBook, day: number) {
    if (day < 0 || day >= bookDays(book).length) return
    stopSpeech()
    try { await commit(selectStudyUnit(storeRef.current, book.id, day)) }
    catch (error) { notify((error as Error).message) }
  }
  async function activateBook(id: string) {
    const current = storeRef.current, book = current.books.find(item => item.id === id)
    if (!book) return
    try {
      const next = selectStudyUnit(current, id, book.currentDay)
      if (await commit({ ...next, learning: { ...next.learning, view: 'learn' } })) onStudyBook()
    } catch (error) { notify((error as Error).message) }
  }

  return {
    undo, canUndo: !!undo || !!storeRef.current.learning.undo, clearUndo: () => setUndo(null),
    changeStudy, restartStudy, changeMarks, changeKnown, undoLastAction, selectDay, activateBook,
  }
}
