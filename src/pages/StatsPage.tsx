import { ChevronRight, Flame, Search, TrendingUp } from 'lucide-react'
import { bookDays, dayKey, markLevel, type Store } from '../model'
import { hasLearned, reviewQueue } from '../study'

type Props = { store: Store; now: number; onLibrary: () => void; onFrequency: () => void; onBooks: () => void }

const shortDate = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`

/** 统计: the current book's progress, the last and next 7 days, mark spread and streak. */
export default function StatsPage({ store, now, onLibrary, onFrequency, onBooks }: Props) {
  const moment = new Date(now)
  const book = store.books.find(item => item.id === store.activeBookId)
  const byId = new Map(store.words.map(word => [word.id, word]))
  const days = book ? bookDays(book) : []
  const inBook = book ? book.wordIds.map(id => byId.get(id)).filter(word => !!word) : []
  const learned = inBook.filter(word => hasLearned(word!)).length
  const known = inBook.filter(word => word!.known).length
  const today = book ? Math.min(book.currentDay + 1, Math.max(1, days.length)) : 0

  // Last 7 days: words learned for the first time, and distinct words reviewed.
  const past = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(moment); date.setDate(date.getDate() - (6 - i))
    const key = dayKey(date)
    return {
      label: i === 6 ? '今天' : shortDate(date),
      learned: store.words.filter(word => word.firstLearnedAt && dayKey(word.firstLearnedAt) === key).length,
      reviewed: new Set(store.reviews.filter(review => review.kind === 'review' && dayKey(review.at) === key).map(review => review.wordId)).size,
    }
  })
  const pastMax = Math.max(1, ...past.map(day => day.learned + day.reviewed))

  // Next 7 days: scheduled reviews by due day (overdue words count for today).
  const scheduled = store.words.filter(word => hasLearned(word) && !word.known)
  const due = reviewQueue(store, moment).length
  const next = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(moment); date.setDate(date.getDate() + i)
    const key = dayKey(date)
    return { label: i === 0 ? '今天' : shortDate(date), count: i === 0 ? due : scheduled.filter(word => dayKey(word.card.due) === key).length }
  })
  const nextMax = Math.max(1, ...next.map(day => day.count))

  // Six-dot marks over every word that has at least one.
  const marks = [1, 2, 3, 4, 5, 6].map(level => ({ level, count: store.words.filter(word => !word.known && markLevel(word.markCount) === level).length }))
  const marksMax = Math.max(1, ...marks.map(item => item.count))

  // Consecutive days with any study, ending today (or yesterday if nothing yet today).
  const active = new Set([...store.reviews.map(review => dayKey(review.at)), ...store.words.filter(word => word.firstLearnedAt).map(word => dayKey(word.firstLearnedAt!))])
  let streak = 0
  const cursor = new Date(moment)
  if (!active.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (active.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1) }

  return <div className="stats-page">
    <section className="stats-card stats-book" aria-label="当前词书">
      {book ? <>
        <button className="stats-book-title" onClick={onBooks} aria-label="词书管理"><strong>{book.title}</strong><ChevronRight size={17} /></button>
        <div className="stats-figures">
          <div><strong>{today}<small> / {days.length || 1}</small></strong><span>第几天</span></div>
          <div><strong>{learned.toLocaleString()}</strong><span>已学</span></div>
          <div><strong>{known.toLocaleString()}</strong><span>熟词</span></div>
          <div><strong>{streak}</strong><span><Flame size={12} />连续天数</span></div>
        </div>
        <progress value={learned + known} max={Math.max(1, inBook.length)} aria-label={`${book.title} 学习进度`} />
        <p className="stats-note">{book.wordIds.length.toLocaleString()} 词 · 每天 {book.dailyCount} 词 · 20 个一组</p>
      </> : <button className="stats-book-title" onClick={onBooks} aria-label="词书管理"><strong>还没有词书</strong><ChevronRight size={17} /></button>}
    </section>

    <section className="stats-card" aria-label="最近 7 天">
      <h2>最近 7 天</h2>
      <div className="stats-bars" role="list">{past.map(day => <div key={day.label} role="listitem" className="stats-bar" aria-label={`${day.label} 新学 ${day.learned} 复习 ${day.reviewed}`}>
        <span className="stats-bar-track"><i className="is-review" style={{ height: `${(day.reviewed / pastMax) * 100}%` }} /><i className="is-new" style={{ height: `${(day.learned / pastMax) * 100}%` }} /></span>
        <small>{day.label}</small>
      </div>)}</div>
      <p className="stats-legend"><i className="is-new" />新学<i className="is-review" />复习</p>
    </section>

    <section className="stats-card" aria-label="未来 7 天复习">
      <h2>未来 7 天复习</h2>
      <div className="stats-bars" role="list">{next.map(day => <div key={day.label} role="listitem" className="stats-bar" aria-label={`${day.label} 复习 ${day.count}`}>
        <span className="stats-bar-value">{day.count || ''}</span>
        <span className="stats-bar-track"><i className="is-review" style={{ height: `${(day.count / nextMax) * 100}%` }} /></span>
        <small>{day.label}</small>
      </div>)}</div>
    </section>

    <section className="stats-card" aria-label="标记分布">
      <h2>标记分布</h2>
      <div className="stats-marks">{marks.map(item => <div key={item.level}>
        <span>{item.level} 点</span><span className="stats-mark-track"><i style={{ width: `${(item.count / marksMax) * 100}%` }} /></span><b>{item.count}</b>
      </div>)}</div>
    </section>

    <div className="settings-menu stats-links">
      <button onClick={onLibrary} aria-label="我的单词"><Search size={20} /><span>我的单词<small>搜索、筛选难词和熟词</small></span><ChevronRight size={16} /></button>
      <button onClick={onFrequency} aria-label="考频查询"><TrendingUp size={20} /><span>考频查询<small>2022–2026 卷面考频</small></span><ChevronRight size={16} /></button>
    </div>
  </div>
}
