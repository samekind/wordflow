import { Check, CheckCheck, ChevronRight, Flame, Search, TrendingUp } from 'lucide-react'
import { bookDays, dayKey, listReviewOffsets, markLevel, type Store } from '../model'
import { checkInStreak, dayPlan, hasLearned, reviewQueue, usesDaySchedule } from '../study'

type Props = { store: Store; now: number; saving: boolean; onCheckIn: () => Promise<boolean>; onStudy: () => void; onLibrary: () => void; onFrequency: () => void; onBooks: () => void }

const shortDate = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`

/** 统计: today's task and check-in, the daily plan, checked-in history, streak and the book's progress. */
export default function StatsPage({ store, now, saving, onCheckIn, onStudy, onLibrary, onFrequency, onBooks }: Props) {
  const moment = new Date(now)
  const book = store.books.find(item => item.id === store.activeBookId)
  const byId = new Map(store.words.map(word => [word.id, word]))
  const days = book ? bookDays(book) : []
  const inBook = book ? book.wordIds.map(id => byId.get(id)).filter(word => !!word) : []
  const learned = inBook.filter(word => hasLearned(word!)).length
  const known = inBook.filter(word => word!.known).length
  const plan = dayPlan(store, moment)
  const dayMode = usesDaySchedule(store) && !!book
  const checkins = new Map(store.checkins.map(item => [item.date, item]))
  const streak = checkInStreak(store, moment)
  const newDone = plan.newTotal - plan.newLeft, reviewDone = plan.reviewTotal - plan.reviewLeft

  // Last 7 days: only checked-in days count.
  const past = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(moment); date.setDate(date.getDate() - (6 - i))
    const entry = checkins.get(dayKey(date))
    return { label: i === 6 ? '今天' : shortDate(date), entry }
  })
  const pastMax = Math.max(1, ...past.map(day => (day.entry?.newCount || 0) + (day.entry?.reviewCount || 0)))
  const weekNew = past.reduce((sum, day) => sum + (day.entry?.newCount || 0), 0)
  const weekReview = past.reduce((sum, day) => sum + (day.entry?.reviewCount || 0), 0)

  // The last 28 dates as a check-in calendar.
  const calendar = Array.from({ length: 28 }, (_, i) => {
    const date = new Date(moment); date.setDate(date.getDate() - (27 - i))
    return { key: dayKey(date), label: shortDate(date), done: checkins.has(dayKey(date)), today: i === 27 }
  })

  // Coming study days: how many words each brings back (按天复习), or due dates (FSRS).
  const next = dayMode && book
    ? Array.from({ length: 7 }, (_, i) => {
      const index = plan.day + 1 + i
      const count = index < days.length ? listReviewOffsets.map(offset => index - offset).filter(value => value >= 0).flatMap(value => days[value]).filter(id => { const word = byId.get(id); return !!word && !word.known }).length : 0
      return { label: `第 ${index + 1} 天`, short: `${index + 1}`, count, beyond: index >= days.length }
    }).filter(item => !item.beyond)
    : Array.from({ length: 7 }, (_, i) => {
      const date = new Date(moment); date.setDate(date.getDate() + i)
      const key = dayKey(date)
      const scheduled = store.words.filter(word => hasLearned(word) && !word.known)
      return { label: i === 0 ? '今天' : shortDate(date), short: i === 0 ? '今天' : shortDate(date), count: i === 0 ? reviewQueue(store, moment).length : scheduled.filter(word => dayKey(word.card.due) === key).length, beyond: false }
    })
  const nextMax = Math.max(1, ...next.map(day => day.count))

  const marks = [1, 2, 3, 4, 5, 6].map(level => ({ level, count: store.words.filter(word => !word.known && markLevel(word.markCount) === level).length }))
  const marksMax = Math.max(1, ...marks.map(item => item.count))

  return <div className="stats-page">
    <section className="stats-card stats-today" aria-label="今日任务">
      <div className="stats-today-head"><h2>今日任务</h2>{book && <span>第 {plan.day + 1} 天 · {book.title}</span>}</div>
      {book ? <>
        <div className="stats-task-rows">
          <div className="stats-task"><span>当天新学</span><progress value={newDone} max={Math.max(1, plan.newTotal)} aria-label="当天新学进度" /><b>{newDone} / {plan.newTotal}</b></div>
          {dayMode && <div className="stats-task"><span>需要复习</span><progress className="is-review" value={reviewDone} max={Math.max(1, plan.reviewTotal)} aria-label="需要复习进度" /><b>{reviewDone} / {plan.reviewTotal}</b></div>}
        </div>
        {plan.checkin
          ? <p className="stats-checkin is-done" role="status"><CheckCheck size={17} />今日已打卡 · 新学 {plan.checkin.newCount} 词 · 复习 {plan.checkin.reviewCount} 词</p>
          : plan.idle
            ? <button className="secondary stats-checkin-button" onClick={onStudy}>第 {plan.day + 1} 天已经学完，{plan.nextDay !== null ? `进入第 ${plan.nextDay + 1} 天继续` : '这本词书已全部学完'}<ChevronRight size={16} /></button>
          : plan.finished
            ? <button className="primary stats-checkin-button" disabled={saving} onClick={() => void onCheckIn()}><Check size={17} />打卡 · 今天新学 {plan.newToday} 词、复习 {plan.reviewedToday} 词</button>
            : <button className="secondary stats-checkin-button" onClick={onStudy}>还差 {plan.newLeft ? `新学 ${plan.newLeft} 词` : ''}{plan.newLeft && plan.reviewLeft ? '、' : ''}{plan.reviewLeft ? `复习 ${plan.reviewLeft} 词` : ''}，学完即可打卡<ChevronRight size={16} /></button>}
        <p className="stats-note">每天新学 {book.dailyCount} 词{dayMode ? `；第 N 天复习第 N-${listReviewOffsets.join('、N-')} 天学过的词` : '；复习按 FSRS 记忆状态安排'}</p>
      </> : <button className="stats-book-title" onClick={onBooks} aria-label="词书管理"><strong>还没有词书</strong><ChevronRight size={17} /></button>}
    </section>

    <section className="stats-card" aria-label="打卡记录">
      <div className="stats-figures">
        <div><strong>{streak}</strong><span><Flame size={12} />连续打卡</span></div>
        <div><strong>{store.checkins.length}</strong><span>累计打卡</span></div>
        <div><strong>{weekNew}</strong><span>本周新学</span></div>
        <div><strong>{weekReview}</strong><span>本周复习</span></div>
      </div>
      <div className="checkin-calendar" role="list" aria-label="最近 28 天打卡">{calendar.map(day => <span key={day.key} role="listitem" data-done={day.done} data-today={day.today} title={day.label} aria-label={`${day.label} ${day.done ? '已打卡' : '未打卡'}`} />)}</div>
    </section>

    <section className="stats-card" aria-label="最近 7 天">
      <h2>最近 7 天 <small>只统计打卡的日子</small></h2>
      <div className="stats-bars" role="list">{past.map(day => <div key={day.label} role="listitem" className="stats-bar" data-empty={!day.entry} aria-label={day.entry ? `${day.label} 新学 ${day.entry.newCount} 复习 ${day.entry.reviewCount}` : `${day.label} 未打卡`}>
        <span className="stats-bar-value">{day.entry ? day.entry.newCount + day.entry.reviewCount : ''}</span>
        <span className="stats-bar-track"><i className="is-review" style={{ height: `${((day.entry?.reviewCount || 0) / pastMax) * 100}%` }} /><i className="is-new" style={{ height: `${((day.entry?.newCount || 0) / pastMax) * 100}%` }} /></span>
        <small>{day.label}</small>
      </div>)}</div>
      <p className="stats-legend"><i className="is-new" />新学<i className="is-review" />复习</p>
    </section>

    <section className="stats-card" aria-label={dayMode ? '接下来的学习天复习' : '未来 7 天复习'}>
      <h2>{dayMode ? '接下来几天要复习' : '未来 7 天复习'}</h2>
      {next.length ? <div className="stats-bars" role="list">{next.map(day => <div key={day.label} role="listitem" className="stats-bar" aria-label={`${day.label} 复习 ${day.count}`}>
        <span className="stats-bar-value">{day.count || ''}</span>
        <span className="stats-bar-track"><i className="is-review" style={{ height: `${(day.count / nextMax) * 100}%` }} /></span>
        <small>{dayMode ? `第${day.short}天` : day.short}</small>
      </div>)}</div> : <p className="stats-note">词书已到最后一天。</p>}
    </section>

    <section className="stats-card stats-book" aria-label="当前词书">
      {book ? <>
        <button className="stats-book-title" onClick={onBooks} aria-label="词书管理"><strong>{book.title}</strong><ChevronRight size={17} /></button>
        <div className="stats-figures">
          <div><strong>{plan.day + 1}<small> / {days.length || 1}</small></strong><span>第几天</span></div>
          <div><strong>{learned.toLocaleString()}</strong><span>已学</span></div>
          <div><strong>{known.toLocaleString()}</strong><span>熟词</span></div>
          <div><strong>{(inBook.length - learned - known > 0 ? inBook.length - learned - known : 0).toLocaleString()}</strong><span>未学</span></div>
        </div>
        <progress value={learned + known} max={Math.max(1, inBook.length)} aria-label={`${book.title} 学习进度`} />
        <p className="stats-note">{book.wordIds.length.toLocaleString()} 词 · 每天 {book.dailyCount} 词 · 20 个一组</p>
      </> : <button className="stats-book-title" onClick={onBooks} aria-label="词书管理"><strong>还没有词书</strong><ChevronRight size={17} /></button>}
    </section>

    <section className="stats-card" aria-label="标记分布">
      <h2>标记分布</h2>
      <div className="stats-marks">{marks.map(item => <div key={item.level}>
        <span>{item.level} 点</span><span className="stats-mark-track"><i style={{ width: `${(item.count / marksMax) * 100}%` }} /></span><b>{item.count}</b>
      </div>)}</div>
    </section>

    <div className="settings-menu stats-links"><div className="settings-group">
      <button onClick={onLibrary} aria-label="我的单词"><Search size={20} /><span>我的单词<small>搜索、筛选难词和熟词</small></span><ChevronRight size={16} /></button>
      <button onClick={onFrequency} aria-label="考频查询"><TrendingUp size={20} /><span>考频查询<small>2022–2026 卷面考频</small></span><ChevronRight size={16} /></button>
    </div></div>
  </div>
}
