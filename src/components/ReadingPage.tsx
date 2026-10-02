import { useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { BookOpen, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Eye, EyeOff, Globe, LoaderCircle, Plus, RefreshCw, Square, Volume2 } from 'lucide-react'
import { DailyIcon, EssayIcon } from '../icons'
import { dayKey, normalize, pageFontAttrs, wordsForDay, type ImportRow, type Store } from '../model'
import { cachedArticle, dailyReadingIndex, englishWordCount, readingLevel, readingLevels, refreshReadingArticle, type ReadingArticle } from '../reading'
import { fitLabels, recommendArticles } from '../library-fit'
import { useReadingArticles } from '../app/useReadingLibrary'
import type { ArticleAssistMode, ArticleAssistResult } from '../platform'
import { articleTranslations } from '../reading-translations'
import { lookupLocalWord } from '../wordbooks'
import { lookupDictionary, safeExternalUrl, type DictionaryEntry } from '../dictionary'
import { coreGloss } from '../gloss'
import ChoiceSheet from './ChoiceSheet'
import { SelectButton } from './Controls'
import Sheet from './Sheet'

type Props = {
  store: Store; now: number;
  /** hub = the 阅读 tab (two entry cards); daily / story = the pushed reader screens. */
  view: 'hub' | 'story' | 'daily'; onOpen: (view: 'story' | 'daily', articleId?: string) => void;
  /** Article chosen from the hub list; the reader starts on it instead of today's pick. */
  articleId?: string;
  saving: boolean; onRead: (id: string) => Promise<boolean>; onWord: (id: string) => void;
  /** Adds a looked-up word to 我的词本 without leaving the article. */
  onAddWord: (row: ImportRow) => Promise<boolean>;
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
/** An online image that cannot load (offline, taken down) must not leave a broken icon behind. */
const hideBroken = (event: SyntheticEvent<HTMLImageElement>) => { event.currentTarget.style.display = 'none' }
function syncedText(at: number, now: number) {
  const minutes = Math.max(0, Math.round((now - at) / 60000))
  return minutes < 2 ? '刚刚' : minutes < 90 ? `${minutes} 分钟前` : minutes < 2880 ? `${Math.round(minutes / 60)} 小时前` : `${Math.round(minutes / 1440)} 天前`
}
/** 阅读 tab: one card per way to read, each opening its own screen. */
function ReadingHub({ store, now, onOpen }: Props) {
  const { articles: catalog, library, refreshLibrary } = useReadingArticles(true)
  const [topic, setTopic] = useState('all')
  const [grade, setGrade] = useState('all')
  const [limit, setLimit] = useState(30)
  useEffect(() => setLimit(30), [topic, grade, store.readingPreferences.level])
  const level = readingLevel(store)
  const choices = useMemo(() => catalog.filter(article => article.level === level), [catalog, level])
  const today = choices.length ? choices[dailyReadingIndex(choices.length, new Date(now))] : undefined
  const article = today ? cachedArticle(today) : undefined
  const words = article ? englishWordCount(article.paragraphs.join(' ')) : 0
  const readIds = new Set(store.readArticleIds)
  const read = !!article && readIds.has(article.id)
  const book = store.books.find(item => item.id === store.activeBookId)
  const dayWords = book ? wordsForDay(store, book).length : 0
  const topics = [...new Set(choices.map(item => item.topic))]
  const grades = readingLevels.filter(item => choices.some(article => article.cefr === item))
  const matching = choices.filter(item => (topic === 'all' || item.topic === topic) && (grade === 'all' || item.cefr === grade))
  const shown = matching.slice(0, limit)
  const picks = useMemo(() => recommendArticles(choices, store, readIds, 3), [choices, store.words, store.books, store.activeBookId, store.readArticleIds])
  const finished = choices.filter(item => readIds.has(item.id)).length
  const nextUnread = choices.find(item => !readIds.has(item.id) && item.id !== today?.id) || choices.find(item => !readIds.has(item.id))
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
    {picks.length > 0 && <section className="reading-picks" aria-label="适合你">
      <div className="reading-library-head"><div><h2>适合你</h2><span>按你已掌握的词估算，生词占 2%–7% 最合适</span></div></div>
      <ul className="reading-list">{picks.map(({ article: item, fit }) => <li key={item.id}>
        <button className="reading-list-item" aria-label={`推荐 ${item.title}`} onClick={() => onOpen('daily', item.id)}>
          {item.image ? <img src={item.image.path} alt="" loading="lazy" onError={hideBroken} /> : <span className="reading-list-icon"><DailyIcon size={20} /></span>}
          <span className="reading-list-body"><strong lang="en">{item.title}</strong>
            <small>{item.cefr} · {fitLabels[fit.label]} · 约 {Math.round(fit.coverage * 100)}% 的词认识{fit.bookWords ? ` · 含 ${fit.bookWords} 个在学词` : ''}</small></span>
          <ChevronRight size={16} />
        </button></li>)}</ul>
    </section>}
    {choices.length > 0 && <section className="reading-library" aria-label="全部选读">
      <div className="reading-library-head">
        <div><h2>全部选读</h2><span>{level === 'easy' ? '基础' : '进阶'} · 已读 {finished} / {choices.length} 篇</span></div>
        <div className="reading-filters">
          {grades.length > 0 && <SelectButton label="选读级别" value={grade} options={[{ value: 'all', label: '全部级别' }, ...grades.map(item => ({ value: item, label: item }))]} onChange={setGrade} />}
          <SelectButton label="选读主题" value={topic} options={[{ value: 'all', label: '全部主题' }, ...topics.map(item => ({ value: item, label: item }))]} onChange={setTopic} />
        </div>
      </div>
      <div className="reading-progress" role="progressbar" aria-label="选读进度" aria-valuemin={0} aria-valuemax={choices.length} aria-valuenow={finished}><i style={{ width: `${Math.round(finished / choices.length * 100)}%` }} /></div>
      {nextUnread && <button className="text-button reading-next" onClick={() => onOpen('daily', nextUnread.id)}>读下一篇没读过的：{nextUnread.title}<ChevronRight size={15} /></button>}
      <ul className="reading-list">{shown.map(item => {
        const count = englishWordCount(item.paragraphs.join(' '))
        return <li key={item.id}><button className="reading-list-item" aria-label={`${item.title}，${item.topic}`} onClick={() => onOpen('daily', item.id)}>
          {item.image ? <img src={item.image.path} alt="" loading="lazy" onError={hideBroken} /> : <span className="reading-list-icon"><DailyIcon size={20} /></span>}
          <span className="reading-list-body"><strong lang="en">{item.title}</strong><small>{item.topic}{item.cefr ? ` · ${item.cefr}` : ''} · {count} 词 · 约 {Math.max(1, Math.ceil(count / 120))} 分钟</small>{item.intro && <small className="reading-list-intro">{item.intro}</small>}</span>
          {readIds.has(item.id) ? <CheckCheck size={16} className="reading-list-read" aria-label="已读" /> : <ChevronRight size={16} />}
        </button></li>
      })}</ul>
      {matching.length > shown.length && <button className="text-button reading-more" onClick={() => setLimit(value => value + 30)}>显示更多（还有 {matching.length - shown.length} 篇）</button>}
      {matching.length === 0 && <p className="field-note">没有符合条件的文章，换个级别或主题试试。</p>}
    </section>}
    <div className="reading-sync" role="status">
      <span>{library.syncing ? '正在更新在线选读库…' : library.fromLibrary ? `在线选读库 ${library.fromLibrary} 篇${library.syncedAt ? ` · ${syncedText(library.syncedAt, now)}更新` : ''}` : '在线选读库暂无文章，联网后自动更新'}</span>
      <button className="text-button" disabled={library.syncing} onClick={() => void refreshLibrary()}><RefreshCw size={14} className={library.syncing ? 'spin' : undefined} />更新选读库</button>
    </div>
    {library.error && <p className="field-note">{library.error}</p>}
    <p className="reading-hub-note">已读文章 {readIds.size} 篇 · 阅读设置在“我的 → 发音与阅读”</p>
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
function DailyEnglish({ store, now, saving, articleId, onRead, onWord, onAddWord, onSpeak, onStop }: Props) {
  const { articles: catalog, loadError, reload } = useReadingArticles(false)
  const [offset, setOffset] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [updated, setUpdated] = useState<ReadingArticle | null>(null)
  const [refreshError, setRefreshError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [selectedWord, setSelectedWord] = useState('')
  const [translated, setTranslated] = useState(false)
  const refreshRequest = useRef(0)
  const wanted = useRef(articleId)
  const level = readingLevel(store)
  const date = dayKey(new Date(now))
  useEffect(() => () => { refreshRequest.current++ }, [])
  useEffect(() => { setOffset(0); setTranslated(false); onStop() }, [level, date])
  const choices = useMemo(() => catalog.filter(article => article.level === level), [catalog, level])
  const todayIndex = dailyReadingIndex(choices.length, new Date(now))
  const index = choices.length ? ((todayIndex + offset) % choices.length + choices.length) % choices.length : 0
  const base = choices[index]
  useEffect(() => {
    if (!wanted.current || !choices.length) return
    const target = choices.findIndex(item => item.id === wanted.current)
    wanted.current = undefined
    if (target >= 0) setOffset(target - todayIndex)
  }, [choices.length])
  const fallback = useMemo(() => base ? cachedArticle(base) : null, [base])
  const article = updated?.id === base?.id ? updated : fallback
  useEffect(() => { refreshRequest.current++; setRefreshing(false); setRefreshError(''); setUpdated(null); setTranslated(false) }, [base?.id])
  const knownWords = useMemo(() => new Map(store.words.map(word => [normalize(word.word), word.id])), [store.words])
  const knownSet = useMemo(() => new Set(knownWords.keys()), [knownWords])
  const book = store.books.find(book => book.id === store.activeBookId)
  const targets = new Set((book ? wordsForDay(store, book) : []).map(word => normalize(word.word)))
  const inBook = useMemo(() => {
    if (!article || !book) return []
    const members = new Set(book.wordIds), byId = new Map(store.words.map(word => [word.id, word]))
    const found = new Map<string, string>()
    for (const match of article.paragraphs.join(' ').matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)) {
      const id = knownWords.get(normalize(match[0])), word = id ? byId.get(id) : undefined
      if (id && word && !word.known && members.has(id) && !found.has(id)) found.set(id, word.word)
    }
    return [...found].map(([id, text]) => ({ id, text }))
  }, [article, book, knownWords, store.words])
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
  if (loadError) return <div className="empty"><BookOpen size={28} /><p role="alert">{loadError}</p><button className="secondary" onClick={reload}><RefreshCw size={16} />重新加载</button></div>
  if (!article) return <div className="empty" role="status"><LoaderCircle className="spin" size={24} /><p>正在读取选读</p></div>
  const words = englishWordCount(article.paragraphs.join(' '))
  const read = store.readArticleIds.includes(article.id)
  const online = article.id.startsWith('lib-')
  const translations = article.translations ?? articleTranslations(article.id, article.paragraphs.length)
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
      <div className="article-meta"><span>{article.topic} · {level === 'easy' ? '基础选读' : '进阶选读'}{article.cefr ? ` · ${article.cefr}` : ''}</span><span>{words} 词 · 约 {Math.max(1, Math.ceil(words / 120))} 分钟</span></div>
      <h2 lang="en">{article.title}</h2>
      {article.intro && <p className="article-intro">{article.intro}{article.tags?.length ? <span className="article-tags">{article.tags.map(tag => <i key={tag}>{tag}</i>)}</span> : null}</p>}
      {article.image && <figure className="reading-image"><img src={article.image.path} alt={article.image.alt} onError={hideBroken} /></figure>}
      <div className="reader-tools"><span>{article.source}</span><div className="small-tools">
        <button className="icon-button" aria-label="朗读英语文章" title="朗读文章" onClick={() => onSpeak(article.paragraphs.join('\n'))}><Volume2 size={20} /></button>
        <button className="icon-button" aria-label="停止英语文章朗读" title="停止朗读" onClick={onStop}><Square size={16} /></button>
        <button className="icon-button" aria-label={translated ? '隐藏译文' : '显示译文'} title={translated ? '隐藏译文' : '显示译文'} disabled={!translations} onClick={() => setTranslated(value => !value)}>{translated ? <EyeOff size={19} /> : <Eye size={19} />}</button>
        {!online && <button className="icon-button" aria-label="更新英语文章" title="联网更新摘录" disabled={refreshing} onClick={refresh}>{refreshing ? <LoaderCircle size={18} className="spin" /> : <RefreshCw size={18} />}</button>}
      </div></div>
      {refreshError && <p className="error-banner" role="alert">{refreshError}</p>}
      <div className="article-paragraphs">{article.paragraphs.map((paragraph, i) => <div className="article-block" key={`${article.id}:${i}`}>
        <ReadableParagraph text={paragraph} targets={highlights} onWord={selectWord} />
        {translated && translations && <p className="article-translation">{translations[i]}</p>}
      </div>)}</div>
    </article>
    {book && <section className="article-vocab" aria-label="文中的词书单词">
      <h3>文中出现的词书单词 <span>{inBook.length}</span></h3>
      {inBook.length ? <div className="vocab-chips">{inBook.slice(0, 24).map(item => <button key={item.id} className="vocab-chip" lang="en" onClick={() => onWord(item.id)}>{item.text}</button>)}{inBook.length > 24 && <span className="vocab-more">等 {inBook.length} 个</span>}</div>
        : <p className="field-note">这篇文章里没有出现《{book.title}》里还在学的单词。</p>}
    </section>}
    <div className="article-completion"><button className={read ? 'secondary' : 'primary'} disabled={saving || read} onClick={() => void onRead(article.id)}>{read ? <CheckCheck size={17} /> : <Check size={17} />}{read ? '已读' : '完成阅读'}</button>{read && <button className="secondary" onClick={() => move(offset + 1)}>读下一篇<ChevronRight size={16} /></button>}
      <a className="text-button" href={article.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />原文</a>
    </div>
    <details className="article-attribution"><summary>来源与许可</summary>
      {online ? <p>英文为维基百科原文节选，未经 AI 改写。难度分级、导读和中文译文由 AI 辅助生成，并参照词频统计，仅供参考。</p> : <p>百科段落选读 · 非 AI 生成。难度为选读参考。</p>}
      <p>{article.author} · <a href={article.license.url} target="_blank" rel="noopener noreferrer">{article.license.name}</a></p>
      <p>摘录时间：{new Date(article.retrievedAt).toLocaleDateString('zh-CN')} · 原文段落节选，省略引用标记</p>
      {article.image && <p>图片：{plainCredit(article.image.credit)} · <a href={article.image.sourceUrl} target="_blank" rel="noopener noreferrer">来源</a> · <a href={article.image.license.url} target="_blank" rel="noopener noreferrer">{article.image.license.name}</a></p>}
    </details>
    <ChoiceSheet title="英语选读" open={pickerOpen} onClose={() => setPickerOpen(false)} value={article.id}
      options={choices.map((choice, i) => ({ value: choice.id, label: `${choice.title}${i === todayIndex ? ' · 今日' : ''}`, count: englishWordCount(choice.paragraphs.join(' ')) }))}
      onSelect={id => move(choices.findIndex(choice => choice.id === id) - todayIndex)} />
    <ReadingWord word={selectedWord} onClose={() => { onStop(); setSelectedWord('') }} onSpeak={onSpeak} onStop={onStop} onAdd={onAddWord} />
  </div>
}
function ReadingWord({ word, onClose, onSpeak, onStop, onAdd }: { word: string; onClose: () => void; onSpeak: (text: string) => void; onStop: () => void; onAdd: (row: ImportRow) => Promise<boolean> }) {
  const [local, setLocal] = useState<ImportRow | undefined>()
  const [entries, setEntries] = useState<DictionaryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [onlineBusy, setOnlineBusy] = useState(false)
  const [adding, setAdding] = useState(false)
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
        <button className="secondary" disabled={adding} onClick={async () => {
          setAdding(true)
          try { if (await onAdd({ word: local.word, meaning: local.meaning, phonetic: local.phonetic, example: '', definition: local.definition, exchange: local.exchange, source: local.source })) onClose() }
          finally { setAdding(false) }
        }}><Plus size={16} />加入我的词本</button>
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
