import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { coreGloss } from '../gloss'
import { bookDays, type Store, type WordBook } from '../model'
import { hasLearned } from '../study'
import type { CatalogBook } from '../wordbooks'
import { combinedExamRank, examFrequencyFor, loadExamFrequency, type ExamFrequencyData } from '../exam-frequency'
import Sheet from './Sheet'

type Props = {
  book: WordBook
  store: Store
  meta?: CatalogBook
  busy: boolean
  onClose: () => void
  onStudy: () => void
  onWord: (id: string) => void
}
export default function BookDetail({ book, store, meta, busy, onClose, onStudy, onWord }: Props) {
  const [data, setData] = useState<ExamFrequencyData>()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(40)
  useEffect(() => { loadExamFrequency().then(setData).catch(() => setData(undefined)) }, [])
  useEffect(() => { setQuery(''); setLimit(40) }, [book.id])
  const byId = useMemo(() => new Map(store.words.map(word => [word.id, word])), [store.words])
  const known = useMemo(() => new Set(store.words.filter(word => word.known).map(word => word.id)), [store.words])
  const days = bookDays(book)
  const learned = book.wordIds.filter(id => { const word = byId.get(id); return word && hasLearned(word) }).length
  const rows = useMemo(() => book.wordIds.flatMap((id, index) => {
    const word = byId.get(id)
    if (!word) return []
    const rank = !data ? null : meta?.exam ? examFrequencyFor(data, meta.exam, word.word) : combinedExamRank(data, word.word)
    return [{ word, index, rank }]
  }), [book.wordIds, byId, data, meta?.exam])
  const needle = query.trim().toLowerCase()
  const visible = rows.filter(row => !needle || row.word.word.toLowerCase().includes(needle) || row.word.meaning.toLowerCase().includes(needle))
  const heard = rows.filter(row => row.rank && row.rank.papers > 0).length
  const scope = meta?.exam ? `${meta.title.replace('词汇', '')}近五年` : '四级、六级、考研合计'
  return <Sheet title={book.title} open tall onClose={onClose}>
    <div className="book-detail">
      <div className="book-detail-summary">
        <span>{book.wordIds.length.toLocaleString()} 词 · 每单元 {book.dailyCount}</span>
        <span>已学 {learned.toLocaleString()} · 熟词 {book.wordIds.filter(id => known.has(id)).length} · 第 {Math.min(book.currentDay + 1, Math.max(1, days.length))} / {days.length || 1} 单元</span>
        <span>{data ? `${scope}考到 ${heard.toLocaleString()} 词` : '正在读取考频'}</span>
      </div>
      <p className="source-note">{meta?.exam ? '学习顺序按这门考试 2022–2026 的卷面试卷数，其次按词次。' : '学习顺序按四级、六级、考研英语一和英语二的合计试卷数，其次按词次。'}</p>
      <div className="search-field"><Search size={16} /><input aria-label="搜索这本书" placeholder="搜索单词或释义" value={query} onChange={event => { setQuery(event.target.value); setLimit(40) }} /></div>
      <div className="book-detail-list">
        {visible.slice(0, limit).map(row => <button className="book-detail-row" key={row.word.id} onClick={() => onWord(row.word.id)}>
          <span>{String(row.index + 1).padStart(2, '0')}</span>
          <strong lang="en">{row.word.word}</strong>
          <em>{coreGloss(row.word.meaning)}</em>
          <small>{row.rank ? (row.rank.papers ? `${row.rank.papers} 套 · ${row.rank.occurrences} 次` : '未考到') : '…'}</small>
        </button>)}
        {!visible.length && <p className="source-note">这本书里没有匹配的词。</p>}
      </div>
      {visible.length > limit && <button className="secondary load-more" onClick={() => setLimit(value => value + 40)}>显示更多</button>}
      <button className="primary wide-button" disabled={busy} onClick={onStudy}>{book.id === store.activeBookId ? '继续学习' : '学习这本词书'}</button>
    </div>
  </Sheet>
}
