import { useEffect, useMemo, useRef, useState } from 'react'
import { IonAlert } from '@ionic/react'
import { useReducedMotion } from 'motion/react'
import { BookOpen, Bookmark, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Clock3, Eye, EyeOff, Minus, Plus, RotateCcw, Volume2 } from 'lucide-react'
import { PreviewIcon, RecallIcon } from './icons'
import { coreGloss } from './gloss'
import LocalDictionary from './components/LocalDictionary'
import { bookDays, dayKey, ebbNextLabel, intervalLabel, listReviewOffsets, markLevel, memoryIntervals, vocabBookId, wordsForDay, pageFontAttrs, type Store, type WordBook } from './model'
import { currentStudyDraft, dayPlan, dayReviewKey, draftComplete, hasLearned, learningStatistics, newWords, reviewQueue, studyView, studyWordStatus, usesDaySchedule, type StudyAction } from './study'
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
import { setSkipKnownConfirm, skipKnownConfirm } from './known-confirm'

type StartProps = { catalog: CatalogBook[]; busy: boolean; error: string; onRetry: () => void; onInstall: (book: CatalogBook, daily: number) => Promise<boolean> }
type Props = {
  /** First-run plan (choose book, daily count, schedule) shown while there is no wordbook. */
  start?: StartProps;
  store: Store; now: number; saving: boolean; canUndo: boolean;
  onMark: (id: string, delta: 1 | -1) => Promise<boolean>;
  /** Sets 熟词: a known word leaves study and is hidden from the list (undo from the toast). */
  onKnown: (id: string, known: boolean) => Promise<boolean>;
  onStudy: (draft: StudyDraft, action: StudyAction) => Promise<boolean>;
  onRestart: (kind: StudyKind) => Promise<boolean>;
  onLearning: (learning: LearningState) => Promise<boolean>;
  onDay: (book: WordBook, day: number) => Promise<void>; onOpenWord: (id: string) => void;
  onUndo: () => void; onBooks: () => void; onImport: () => void; onVocab: () => void;
  onLayout: (layout: Store['studyLayout']) => void;
  onSpeak: (text: string) => void; onStop: () => void;
  onCheckIn: () => Promise<boolean>;
  contextServices: ContextServices;
}
/** Shown once the day is done: check in to record it, or the record already made today. */
export function CheckInBar({ plan, saving, onCheckIn, onNextDay }: { plan: ReturnType<typeof dayPlan>; saving: boolean; onCheckIn: () => Promise<boolean>; onNextDay: (day: number) => void }) {
  const stale = !!plan.checkin && (plan.checkin.newCount !== plan.newToday || plan.checkin.reviewCount !== plan.reviewedToday)
  if (!plan.checkin && plan.idle) return <div className="checkin-bar">
    <span className="checkin-text"><strong>第 {plan.day + 1} 天已经学完</strong><small>今天还没有新学或复习，{plan.nextDay !== null ? '进入下一天学完后即可打卡' : '这本词书的每一天都已学完'}</small></span>
    {plan.nextDay !== null && <button className="primary checkin-button" disabled={saving} onClick={() => onNextDay(plan.nextDay!)}>进入第 {plan.nextDay + 1} 天<ChevronRight size={16} /></button>}
  </div>
  return <div className="checkin-bar" data-done={!!plan.checkin}>
    <span className="checkin-text">{plan.checkin
      ? <><strong><CheckCheck size={16} />今日已打卡</strong><small>新学 {plan.checkin.newCount} 词 · 复习 {plan.checkin.reviewCount} 词</small></>
      : <><strong>当天任务完成</strong><small>今天新学 {plan.newToday} 词 · 复习 {plan.reviewedToday} 词，打卡后计入统计</small></>}</span>
    {(!plan.checkin || (stale && plan.canCheckIn)) && <button className="primary checkin-button" disabled={saving || !plan.canCheckIn} onClick={() => void onCheckIn()}>
      <Check size={16} />{plan.checkin ? '更新打卡' : '打卡'}</button>}
  </div>
}
export default function StudyList({ start, store, now, saving, canUndo, onMark, onKnown, onStudy, onRestart, onLearning, onDay, onOpenWord, onUndo, onBooks, onImport, onVocab, onLayout, onSpeak, onStop, onCheckIn, contextServices }: Props) {
  const reduced = useReducedMotion()
  const [daysOpen, setDaysOpen] = useState(false), [showMeanings, setShowMeanings] = useState(false), [openMeaning, setOpenMeaning] = useState<string | null>(null), [planOpen, setPlanOpen] = useState(false)
  const [replaceKind, setReplaceKind] = useState<StudyKind | null>(null)
  const [knownTarget, setKnownTarget] = useState<{ id: string; word: string } | null>(null), [leaving, setLeaving] = useState<string[]>([]), [showKnown, setShowKnown] = useState(false)
  const vocabCount = store.books.find(book => book.id === vocabBookId)?.wordIds.length ?? 0
  const previousRows = useRef<{ id: string; word: string; meaning: string; markCount: number; missing: boolean; known: boolean; status: string; forgotten: boolean }[]>([])
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
    return { id, word: word?.word || old?.word || '已删除', meaning: word?.meaning || old?.meaning || '', markCount: word?.markCount || 0,
      missing: !word, known: !!word?.known, status: draft && !completed ? studyWordStatus(store, draft, id, moment) : '', forgotten: mode === 'practice' ? !!practice?.forgottenIds.includes(id) : !!draft?.forgotten[id] }
  })
  // 熟词 leave the list (fading out first); 显示熟词 brings them back, dimmed, to be un-marked.
  const knownRows = rows.filter(row => row.known), hiddenKnown = knownRows.filter(row => !leaving.includes(row.id)).length
  const shownRows = rows.filter(row => !row.known || showKnown || leaving.includes(row.id))
  // The refilled group no longer contains a word that was just marked: keep it in place until its fade ends.
  previousRows.current.forEach((row, index) => { if (leaving.includes(row.id) && !rows.some(item => item.id === row.id)) shownRows.splice(Math.min(index, shownRows.length), 0, { ...row, known: true }) })
  useEffect(() => { previousRows.current = shownRows })
  const eligible = rows.filter(row => !row.status && !row.missing), forgotten = eligible.filter(row => row.forgotten).length
  const changed = rows.some(row => row.status.includes('重新检查')), stats = learningStatistics(store, moment)
  const scheduled = store.words.filter(word => hasLearned(word) && !word.known)
  const nextDue = scheduled.filter(word => +new Date(word.card.due) > now).sort((a, b) => +new Date(a.card.due) - +new Date(b.card.due))[0]
  const currentKey = `${mode}:${draft?.bookId || book?.id}:${draft?.day ?? day}:${currentPage}`
  const moreFresh = mode === 'learn' && fresh.length > 0
  // 按天复习: the review list belongs to the selected day, so the day header and both tabs stay visible.
  const dayMode = usesDaySchedule(store) && !!book, plan = dayPlan(store, moment)
  const reviewDays = listReviewOffsets.map(offset => day - offset).filter(value => value >= 0).map(value => value + 1)
  const continueLabel = remainingPage >= 0 ? '继续下一组' : mode === 'review' ? queue.length ? '继续复习' : '学习新词' : moreFresh ? '继续当天新词' : book && day + 1 < days.length ? '后一天' : '查看复习'
  const savedDraft = draft && store.learning.drafts[draft.kind]?.id === draft.id, practiceDone = mode === 'practice' && !!practice?.completedAt
  const number = (id: string) => {
    const source = mode === 'review' ? draft?.groups.flat() : store.books.find(item => item.id === (draft?.bookId || book?.id))?.wordIds
    return String((source?.indexOf(id) ?? -1) + 1).padStart(2, '0')
  }
  const dayOptions = useMemo(() => {
    if (!daysOpen || !book) return []
    const learnedIds = new Set(store.words.filter(word => !word.known && hasLearned(word)).map(word => word.id))
    const reviewed = new Map<string, Set<string>>()
    for (const review of store.reviews) if (review.forDay) { let set = reviewed.get(review.forDay); if (!set) reviewed.set(review.forDay, set = new Set()); set.add(review.wordId) }
    return days.map((ids, index) => {
      const task = [store.learning.drafts.learn, ...store.learning.parked].find(item => item && item.bookId === book.id && item.day === index)
      const learned = ids.filter(id => learnedIds.has(id)).length
      const recall = dayMode ? listReviewOffsets.map(offset => index - offset).filter(value => value >= 0).flatMap(value => days[value]).filter(id => learnedIds.has(id)) : []
      const done = reviewed.get(dayReviewKey(book.id, index))
      const reviewLeft = recall.filter(id => !done?.has(id)).length
      const status = task && !draftComplete(task) ? `待继续 · 已完成 ${task.completed.length} / ${task.groups.length} 组` : learned >= ids.length ? '新词已学完' : learned ? `新词已学 ${learned}` : '未开始'
      return { value: String(index), label: `第 ${index + 1} 天`, count: ids.length,
        detail: dayMode ? `新学 ${ids.length} · 复习 ${recall.length}${recall.length ? reviewLeft ? `（剩 ${reviewLeft}）` : '（已完成）' : ''} · ${status}` : status }
    })
  }, [daysOpen, book, days, store.words, store.reviews, store.learning, dayMode])
  async function confirmKnown(target: { id: string; word: string }) {
    setLeaving(items => [...items, target.id])
    const done = await onKnown(target.id, true)
    setTimeout(() => setLeaving(items => items.filter(id => id !== target.id)), done ? 420 : 0)
  }
  function scrollToEnglish() { document.getElementById('app-scroll')?.scrollTo({ top: 0, behavior: 'instant' }) }
  function cancelPress() { clearTimeout(timer.current) }
  useEffect(() => cancelPress, [])
  useEffect(() => { setShowMeanings(false); setOpenMeaning(null); scrollToEnglish() }, [currentKey, preview, contextMode])
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
  const showTasks = dayMode || mode === 'review' || queue.length > 0
  return <section className={`study-list-view font-scope layout-${store.studyLayout}`} aria-label="列表背词" {...pageFontAttrs(store.appearance.study)}>
    <div className="english-page">
      {/* Two slim rows: day · 速记/自查 · 生词本, then 当天新学/需要复习 when both exist. The book is chosen in 我的 → 词书管理. */}
      <header className="study-card">
        <h1 className="sr-only">学习</h1>
        <div className="study-card-top">
          <div className="study-day-stepper" data-review={mode === 'review'}>
            {(mode !== 'review' || dayMode) && <button className="icon-button" aria-label="前一天" disabled={!book || !day || saving} onClick={() => void chooseDay(day - 1)}><ChevronLeft size={17} /></button>}
            {mode === 'review' && !dayMode
              ? <span className="study-day-button is-static"><span className="day-title">到期复习</span><span className="current-book-label">全部词书</span></span>
              : <button className="study-day-button" aria-label="选择学习的天" disabled={!book || saving} onClick={() => setDaysOpen(true)}><span className="day-title">第 {day + 1} 天</span><ChevronDown size={13} /></button>}
            {(mode !== 'review' || dayMode) && <button className="icon-button" aria-label="后一天" disabled={!book || day >= days.length - 1 || saving} onClick={() => void chooseDay(day + 1)}><ChevronRight size={17} /></button>}
          </div>
          {!!rows.length && groups.length > 0 && <div className="study-task-progress" aria-label="本次任务进度">
            <span className="sr-only">第 {currentPage + 1} / {groups.length} 组{draft ? ` · 已完成 ${draft.completed.length} / ${groups.length} 组` : ''}{mode === 'review' && pendingReviewGroups.length > 0 && laterReviews > 0 ? ` · 另有 ${laterReviews} 词到期` : ''}</span>
          </div>}
          {!!rows.length && <Segmented label="学习方式" className="study-stage-switch"
            value={contextMode ? 'context' : preview ? 'preview' : 'test'} disabled={saving || contextServices.busy} onChange={chooseStage}
            options={[
              { value: 'preview' as const, ariaLabel: '快速记忆', title: '快速记忆：看词和释义', label: <><PreviewIcon size={15} /><span className="stage-text">速记</span></> },
              { value: 'test' as const, ariaLabel: '自己自查', title: '自己自查：先想再核对', label: <><RecallIcon size={15} /><span className="stage-text">自查</span></> },
            ]} />}
          <button className="icon-button vocab-button" aria-label={`生词本 · ${vocabCount} 词`} title="生词本" onClick={onVocab}><Bookmark size={20} /></button>
        </div>
        {/* New vs due review only matters when something is due. */}
        {showTasks && <Segmented label="学习任务" className="study-task-tabs" disabled={saving}
          value={mode === 'review' ? 'review' : mode === 'practice' ? 'practice' : 'learn'}
          onChange={view => switchMode(view === 'review' ? 'review' : 'learn')}
          options={[
            // In practice mode the 新词 tab shows as selected and tapping it returns to learning.
            { value: mode === 'practice' ? 'practice' as const : 'learn' as const, ariaLabel: dayMode ? '当天新学' : '新词', title: `今天待学 ${fresh.length} 词`, label: <>{dayMode ? '当天新学' : '新词'} <span>{fresh.length}</span></> },
            { value: 'review' as const, ariaLabel: dayMode ? '需要复习' : '到期复习', title: dayMode ? `复习第 ${reviewDays.join('、') || '—'} 天学过的词，还剩 ${queue.length} 词` : `全部词书到期 ${queue.length} 词`, label: <>{dayMode ? '需要复习' : '到期复习'} <span>{queue.length}</span></> },
          ]} />}
        {dayMode && <p className="sr-only" aria-label="当天计划">第 {day + 1} 天 · 新学 {plan.newTotal} 词{plan.reviewTotal ? ` · 复习 ${plan.reviewTotal} 词（第 ${reviewDays.join('、')} 天学过的词）` : reviewDays.length ? ' · 前几天还没有学过的词，暂无复习' : ' · 第一天没有复习'}</p>}
        {book && (plan.finished || plan.checkin) && <CheckInBar plan={plan} saving={saving} onCheckIn={onCheckIn} onNextDay={value => void chooseDay(value)} />}
      </header>
      {!rows.length ? <div className="study-empty"><BookOpen size={30} /><h2>{mode === 'review' ? dayMode ? '这一天的复习已完成' : '暂无到期复习' : !book ? '从一本词书开始' : '今天暂无新词'}</h2><p>{mode === 'review' && dayMode ? reviewDays.length ? `第 ${day + 1} 天复习第 ${reviewDays.join('、')} 天学过的词，每个词复习一次。` : '第一天只学新词，从第二天开始复习前面学过的词。' : mode === 'review' ? nextDue ? `下次复习在 ${intervalLabel(nextDue.card.due, moment)}后` : '完成新词自测后，这里会按计划安排复习。' : !book ? '选词书 → 看词或读短文 → 自测提交。每组最多 20 词，中途退出会保留进度。' : '今天的词已学过或已标熟，可以回看，或继续下一天。'}</p><div className="button-row">{mode === 'review' && fresh.length > 0 && <button className="primary" disabled={saving} onClick={() => switchMode('learn')}>学习当天新词</button>}{mode === 'review' && !dayMode && !fresh.length && <button className="primary" disabled={saving} onClick={() => switchMode('learn')}>学习新词</button>}{mode !== 'review' && dayMode && queue.length > 0 && <button className="primary" disabled={saving} onClick={() => switchMode('review')}>去复习 · {queue.length} 词</button>}{book && day + 1 < days.length && mode !== 'review' && <button className="primary" onClick={() => void chooseDay(day + 1)}>进入下一天</button>}{!book && <><button className="primary" onClick={onBooks}>选择词书</button><button className="secondary" onClick={onImport}>导入词表</button></>}</div></div> : <>
        {contextMode && draft ? <ContextReader store={store} draft={draft} now={now} services={contextServices} onWord={onOpenWord} onSpeak={onSpeak} onStop={onStop} onCheck={() => { onStop(); void onStudy(draft, { type: 'self-test' }) }} /> : <><ol className="english-grid" aria-label="编号英文词表" key={currentKey}>
          {shownRows.map(row => <li className="english-entry" key={row.id} data-leaving={leaving.includes(row.id)} data-known={row.known} data-word-id={row.id} data-number={number(row.id)} data-mark-count={markLevel(row.markCount)} data-mark-level={markLevel(row.markCount)} data-forgotten={row.forgotten} data-next={store.reviewMethod === 'ebbinghaus' && byId.has(row.id) ? ebbNextLabel(byId.get(row.id)!, row.forgotten) : ''}>
            <SwipeRow disabled={saving || row.missing || (!preview && completed)}
              onSwipeStart={() => { press.current.moved = true; cancelPress() }}
              actions={[
                { label: <><Minus size={16} /><span>减标记</span></>, ariaLabel: `第 ${number(row.id)} 词减一个标记`, tone: 'neutral', disabled: row.markCount === 0 && !row.forgotten, onClick: () => void lessMark(row) },
                row.known
                  ? { label: <><RotateCcw size={16} /><span>取消熟词</span></>, ariaLabel: `取消 ${row.word} 的熟词`, tone: 'known', onClick: () => void onKnown(row.id, false) }
                  : { label: <><CheckCheck size={16} /><span>熟词</span></>, ariaLabel: `把 ${row.word} 设为熟词`, tone: 'known', onClick: () => { const target = { id: row.id, word: row.word }; if (skipKnownConfirm()) void confirmKnown(target); else setKnownTarget(target) } },
              ]}>
              <button className="english-line" disabled={saving || row.missing} aria-label={`${number(row.id)} ${row.word}，标记 ${markLevel(row.markCount)} / 6${row.forgotten ? '，本轮不熟' : ''}`} title="点按加一个标记，左滑减标记或设为熟词，长按查词"
                onPointerDown={event => { if (event.button !== 0) return; cancelPress(); press.current = { x: event.clientX, y: event.clientY, moved: false, held: false }; timer.current = setTimeout(() => { press.current.held = true; onOpenWord(row.id) }, 480) }}
                onPointerMove={event => { if (Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 8) { press.current.moved = true; cancelPress() } }} onPointerUp={cancelPress} onPointerLeave={cancelPress} onPointerCancel={cancelPress}
                onContextMenu={event => { event.preventDefault(); cancelPress(); press.current.held = true; onOpenWord(row.id) }} onClick={event => { if (event.detail === 0 || (!press.current.held && !press.current.moved)) { if (completed && !preview) onOpenWord(row.id); else void tapWord(row) } }}>
                <span className="word-index"><span className="word-number">{number(row.id)}</span><MarkDots count={row.markCount} /></span><span className="word-card-content"><span className="english-stack"><span className={`english-word${row.word.length > 14 ? ' long-word' : ''}`} lang="en">{row.word}</span></span>{preview && <span className="card-meaning">{coreGloss(row.meaning)}</span>}{!!row.status && <span className="study-word-state">{row.status}</span>}{!preview && row.forgotten && <span className="study-word-state">本轮不熟</span>}</span>
              </button>
            </SwipeRow>
          </li>)}
        </ol>
        {knownRows.length > 0 && <p className="known-note" role="status">{showKnown ? `正在显示 ${knownRows.length} 个熟词` : `已隐藏 ${hiddenKnown} 个熟词`}<button className="text-button" onClick={() => setShowKnown(!showKnown)}>{showKnown ? '再次隐藏' : '显示'}</button></p>}
        {!preview && <section className="meaning-section" aria-label="编号中文释义"><div className="meaning-heading"><h2>核对释义</h2><button className="text-button" onClick={() => setShowMeanings(!showMeanings)} aria-label={showMeanings ? '隐藏全部释义' : '显示全部释义'}>{showMeanings ? <EyeOff size={16} /> : <Eye size={16} />}{showMeanings ? '收起释义' : '展开核对'}</button></div>
          {showMeanings && <ol className="meaning-list">{rows.map(row => <li className="meaning-entry" key={row.id} data-word-id={row.id} data-number={number(row.id)} data-open={openMeaning === row.id || undefined}><div className="meaning-row"><span className="word-number">{number(row.id)}</span><button className="meaning-main" aria-expanded={openMeaning === row.id} aria-label={`第 ${number(row.id)} 词词典释义`} onClick={() => setOpenMeaning(openMeaning === row.id ? null : row.id)}><span className="meaning-word" lang="en">{row.word}</span><span className="meaning-line"><span className="chinese-meaning">{coreGloss(row.meaning)}</span><ChevronDown size={14} aria-hidden="true" /></span></button><button className="text-button meaning-check" aria-label={`${row.forgotten ? '取消' : '标记'}第 ${number(row.id)} 词不熟`} aria-pressed={row.forgotten} disabled={saving || completed || row.missing} onClick={() => void markEntry(row.id, row.forgotten ? -1 : 1)}>{row.forgotten ? '已标不熟' : '不熟'}</button><button className="study-mark" disabled={row.missing} onClick={() => onOpenWord(row.id)} aria-label={`第 ${number(row.id)} 词详情`}><MarkDots count={row.markCount} /></button></div>{openMeaning === row.id && <div className="meaning-dict" aria-label={`${row.word} 词典释义`}><LocalDictionary compact word={row.word} meaning={row.meaning} />{!row.missing && <button className="text-button" onClick={() => onOpenWord(row.id)}>词条详情</button>}</div>}</li>)}</ol>}
          {showMeanings && <button className="text-button" aria-label="返回英文词表" onClick={scrollToEnglish}>返回词表</button>}
        </section>}
        {!preview && <div className="study-submit-area">
          {completed ? <p role="status" className="group-done"><span className="done-badge" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>本组已检查完，下次复习已安排。</p> : mode === 'practice' ? <p>自由练习保留反馈，不改变复习时间。{practiceDone && '本次练习已完成。'}</p> : <p>不熟 {forgotten} 词，其余 {eligible.length - forgotten} 词。提交表示其余词已自测记住。</p>}
          {changed && draft && <button className="secondary" disabled={saving} onClick={() => void onStudy(draft, { type: 'refresh' })}>重新检查本组</button>}
          {mode === 'practice' ? <button className="secondary" disabled={saving || practiceDone} onClick={() => void practiceState({ completedAt: new Date(now).toISOString() })}><Check size={17} />练习完成</button> : draft && !completed ? <button className="primary complete-group" disabled={saving || changed} onClick={() => void onStudy(draft, { type: 'submit', token: draft.tokens[currentPage] })}><Check size={17} />本组已检查完</button> : <button className="secondary" disabled={saving} onClick={continueStudy}><CheckCheck size={17} />{continueLabel}</button>}
        </div>}
</>}
        <div className="study-pagination"><button className="icon-button" aria-label="上一组" disabled={saving || !currentPage} onClick={() => move(currentPage - 1)}><ChevronLeft size={19} /></button>{groups.length > 1 ? <GlassSlider name="词组" min={1} max={groups.length} value={currentPage + 1} label={page => `${page}`} thumbWidth={42} onCommit={page => { if (!saving) move(page - 1) }} /> : <span className="page-static" aria-label={`第 ${currentPage + 1} 组，共 ${groups.length} 组`}>{currentPage + 1} / {groups.length}</span>}<button className="icon-button" disabled={saving || currentPage >= groups.length - 1} onClick={() => move(currentPage + 1)} aria-label="下一组"><ChevronRight size={19} /></button><button className="icon-button plan-trigger" aria-label="复习计划" title="复习计划" onClick={() => setPlanOpen(true)}><Clock3 size={19} /></button></div>
      </>}
    </div>
    <IonAlert isOpen={knownTarget !== null} cssClass="app-alert" animated={!reduced} header={`把 ${knownTarget?.word || ''} 设为熟词？`}
      message="标记后这个词会从列表中隐藏，学习和复习计划不再安排它，本组提交时也会跳过。可以点“撤销上一步”，或在词详情里关掉“熟词”恢复。"
      onDidDismiss={() => setKnownTarget(null)}
      inputs={[{ type: 'checkbox', label: '以后不再提醒', value: 'skip', checked: false }]}
      buttons={[{ text: '取消', role: 'cancel' }, { text: '设为熟词', handler: (checked?: string[] | string) => {
        if (Array.isArray(checked) ? checked.includes('skip') : checked === 'skip') setSkipKnownConfirm(true)
        if (knownTarget) void confirmKnown(knownTarget)
      } }]} />
    <ChoiceSheet title="学习的天" open={daysOpen} onClose={() => setDaysOpen(false)} value={String(day)} options={dayOptions} onSelect={value => { void chooseDay(Number(value)) }} />
    <IonAlert isOpen={replaceKind !== null} cssClass="app-alert" animated={!reduced} header="结束原学习草稿？" message="已提交的学习记录和难词标记保留，未提交的本轮结果将结束。随后按当前选择重新选词。" onDidDismiss={() => setReplaceKind(null)} buttons={[{ text: '继续原任务', role: 'cancel' }, { text: '结束并重新选词', role: 'destructive', handler: () => { if (replaceKind) void onRestart(replaceKind) } }]} />
    <Sheet title="复习计划" open={planOpen} onClose={() => setPlanOpen(false)} tall><div className="memory-plan"><div className="memory-plan-heading"><h3>{dayMode ? '艾宾浩斯 · 按天复习' : store.reviewMethod === 'ebbinghaus' ? '艾宾浩斯式间隔复习' : 'FSRS 自适应复习'}</h3><span>{dayMode ? `${book?.title} · 第 ${day + 1} 天` : '全部已学单词 · 跨词书去重'}</span></div><div className="memory-totals"><div><strong>{queue.length}</strong><span>{dayMode ? '这一天还要复习' : '到期待复习'}</span></div><div><strong>{dayMode ? plan.reviewTotal : scheduled.length}</strong><span>{dayMode ? '这一天共复习' : '已加入计划'}</span></div></div>
      {reviewDraft && <div className="review-task-summary" aria-label="复习任务进度"><strong>{pendingReviewGroups.length ? `本次已完成 ${reviewDraft.completed.length} / ${reviewDraft.groups.length} 组` : '本次复习已完成'}</strong><span>{pendingReviewGroups.length ? `剩余 ${pendingReviewGroups.length} 组，继续原来的词表和答案。` : queue.length ? `还有 ${queue.length} 词到期，可以开始下一次复习。` : '当前到期任务已处理完，可以学习新词。'}</span>{pendingReviewGroups.length > 0 && laterReviews > 0 && <span>另有 {laterReviews} 词到期，完成本次后继续。</span>}</div>}
      <button className="primary review-continue" disabled={saving} onClick={() => void continueReview()}><RotateCcw size={17} />{pendingReviewGroups.length ? `继续本次复习 · 剩余 ${pendingReviewGroups.length} 组` : queue.length ? `${dayMode ? '开始复习' : '开始到期复习'} · ${queue.length} 词` : '学习新词'}</button>
      <div className="plan-tools" role="group" aria-label="本组操作">
        {book && mode !== 'review' && <button className="secondary plan-wide" disabled={saving} onClick={() => { setPlanOpen(false); switchMode(mode === 'practice' ? 'learn' : 'practice') }}><RotateCcw size={16} />{mode === 'practice' ? '返回当天新词' : '回看当天 · 不改变复习计划'}</button>}
        {!!rows.length && mode !== 'practice' && !contextMode && <button className="secondary" disabled={saving || contextServices.busy} onClick={() => { setPlanOpen(false); chooseStage('context') }}><BookOpen size={16} />读短文</button>}
        {!!rows.length && <button className="secondary" disabled={saving} onClick={() => { setPlanOpen(false); onSpeak(rows.filter(row => !row.missing).map(row => row.word).join('. ')) }}><Volume2 size={16} />朗读本组</button>}
        <button className="secondary" disabled={!canUndo || saving} aria-label="撤销上一步" onClick={() => { setPlanOpen(false); onUndo() }}><RotateCcw size={16} />撤销上一步</button>
        {savedDraft && !draftComplete(draft) && <button className="secondary plan-wide" disabled={saving} onClick={() => { setPlanOpen(false); restart(draft.kind) }}>重新开始本组</button>}
      </div>
      {dayMode ? <table className="memory-table" aria-label="按天复习时间表"><thead><tr><th scope="col">学完那天之后</th><th scope="col">回来复习</th></tr></thead><tbody>{listReviewOffsets.map(offset => <tr key={offset}><th scope="row">第 {offset} 天</th><td>{day + 1 - offset >= 1 ? `第 ${day + 1} 天复习第 ${day + 1 - offset} 天的词` : '—'}</td></tr>)}</tbody></table> : <table className="memory-table" aria-label={store.reviewMethod === 'ebbinghaus' ? '间隔复习时间表' : 'FSRS 复习规则'}><thead><tr><th scope="col">完成阶段</th><th scope="col">下次复习间隔</th></tr></thead><tbody>{store.reviewMethod === 'ebbinghaus' ? <>{memoryIntervals.map((step, index) => <tr key={step.minutes}><th scope="row">{index === 0 ? '首次学习' : `第 ${index} 次复习`}</th><td>{step.label}{index === memoryIntervals.length - 1 ? '，之后每 30 天' : ''}</td></tr>)}<tr><th scope="row">忘记 / 需重学</th><td>5 分钟，重新开始</td></tr></> : <><tr><th scope="row">忘记 / 需重学</th><td>逐词计算重学时间</td></tr><tr><th scope="row">记住</th><td>根据记忆状态逐词调整</td></tr></>}</tbody></table>}
      {dayMode ? <p className="field-note">每个学习天先学当天的新词，再复习第 N-{listReviewOffsets.join('、N-')} 天学过的词，每个词每天复习一次。两项都完成后可以打卡。</p> : <><p className="field-note">间隔从正式提交计算，提前自由练习不推进阶段。固定间隔为应用预设，非个人实测遗忘曲线。</p><div className="review-forecast">{Array.from({ length: 7 }, (_, index) => { const date = new Date(now); date.setDate(date.getDate() + index); return <div key={index}><span>{index === 0 ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`}</span><strong>{scheduled.filter(word => dayKey(word.card.due) === dayKey(date)).length}</strong></div> })}</div><p className="next-review">{nextDue ? `下次复习 · ${intervalLabel(nextDue.card.due, moment)}后` : '暂无后续复习'}</p></>}
    </div></Sheet>
  </section>
}