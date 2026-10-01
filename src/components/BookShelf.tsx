import { useEffect, useState } from 'react'
import { BookOpen, Check, ChevronRight, Download, LoaderCircle, Search } from 'lucide-react'
import { bookDays, type Store, type WordBook } from '../model'
import { hasLearned } from '../study'
import type { CatalogBook } from '../wordbooks'
import { loadExamFrequency, type ExamFrequencyData } from '../exam-frequency'
import Sheet from './Sheet'
import { Segmented } from './Controls'
import ExamFrequencyView from './ExamFrequencyView'
import BookDetail from './BookDetail'
import DailyWordCount, { validDailyCount } from './DailyWordCount'

type Props = {
  store: Store; catalog: CatalogBook[]; busy: boolean; error: string;
  onRetry: () => void; onLibrary: () => void;
  onActivate: (id: string) => void; onInstall: (book: CatalogBook, daily: number) => Promise<boolean>;
  onWord: (id: string) => void;
}
export default function BookShelf({ store, catalog, busy, error, onRetry, onLibrary, onActivate, onInstall, onWord }: Props) {
  const [view, setView] = useState<'mine' | 'catalog' | 'frequency'>(store.books.length ? 'mine' : 'catalog')
  const [selected, setSelected] = useState<CatalogBook | null>(null)
  const [opened, setOpened] = useState<WordBook | null>(null)
  const [preview, setPreview] = useState<ExamFrequencyData>()
  const [daily, setDaily] = useState(Math.max(5, Math.min(100, store.goal)))
  useEffect(() => { if (selected?.exam) loadExamFrequency().then(setPreview).catch(() => setPreview(undefined)) }, [selected?.id])
  const learnedIds = new Set(store.words.filter(hasLearned).map(w => w.id))
  return <div className="book-shelf">
    <p className="page-purpose">选一本词书，按单元学习。每本书的进度分别保留。</p>
    <div className="shelf-toolbar"><Segmented<'mine' | 'catalog' | 'frequency'> label="词书视图" value={view} onChange={setView}
      options={[{ value: 'mine', label: '我的词书' }, { value: 'catalog', label: '添加词书' }]} /></div>
    <div className="shelf-links"><button className="text-button" aria-label="我的单词" onClick={onLibrary}><Search size={16} />查找我的单词</button><button className="text-button" aria-pressed={view === 'frequency'} onClick={() => setView(view === 'frequency' ? 'mine' : 'frequency')}>考频查询<ChevronRight size={15} /></button></div>
    {view === 'frequency' ? <ExamFrequencyView initialExam={catalog.find(book => book.id === store.activeBookId)?.exam || (store.activeBookId === 'ecdict-ky' ? 'ky1' : 'cet4')} /> : view === 'mine' ? <>
      {!store.books.length ? <div className="empty"><BookOpen size={32} /><h2>还没有词书</h2><button className="primary" onClick={() => setView('catalog')}>选择词书<ChevronRight size={17} /></button></div> :
        <div className="owned-books">{store.books.map(book => {
          const meta = catalog.find(c => c.id === book.id) || (book.id === 'ecdict-ky' ? catalog.find(c => c.tag === 'ky') : undefined)
          const learned = book.wordIds.filter(id => learnedIds.has(id)).length
          const days = bookDays(book)
          return <button className="owned-book" key={book.id} disabled={busy} onClick={() => setOpened(book)}>
            <span className="book-cover" style={{ background: meta?.color || '#56a495' }}><BookOpen size={25} /><b>{meta?.label || 'MY WORDS'}</b></span>
            <span className="owned-book-info"><strong>{book.title}{book.id === store.activeBookId && <small className="current-book-badge">正在学习</small>}</strong>
              <span>{book.wordIds.length.toLocaleString()} 词 · 每单元 {book.dailyCount} 词</span>
              <progress value={learned} max={Math.max(1, book.wordIds.length)} aria-label={`${book.title} 学习进度`} />
              <small>已学 {learned} 词 · 第 {Math.min(book.currentDay + 1, Math.max(1, days.length))} / {days.length || 1} 单元</small></span>
            <ChevronRight size={19} />
          </button>
        })}</div>}
      {store.activeBookId && <button className="primary wide-button shelf-continue" disabled={busy} onClick={() => onActivate(store.activeBookId)}>继续学习 · {store.books.find(book => book.id === store.activeBookId)?.title}<ChevronRight size={17} /></button>}
    </> : <>
      <p className="source-note">选择词书后可设置每单元词量。词表来自 ECDICT 分类，非官方出版词书。</p>
      {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={onRetry}>重新加载</button></div>}
      {!catalog.length && !error && <div className="empty"><LoaderCircle className="spin" size={24} /></div>}
      <div className="catalog-grid">{catalog.map(book => {
        const installed = store.books.some(b => b.id === book.id)
        return <button className="catalog-book" key={book.id} disabled={busy} onClick={() => {
          const owned = store.books.find(item => item.id === book.id)
          if (owned) setOpened(owned)
          else setSelected(book)
        }}>
          <span className="book-cover large" style={{ background: book.color }}><BookOpen size={30} /><b>{book.label}</b></span>
          <strong>{book.title}</strong><span>{book.count.toLocaleString()} 词</span>
          <small>{installed ? <><Check size={13} />已加入</> : <><Download size={13} />加入词书</>}</small>
        </button>
      })}</div>
    </>}
    <Sheet title={selected?.title || '加入词书'} open={!!selected} onClose={() => setSelected(null)} dismissible={!busy}>
      {selected && <div className="book-setup">
        <div className="book-setup-title"><span className="book-cover" style={{ background: selected.color }}><BookOpen size={24} /><b>{selected.label}</b></span>
          <div><h3>{selected.title}</h3><p>{selected.count.toLocaleString()} 词 · 本地词库</p></div></div>
        <DailyWordCount label="本书每单元词量" value={daily} onChange={setDaily} disabled={busy} />
        {validDailyCount(daily) && <p className="field-note">{Math.ceil(selected.count / daily)} 个单元 · 最后单元 {selected.count % daily || daily} 词</p>}
        <p className="source-note">来源：{selected.source}。{selected.exam ? '按 2022–2026 卷面出现试卷数、总词次排序，零命中词保留在后。' : '原词序依据 COCA/BNC。'}已有单词沿用当前记录。</p>
        {selected.exam && preview && <ol className="book-preview">{preview.exams[selected.exam].words.slice(0, 5).map(word => <li key={word.word}><b lang="en">{word.word}</b><span>{word.papers} 套 · {word.occurrences} 次</span></li>)}</ol>}
        <button className="primary wide-button" disabled={busy || !validDailyCount(daily)} onClick={async () => { if (await onInstall(selected, daily)) setSelected(null) }}>{busy ? <LoaderCircle className="spin" size={18} /> : <BookOpen size={18} />}开始学习</button>
      </div>}
    </Sheet>
    {opened && <BookDetail book={store.books.find(item => item.id === opened.id) || opened} store={store} meta={catalog.find(item => item.id === opened.id)} busy={busy} onClose={() => setOpened(null)} onWord={onWord} onStudy={() => { setOpened(null); onActivate(opened.id) }} />}
  </div>
}
