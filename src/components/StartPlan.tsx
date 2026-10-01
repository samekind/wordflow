import { useState } from 'react'
import { BookOpen, Check, ChevronLeft, ChevronRight, LoaderCircle, Upload } from 'lucide-react'
import type { CatalogBook } from '../wordbooks'
import type { Store } from '../model'
import { planSchedule, planSummary } from '../study-plan'
import DailyWordCount, { validDailyCount } from './DailyWordCount'

type Props = {
  store: Store
  catalog: CatalogBook[]
  busy: boolean
  error: string
  onRetry: () => void
  onInstall: (book: CatalogBook, daily: number) => Promise<boolean>
  onImport: () => void
}

/** D1, D2 … = the words of day 1, day 2 of the plan. */
const unitName = (unit: number) => `D${unit + 1}`
const md = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`

/** First run: 选词书 → 定计划 → 看复习安排 → 开始背单词. Shown on 学习 until a book is chosen. */
export default function StartPlan({ store, catalog, busy, error, onRetry, onInstall, onImport }: Props) {
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [book, setBook] = useState<CatalogBook | null>(null)
  const [daily, setDaily] = useState(Math.max(5, Math.min(100, store.goal || 20)))
  const valid = validDailyCount(daily)
  const summary = book && valid ? planSummary(book.count, daily) : null
  const schedule = book && valid ? planSchedule(book.count, daily, 14) : []
  const peak = schedule.reduce((max, day) => Math.max(max, day.newWords + day.reviewWords), 0)

  return <section className="start-plan" aria-label="开始学习">
    <ol className="start-steps" aria-label="步骤">{['选词书', '定计划', '看安排'].map((label, index) =>
      <li key={label} aria-current={step === index ? 'step' : undefined} data-done={step > index}>{step > index ? <Check size={12} /> : index + 1}<span>{label}</span></li>)}</ol>

    {step === 0 && <>
      <h1 className="start-title">选一本词书</h1>
      {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={onRetry}>重新加载</button></div>}
      {!catalog.length && !error && <div className="empty"><LoaderCircle className="spin" size={24} /></div>}
      <div className="start-books">{catalog.map(item => <button key={item.id} className="start-book" aria-pressed={book?.id === item.id} disabled={busy}
        onClick={() => { setBook(item); setStep(1) }}>
        <span className="book-cover" style={{ background: item.color }}><BookOpen size={20} /><b>{item.label}</b></span>
        <span><strong>{item.title}</strong><small>{item.count.toLocaleString()} 词</small></span>
        <ChevronRight size={17} />
      </button>)}</div>
      <button className="text-button start-import" onClick={onImport}><Upload size={15} />用自己的词表</button>
    </>}

    {step === 1 && book && <>
      <h1 className="start-title">每天背多少？</h1>
      <p className="start-lead">{book.title} · {book.count.toLocaleString()} 词。每天学一天的词，20 个一组，之后按时复习。</p>
      <DailyWordCount label="每天新词" value={daily} onChange={setDaily} disabled={busy} />
      {summary && <div className="start-summary">
        <div><strong>{summary.units}</strong><span>天学完新词</span></div>
        <div><strong>{Math.ceil(daily / 20)}</strong><span>组 / 天（20 词一组）</span></div>
        <div><strong>{md(summary.finish)}</strong><span>预计学完</span></div>
      </div>}
      <div className="start-actions"><button className="secondary" onClick={() => setStep(0)}><ChevronLeft size={16} />换词书</button>
        <button className="primary" disabled={!valid} onClick={() => setStep(2)}>看复习安排<ChevronRight size={16} /></button></div>
    </>}

    {step === 2 && book && summary && <>
      <h1 className="start-title">未来两周的安排</h1>
      <p className="start-lead">每天学当天的词，20 个一组；学过的那一天在第 1、2、4、7、15 天后回来复习。最多的一天约 {peak} 词。</p>
      <table className="start-schedule" aria-label="未来两周学习安排">
        <thead><tr><th scope="col">日期</th><th scope="col">新学</th><th scope="col">复习（第几天的词）</th><th scope="col">合计</th></tr></thead>
        <tbody>{schedule.map(day => {
          const date = new Date(); date.setDate(date.getDate() + day.day)
          const total = day.newWords + day.reviewWords
          return <tr key={day.day} data-today={day.day === 0}>
            <th scope="row">{day.day === 0 ? '今天' : day.day === 1 ? '明天' : md(date)}</th>
            <td>{day.newUnit === null ? '—' : <><b>{unitName(day.newUnit)}</b> {day.newWords}</>}</td>
            <td className="start-review">{day.reviewUnits.length ? day.reviewUnits.map(unitName).join(' ') : '—'}</td>
            <td><span className="start-load" style={{ '--load': peak ? total / peak : 0 } as React.CSSProperties}>{total}</span></td>
          </tr>
        })}</tbody>
      </table>
      <p className="field-note">按时完成时的预估。漏掉的复习会顺延到下次打开；FSRS 模式会按每个词的记忆情况调整。</p>
      <div className="start-actions"><button className="secondary" disabled={busy} onClick={() => setStep(1)}><ChevronLeft size={16} />改计划</button>
        <button className="primary" disabled={busy} onClick={() => void onInstall(book, daily)}>{busy ? <LoaderCircle className="spin" size={17} /> : <BookOpen size={17} />}开始背单词</button></div>
    </>}
  </section>
}
