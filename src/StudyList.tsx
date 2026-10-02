import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IonAlert } from '@ionic/react'
import { useReducedMotion } from 'motion/react'
import { BookOpen, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Clock3, Ellipsis, Eye, EyeOff, Minus, Plus, RotateCcw, Volume2 } from 'lucide-react'
import { PreviewIcon, RecallIcon } from './icons'
import { coreGloss } from './gloss'
import { bookDays, dayKey, ebbNextLabel, intervalLabel, markLevel, memoryIntervals, wordsForDay, pageFontAttrs, type Store, type WordBook } from './model'
import { currentStudyDraft, draftComplete, hasLearned, learningStatistics, newWords, reviewQueue, studyView, studyWordStatus, type StudyAction } from './study'
import type { LearningState, StudyDraft, StudyKind } from './study-state'
import ChoiceSheet from './components/ChoiceSheet'
import Sheet from './components/Sheet'
import GlassSlider from './components/GlassSlider'
import MarkDots from './components/MarkDots'
import { Segmented } from './components/Controls'
import ContextReader, { type ContextServices } from './components/ContextReader'
import SwipeRow from './components/SwipeRow'
import StartPlan from './components/StartPlan'
import type { CatalogBook } from './wordbooks'

type StartProps = { catalog: CatalogBook[]; busy: boolean; error: string; onRetry: () => void; onInstall: (book: CatalogBook, daily: number) => Promise<boolean> }
type Props = {
  /** First-run plan (choose book, daily count, schedule) shown while there is no wordbook. */
  start?: StartProps;
  store: Store; now: number; saving: boolean; canUndo: boolean;
  onMark: (id: string, delta: 1 | -1) => Promise<boolean>;
  /** Marks the word as 熟词: it leaves study (undo from the toast). */
  onKnown: (id: string) => Promise<boolean>;
  onStudy: (draft: StudyDraft, action: StudyAction) => Promise<boolean>;
  onRestart: (kind: StudyKind) => Promise<boolean>;
  onLearning: (learning: LearningState) => Promise<boolean>;
  onDay: (book: WordBook, day: number) => Promise<void>; onOpenWord: (id: string) => void;
  onUndo: () => void; onBooks: () => void; onImport: () => void;
  onLayout: (layout: Store['studyLayout']) => void;
  /** Study-page display preferences kept in appearance (e.g. hiding phonetics). */
  onAppearance: (patch: Partial<Store['appearance']>) => void; onSpeak: (text: string) => void; onStop: () => void;
  contextServices: ContextServices;
}
/** ⋯ menu for everything that is not the current word list. */
function StudyMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key) }
  }, [open])
  return <div className="study-menu" ref={root}>
    <button className="icon-button" aria-label="更多操作" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}><Ellipsis size={20} /></button>
    {open && <div className="study-menu-panel" role="group" aria-label="更多操作">{children(() => setOpen(false))}</div>}
  </div>
}

export default function StudyList({ start, store, now, saving, canUndo, onMark, onKnown, onStudy, onRestart, onLearning, onDay, onOpenWord, onUndo, onBooks, onImport, onLayout, onAppearance, onSpeak, onStop, contextServices }: Props) {
  const reduced = useReducedMotion()
  const hidePhonetic = !!store.appearance.hidePhonetic
  const [daysOpen, setDaysOpen] = useState(false), [showMeanings, setShowMeanings] = useState(false), [planOpen, setPlanOpen] = useState(false)
  const [replaceKind, setReplaceKind] = useState<StudyKind | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const press = useRef({ x: 0, y: 0, moved: false, held: false })
  const book = store.books.find(item => item.id === store.activeBookId), days = book ? bookDays(book) : []
  const day = Math.min(book?.currentDay || 0, Math.max(0, days.length - 1))
  const moment = new Date(now), mode = studyView(store, moment), queue = reviewQueue(store, moment), fresh = newWords(store)
  const candidateKey = (mode === 'review' ? queue : fresh).slice(0, 100).map(word => word.id).join(',')
  const draft = useMemo(() => mode === 'practice' ? null : currentStudyDraft(store, mode, new Date(now)), [store, mode, candidateKey])
  const practice = store.learning.practice?.bookId === book?.id && store.learning.practice?.day === day ? store.learning.practice : null
  const practiceWords = book ? wordsForDay(store, book, day) : []
  const practiceGroups = Array.from({ length: Math.ceil(practiceWords.length / 20) }, (_, index) => practiceWords.slice(index * 20, index * 20 + 20).map(word => word.id))
  const groups = mode === 'practice' ? practiceGroups : draft?.groups || []
  const currentPage = mode === 'practice' ? Math.min(practice?.page || 0, Math.max(0, groups.length - 1)) : draft?.page || 0
  const ids = groups[currentPage] || [], byId = new Map(store.words.map(word => [word.id, word]))
  const completed = !!draft?.completed.includes(currentPage), preview = store.studyLayout === 'preview'
  const contextMode = mode !== 'practice' && store.learning.method === 'context'
  const reviewDraft = mode === 'review' ? draft : store.learning.drafts.review
  const pendingReviewGroups = reviewDraft?.groups.filter((_, index) => !reviewDraft.completed.includes(index)) || []
  const pendingReviewIds = new Set(pendingReviewGroups.flat())
  const laterReviews = queue.filter(word => !pendingReviewIds.has(word.id)).length
  const nextPage = draft ? groups.findIndex((_, index) => index > currentPage && !draft.completed.includes(index)) : -1
  const remainingPage = nextPage >= 0 ? nextPage : draft ? groups.findIndex((_, index) => !draft.completed.includes(index)) : -1
  const rows = ids.map(id => {
    const word = byId.get(id), old = draft?.words.find(item => item.id === id)
    return { id, word: word?.word || old?.word || '已删除', meaning: word?.meaning || old?.meaning || '', phonetic: word?.phonetic || '', markCount: word?.markCount || 0,
      missing: !word, status: draft && !completed ? studyWordStatus(store, draft, id, moment) : '', forgotten: mode === 'practice' ? !!practice?.forgottenIds.includes(id) : !!draft?.forgotten[id] }
  })
  const eligible = rows.filter(row => !row.status && !row.missing), forgotten = eligible.filter(row => row.forgotten).length
  const changed = rows.some(row => row.status.includes('重新检查')), stats = learningStatistics(store, moment)
  const scheduled = store.words.filter(word => hasLearned(word) && !word.known)
  const nextDue = scheduled.filter(word => +new Date(word.card.due) > now).sort((a, b) => +new Date(a.card.due) - +new Date(b.card.due))[0]
  const currentKey = `${mode}:${draft?.bookId || book?.id}:${draft?.day ?? day}:${currentPage}`
  const moreFresh = mode === 'learn' && fresh.length > 0
  const continueLabel = remainingPage >= 0 ? '继续下一组' : mode === 'review' ? queue.length ? '继续到期复习' : '学习新词' : moreFresh ? '继续当天新词' : book && day + 1 < days.length ? '后一天' : '查看到期复习'
  const savedDraft = draft && store.learning.drafts[draft.kind]?.id === draft.id, practiceDone = mode === 'practice' && !!practice?.completedAt
  const number = (id: string) => {
    const source = mode === 'review' ? draft?.groups.flat() : store.books.find(item => item.id === (draft?.bookId || book?.id))?.wordIds
    return String((source?.indexOf(id) ?? -1) + 1).padStart(2, '0')
  }
  function scrollToEnglish() { document.getElementById('app-scroll')?.scrollTo({ top: 0, behavior: 'instant' }) }
  function cancelPress() { clearTimeout(timer.current) }
  useEffect(() => cancelPress, [])
  useEffect(() => { setShowMeanings(false); scrollToEnglish() }, [currentKey, preview, contextMode])
  function practiceState(patch: Partial<NonNullable<LearningState['practice']>>) {
    return onLearning({ ...store.learning, view: 'practice', practice: { bookId: book?.id || '', day, page: currentPage, forgottenIds: practice?.forgottenIds || [], completedAt: practice?.completedAt || null, ...patch } })
  }
  function move(page: number) { if (mode === 'practice') void practiceState({ page, completedAt: null }); else if (draft) void onStudy(draft, { type: 'page', page }) }
  function continueStudy() {
    if (remainingPage >= 0) move(remainingPage)
    else if (mode === 'review') { if (queue.length) restart('review'); else switchMode('learn') }
    else if (moreFresh) restart('learn')
    else if (book && day + 1 < days.length) void chooseDay(day + 1)
    else switchMode('review')
  }
  // One meaning for a tap everywhere: +1 mark. In 自己自查 the first tap also records 本轮不熟 for
  // the group (that mark is part of the submission); later taps only add marks.
  function tapWord(row: typeof rows[number]) {
    if (preview || mode === 'practice') return markEntry(row.id, 1)
    return row.forgotten ? onMark(row.id, 1) : markEntry(row.id, 1)
  }
  // 减标记 always removes exactly one mark. Marks added after 本轮不熟 go first; the last one
  // also clears 本轮不熟 for the group.
  function lessMark(row: typeof rows[number]) {
    const recorded = !preview && mode !== 'practice' ? draft?.forgotten[row.id] : undefined
    if (recorded && row.markCount > recorded.after.count) return onMark(row.id, -1)
    if (recorded) return markEntry(row.id, -1)
    if (!preview && row.forgotten) return markEntry(row.id, -1)
    return row.markCount > 0 ? onMark(row.id, -1) : Promise.resolve(false)
  }
  async function markEntry(id: string, delta: 1 | -1) {
    if (preview) return onMark(id, delta)
    if (mode === 'practice') { const selected = new Set(practice?.forgottenIds || []); if (delta > 0) selected.add(id); else selected.delete(id); return practiceState({ forgottenIds: [...selected], completedAt: null }) }
    return draft && !completed ? onStudy(draft, { type: delta > 0 ? 'forget' : 'cancel', wordId: id }) : false
  }
  function switchMode(view: Exclude<LearningState['view'], 'auto'>) { onStop(); void onLearning({ ...store.learning, view }) }
  async function continueReview() {
    onStop()
    if (reviewDraft && pendingReviewGroups.length) {
      const page = reviewDraft.completed.includes(reviewDraft.page) ? reviewDraft.groups.findIndex((_, index) => !reviewDraft.completed.includes(index)) : reviewDraft.page
      if (await onStudy(reviewDraft, { type: 'page', page })) setPlanOpen(false)
    } else if (queue.length) {
      if (await onRestart('review')) setPlanOpen(false)
    } else if (await onLearning({ ...store.learning, view: 'learn' })) setPlanOpen(false)
  }
  function restart(kind: StudyKind) { const previous = store.learning.drafts[kind]; if (previous && !draftComplete(previous)) setReplaceKind(kind); else void onRestart(kind) }
  async function chooseDay(value: number) { if (book) await onDay(book, value) }
  function chooseStage(stage: 'preview' | 'context' | 'test') {
    onStop()
    if (draft) void onStudy(draft, stage === 'context' ? { type: 'method', method: 'context' } : { type: stage === 'test' ? 'self-test' : 'preview' })
    else if (mode === 'practice') onLayout(stage === 'test' ? 'test' : 'preview')
  }
  // First run: no wordbook yet, so 学习 walks through choosing one instead of an empty page.
  if (!store.books.length && start) return <section className="study-list-view font-scope" aria-label="列表背词" {...pageFontAttrs(store.appearance.study)}><div className="english-page"><StartPlan store={store} {...start} onImport={onImport} /></div></section>
  const showTasks = mode === 'review' || queue.length > 0
  return <section className={`study-list-view font-scope layout-${store.studyLayout}`} aria-label="列表背词" {...pageFontAttrs(store.appearance.study)}>
    <div className="english-page">
      {/* One slim row: which day (the book is chosen in 我的 → 词书管理), group dots, and ⋯. */}
      <header className="study-card">
        <h1 className="sr-only">学习</h1>
        <div className="study-card-top">
          <div className="study-day-stepper" data-review={mode === 'review'}>
            {mode !== 'review' && <button className="icon-button" aria-label="前一天" disabled={!book || !day || saving} onClick={() => void chooseDay(day - 1)}><ChevronLeft size={17} /></button>}
            {mode === 'review'
              ? <span className="study-day-button is-static"><span className="day-title">到期复习</span><span className="current-book-label">全部词书</span></span>
              : <button className="study-day-button" aria-label="选择学习的天" disabled={!book || saving} onClick={() => setDaysOpen(true)}><span className="day-title">第 {day + 1} 天</span><ChevronDown size={13} /></button>}
            {mode !== 'review' && <button className="icon-button" aria-label="后一天" disabled={!book || day >= days.length - 1 || saving} onClick={() => void chooseDay(day + 1)}><ChevronRight size={17} /></button>}
          </div>
          {!!rows.length && groups.length > 0 && <div className="study-task-progress" aria-label="本次任务进度">
            <span className="group-dots" aria-hidden="true">{groups.map((_, index) => <i key={index} data-done={!!draft?.completed.includes(index)} data-current={index === currentPage} />)}</span>
            <span className="sr-only">第 {currentPage + 1} / {groups.length} 组{draft ? ` · 已完成 ${draft.completed.length} / ${groups.length} 组` : ''}{mode === 'review' && pendingReviewGroups.length > 0 && laterReviews > 0 ? ` · 另有 ${laterReviews} 词到期` : ''}</span>
            <span className="group-count">{currentPage + 1}/{groups.length} 组</span>
          </div>}
          <StudyMenu>{close => <>
            <button onClick={() => { close(); setPlanOpen(true) }}><Clock3 size={16} />复习计划</button>
            <button aria-pressed={hidePhonetic} onClick={() => { close(); onAppearance({ hidePhonetic: !hidePhonetic }) }}>{hidePhonetic ? <Eye size={16} /> : <EyeOff size={16} />}{hidePhonetic ? '显示音标' : '隐藏音标'}</button>
            {!!rows.length && <button disabled={saving} onClick={() => { close(); onSpeak(rows.filter(row => !row.missing).map(row => row.word).join('. ')) }}><Volume2 size={16} />朗读本组</button>}
            {!!rows.length && mode !== 'practice' && <button aria-pressed={contextMode} disabled={saving || contextServices.busy} onClick={() => { close(); chooseStage('context') }}><BookOpen size={16} />读短文</button>}
            {book && mode !== 'review' && <button disabled={saving} onClick={() => { close(); switchMode(mode === 'practice' ? 'learn' : 'practice') }}><RotateCcw size={16} />{mode === 'practice' ? '返回当天新词' : '回看当天 · 不改变复习计划'}</button>}
            <button disabled={!canUndo || saving} onClick={() => { close(); onUndo() }} aria-label="撤销上一步"><RotateCcw size={16} />撤销上一步</button>
            {savedDraft && !draftComplete(draft) && <button disabled={saving} onClick={() => { close(); restart(draft.kind) }}>重新开始本组</button>}
            <button onClick={() => { close(); onImport() }}><Plus size={16} />导入词表</button>
            <p className="study-menu-note" aria-label="今日学习统计">今日新学 {stats.newToday} 词 · 复习 {stats.reviewedToday} 词</p>
          </>}</StudyMenu>
        </div>
        {/* New vs due review only matters when something is due. */}
        {showTasks && <Segmented label="学习任务" className="study-task-tabs" disabled={saving}
          value={mode === 'review' ? 'review' : mode === 'practice' ? 'practice' : 'learn'}
          onChange={view => switchMode(view === 'review' ? 'review' : 'learn')}
          options={[
            // In practice mode the 新词 tab shows as selected and tapping it returns to learning.
            { value: mode === 'practice' ? 'practice' as const : 'learn' as const, ariaLabel: '新词', title: `今天待学 ${fresh.length} 词`, label: <>新词 <span>{fresh.length}</span></> },
            { value: 'review' as const, ariaLabel: '到期复习', title: `全部词书到期 ${queue.length} 词`, label: <>到期复习 <span>{queue.length}</span></> },
          ]} />}
        {!!rows.length && <Segmented label="学习方式" className="study-stage-switch"
          value={contextMode ? 'context' : preview ? 'preview' : 'test'} disabled={saving || contextServices.busy} onChange={chooseStage}
          options={[
            { value: 'preview' as const, ariaLabel: '快速记忆', label: <><PreviewIcon size={15} />快速记忆</> },
            { value: 'test' as const, ariaLabel: '自己自查', label: <><RecallIcon size={15} />自己自查</> },
          ]} />}
      </header>
      {!rows.length ? <div className="study-empty"><BookOpen size={30} /><h2>{mode === 'review' ? '暂无到期复习' : !book ? '从一本词书开始' : '今天暂无新词'}</h2><p>{mode === 'review' ? nextDue ? `下次复习在 ${intervalLabel(nextDue.card.due, moment)}后` : '完成新词自测后，这里会按计划安排复习。' : !book ? '选词书 → 看词或读短文 → 自测提交。每组最多 20 词，中途退出会保留进度。' : '今天的词已学过或已标熟，可以回看，或继续下一天。'}</p><div className="button-row">{mode === 'review' && <button className="primary" disabled={saving} onClick={() => switchMode('learn')}>学习新词</button>}{book && day + 1 < days.length && mode !== 'review' && <button className="primary" onClick={() => void chooseDay(day + 1)}>进入下一天</button>}{!book && <><button className="primary" onClick={onBooks}>选择词书</button><button className="secondary" onClick={onImport}>导入词表</button></>}</div></div> : <>
        {contextMode && draft ? <ContextReader store={store} draft={draft} now={now} services={contextServices} onWord={onOpenWord} onSpeak={onSpeak} onStop={onStop} onCheck={() => { onStop(); void onStudy(draft, { type: 'self-test' }) }} /> : <><ol className="english-grid" aria-label="编号英文词表" key={currentKey}>
          {rows.map(row => <li className="english-entry" key={row.id} data-word-id={row.id} data-number={number(row.id)} data-mark-count={markLevel(row.markCount)} data-mark-level={markLevel(row.markCount)} data-forgotten={row.forgotten} data-next={store.reviewMethod === 'ebbinghaus' && byId.has(row.id) ? ebbNextLabel(byId.get(row.id)!, row.forgotten) : ''}>
            <SwipeRow disabled={saving || row.missing || (!preview && completed)}
              onSwipeStart={() => { press.current.moved = true; cancelPress() }}
              actions={[
                { label: <><Minus size={16} /><span>减标记</span></>, ariaLabel: `第 ${number(row.id)} 词减一个标记`, tone: 'neutral', disabled: row.markCount === 0 && !row.forgotten, onClick: () => void lessMark(row) },
                { label: <><CheckCheck size={16} /><span>熟词</span></>, ariaLabel: `把 ${row.word} 设为熟词`, tone: 'known', onClick: () => void onKnown(row.id) },
              ]}>
              <button className="english-line" disabled={saving || row.missing} aria-label={`${number(row.id)} ${row.word}，标记 ${markLevel(row.markCount)} / 6${row.forgotten ? '，本轮不熟' : ''}`} title="点按加一个标记，左滑减标记或设为熟词，长按查词"
                onPointerDown={event => { if (event.button !== 0) return; cancelPress(); press.current = { x: event.clientX, y: event.clientY, moved: false, held: false }; timer.current = setTimeout(() => { press.current.held = true; onOpenWord(row.id) }, 480) }}
                onPointerMove={event => { if (Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8) { press.current.moved = true; cancelPress() } }} onPointerUp={cancelPress} onPointerLeave={cancelPress} onPointerCancel={cancelPress}
                onContextMenu={event => { event.preventDefault(); cancelPress(); press.current.held = true; onOpenWord(row.id) }} onClick={event => { if (event.detail === 0 || (!press.current.held && !press.current.moved)) { if (completed && !preview) onOpenWord(row.id); else void tapWord(row) } }}>
                <span className="word-index"><span className="word-number">{number(row.id)}</span><MarkDots count={row.markCount} /></span><span className="word-card-content"><span className="english-stack"><span className={`english-word${row.word.length > 14 ? ' long-word' : ''}`} lang="en">{row.word}</span>{row.phonetic && !hidePhonetic && <span className="card-phonetic" lang="en">{row.phonetic}</span>}</span>{preview && <span className="card-meaning">{coreGloss(row.meaning)}</span>}{!!row.status && <span className="study-word-state">{row.status}</span>}{!preview && row.forgotten && <span className="study-word-state">本轮不熟</span>}</span>
              </button>
            </SwipeRow>
          </li>)}
        </ol>
        {!preview && <section className="meaning-section" aria-label="编号中文释义"><div className="meaning-heading"><h2>核对释义</h2><button className="text-button" onClick={() => setShowMeanings(!showMeanings)} aria-label={showMeanings ? '隐藏全部释义' : '显示全部释义'}>{showMeanings ? <EyeOff size={16} /> : <Eye size={16} />}{showMeanings ? '收起释义' : '展开核对'}</button></div>
          {showMeanings && <ol className="meaning-list">{rows.map(row => <li className="meaning-entry" key={row.id} data-word-id={row.id} data-number={number(row.id)}><div className="meaning-row"><span className="word-number">{number(row.id)}</span><span className="chinese-meaning">{coreGloss(row.meaning)}</span><button className="text-button meaning-check" aria-label={`${row.forgotten ? '取消' : '标记'}第 ${number(row.id)} 词不熟`} aria-pressed={row.forgotten} disabled={saving || completed || row.missing} onClick={() => void markEntry(row.id, row.forgotten ? -1 : 1)}>{row.forgotten ? '已标不熟' : '不熟'}</button><button className="study-mark" disabled={row.missing} onClick={() => onOpenWord(row.id)} aria-label={`第 ${number(row.id)} 词详情`}><MarkDots count={row.markCount} /></button></div></li>)}</ol>}
          {showMeanings && <button className="text-button" aria-label="返回英文词表" onClick={scrollToEnglish}>返回词表</button>}
        </section>}
        {!preview && <div className="study-submit-area">
          {completed ? <p role="status">本组已检查完，下次复习已安排。</p> : mode === 'practice' ? <p>自由练习保留反馈，不改变复习时间。{practiceDone && '本次练习已完成。'}</p> : <p>不熟 {forgotten} 词，其余 {eligible.length - forgotten} 词。提交表示其余词已自测记住。</p>}
          {changed && draft && <button className="secondary" disabled={saving} onClick={() => void onStudy(draft, { type: 'refresh' })}>重新检查本组</button>}
          {mode === 'practice' ? <button className="secondary" disabled={saving || practiceDone} onClick={() => void practiceState({ completedAt: new Date(now).toISOString() })}><Check size={17} />练习完成</button> : draft && !completed ? <button className="primary complete-group" disabled={saving || changed} onClick={() => void onStudy(draft, { type: 'submit', token: draft.tokens[currentPage] })}><Check size={17} />本组已检查完</button> : <button className="secondary" disabled={saving} onClick={continueStudy}><CheckCheck size={17} />{continueLabel}</button>}
        </div>}
</>}
        <div className="study-pagination"><button className="icon-button" aria-label="上一组" disabled={saving || !currentPage} onClick={() => move(currentPage - 1)}><ChevronLeft size={19} /></button>{groups.length > 1 ? <GlassSlider name="词组" min={1} max={groups.length} value={currentPage + 1} label={page => `${page}`} thumbWidth={42} onCommit={page => { if (!saving) move(page - 1) }} /> : <span className="page-static" aria-label={`第 ${currentPage + 1} 组，共 ${groups.length} 组`}>{currentPage + 1} / {groups.length}</span>}<button className="icon-button" disabled={saving || currentPage >= groups.length - 1} onClick={() => move(currentPage + 1)} aria-label="下一组"><ChevronRight size={19} /></button></div>
      </>}
    </div>
    <ChoiceSheet title="学习的天" open={daysOpen} onClose={() => setDaysOpen(false)} value={String(day)} options={days.map((ids, index) => {
      const task = [store.learning.drafts.learn, ...store.learning.parked].find(item => item && item.bookId === book?.id && item.day === index)
      const learned = ids.filter(id => { const word = byId.get(id); return word && hasLearned(word) }).length
      return { value: String(index), label: `第 ${index + 1} 天`, count: ids.length, detail: task && !draftComplete(task) ? `待继续 · 已完成 ${task.completed.length} / ${task.groups.length} 组` : `已学 ${learned} 词` }
    })} onSelect={value => { void chooseDay(Number(value)) }} />
    <IonAlert isOpen={replaceKind !== null} cssClass="app-alert" animated={!reduced} header="结束原学习草稿？" message="已提交的学习记录和难词标记保留，未提交的本轮结果将结束。随后按当前选择重新选词。" onDidDismiss={() => setReplaceKind(null)} buttons={[{ text: '继续原任务', role: 'cancel' }, { text: '结束并重新选词', role: 'destructive', handler: () => { if (replaceKind) void onRestart(replaceKind) } }]} />
    <Sheet title="复习计划" open={planOpen} onClose={() => setPlanOpen(false)} tall><div className="memory-plan"><div className="memory-plan-heading"><h3>{store.reviewMethod === 'ebbinghaus' ? '艾宾浩斯式间隔复习' : 'FSRS 自适应复习'}</h3><span>全部已学单词 · 跨词书去重</span></div><div className="memory-totals"><div><strong>{queue.length}</strong><span>到期待复习</span></div><div><strong>{scheduled.length}</strong><span>已加入计划</span></div></div>
      {reviewDraft && <div className="review-task-summary" aria-label="复习任务进度"><strong>{pendingReviewGroups.length ? `本次已完成 ${reviewDraft.completed.length} / ${reviewDraft.groups.length} 组` : '本次复习已完成'}</strong><span>{pendingReviewGroups.length ? `剩余 ${pendingReviewGroups.length} 组，继续原来的词表和答案。` : queue.length ? `还有 ${queue.length} 词到期，可以开始下一次复习。` : '当前到期任务已处理完，可以学习新词。'}</span>{pendingReviewGroups.length > 0 && laterReviews > 0 && <span>另有 {laterReviews} 词到期，完成本次后继续。</span>}</div>}
      <button className="primary review-continue" disabled={saving} onClick={() => void continueReview()}><RotateCcw size={17} />{pendingReviewGroups.length ? `继续本次复习 · 剩余 ${pendingReviewGroups.length} 组` : queue.length ? `开始到期复习 · ${queue.length} 词` : '学习新词'}</button>
      <table className="memory-table" aria-label={store.reviewMethod === 'ebbinghaus' ? '间隔复习时间表' : 'FSRS 复习规则'}><thead><tr><th scope="col">完成阶段</th><th scope="col">下次复习间隔</th></tr></thead><tbody>{store.reviewMethod === 'ebbinghaus' ? <>{memoryIntervals.map((step, index) => <tr key={step.minutes}><th scope="row">{index === 0 ? '首次学习' : `第 ${index} 次复习`}</th><td>{step.label}{index === memoryIntervals.length - 1 ? '，之后每 30 天' : ''}</td></tr>)}<tr><th scope="row">忘记 / 需重学</th><td>5 分钟，重新开始</td></tr></> : <><tr><th scope="row">忘记 / 需重学</th><td>逐词计算重学时间</td></tr><tr><th scope="row">记住</th><td>根据记忆状态逐词调整</td></tr></>}</tbody></table>
      <p className="field-note">间隔从正式提交计算，提前自由练习不推进阶段。固定间隔为应用预设，非个人实测遗忘曲线。</p><div className="review-forecast">{Array.from({ length: 7 }, (_, index) => { const date = new Date(now); date.setDate(date.getDate() + index); return <div key={index}><span>{index === 0 ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`}</span><strong>{scheduled.filter(word => dayKey(word.card.due) === dayKey(date)).length}</strong></div> })}</div><p className="next-review">{nextDue ? `下次复习 · ${intervalLabel(nextDue.card.due, moment)}后` : '暂无后续复习'}</p>
    </div></Sheet>
  </section>
}