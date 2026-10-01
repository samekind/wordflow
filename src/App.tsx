import { useEffect, useMemo, useRef, useState } from 'react'
import { App as AndroidApp } from '@capacitor/app'
import { IonAlert, IonLabel, IonTabBar, IonTabButton, IonToast } from '@ionic/react'
import { alertController, modalController } from '@ionic/core'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowDownUp, BookOpen, Check, CheckCheck, ChevronLeft, Download, Eye, EyeOff, LoaderCircle, Plus, Search, Trash2, Upload, Volume2 } from 'lucide-react'
import { DailyIcon, EssayIcon, ProfileIcon, ReadIcon, StudyIcon } from './icons'
import { bookDays, dayKey, emptyStore, importToPersonal, installBook, intervalLabel, markLevel, markWord, normalize, parseWords, setKnown, setUserMnemonic, storyContentSchema, storyIsCurrent, storyKey, validateStore, type ContextStory, type DailyStory, type Store, type Word, type WordBook } from './model'
import StudyList from './StudyList'
import { applyStudyAction, contextStoryKey, currentStudyDraft, selectStudyUnit, startNewStudy, studyGroupWords, studyView, studyWordStatus, undoStudySubmission, type StudyAction } from './study'
import type { StudyDraft, StudyKind } from './study-state'
import { api, isAndroidApp, phone, streamStory, syncSystemAppearance } from './platform'
import Sheet from './components/Sheet'
import WordDetails from './components/WordDetails'
import BookShelf from './components/BookShelf'
import DailyReader from './components/DailyReader'
import SettingsPage, { settingsTitles, type AIConfig, type SettingsSection } from './components/SettingsPage'
import ReadingPage from './components/ReadingPage'
import type { ArticleAssistMode, ArticleAssistResult } from './platform'
import MarkDots from './components/MarkDots'
import { loadExamFrequency, orderPersonalBook } from './exam-frequency'
import { appRelease, createCloudAccount, downloadCloudState, fetchCloudRelease, recoverCloudAccount, uploadCloudState, CloudConflict } from './cloud'
import { coreGloss } from './gloss'
import { loadBookWords, loadCatalog, type CatalogBook } from './wordbooks'
import { starterRows } from './vocabulary'
import { lookupDictionary, safeExternalUrl } from './dictionary'

type Page = 'today' | 'books' | 'story' | 'library' | 'settings'
type CompletionChange = { bookId: string; wordId: string; completed: boolean }
type UndoAction = { changes: { id: string; patch: Partial<Word> }[]; reviewIds: string[]; completions: CompletionChange[] }
const tabs = [{ id: 'today', label: '学习', icon: StudyIcon }, { id: 'books', label: '词书', icon: BookOpen }, { id: 'story', label: '阅读', icon: ReadIcon }, { id: 'settings', label: '我的', icon: ProfileIcon }] as const
function completionChanges(before: Store, after: Store, ids: string[]): CompletionChange[] {
  return before.books.flatMap(book => ids.filter(id => book.completedWordIds.includes(id) !== !!after.books.find(b => b.id === book.id)?.completedWordIds.includes(id))
    .map(wordId => ({ bookId: book.id, wordId, completed: book.completedWordIds.includes(wordId) })))
}
export default function App() {
  const reduced = useReducedMotion()
  const [store, setStore] = useState<Store>(emptyStore)
  const storeRef = useRef(store)
  const revision = useRef(0)
  const saveLock = useRef(false)
  const pendingSave = useRef<Promise<void> | null>(null)
  const aiLock = useRef(false)
  const speechSequence = useRef(0)
  const recording = useRef<HTMLAudioElement | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [savingNow, setSaving] = useState(false)
  const [failedSave, setFailedSave] = useState<{ next: Store; revision: number; error: string } | null>(null)
  const failedSaveRef = useRef<typeof failedSave>(null)
  const saving = savingNow || !!failedSave
  const [page, setPage] = useState<Page>('today')
  const [backPage, setBackPage] = useState<Page>('today')
  const [libraryBackPage, setLibraryBackPage] = useState<Page>('today')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('home')
  const [readingView, setReadingView] = useState<'story' | 'daily'>('daily')
  const [settingsOrigin, setSettingsOrigin] = useState<Page>('settings')
  const [toast, setToast] = useState('')
  const [toastUndo, setToastUndo] = useState(false)
  const [undo, setUndo] = useState<UndoAction | null>(null)
  const [catalog, setCatalog] = useState<CatalogBook[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [bookBusy, setBookBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [rawImport, setRawImport] = useState('')
  const [batch, setBatch] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('weak')
  const [libraryLimit, setLibraryLimit] = useState(300)
  const [hidden, setHidden] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [ai, setAI] = useState<AIConfig>({ provider: 'deepseek', model: 'deepseek-flash', configured: false })
  const [aiBusy, setAIBusy] = useState(false)
  const [storyLive, setStoryLive] = useState('')
  const [contextGeneratingKey, setContextGeneratingKey] = useState('')
  const [aiError, setAIError] = useState('')
  const [detailId, setDetailId] = useState('')
  const [editWord, setEditWord] = useState<Word | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [restoreCandidate, setRestoreCandidate] = useState<Store | null>(null)
  const [licensesOpen, setLicensesOpen] = useState(false)
  const [licenseText, setLicenseText] = useState('')
  const [clock, setClock] = useState(Date.now())
  const fileRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLInputElement>(null)
  const today = dayKey(new Date(clock))
  const detailWord = store.words.find(w => w.id === detailId)
  const parsed = useMemo(() => parseWords(rawImport), [rawImport])
  const uniqueRows = useMemo(() => [...new Map(parsed.rows.map(row => [normalize(row.word), row])).values()], [parsed])
  const previewNew = useMemo(() => { const existing = new Set(store.words.map(w => normalize(w.word))); return uniqueRows.filter(row => !existing.has(normalize(row.word))).length }, [uniqueRows, store.words])
  const libraryWords = useMemo(() => store.words.filter(w => `${w.word} ${w.meaning} ${w.batch}`.toLowerCase().includes(search.trim().toLowerCase()))
    .filter(w => filter === 'all' || (filter === 'marked' && w.markCount > 0 && !w.known) || (filter === 'known' && w.known))
    .sort((a, b) => sort === 'alpha' ? a.word.localeCompare(b.word) : sort === 'recent' ? b.addedAt.localeCompare(a.addedAt) : markLevel(b.markCount) - markLevel(a.markCount) || b.failures - a.failures), [store.words, search, filter, sort])
  useEffect(() => setLibraryLimit(300), [search, filter, sort])
  useEffect(() => {
    const root = document.documentElement
    const look = store.appearance
    root.dataset.theme = look.theme
    root.dataset.font = look.font
    root.dataset.weight = look.weight
    root.dataset.size = look.size
    root.style.colorScheme = look.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', look.theme === 'dark' ? '#1c2431' : '#fafbfc')
  }, [store.appearance])
  useEffect(() => {
    if (ready) void syncSystemAppearance(store.appearance.theme).catch(error => console.warn('无法同步系统栏外观', error))
  }, [ready, store.appearance.theme])

  function notify(message: string, allowUndo = false) { setToastUndo(allowUndo); setToast(message) }
  async function withFrequencyOrder(next: Store) {
    try { return orderPersonalBook(next, await loadExamFrequency(), storeRef.current.books.find(book => book.id === 'personal')?.wordIds || []) }
    catch { return next }
  }
  async function refreshCatalog() { setCatalogError(''); try { setCatalog(await loadCatalog()) } catch (error) { setCatalogError((error as Error).message) } }
  useEffect(() => {
    Promise.all([api('state'), api('settings')]).then(async ([data, settings]) => {
      if (data.apiVersion !== 7) throw new Error('当前服务版本较旧，请打开新版预览地址或更新安卓安装包。原记录未改变。')
      const validated = validateStore(data.state)
      revision.current = data.revision; storeRef.current = validated; setAI(settings)
      setStore(storeRef.current); setReady(true)
    }).catch(error => setLoadError(error.message))
    void refreshCatalog()
    const timer = setInterval(() => setClock(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])
  function stopSpeech() {
    speechSequence.current++; recording.current?.pause(); recording.current = null
    if (isAndroidApp) { void phone.stopSpeech().catch(() => {}); return }
    if ('speechSynthesis' in window) speechSynthesis.cancel()
  }
  function navigate(target: Page, section: SettingsSection = 'home') {
    stopSpeech()
    if (target === 'library' && page !== 'library') setLibraryBackPage(page)
    if (target === 'books' || target === 'library') setBackPage(page === 'books' || page === 'library' ? backPage : page)
    if (target === 'settings') { setSettingsSection(section); setSettingsOrigin(section === 'home' ? 'settings' : page) }
    setPage(target); setAIError(''); document.getElementById('app-scroll')?.scrollTo({ top: 0 })
  }
  function goBack() {
    if (page === 'settings' && settingsSection !== 'home') { stopSpeech(); if (settingsOrigin !== 'settings') navigate(settingsOrigin); else setSettingsSection('home'); return }
    navigate(page === 'library' ? libraryBackPage : page === 'books' ? backPage : 'today')
  }
  useEffect(() => {
    if (!isAndroidApp) return
    const listener = AndroidApp.addListener('backButton', async () => {
      if (saveLock.current) return
      const alert = await alertController.getTop()
      if (alert) { await alert.dismiss(); return }
      const modal = await modalController.getTop()
      if (modal) { await modal.dismiss(); return }
      if (page !== 'today') { goBack(); return }
      stopSpeech(); void AndroidApp.minimizeApp()
    })
    return () => { void listener.then(handle => handle.remove()) }
  }, [page, backPage, libraryBackPage, settingsSection, settingsOrigin])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (saveLock.current || aiLock.current || failedSaveRef.current) event.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => { window.removeEventListener('beforeunload', handler); stopSpeech() }
  }, [])
  async function commit(next: Store, retry = false) {
    if (saveLock.current || (failedSaveRef.current && !retry)) return false
    saveLock.current = true; setSaving(true)
    const baseRevision = retry ? failedSaveRef.current!.revision : revision.current
    let valid: Store
    try { valid = validateStore(next) } catch (error) { saveLock.current = false; setSaving(false); notify((error as Error).message); return false }
    let release!: () => void
    pendingSave.current = new Promise<void>(resolve => { release = resolve })
    function accept(savedRevision: number) {
      revision.current = savedRevision; storeRef.current = valid; setStore(valid); setClock(Date.now())
      failedSaveRef.current = null; setFailedSave(null)
    }
    async function reconcile() {
      const latest = await api('state')
      if (latest.apiVersion !== 7) throw new Error('当前服务版本不支持新版学习草稿，请更新后重试。')
      if (latest.revision > baseRevision && JSON.stringify(validateStore(latest.state)) === JSON.stringify(valid)) { accept(latest.revision); return true }
      if (latest.revision !== baseRevision) throw new Error('其他操作已更新学习记录。当前改动仍在本页，可先导出待保存备份再重新加载。')
      return false
    }
    try {
      if (retry && await reconcile()) return true
      const data = await api('state', { method: 'PUT', body: JSON.stringify({ state: valid, revision: baseRevision }) })
      accept(data.revision); return true
    } catch (error) {
      let message = (error as Error).message
      try { if (await reconcile()) return true } catch (reason) { message = (reason as Error).message }
      const failed = { next: valid, revision: baseRevision, error: message }
      failedSaveRef.current = failed; setFailedSave(failed); setStore(valid)
      return false
    }
    finally { saveLock.current = false; pendingSave.current = null; setSaving(false); release() }
  }
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
    if (!word || saveLock.current) return false
    const next = markWord(previous, id, delta)
    if (next === previous) {
      notify(delta > 0 ? `${word.word} 已到六级标记；本轮自测结果仍会单独记录` : `${word.word} 还没有标记可减`)
      return false
    }
    setUndo({ changes: [{ id, patch: { markCount: word.markCount, markedAt: word.markedAt, markRevision: (word.markRevision || 0) + 2, known: word.known } }], reviewIds: [], completions: completionChanges(previous, next, [id]) })
    if (!await commit(next)) return false
    return true
  }
  async function changeKnown(id: string, known: boolean) {
    const previous = storeRef.current, word = previous.words.find(w => w.id === id)
    if (!word || saveLock.current) return false
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
    const current = storeRef.current
    if (day < 0 || day >= bookDays(book).length) return
    stopSpeech()
    try { await commit(selectStudyUnit(current, book.id, day)) }
    catch (error) { notify((error as Error).message) }
  }
  async function activateBook(id: string) {
    const current = storeRef.current, book = current.books.find(item => item.id === id)
    if (!book) return
    try {
      const next = selectStudyUnit(current, id, book.currentDay)
      if (await commit({ ...next, learning: { ...next.learning, view: 'learn' } })) navigate('today')
    } catch (error) { notify((error as Error).message) }
  }
  async function addCatalogBook(book: CatalogBook, daily: number) {
    if (bookBusy || saveLock.current) return false
    setBookBusy(true)
    try {
      const rows = await loadBookWords(book.tag, book.exam)
      if (rows.length !== book.count) throw new Error('词书目录与内容版本不一致，请重新打开应用')
      const source = book.exam ? `${book.source} · 2022–2026卷面考频` : book.source
      const installed = installBook(storeRef.current, book.id, book.title, source, rows, daily)
      if (!await commit({ ...installed, learning: { ...installed.learning, view: 'learn' } })) return false
      await modalController.dismiss(undefined, 'saved'); setUndo(null); navigate('today'); return true
    } catch (error) { notify((error as Error).message); return false }
    finally { setBookBusy(false) }
  }
  function openWord(id: string) { setDetailId(id); setAIError('') }
  async function editDetail(word: Word) {
    const modal = await modalController.getTop()
    if (modal && await modal.dismiss()) { setEditWord(word); setConfirmDelete(false) }
  }
  async function configureFromDetail() { await modalController.dismiss(); navigate('settings', 'ai') }
  function speak(text: string, accent = storeRef.current.pronunciation.accent) {
    stopSpeech()
    const request = speechSequence.current
    const rate = storeRef.current.pronunciation.rate
    async function fallback(message: string) {
      if (request !== speechSequence.current) return
      if (text.length > 100 || /[.!?\n]/.test(text)) { notify(message); return }
      try {
        const entries = await lookupDictionary(text)
        if (request !== speechSequence.current) return
        const audio = entries.flatMap(entry => entry.phonetics).map(item => safeExternalUrl(item.audio)).filter(Boolean)
        const preferred = accent === 'uk' ? /[-_](uk|gb)[-_.]/i : /[-_]us[-_.]/i
        const url = audio.find(item => preferred.test(item)) || audio[0]
        if (!url) throw new Error('暂无录音')
        const player = new Audio(url); recording.current = player
        await player.play()
      } catch {
        if (request === speechSequence.current) notify('录音暂不可用，请安装系统英语语音后重试')
      }
    }
    if (isAndroidApp) { void phone.speak({ word: text, accent, rate }).catch(error => fallback(error.message)); return }
    if (!('speechSynthesis' in window)) { void fallback('当前浏览器不支持朗读'); return }
    const speech = new SpeechSynthesisUtterance(text); speech.lang = accent === 'uk' ? 'en-GB' : 'en-US'; speech.rate = rate
    speech.onerror = event => { if (event.error !== 'interrupted' && event.error !== 'canceled') void fallback('朗读暂不可用，请检查系统英语语音') }
    speechSynthesis.speak(speech)
  }
  async function addImport(rows = uniqueRows, title = batch.trim() || `${today} 导入`) {
    if (!rows.length || (rows === uniqueRows && parsed.errors.length)) return
    const result = importToPersonal(storeRef.current, rows, title)
    if (await commit(await withFrequencyOrder(result.store))) {
      setUndo(null); notify(`已加入我的词本 · 新增 ${result.added} 词，复用 ${result.skipped} 词`)
      setImportOpen(false); setRawImport(''); setBatch(''); navigate('today')
    }
  }
  async function downloadBackup() {
    await exportState(storeRef.current, `拾词备份-${today}.json`)
  }
  async function exportState(value: Store, filename: string) {
    if (isAndroidApp) {
      try {
        const result = await phone.exportBackup({ content: JSON.stringify(value), filename })
        if (!result.cancelled) notify('备份已保存')
      } catch (error) { notify((error as Error).message) }
      return
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function generateLessons(ids: string[]) {
    if (!ids.length || aiLock.current) return
    const source = new Map(storeRef.current.words.filter(w => ids.includes(w.id)).map(w => [w.id, w]))
    aiLock.current = true; setAIBusy(true); setAIError('')
    try {
      const data = await api('reinforce', { method: 'POST', body: JSON.stringify({ ids }) })
      while (pendingSave.current) await pendingSave.current
      const current = storeRef.current
      const received = data.lessons.filter((lesson: { wordId: string }) => current.words.some(w => w.id === lesson.wordId && source.get(w.id)?.meaning === w.meaning && source.get(w.id)?.word === w.word))
      if (!received.length) throw new Error('词条已改变，请重新生成联想')
      if (await commit({ ...current, lessons: [...current.lessons.filter(l => !received.some((n: { wordId: string }) => n.wordId === l.wordId)), ...received] })) notify('单词联想已保存')
    } catch (error) { setAIError((error as Error).message) }
    finally { aiLock.current = false; setAIBusy(false) }
  }
  async function generateStory(bookId: string, day: number, part: number, words: Word[]) {
    if (aiLock.current || !words.length) return
    aiLock.current = true; setAIBusy(true); setAIError(''); setStoryLive('')
    const targets = words.map(({ id, word, meaning }) => ({ id, word, meaning }))
    try {
      const data = isAndroidApp
        ? await api('story', { method: 'POST', body: JSON.stringify({ ids: targets.map(w => w.id) }) })
        : await streamStory(targets.map(w => w.id), setStoryLive)
      const content = storyContentSchema.parse(data.story)
      while (pendingSave.current) await pendingSave.current
      const current = storeRef.current, book = current.books.find(b => b.id === bookId)
      const result: DailyStory = { ...content, id: storyKey(bookId, day, part), bookId, day, part, targets, model: data.model, createdAt: new Date().toISOString() }
      const currentWords = words.map(word => current.words.find(item => item.id === word.id)).filter((word): word is Word => !!word)
      if (!book || !storyIsCurrent(result, currentWords)) throw new Error('所选词汇或释义已改变，本次短文未保存，请重新生成')
      if (await commit({ ...current, stories: [...current.stories.filter(s => s.id !== result.id), result] })) notify(`第 ${day + 1} 单元短文已保存`)
    } catch (error) { setAIError((error as Error).message) }
    finally { aiLock.current = false; setAIBusy(false); setStoryLive('') }
  }
  async function generateContextStory(draft: StudyDraft) {
    if (aiLock.current || saveLock.current) return
    if (storeRef.current.learning.drafts[draft.kind]?.id !== draft.id && !await changeStudy(draft, { type: 'method', method: 'context' })) return
    const before = storeRef.current, saved = before.learning.drafts[draft.kind]
    if (saved?.id !== draft.id || saved.page !== draft.page) { notify('当前学习组已改变，请重新打开语境记忆'); return }
    const words = studyGroupWords(before, draft)
    if (words.length !== draft.groups[draft.page].length || (!draft.completed.includes(draft.page) && words.some(word => studyWordStatus(before, draft, word.id, new Date())))) { notify('这组词已有变化，请返回自测核对'); return }
    const key = contextStoryKey(draft), targets = words.map(({ id, word, meaning }) => ({ id, word, meaning }))
    aiLock.current = true; setAIBusy(true); setContextGeneratingKey(key); setAIError(''); setStoryLive('')
    try {
      const data = isAndroidApp
        ? await api('story', { method: 'POST', body: JSON.stringify({ ids: targets.map(word => word.id) }) })
        : await streamStory(targets.map(word => word.id), setStoryLive)
      const content = storyContentSchema.parse(data.story)
      while (pendingSave.current) await pendingSave.current
      const current = storeRef.current
      const task = [current.learning.drafts[draft.kind], ...current.learning.parked].find(item => item?.id === draft.id)
      const currentWords = targets.map(word => current.words.find(item => item.id === word.id)).filter((word): word is Word => !!word)
      const result: ContextStory = { ...content, id: key, taskId: draft.id, kind: draft.kind, group: draft.page, targets, model: data.model, createdAt: new Date().toISOString() }
      if (!task || task.groups[draft.page]?.join(',') !== targets.map(word => word.id).join(',') || !storyIsCurrent(result, currentWords)) throw new Error('本组词汇已改变，本次短文未保存，请重新生成')
      const contextStories = [...current.contextStories.filter(story => story.id !== key), result]
      if (await commit({ ...current, contextStories })) notify('本组语境短文已保存，读完后请进行遮义自测')
    } catch (error) { setAIError((error as Error).message) }
    finally { aiLock.current = false; setAIBusy(false); setContextGeneratingKey(''); setStoryLive('') }
  }
  async function assistArticle(data: { mode: ArticleAssistMode; title: string; text: string }): Promise<ArticleAssistResult> {
    if (aiLock.current) throw new Error('已有 AI 任务正在运行，请稍后重试')
    aiLock.current = true; setAIBusy(true); setAIError('')
    try {
      const result = await api('article-assist', { method: 'POST', body: JSON.stringify(data) }) as ArticleAssistResult
      return result
    } catch (error) {
      const message = (error as Error).message
      setAIError(message)
      throw error
    } finally { aiLock.current = false; setAIBusy(false) }
  }
  async function saveAI(data: { provider: string; model: string; key: string }) {
    if (aiLock.current) return false
    aiLock.current = true; setAIBusy(true); setAIError('')
    try { setAI(await api('settings', { method: 'PUT', body: JSON.stringify(data) })); notify('AI 配置已保存，生成时验证连通性'); return true }
    catch (error) { setAIError((error as Error).message); return false }
    finally { aiLock.current = false; setAIBusy(false) }
  }
  async function removeAI() {
    if (aiLock.current) return false
    aiLock.current = true; setAIBusy(true); setAIError('')
    try { setAI(await api('settings', { method: 'DELETE' })); notify('AI 密钥已移除'); return true }
    catch (error) { setAIError((error as Error).message); return false }
    finally { aiLock.current = false; setAIBusy(false) }
  }
  async function saveWord() {
    if (!editWord) return
    const current = storeRef.current, meaning = editWord.meaning.trim()
    const changed = current.words.find(w => w.id === editWord.id)?.meaning !== meaning
    if (await commit({ ...current,
      words: current.words.map(w => w.id === editWord.id ? { ...w, meaning, phonetic: editWord.phonetic.trim(), example: editWord.example.trim(), source: changed ? '个人修订' : w.source } : w),
      lessons: changed ? current.lessons.filter(l => l.wordId !== editWord.id) : current.lessons,
      stories: changed ? current.stories.filter(s => !s.targets.some(w => w.id === editWord.id)) : current.stories,
      contextStories: changed ? current.contextStories.filter(s => !s.targets.some(w => w.id === editWord.id)) : current.contextStories,
    })) { await modalController.dismiss(undefined, 'saved'); notify(changed ? '释义已更新，相关旧助记已清除' : '已更新单词') }
  }
  async function deleteWord() {
    if (!editWord) return
    const id = editWord.id, current = storeRef.current
    if (await commit({ ...current, words: current.words.filter(w => w.id !== id),
      reviews: current.reviews.filter(r => r.wordId !== id), lessons: current.lessons.filter(l => l.wordId !== id),
      stories: current.stories.filter(s => !s.targets.some(w => w.id === id)),
      contextStories: current.contextStories.filter(s => !s.targets.some(w => w.id === id)),
      books: current.books.map(b => ({ ...b, wordIds: b.wordIds.filter(wordId => wordId !== id), completedWordIds: b.completedWordIds.filter(wordId => wordId !== id) })),
    })) { await modalController.dismiss(undefined, 'saved'); setEditWord(null); setUndo(null); notify('单词已删除') }
  }
  async function showLicenses() {
    setLicensesOpen(true)
    try { const response = await fetch('/vocabulary/ECDICT-LICENSE.txt'); if (!response.ok) throw new Error(); setLicenseText(await response.text()) }
    catch { setLicenseText('许可文件暂时无法读取，请参阅 ECDICT 仓库。') }
  }
  if (!ready) return <div className="loading-page"><img className="boot-logo" src="/logo.png" alt="Wordflow 拾词" />{loadError ? <><p role="alert">{loadError}</p><button className="primary" onClick={() => location.reload()}>重新加载</button></> : <LoaderCircle className="spin" />}</div>
  const selectedTab = page === 'library' ? (libraryBackPage === 'settings' ? 'settings' : 'books') : page
  const secondaryPage = page === 'library' || (page === 'settings' && settingsSection !== 'home')
  return <div className={`app-shell ${page}-page`}>
    <main className="main" id="app-scroll">
      {failedSave && <div className="save-problem" role="alert"><strong>当前改动尚未保存</strong><p>{failedSave.error}</p><p>请保持本页打开，重试或导出待保存备份。</p><div className="button-row">
        <button className="primary" disabled={savingNow} onClick={() => void commit(failedSave.next, true)}>重试保存</button>
        <button className="secondary" disabled={savingNow} onClick={() => void exportState(failedSave.next, `拾词待保存-${today}.json`)}>导出待保存备份</button>
        <button className="text-button" disabled={savingNow} onClick={async () => {
          if (!window.confirm('放弃本页尚未保存的改动，并读取设备中已保存的记录？')) return
          try { const data = await api('state'); if (data.apiVersion !== 7) throw new Error('服务版本不匹配'); const next = validateStore(data.state); revision.current = data.revision; storeRef.current = next; failedSaveRef.current = null; setFailedSave(null); setStore(next); setUndo(null) }
          catch (error) { notify((error as Error).message) }
        }}>放弃改动并重载</button>
      </div></div>}
      {!!store.learning.notice && <div className="save-problem" role="status"><p>{store.learning.notice}</p><button className="text-button" disabled={saving} onClick={() => void commit({ ...storeRef.current, learning: { ...storeRef.current.learning, notice: '' } })}>知道了</button></div>}
      <AnimatePresence mode="wait" initial={false}><motion.div className="view-transition" key={page} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .1 }}>
        {page !== 'today' && <header className={`topbar${secondaryPage ? '' : ' primary-topbar'}`}>
          {secondaryPage && <button className="icon-button" aria-label="返回" title="返回" onClick={goBack}><ChevronLeft size={23} /></button>}
          <h1>{page === 'books' ? '词书' : page === 'story' ? '阅读' : page === 'library' ? '我的单词' : settingsTitles[settingsSection]}</h1>
          {page === 'books' || page === 'library' ? <button className="text-button header-action" aria-label="导入词表" onClick={() => setImportOpen(true)}><Plus size={17} />导入词表</button> : null}
        </header>}
        <div className={`content ${page === 'today' ? 'study-view' : ''}`}>
          {page === 'today' && <StudyList store={store} now={clock} saving={saving} canUndo={!!undo || !!store.learning.undo}
            onMark={changeMarks} onStudy={changeStudy} onRestart={restartStudy} onDay={selectDay} onOpenWord={openWord} onUndo={undoLastAction}
            onLearning={learning => commit({ ...storeRef.current, learning })}
            onLayout={studyLayout => { void commit({ ...storeRef.current, studyLayout }) }}
            contextServices={{ busy: aiBusy || saving, generatingKey: contextGeneratingKey, configured: ai.configured, live: storyLive, error: aiError, onGenerate: generateContextStory, onSettings: () => navigate('settings', 'ai') }} onStop={stopSpeech}
            onBooks={() => navigate('books')} onImport={() => setImportOpen(true)} onSpeak={speak} />}
          {page === 'books' && <BookShelf store={store} catalog={catalog} busy={bookBusy || saving} error={catalogError} onRetry={refreshCatalog}
            onLibrary={() => navigate('library')} onActivate={activateBook} onInstall={addCatalogBook} onWord={openWord} />}
          {page === 'story' && <ReadingPage store={store} now={clock} view={readingView} onView={view => { stopSpeech(); setReadingView(view) }} saving={saving} aiConfigured={ai.configured} onAssist={assistArticle} onAISettings={() => navigate('settings', 'ai')}
            onStudy={async () => { const current = storeRef.current; const mode = studyView(current); const draft = currentStudyDraft(current, mode === 'review' ? 'review' : 'learn'); if (!draft || await changeStudy(draft, { type: 'method', method: 'context' })) navigate('today') }}
            onRead={id => {
              const current = storeRef.current
              if (current.readArticleIds.includes(id)) return Promise.resolve(true)
              return commit({ ...current, readArticleIds: [...current.readArticleIds, id].slice(-2000) })
            }} onWord={openWord} onSpeak={speak} onStop={stopSpeech}>
            <DailyReader store={store} busy={aiBusy || saving} live={storyLive} configured={ai.configured} error={aiError} onGenerate={generateStory}
              onWord={openWord} onSpeak={speak} onStop={stopSpeech} onSettings={() => navigate('settings', 'ai')} onBooks={() => navigate('books')} />
          </ReadingPage>}
          {page === 'settings' && <SettingsPage store={store} ai={ai} saving={saving} aiBusy={aiBusy} error={aiError} onSaveAI={saveAI} onRemoveAI={removeAI}
            section={settingsSection} onSection={section => { stopSpeech(); setSettingsOrigin('settings'); setSettingsSection(section); document.getElementById('app-scroll')?.scrollTo({ top: 0 }) }}
            onPreferences={patch => commit({ ...storeRef.current, ...patch })} onBackup={downloadBackup} onRestore={() => restoreRef.current?.click()} onSpeak={speak} onLicenses={showLicenses}
            onBooks={() => navigate('books')} onLibrary={() => navigate('library')}
            onCloudCreate={async () => (await createCloudAccount()).recoveryCode}
            onCloudRecover={async code => { await recoverCloudAccount(code) }}
            onCloudUpload={async force => { try { const saved = await uploadCloudState(storeRef.current, force); return `已上传 · ${saved.savedAt}` } catch (error) { if (error instanceof CloudConflict) throw new Error('云端有更新的记录'); throw error } }}
            onCloudRestore={async () => { setRestoreCandidate(validateStore(await downloadCloudState())) }}
            onCheckUpdate={async () => {
              const release = await fetchCloudRelease()
              if (release.versionCode <= appRelease.versionCode) return `已是最新版本 ${appRelease.versionName}`
              if (!isAndroidApp) { window.open(release.url, '_blank', 'noopener'); return `有新版本 ${release.versionName}，已打开下载` }
              await phone.downloadUpdate({ url: release.url, sha256: release.sha256 })
              return `新版本 ${release.versionName} 已下载并通过校验，正在打开安装程序`
            }} />}
          {page === 'library' && <>
            <p className="page-purpose">查找所有词书中的单词，整理难词与熟词。点单词查看详情。</p>
            <div className="library-toolbar"><div className="search-field"><Search size={18} /><input aria-label="搜索词库" placeholder="搜索单词或释义" value={search} onChange={event => setSearch(event.target.value)} /></div>
              <label className="sort-field"><ArrowDownUp size={16} /><select aria-label="单词排序" value={sort} onChange={event => setSort(event.target.value)}><option value="weak">标记程度</option><option value="recent">最近加入</option><option value="alpha">字母顺序</option></select></label>
              <button className="icon-button" aria-label={hidden ? '显示释义' : '隐藏释义'} title={hidden ? '显示释义' : '隐藏释义'} onClick={() => { setHidden(!hidden); setRevealed(new Set()) }}>{hidden ? <EyeOff size={19} /> : <Eye size={19} />}</button>
              </div>
            <div className="filter-row" aria-label="单词筛选">{[['all', '全部'], ['marked', '已标记'], ['known', '熟词']].map(([id, label]) => <button aria-pressed={filter === id} key={id} onClick={() => setFilter(id)}>{label}</button>)}<span>{libraryWords.length.toLocaleString()} 词</span></div>
            {filter !== 'all' && <p className="field-note">{filter === 'known' ? '熟词已移出学习队列，可在详情中放回学习。' : '六点标记表示需要关注的程度，可在详情中增减。'}</p>}
            {libraryWords.length ? <div className="word-table">{libraryWords.slice(0, libraryLimit).map(word => <div className="word-row" key={word.id}>
              <button className="word-cell" onClick={() => openWord(word.id)}><strong>{word.word}</strong><span>{word.phonetic || word.batch}</span></button>
              <button className={`meaning-cell ${hidden && !revealed.has(word.id) ? 'concealed' : ''}`} onClick={() => setRevealed(previous => { const next = new Set(previous); next.has(word.id) ? next.delete(word.id) : next.add(word.id); return next })}>{hidden && !revealed.has(word.id) ? <Eye size={17} /> : coreGloss(word.meaning)}</button>
              <span className="library-marker" aria-label={word.known ? '熟词' : `标记 ${markLevel(word.markCount)} / 6`}>{word.known ? <CheckCheck size={18} /> : <MarkDots count={word.markCount} />}</span>
            </div>)}{libraryWords.length > libraryLimit && <button className="secondary load-more" onClick={() => setLibraryLimit(limit => limit + 300)}>显示更多</button>}</div> :
              <div className="empty"><Search size={28} /><h2>{store.words.length ? '没有匹配的单词' : '还没有单词'}</h2><p>{store.words.length ? '试试其他关键词，或查看全部单词。' : '先添加一本词书，或导入自己的词表。'}</p><button className="secondary" onClick={() => { if (store.words.length) { setSearch(''); setFilter('all') } else navigate('books') }}>{store.words.length ? '查看全部单词' : '去选词书'}</button></div>}
          </>}
        </div>
      </motion.div></AnimatePresence>
    </main>
    <nav className="mobile-nav" id="phone-tabs" aria-label="主导航">
      <motion.div aria-hidden className="tab-glass-selection" initial={false} animate={{ x: `${tabs.findIndex(tab => tab.id === selectedTab) * 100}%` }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }} />
      <IonTabBar selectedTab={selectedTab}>
      {tabs.map(tab => <IonTabButton tab={tab.id} key={tab.id} selected={selectedTab === tab.id} onClick={() => navigate(tab.id)} aria-label={tab.label}><tab.icon /><IonLabel>{tab.label}</IonLabel></IonTabButton>)}
    </IonTabBar></nav>
    <IonToast isOpen={!!toast} message={toast} duration={3500} position="bottom" positionAnchor="phone-tabs" cssClass="app-toast" animated={!reduced} onDidDismiss={() => setToast('')}
      buttons={[...(toastUndo && (undo || store.learning.undo) ? [{ text: '撤销', handler: () => { void undoLastAction(); return false } }] : []), { text: '关闭', role: 'cancel' }]} />
    <WordDetails word={detailWord} lesson={store.lessons.find(l => l.wordId === detailId)} saving={saving} generating={aiBusy} configured={ai.configured} error={aiError}
      onClose={() => setDetailId('')} onMark={changeMarks} onKnown={changeKnown} onSpeak={speak} onStop={stopSpeech}
      onDictionary={word => { void phone.openDictionary({ word }).catch(error => notify(error.message)) }} onGenerate={generateLessons} onConfigure={configureFromDetail} onEdit={editDetail}
      onSaveMnemonic={async (id, fields) => {
        const next = setUserMnemonic(storeRef.current, id, fields)
        if (next === storeRef.current) return true
        return commit(next)
      }} />
    <Sheet title="导入词表" open={importOpen} dismissible={!saving} onClose={() => setImportOpen(false)} tall>
      <div className="import-body"><p className="page-purpose">导入的词会加入“我的词本”。已有单词沿用原来的学习记录。</p><button className="secondary" disabled={saving} onClick={() => addImport(starterRows, '常用 100 词')}><BookOpen size={17} />导入常用 100 词</button>
        <button className="upload-area" onClick={() => fileRef.current?.click()}><Upload size={24} /><strong>选择词表文件</strong><span>CSV / TXT / TSV · 最大 2 MB</span></button>
        <label className="form-label">或粘贴词表<textarea value={rawImport} onChange={event => setRawImport(event.target.value)} placeholder={'word,meaning,phonetic,example\nresilient,有韧性的,,Stay resilient.'} rows={5} /></label>
        <label className="form-label">来源名称<input value={batch} maxLength={100} onChange={event => setBatch(event.target.value)} placeholder={`${today} 导入`} /></label>
        {!!parsed.errors.length && <div className="error-banner" role="alert">{parsed.errors.slice(0, 4).map((error, i) => <p key={i}>{error}</p>)}</div>}
        {!!uniqueRows.length && <div className="import-preview"><strong>{previewNew} 个新词 · 复用 {uniqueRows.length - previewNew} 个已有词</strong>{uniqueRows.slice(0, 3).map(row => <div key={row.word}><b>{row.word}</b><span>{row.meaning}</span></div>)}</div>}
        <div className="modal-actions"><button className="secondary" disabled={saving} onClick={() => setImportOpen(false)}>取消</button><button className="primary" disabled={saving || !uniqueRows.length || !!parsed.errors.length} onClick={() => addImport()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}加入我的词本</button></div>
      </div>
    </Sheet>
    {editWord && <Sheet title="编辑单词" open dismissible={!saving} onClose={() => setEditWord(null)} tall><form className="edit-form" onSubmit={event => { event.preventDefault(); void saveWord() }}>
      <div className="edit-word-title"><h2>{editWord.word}</h2><button type="button" className="icon-button" aria-label="朗读单词" title="朗读单词" onClick={() => speak(editWord.word)}><Volume2 size={20} /></button></div>
      <label className="form-label">释义<textarea required maxLength={2000} value={editWord.meaning} onChange={event => setEditWord({ ...editWord, meaning: event.target.value })} /></label>
      <label className="form-label">音标<input value={editWord.phonetic} maxLength={500} onChange={event => setEditWord({ ...editWord, phonetic: event.target.value })} /></label>
      <label className="form-label">例句<textarea maxLength={5000} value={editWord.example} onChange={event => setEditWord({ ...editWord, example: event.target.value })} /></label>
      <p className="source-note">{editWord.batch} · 已复习 {editWord.card.reps} 次</p>
      <div className="modal-actions"><button type="button" className="text-button danger" disabled={saving} onClick={() => setConfirmDelete(true)}><Trash2 size={16} />删除</button><button type="submit" className="primary" disabled={saving || !editWord.meaning.trim()}><Check size={17} />保存</button></div>
    </form></Sheet>}
    <IonAlert isOpen={confirmDelete} header="删除这个单词？" message="此词将从所有词书中移除，并删除相关复习记录与助记。" cssClass="app-alert" animated={!reduced} onDidDismiss={() => setConfirmDelete(false)}
      buttons={[{ text: '取消', role: 'cancel' }, { text: '确认删除', role: 'destructive', handler: () => { void deleteWord() } }]} />
    {restoreCandidate && <Sheet title="恢复学习记录" open dismissible={!saving} onClose={() => setRestoreCandidate(null)} tall><div className="import-body">
      <p>这份记录包含 {restoreCandidate.words.length} 个单词、{restoreCandidate.books.length} 本词书和 {restoreCandidate.stories.length} 篇短文。</p>
      <p className="error-banner">恢复将替换当前学习数据，AI 配置不变。建议先备份当前数据。</p>
      <div className="button-row"><button className="secondary" onClick={downloadBackup}><Download size={16} />备份当前数据</button><button className="primary" disabled={saving} onClick={async () => {
        if (await commit(restoreCandidate)) { await modalController.dismiss(undefined, 'saved'); setUndo(null); notify('备份已恢复') }
      }}>确认恢复</button></div>
    </div></Sheet>}
    <Sheet title="词库来源与开源许可" open={licensesOpen} onClose={() => setLicensesOpen(false)} tall><div className="license-content">
      <h3>ECDICT</h3><p>内置词书按 ECDICT 的考试标签筛选并按词频排序，不是官方大纲或出版词书。词条已做格式整理，内容仍需核对。</p>
      <a href="https://github.com/skywind3000/ECDICT" target="_blank" rel="noopener noreferrer">ECDICT 项目来源</a><pre>{licenseText || '正在读取许可…'}</pre>
      <h3>Free Dictionary API</h3><p>在线查词仅发送当前单词。返回内容的来源和许可显示在词条下方；未提供内容时继续使用本地释义。</p>
      <a href="https://dictionaryapi.dev/" target="_blank" rel="noopener noreferrer">API 项目来源</a>
    </div></Sheet>
    <input ref={fileRef} hidden type="file" accept=".csv,.txt,.tsv" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
      if (file.size > 2 * 1024 * 1024) { notify('文件不能超过 2 MB'); return }
      try { const text = await file.text(); if (text.includes('\uFFFD')) throw new Error('请将词表另存为 UTF-8 编码后导入'); setRawImport(text); setBatch(file.name.replace(/\.[^.]+$/, '')) }
      catch (error) { notify((error as Error).message) }
    }} />
    <input ref={restoreRef} hidden type="file" accept=".json" onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
      try { if (file.size > 12 * 1024 * 1024) throw new Error(); setRestoreCandidate(validateStore(JSON.parse(await file.text()))) }
      catch { notify('备份格式无效或文件过大，当前记录未改变') }
    }} />
  </div>
}
