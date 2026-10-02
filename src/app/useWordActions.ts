import { useEffect, useState } from 'react'
import { modalController } from '@ionic/core'
import { importToPersonal, installBook, setUserMnemonic, type ImportRow, type Store, type Word } from '../model'
import { loadExamFrequency, orderPersonalBook } from '../exam-frequency'
import { loadBookWords, loadCatalog, type CatalogBook } from '../wordbooks'

type Deps = {
  storeRef: { current: Store }
  commit: (next: Store) => Promise<boolean>
  notify: (message: string) => void
  clearUndo: () => void
  /** Called after new words land in the store, to show the study tab. */
  onStudyBook: () => void
}

/** Wordbook catalog, installing books, importing word lists and editing or deleting words. */
export function useWordActions({ storeRef, commit, notify, clearUndo, onStudyBook }: Deps) {
  const [catalog, setCatalog] = useState<CatalogBook[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [bookBusy, setBookBusy] = useState(false)

  async function refreshCatalog() { setCatalogError(''); try { setCatalog(await loadCatalog()) } catch (error) { setCatalogError((error as Error).message) } }
  useEffect(() => { void refreshCatalog() }, [])

  async function withFrequencyOrder(next: Store) {
    try { return orderPersonalBook(next, await loadExamFrequency(), storeRef.current.books.find(book => book.id === 'personal')?.wordIds || []) }
    catch { return next }
  }
  /** `extra` is merged into the same save, so first-run setup lands as one commit. */
  async function installCatalogBook(book: CatalogBook, daily: number, extra: Partial<Store> = {}) {
    if (bookBusy) return false
    setBookBusy(true)
    try {
      const rows = await loadBookWords(book.tag, book.exam)
      if (rows.length !== book.count) throw new Error('词书目录与内容版本不一致，请重新打开应用')
      const source = book.exam ? `${book.source} · 2022–2026卷面考频` : book.source
      const installed = installBook(storeRef.current, book.id, book.title, source, rows, daily)
      if (!await commit({ ...installed, ...extra, learning: { ...installed.learning, view: 'learn' } })) return false
      // Installed either from the 词书 sheet or inline from the first-run plan (no sheet open).
      if (await modalController.getTop()) await modalController.dismiss(undefined, 'saved')
      clearUndo(); onStudyBook(); return true
    } catch (error) { notify((error as Error).message); return false }
    finally { setBookBusy(false) }
  }
  /** Adds rows to 我的词本 (frequency ordered). Resolves true when saved; `stay` keeps the current tab. */
  async function importRows(rows: ImportRow[], title: string, stay = false) {
    const result = importToPersonal(storeRef.current, rows, title)
    if (!await commit(await withFrequencyOrder(result.store))) return false
    clearUndo(); notify(`已加入我的词本 · 新增 ${result.added} 词，复用 ${result.skipped} 词`)
    if (!stay) onStudyBook()
    return true
  }
  async function saveWord(edited: Word) {
    const current = storeRef.current, meaning = edited.meaning.trim()
    const changed = current.words.find(w => w.id === edited.id)?.meaning !== meaning
    if (await commit({ ...current,
      words: current.words.map(w => w.id === edited.id ? { ...w, meaning, phonetic: edited.phonetic.trim(), example: edited.example.trim(), source: changed ? '个人修订' : w.source } : w),
      lessons: changed ? current.lessons.filter(l => l.wordId !== edited.id) : current.lessons,
      stories: changed ? current.stories.filter(s => !s.targets.some(w => w.id === edited.id)) : current.stories,
      contextStories: changed ? current.contextStories.filter(s => !s.targets.some(w => w.id === edited.id)) : current.contextStories,
    })) { await modalController.dismiss(undefined, 'saved'); notify(changed ? '释义已更新，相关旧助记已清除' : '已更新单词') }
  }
  async function deleteWord(id: string) {
    const current = storeRef.current
    if (!await commit({ ...current, words: current.words.filter(w => w.id !== id),
      reviews: current.reviews.filter(r => r.wordId !== id), lessons: current.lessons.filter(l => l.wordId !== id),
      stories: current.stories.filter(s => !s.targets.some(w => w.id === id)),
      contextStories: current.contextStories.filter(s => !s.targets.some(w => w.id === id)),
      books: current.books.map(b => ({ ...b, wordIds: b.wordIds.filter(wordId => wordId !== id), completedWordIds: b.completedWordIds.filter(wordId => wordId !== id) })),
    })) return false
    await modalController.dismiss(undefined, 'saved'); clearUndo(); notify('单词已删除'); return true
  }
  async function saveMnemonic(id: string, fields: Parameters<typeof setUserMnemonic>[2]) {
    const next = setUserMnemonic(storeRef.current, id, fields)
    if (next === storeRef.current) return true
    return commit(next)
  }
  async function restore(candidate: Store) {
    if (!await commit({ ...candidate, onboarded: true })) return false
    await modalController.dismiss(undefined, 'saved'); clearUndo(); notify('备份已恢复'); return true
  }

  return { catalog, catalogError, bookBusy, refreshCatalog, installCatalogBook, importRows, saveWord, deleteWord, saveMnemonic, restore }
}
