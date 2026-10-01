import { useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, CheckCheck, Eye, EyeOff, Search } from 'lucide-react'
import { markLevel, type Store } from '../model'
import { coreGloss } from '../gloss'
import MarkDots from '../components/MarkDots'
import { Segmented } from '../components/Controls'

type Filter = 'all' | 'marked' | 'known'
type Props = { store: Store; onWord: (id: string) => void; onBooks: () => void }

/** 我的单词: search across all books, filter marked / known words, conceal meanings for self-checks. */
export default function LibraryPage({ store, onWord, onBooks }: Props) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState('weak')
  const [limit, setLimit] = useState(300)
  const [hidden, setHidden] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const words = useMemo(() => store.words.filter(w => `${w.word} ${w.meaning} ${w.batch}`.toLowerCase().includes(search.trim().toLowerCase()))
    .filter(w => filter === 'all' || (filter === 'marked' && w.markCount > 0 && !w.known) || (filter === 'known' && w.known))
    .sort((a, b) => sort === 'alpha' ? a.word.localeCompare(b.word) : sort === 'recent' ? b.addedAt.localeCompare(a.addedAt) : markLevel(b.markCount) - markLevel(a.markCount) || b.failures - a.failures), [store.words, search, filter, sort])
  useEffect(() => setLimit(300), [search, filter, sort])
  const toggle = (id: string) => setRevealed(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next })

  return <>
    <p className="page-purpose">查找所有词书中的单词，整理难词与熟词。点单词查看详情。</p>
    <div className="library-toolbar"><div className="search-field"><Search size={18} /><input aria-label="搜索词库" placeholder="搜索单词或释义" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <label className="sort-field"><ArrowDownUp size={16} /><select aria-label="单词排序" value={sort} onChange={event => setSort(event.target.value)}><option value="weak">标记程度</option><option value="recent">最近加入</option><option value="alpha">字母顺序</option></select></label>
      <button className="icon-button" aria-label={hidden ? '显示释义' : '隐藏释义'} title={hidden ? '显示释义' : '隐藏释义'} onClick={() => { setHidden(!hidden); setRevealed(new Set()) }}>{hidden ? <EyeOff size={19} /> : <Eye size={19} />}</button>
    </div>
    <div className="filter-row"><Segmented label="单词筛选" value={filter} onChange={setFilter}
      options={[{ value: 'all', label: '全部' }, { value: 'marked', label: '已标记' }, { value: 'known', label: '熟词' }]} /><span>{words.length.toLocaleString()} 词</span></div>
    {filter !== 'all' && <p className="field-note">{filter === 'known' ? '熟词已移出学习队列，可在详情中放回学习。' : '六点标记表示需要关注的程度，可在详情中增减。'}</p>}
    {words.length ? <div className="word-table">{words.slice(0, limit).map(word => <div className="word-row" key={word.id}>
      <button className="word-cell" onClick={() => onWord(word.id)}><strong>{word.word}</strong><span>{word.phonetic || word.batch}</span></button>
      <button className={`meaning-cell ${hidden && !revealed.has(word.id) ? 'concealed' : ''}`} onClick={() => toggle(word.id)}>{hidden && !revealed.has(word.id) ? <Eye size={17} /> : coreGloss(word.meaning)}</button>
      <span className="library-marker" aria-label={word.known ? '熟词' : `标记 ${markLevel(word.markCount)} / 6`}>{word.known ? <CheckCheck size={18} /> : <MarkDots count={word.markCount} />}</span>
    </div>)}{words.length > limit && <button className="secondary load-more" onClick={() => setLimit(value => value + 300)}>显示更多</button>}</div> :
      <div className="empty"><Search size={28} /><h2>{store.words.length ? '没有匹配的单词' : '还没有单词'}</h2><p>{store.words.length ? '试试其他关键词，或查看全部单词。' : '先添加一本词书，或导入自己的词表。'}</p>
        <button className="secondary" onClick={() => { if (store.words.length) { setSearch(''); setFilter('all') } else onBooks() }}>{store.words.length ? '查看全部单词' : '去选词书'}</button></div>}
  </>
}
