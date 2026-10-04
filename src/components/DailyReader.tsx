import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Check, CheckCheck, ChevronLeft, ChevronRight, Eye, EyeOff, LoaderCircle, RefreshCw, Square, Volume2 } from 'lucide-react'
import { coreGloss } from '../gloss'
import { bookDays, normalize, storyCoverage, storyIsCurrent, storyKey, storyParagraphCount, wordsForDay, type ImportRow, type Store, type Word } from '../model'
import { AIIcon } from '../icons'
import GlassSlider from './GlassSlider'
import MarkDots from './MarkDots'
import Sheet from './Sheet'
import { ParagraphWords, StoryProgress } from './ContextReader'
import { LookupDock, LookupProvider, ReadableText } from './ReadableText'

type Props = {
  store: Store; busy: boolean; live?: string; error: string;
  onGenerate: (bookId: string, day: number, part: number, words: Word[]) => void;
  onWord: (id: string) => void;
  onSpeak: (text: string) => void; onStop: () => void; onBooks: () => void;
  onAddWord?: (row: ImportRow) => Promise<boolean>;
}
export default function DailyReader({ store, busy, live = '', error, onGenerate, onWord, onSpeak, onStop, onBooks, onAddWord }: Props) {
  const book = store.books.find(b => b.id === store.activeBookId)
  const days = book ? bookDays(book) : []
  const [selectedDay, setSelectedDay] = useState(book?.currentDay || 0)
  useEffect(() => { setSelectedDay(book?.currentDay || 0) }, [book?.id])
  const day = Math.min(selectedDay, Math.max(0, days.length - 1))
  const allWords = book ? wordsForDay(store, book, day) : []
  const [part, setPart] = useState(0)
  const [translated, setTranslated] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [markFilter, setMarkFilter] = useState(0)
  const [query, setQuery] = useState('')
  useEffect(() => { setPart(0); setTranslated(false); setSelected(new Set()); setQuery('') }, [book?.id, day])
  const totalParts = Math.ceil(allWords.length / 40)
  const currentPart = Math.min(part, Math.max(0, totalParts - 1))
  const words = allWords.slice(currentPart * 40, (currentPart + 1) * 40)
  const candidate = store.stories.find(s => s.id === storyKey(book?.id || '', day, currentPart))
  useEffect(() => { setSelected(candidate ? new Set(candidate.targets.map(target => target.id)) : new Set()) }, [candidate?.id, book?.id, day, currentPart])
  const selectedWords = words.filter(word => selected.has(word.id))
  const story = candidate && selectedWords.length > 0 && storyIsCurrent(candidate, selectedWords) ? candidate : undefined
  const coverage = story ? storyCoverage(story, selectedWords) : []
  const known = useMemo(() => new Map(store.words.map(word => [normalize(word.word), word.id])), [store.words])
  const targetIds = useMemo(() => new Map(selectedWords.map(word => [normalize(word.word), word.id])), [selectedWords])
  const missing = selectedWords.filter(w => !coverage.includes(w.id))
  if (!book || !words.length) return <div className="empty"><BookOpen size={30} /><h2>先选择一本词书</h2><button className="primary" onClick={onBooks}>选择词书<ChevronRight size={17} /></button></div>
  const needle = query.trim().toLowerCase()
  const visibleWords = words.filter(word => word.markCount >= markFilter && (!needle || word.word.toLowerCase().includes(needle) || word.meaning.toLowerCase().includes(needle)))
  function toggleWord(id: string) {
    setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function generate() {
    setPickerOpen(false)
    onGenerate(book!.id, day, currentPart, selectedWords)
  }
  const picker = <Sheet title="选择单词" open={pickerOpen} onClose={() => setPickerOpen(false)} tall>
    <div className="picker-bar">
      <p className="picker-note">{allWords.length > 40 ? `今天有 ${allWords.length} 个词。短文每次最多写 40 个，当前是第 ${currentPart + 1} / ${totalParts} 组。` : `选出今天没记牢的词，AI 会按词数分段，每段围绕 3 至 5 个词写一个小场景。`}</p>
      {totalParts > 1 && <div className="part-tabs" aria-label="短文分组">{Array.from({ length: totalParts }, (_, index) => <button key={index} aria-pressed={currentPart === index} onClick={() => { setPart(index); setQuery('') }}>第 {index + 1} 组 · {allWords.slice(index * 40, (index + 1) * 40).length}</button>)}</div>}
      <GlassSlider name="按标记筛选" caption="向右拖，只留下标记更高的词" thumbWidth={92} min={0} max={6} value={markFilter} label={value => value === 0 ? '全部' : `≥${value}`} accessory={<MarkDots count={markFilter} />} onChange={setMarkFilter} />
      <input className="picker-search" value={query} placeholder="搜索单词或释义" onChange={event => setQuery(event.target.value)} />
      <div className="story-picker-heading"><span>{selectedWords.length} 已选{selectedWords.length > 0 && ` · 约 ${storyParagraphCount(selectedWords.length)} 段`} · 当前 {visibleWords.length}</span><div className="picker-actions">
        <button type="button" aria-label="全选" disabled={busy || !visibleWords.length} onClick={() => setSelected(new Set(visibleWords.map(word => word.id)))}><CheckCheck size={15} />全选当前</button>
        <button type="button" aria-label="选没记牢的" disabled={busy || !words.some(word => word.markCount > 0)} onClick={() => setSelected(new Set(words.filter(word => word.markCount > 0).map(word => word.id)))}>没记牢的</button>
        <button type="button" aria-label="清空" disabled={busy || selected.size === 0} onClick={() => setSelected(new Set())}>清除</button>
      </div></div>
    </div>
    <div className="sheet-word-list">{visibleWords.map(word => <button key={word.id} className="sheet-word" aria-pressed={selected.has(word.id)} disabled={busy} onClick={() => toggleWord(word.id)}>
      <span>{selected.has(word.id) ? <Check size={15} /> : <span className="story-word-empty" />}</span>
      <span className="sheet-word-main"><strong lang="en">{word.word}</strong><small>{coreGloss(word.meaning)}</small></span>
      <MarkDots count={word.markCount} />
    </button>)}{!visibleWords.length && <p className="field-note">这一档没有词，换一个标记或搜索条件。</p>}</div>
    <div className="picker-foot"><button className="primary wide-button" disabled={busy || !selectedWords.length} onClick={generate}>{busy ? <LoaderCircle className="spin" size={18} /> : <AIIcon size={18} />}{busy ? '正在写短文' : `生成短文 · ${selectedWords.length} 词`}</button></div>
  </Sheet>
  const dayNav = <div className="compact-day"><button className="icon-button" aria-label="短文前一天" title="前一天" disabled={!day || busy} onClick={() => { onStop(); setSelectedDay(day - 1) }}><ChevronLeft size={18} /></button>
    <span>第 {day + 1} 天</span><button className="icon-button" aria-label="短文后一天" title="后一天" disabled={day >= days.length - 1 || busy} onClick={() => { onStop(); setSelectedDay(day + 1) }}><ChevronRight size={18} /></button></div>
  const article = story ? <>
    <div className="story-head">{dayNav}<button className="text-button" onClick={() => setPickerOpen(true)}>选择单词</button><span className="story-coverage">覆盖 {coverage.length}/{selectedWords.length} 词</span><div className="small-tools">
      <button className="icon-button" aria-label="朗读短文" title="朗读短文" onClick={() => onSpeak(story.paragraphs.map(p => p.english).join('\n'))}><Volume2 size={20} /></button>
      <button className="icon-button" aria-label="停止朗读" title="停止朗读" onClick={onStop}><Square size={16} /></button>
      <button className="icon-button" aria-label={translated ? '隐藏译文' : '显示译文'} title={translated ? '隐藏译文' : '显示译文'} onClick={() => setTranslated(!translated)}>{translated ? <EyeOff size={19} /> : <Eye size={19} />}</button>
      <button className="icon-button" aria-label="重新生成短文" title="重新生成短文" disabled={busy || !selectedWords.length} onClick={() => onGenerate(book.id, day, currentPart, selectedWords)}>{busy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}</button>
    </div></div>
    <article className="story-article"><h2>{story.title}</h2>
      {story.paragraphs.map((paragraph, index) => <div className="story-paragraph" key={index}>
        <p lang="en"><ReadableText text={paragraph.english} keyPrefix={`${index}`} targets={targetIds} onTarget={onWord} /></p>
        {translated && <p className="story-translation">{paragraph.translation}</p>}
        <ParagraphWords english={paragraph.english} words={selectedWords} onWord={onWord} />
      </div>)}
    </article>
    {missing.length > 0 && <div className="missing-words"><span>这些词没写进短文，可重新生成</span>{missing.map(w => <button onClick={() => onWord(w.id)} key={w.id}>{w.word}</button>)}</div>}
    <p className="source-note story-source">AI 生成内容 · 请核对</p>
  </> : null
  return <LookupProvider title={story?.title || '短文'} known={known} onSpeak={onSpeak} onStop={onStop} onAdd={onAddWord} onOpenWord={onWord}><div className="daily-reader">
    <p className="reader-book-label">选词来源 · {book.title}</p>
    {totalParts > 1 && <div className="part-tabs" aria-label="短文分篇">{Array.from({ length: totalParts }, (_, index) =>
      <button key={index} aria-pressed={currentPart === index} onClick={() => { setPart(index); setTranslated(false); onStop() }}>短文 {index + 1}</button>)}</div>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {busy && <StoryProgress words={selectedWords} live={live} />}
    {!busy && (story ? article : <div className="story-ready"><section className="story-ready-card">
      {dayNav}
      <h2>选几个词，读一篇短文</h2>
      <p>从当天的词里选词后生成。短文会保存在这里，随时回来读。</p>
      <div className="story-ready-stats"><span><strong>{allWords.length}</strong>当天的词</span><span><strong>{allWords.filter(word => word.markCount > 0).length}</strong>已标记</span></div>
      <button className="primary" onClick={() => setPickerOpen(true)}>选择单词</button>
    </section></div>)}
    {picker}
    <LookupDock />
  </div></LookupProvider>
}
