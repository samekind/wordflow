import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BookOpen, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Eye, EyeOff, Globe, LoaderCircle, RefreshCw, Square, Volume2 } from 'lucide-react'
import { DailyIcon, EssayIcon } from '../icons'
import { dayKey, normalize, pageFontAttrs, wordsForDay, type ImportRow, type Store } from '../model'
import { cachedArticle, dailyReadingIndex, englishWordCount, loadReadingCatalog, readingLevel, refreshReadingArticle, type ReadingArticle } from '../reading'
import type { ArticleAssistMode, ArticleAssistResult } from '../platform'
import { articleTranslations } from '../reading-translations'
import { lookupLocalWord } from '../wordbooks'
import { lookupDictionary, safeExternalUrl, type DictionaryEntry } from '../dictionary'
import { coreGloss } from '../gloss'
import ChoiceSheet from './ChoiceSheet'
import Sheet from './Sheet'

type Props = {
  store: Store; now: number;
  /** hub = the 阅读 tab (two entry cards); daily / story = the pushed reader screens. */
  view: 'hub' | 'story' | 'daily'; onOpen: (view: 'story' | 'daily') => void;
  saving: boolean; onRead: (id: string) => Promise<boolean>; onWord: (id: string) => void;
  onSpeak: (text: string) => void; onStop: () => void; children: ReactNode;
  aiConfigured: boolean; onAssist: (data: { mode: ArticleAssistMode; title: string; text: string }) => Promise<ArticleAssistResult>;
  onAISettings: () => void;
  onStudy: () => void;
}
export default function ReadingPage(props: Props) {
  return <div className="reading-page font-scope" data-size={props.store.readingPreferences.textSize} {...pageFontAttrs(props.store.appearance.reading)}>
    {props.view === 'hub' ? <ReadingHub {...props} /> : props.view === 'story' ? <>
      <div className="reading-intro"><p>用自己选的词生成短文，扩展阅读。背当天的词请回到学习页。</p>
        <button className="text-button" disabled={props.saving} onClick={props.onStudy}>去本组语境记忆<ChevronRight size={15} /></button></div>
      {props.children}
    </> : <DailyEnglish {...props} />}
  </div>
}
/** 阅读 tab: one card per way to read, each opening its own screen. */
function ReadingHub({ store, now, onOpen }: Props) {
  const [catalog, setCatalog] = useState<ReadingArticle[]>([])
  useEffect(() => { let active = true; loadReadingCatalog().then(articles => { if (active) setCatalog(articles) }).catch(() => {}); return () => { active = false } }, [])
  const level = readingLevel(store)
  const choices = catalog.filter(article => article.level === level)
  const today = choices.length ? choices[dailyReadingIndex(choices.length, new Date(now))] : undefined
  const article = today ? cachedArticle(today) : undefined
  const words = article ? englishWordCount(article.paragraphs.join(' ')) : 0
  const read = !!article && store.readArticleIds.includes(article.id)
  const book = store.books.find(item => item.id === store.activeBookId)
  const dayWords = book ? wordsForDay(store, book).length : 0
  return <div className="reading-hub">
    <button className="reading-entry reading-entry-daily" aria-label="英语选读" onClick={() => onOpen('daily')}>
      {article?.image ? <img src={article.image.path} alt="" /> : <span className="reading-entry-icon"><DailyIcon size={26} /></span>}
      <span className="reading-entry-body">
        <small>今日英语选读 · {level === 'easy' ? '基础' : '进阶'}</small>
        <strong lang="en">{article?.title || '正在读取…'}</strong>
        <span>{article ? `${article.topic} · ${words} 词 · 约 ${Math.max(1, Math.ceil(words / 120))} 分钟` : '百科段落选读，点单词即可查义'}</span>
      </span>
      <span className="reading-entry-state" data-read={read}>{read ? <><CheckCheck size={14} />已读</> : <>开始读<ChevronRight size={15} /></>}</span>
    </button>
    <button className="reading-entry" aria-label="自选词短文" onClick={() => onOpen('story')}>
      <span className="reading-entry-icon"><EssayIcon size={26} /></span>
      <span className="reading-entry-body">
        <small>自选词短文</small>
        <strong>用当天的词写一篇短文</strong>
        <span>{dayWords ? `当天 ${dayWords} 个词可选` : '先选一本词书'} · 已保存 {store.stories.length} 篇</span>
      </span>
      <ChevronRight size={18} className="reading-entry-chevron" />
    </button>
    <p className="reading-hub-note">已读文章 {new Set(store.readArticleIds).size} 篇 · 阅读设置在“我的 → 发音与阅读”</p>
  </div>
}
function plainCredit(value: string) {
  const template = document.createElement('template')
  template.innerHTML = value
  return template.content.textContent?.trim() || 'Wikimedia Commons'
}
function ReadableParagraph({ text, targets, onWord }: { text: string; targets: Set<string>; onWord: (word: string) => void }) {
  const parts: ReactNode[] = []
  let previous = 0
  for (const match of text.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)) {
    parts.push(text.slice(previous, match.index))
    const word = match[0]
    parts.push(<button className="reading-token" data-target={targets.has(normalize(word))} key={match.index} aria-label={`查词 ${word}`} onClick={() => onWord(word)}>{word}</button>)
    previous = match.index + word.length
  }
  parts.push(text.slice(previous))
  return <p lang="en">{parts}</p>
}
function DailyEnglish({ store, now, saving, onRead, onWord, onSpeak, onStop }: Props) {
  const [catalog, setCatalog] = useState<ReadingArticle[]>([])
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [offset, setOffset] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [updated, setUpdated] = useState<ReadingArticle | null>(null)
  const [refreshError, setRefreshError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [selectedWord, setSelectedWord] = useState('')
  const [translated, setTranslated] = useState(false)
  const refreshRequest = useRef(0)
  const level = readingLevel(store)
  const date = dayKey(new Date(now))
  useEffect(() => {
    let active = true
    setLoadError('')
    loadReadingCatalog().then(articles => { if (active) setCatalog(articles) }).catch(error => { if (active) setLoadError(error.message) })
    return () => { active = false; refreshRequest.current++ }
  }, [reload])
  useEffect(() => { setOffset(0); setTranslated(false); onStop() }, [level, date])
  const choices = useMemo(() => catalog.filter(article => article.level === level), [catalog, level])
  const todayIndex = dailyReadingIndex(choices.length, new Date(now))
  const index = choices.length ? ((todayIndex + offset) % choices.length + choices.length) % choices.length : 0
  const base = choices[index]
  const fallback = useMemo(() => base ? cachedArticle(base) : null, [base])
  const article = updated?.id === base?.id ? updated : fallback
  useEffect(() => { refreshRequest.current++; setRefreshing(false); setRefreshError(''); setUpdated(null); setTranslated(false) }, [base?.id])
  const knownWords = useMemo(() => new Map(store.words.map(word => [normalize(word.word), word.id])), [store.words])
  const knownSet = useMemo(() => new Set(knownWords.keys()), [knownWords])
  const book = store.books.find(book => book.id === store.activeBookId)
  const targets = new Set((book ? wordsForDay(store, book) : []).map(word => normalize(word.word)))
  function selectWord(word: string) {
    onStop()
    const id = knownWords.get(normalize(word))
    if (id) onWord(id)
    else setSelectedWord(word.toLowerCase())
  }
  async function refresh() {
    if (!base || refreshing) return
    const request = ++refreshRequest.current
    onStop(); setRefreshing(true); setRefreshError('')
    try { const next = await refreshReadingArticle(base); if (request === refreshRequest.current) setUpdated(next) }
    catch (error) { if (request === refreshRequest.current) setRefreshError((error as Error).message) }
    finally { if (request === refreshRequest.current) setRefreshing(false) }
  }
  function move(next: number) { onStop(); setOffset(next) }
  if (loadError) return <div className="empty"><BookOpen size={28} /><p role="alert">{loadError}</p><button className="secondary" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} />重新加载</button></div>
  if (!article) return <div className="empty" role="status"><LoaderCircle className="spin" size={24} /><p>正在读取选读</p></div>
  const words = englishWordCount(article.paragraphs.join(' '))
  const read = store.readArticleIds.includes(article.id)
  const translations = articleTranslations(article.id, article.paragraphs.length)
  const highlights = new Set([...knownSet, ...targets])
  return <div className="daily-english" data-article-id={article.id}>
    <div className="daily-article-toolbar">
      <div className="article-picker">
        <button className="icon-button" aria-label="上一篇文章" title="上一篇文章" onClick={() => move(offset - 1)}><ChevronLeft size={18} /></button>
        <button className="article-picker-title" onClick={() => setPickerOpen(true)} aria-label="选择英语文章">{index === todayIndex ? '今日选读' : '精选选读'}<ChevronDown size={12} /></button>
        <button className="icon-button" aria-label="下一篇文章" title="下一篇文章" onClick={() => move(offset + 1)}><ChevronRight size={18} /></button>
      </div>
      <span>{new Date(now).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span>
    </div>
    <article className="source-article">
      <div className="article-meta"><span>{article.topic} · {level === 'easy' ? '基础选读' : '进阶选读'}</span><span>{words} 词 · 约 {Math.max(1, Math.ceil(words / 120))} 分钟</span></div>
      <h2 lang="en">{article.title}</h2>
      {article.image && <figure className="reading-image"><img src={article.image.path} alt={article.image.alt} /></figure>}
      <div className="reader-tools"><span>{article.source}</span><div className="small-tools">
        <button className="icon-button" aria-label="朗读英语文章" title="朗读文章" onClick={() => onSpeak(article.paragraphs.join('\n'))}><Volume2 size={20} /></button>
        <button className="icon-button" aria-label="停止英语文章朗读" title="停止朗读" onClick={onStop}><Square size={16} /></button>
        <button className="icon-button" aria-label={translated ? '隐藏译文' : '显示译文'} title={translated ? '隐藏译文' : '显示译文'} disabled={!translations} onClick={() => setTranslated(value => !value)}>{translated ? <EyeOff size={19} /> : <Eye size={19} />}</button>
        <button className="icon-button" aria-label="更新英语文章" title="联网更新摘录" disabled={refreshing} onClick={refresh}>{refreshing ? <LoaderCircle size={18} className="spin" /> : <RefreshCw size={18} />}</button>
      </div></div>
      {refreshError && <p className="error-banner" role="alert">{refreshError}</p>}
      <div className="article-paragraphs">{article.paragraphs.map((paragraph, i) => <div className="article-block" key={`${article.id}:${i}`}>
        <ReadableParagraph text={paragraph} targets={highlights} onWord={selectWord} />
        {translated && translations && <p className="article-translation">{translations[i]}</p>}
      </div>)}</div>
    </article>
    <div className="article-completion"><button className={read ? 'secondary' : 'primary'} disabled={saving || read} onClick={() => void onRead(article.id)}>{read ? <CheckCheck size={17} /> : <Check size={17} />}{read ? '已读' : '完成阅读'}</button>{read && <button className="secondary" onClick={() => move(offset + 1)}>读下一篇<ChevronRight size={16} /></button>}
      <a className="text-button" href={article.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />原文</a>
    </div>
    <details className="article-attribution"><summary>来源与许可</summary>
      <p>百科段落选读 · 非 AI 生成。难度为选读参考。</p>
      <p>{article.author} · <a href={article.license.url} target="_blank" rel="noopener noreferrer">{article.license.name}</a></p>
      <p>摘录时间：{new Date(article.retrievedAt).toLocaleDateString('zh-CN')} · 原文段落节选，省略引用标记</p>
      {article.image && <p>图片：{plainCredit(article.image.credit)} · <a href={article.image.sourceUrl} target="_blank" rel="noopener noreferrer">来源</a> · <a href={article.image.license.url} target="_blank" rel="noopener noreferrer">{article.image.license.name}</a></p>}
    </details>
    <ChoiceSheet title="英语选读" open={pickerOpen} onClose={() => setPickerOpen(false)} value={article.id}
      options={choices.map((choice, i) => ({ value: choice.id, label: `${choice.title}${i === todayIndex ? ' · 今日' : ''}`, count: englishWordCount(choice.paragraphs.join(' ')) }))}
      onSelect={id => move(choices.findIndex(choice => choice.id === id) - todayIndex)} />
    <ReadingWord word={selectedWord} onClose={() => { onStop(); setSelectedWord('') }} onSpeak={onSpeak} onStop={onStop} />
  </div>
}
function ReadingWord({ word, onClose, onSpeak, onStop }: { word: string; onClose: () => void; onSpeak: (text: string) => void; onStop: () => void }) {
  const [local, setLocal] = useState<ImportRow | undefined>()
  const [entries, setEntries] = useState<DictionaryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [onlineBusy, setOnlineBusy] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  useEffect(() => {
    const request = ++sequence.current
    setLocal(undefined); setEntries([]); setError(''); setOnlineBusy(false)
    if (!word) { setLoading(false); return }
    setLoading(true)
    lookupLocalWord(word).then(result => { if (request === sequence.current) setLocal(result) }).catch(() => {
      if (request === sequence.current) setError('本地释义暂不可用')
    }).finally(() => { if (request === sequence.current) setLoading(false) })
    return () => { sequence.current++ }
  }, [word])
  async function online() {
    const request = ++sequence.current
    setOnlineBusy(true); setError('')
    try { const data = await lookupDictionary(word); if (request === sequence.current) setEntries(data) }
    catch (error) { if (request === sequence.current) setError((error as Error).message) }
    finally { if (request === sequence.current) setOnlineBusy(false) }
  }
  return <Sheet title="阅读查词" open={!!word} onClose={onClose}>
    {word && <div className="reading-word">
      <div className="word-action-title"><h3 lang="en">{word}</h3><button className="icon-button" aria-label="朗读阅读单词" title="朗读单词" onClick={() => { onStop(); onSpeak(local?.word || word) }}><Volume2 size={20} /></button></div>
      {loading ? <LoaderCircle size={20} className="spin" /> : local ? <>
        {local.word.toLowerCase() !== word && <p className="source-note">原形：{local.word}</p>}
        <p className="muted">{local.phonetic}</p><p className="word-action-meaning">{coreGloss(local.meaning)}</p><p className="source-note">ECDICT 本地释义</p>
      </> : <p className="field-note">本地词库未收录</p>}
      <button className="text-button" disabled={loading || onlineBusy} onClick={online}>{onlineBusy ? <LoaderCircle size={16} className="spin" /> : <Globe size={16} />}在线词典</button>
      {error && <p className="error-banner" role="alert">{error}</p>}
      {entries.map((entry, i) => <div className="dictionary-entry" key={i}>
        {entry.meanings.slice(0, 3).map((meaning, j) => <div className="dictionary-meaning" key={j}><span>{meaning.partOfSpeech}</span><ol>{meaning.definitions.slice(0, 3).map((definition, k) => <li key={k}>{definition.definition}</li>)}</ol></div>)}
        <div className="dictionary-attribution"><span>Free Dictionary API</span>
          {entry.sourceUrls.filter(url => safeExternalUrl(url)).map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer">词条来源</a>)}
          {safeExternalUrl(entry.license?.url) && <a href={safeExternalUrl(entry.license?.url)} target="_blank" rel="noopener noreferrer">{entry.license?.name || '许可'}</a>}
        </div>
      </div>)}
    </div>}
  </Sheet>
}
