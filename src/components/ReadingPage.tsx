import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { BookOpen, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, EyeOff, Globe, Languages, LoaderCircle, Plus, RefreshCw, Send, Sparkles, Square, Volume2 } from 'lucide-react'
import { DailyIcon, EssayIcon } from '../icons'
import { dayKey, normalize, pageFontAttrs, wordsForDay, type ImportRow, type Store } from '../model'
import { articleCefr, cachedArticle, cefrNames, dailyReadingIndex, englishWordCount, inScope, readingLengthNames, readingLengths, readingLevel, readingLevels, refreshReadingArticle, scopeLabel, type ReadingArticle, type ReadingCefr, type ReadingLength, type ReadingScope } from '../reading'
import { fitLabels, recommendArticles } from '../library-fit'
import { useReadingArticles } from '../app/useReadingLibrary'
import { askReadingAI, cachedAITranslation, saveAITranslation, type ReadingAIMode, type ReadingAIResult } from '../reading-ai'
import { articleTranslations } from '../reading-translations'
import { lookupLocalWord } from '../wordbooks'
import { lookupDictionary, safeExternalUrl, type DictionaryEntry } from '../dictionary'
import { coreGloss } from '../gloss'
import ChoiceSheet from './ChoiceSheet'
import Sheet from './Sheet'

type Props = {
  store: Store; now: number;
  /** hub = the 阅读 tab (entry cards); shelf = one difficulty's topics / list; daily / story = the pushed reader screens. */
  view: 'hub' | 'picks' | 'shelf' | 'story' | 'daily'; onOpen: (view: 'picks' | 'story' | 'daily', articleId?: string, scope?: ReadingScope) => void;
  onShelf: (cefr: ReadingCefr, topic?: string) => void;
  /** Article chosen from a list; the reader starts on it instead of today's pick. */
  articleId?: string;
  /** Shelf screen: the difficulty (and topic) shown. Reader: the set previous/next stays inside. */
  scope?: ReadingScope;
  saving: boolean; onRead: (id: string) => Promise<boolean>; onWord: (id: string) => void;
  /** Adds a looked-up word to 我的词本 without leaving the article. */
  onAddWord: (row: ImportRow) => Promise<boolean>;
  onSpeak: (text: string) => void; onStop: () => void; children: ReactNode;
  onStudy: () => void;
}
export default function ReadingPage(props: Props) {
  return <div className="reading-page font-scope" data-size={props.store.readingPreferences.textSize} {...pageFontAttrs(props.store.appearance.reading)}>
    {props.view === 'hub' ? <ReadingEntries {...props} /> : props.view === 'picks' ? <ReadingHub {...props} /> : props.view === 'shelf' && props.scope?.cefr ? <ReadingShelf {...props} scope={{ ...props.scope, cefr: props.scope.cefr }} /> : props.view === 'story' ? <>
      <div className="reading-intro"><p>把当天的词放进一篇短文里，在上下文中记住它们。也可以自己挑词生成。</p>
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
const pageSize = 15
const minutesFor = (words: number) => Math.max(1, Math.ceil(words / 120))
/** 阅读 tab: exactly two entries. Everything else is one level down. */
function ReadingEntries({ store, now, onOpen }: Props) {
  const { articles: catalog } = useReadingArticles(true)
  const level = readingLevel(store)
  const choices = useMemo(() => catalog.filter(article => article.level === level), [catalog, level])
  const today = choices.length ? choices[dailyReadingIndex(choices.length, new Date(now))] : undefined
  const read = !!today && store.readArticleIds.includes(today.id)
  const book = store.books.find(item => item.id === store.activeBookId)
  const dayWords = book ? wordsForDay(store, book).length : 0
  return <div className="reading-hub reading-entries">
    <button className="reading-entry reading-entry-daily" aria-label="每日英语选读" onClick={() => onOpen('picks')}>
      {today?.image ? <img src={today.image.path} alt="" /> : <span className="reading-entry-icon"><DailyIcon size={26} /></span>}
      <span className="reading-entry-body">
        <small>每日英语选读</small>
        <strong lang="en">{today?.title || '百科段落选读'}</strong>
        <span>今日一篇、适合你的推荐，以及 A2–C2 按难度选读</span>
      </span>
      <span className="reading-entry-state" data-read={read}>{read ? <><CheckCheck size={14} />今日已读</> : <ChevronRight size={18} />}</span>
    </button>
    <button className="reading-entry" aria-label="语境记忆" onClick={() => onOpen('story')}>
      <span className="reading-entry-icon"><EssayIcon size={26} /></span>
      <span className="reading-entry-body">
        <small>语境记忆</small>
        <strong>把当天的词放进短文里记</strong>
        <span>{dayWords ? `当天 ${dayWords} 个词` : '先选一本词书'} · 已保存 {store.stories.length} 篇</span>
      </span>
      <ChevronRight size={18} className="reading-entry-chevron" />
    </button>
    <p className="reading-hub-note">已读文章 {store.readArticleIds.length} 篇 · 阅读设置在“我的 → 发音与阅读”</p>
  </div>
}
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="catalog-filter" role="group" aria-label={`${label}筛选`}><b className="filter-label">{label}</b><div className="filter-scroll">{children}</div></div>
}
type CatalogFilter = { cefr: ReadingCefr | ''; topic: string; length: ReadingLength | ''; status: 'all' | 'unread' | 'read' }
/** Kept for the session so coming back from an article shows the same filtered list. */
let catalogFilter: CatalogFilter = { cefr: '', topic: '', length: '', status: 'all' }
const filterPage = 8
function issueNumber(date: Date) { return Math.floor((+date - +new Date(date.getFullYear(), 0, 0)) / 86400000) }
/** 每日英语选读, laid out like a magazine: today's cover story, picks for you, the difficulty shelves and a filterable contents list. */
function ReadingHub({ store, now, onOpen, onShelf }: Props) {
  const { articles: catalog, library, refreshLibrary } = useReadingArticles(true)
  const level = readingLevel(store)
  const choices = useMemo(() => catalog.filter(article => article.level === level), [catalog, level])
  const today = choices.length ? choices[dailyReadingIndex(choices.length, new Date(now))] : undefined
  const article = today ? cachedArticle(today) : undefined
  const words = article ? englishWordCount(article.paragraphs.join(' ')) : 0
  const readIds = new Set(store.readArticleIds)
  const read = !!article && readIds.has(article.id)
  const picks = useMemo(() => recommendArticles(catalog, store, readIds, 3), [catalog, store.words, store.books, store.activeBookId, store.readArticleIds])
  const shelves = readingLevels.map(cefr => {
    const items = catalog.filter(item => articleCefr(item) === cefr)
    return { cefr, total: items.length, done: items.filter(item => readIds.has(item.id)).length }
  })
  const [filter, setFilterState] = useState(catalogFilter)
  const [limit, setLimit] = useState(filterPage)
  function setFilter(next: Partial<CatalogFilter>) { catalogFilter = { ...filter, ...next }; setFilterState(catalogFilter); setLimit(filterPage) }
  const topics = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of catalog) counts.set(item.topic, (counts.get(item.topic) || 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [catalog])
  const scope: ReadingScope = { ...(filter.cefr ? { cefr: filter.cefr } : {}), ...(filter.topic ? { topic: filter.topic } : {}), ...(filter.length ? { length: filter.length } : {}) }
  const matching = useMemo(() => catalog.filter(item => inScope(item, scope) && (filter.status === 'all' || (filter.status === 'read') === readIds.has(item.id))),
    [catalog, filter, store.readArticleIds])
  const date = new Date(now)
  const chip = (label: ReactNode, pressed: boolean, onClick: () => void, name?: string) =>
    <button className="filter-chip" aria-pressed={pressed} aria-label={name} onClick={onClick}>{label}</button>
  return <div className="reading-hub magazine">
    <header className="magazine-masthead"><strong>每日外刊</strong><span>第 {issueNumber(date)} 期 · {date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</span></header>
    <button className="reading-cover" aria-label="英语选读" onClick={() => onOpen('daily')}>
      {article?.image ? <img src={article.image.path} alt="" onError={hideBroken} /> : <span className="reading-cover-art" aria-hidden="true">{article?.title.slice(0, 1) || 'W'}</span>}
      <span className="reading-cover-body">
        <small className="magazine-kicker">今日封面 · {article ? `${article.topic} · ${articleCefr(article)}` : level === 'easy' ? '基础' : '进阶'}</small>
        <strong lang="en">{article?.title || '正在读取…'}</strong>
        {article?.intro && <span className="reading-cover-dek">{article.intro}</span>}
        <span className="reading-cover-meta">{article ? `${words} 词 · 约 ${minutesFor(words)} 分钟` : '百科段落选读，点单词即可查义'}
          <span className="reading-entry-state" data-read={read}>{read ? <><CheckCheck size={14} />已读</> : <>开始读<ChevronRight size={15} /></>}</span></span>
      </span>
    </button>
    {picks.length > 0 && <section className="reading-picks" aria-label="适合你">
      <div className="reading-library-head"><div><h2>适合你</h2><span>按你已掌握的词估算，生词占 2%–7% 最合适</span></div></div>
      <ul className="reading-list">{picks.map(({ article: item, fit }) => <li key={item.id}>
        <button className="reading-list-item" aria-label={`推荐 ${item.title}`} onClick={() => onOpen('daily', item.id, { cefr: articleCefr(item) })}>
          {item.image ? <img src={item.image.path} alt="" loading="lazy" onError={hideBroken} /> : <span className="reading-list-icon"><DailyIcon size={20} /></span>}
          <span className="reading-list-body"><small className="magazine-kicker">{item.topic}</small><strong lang="en">{item.title}</strong>
            <small>{item.cefr} · {fitLabels[fit.label]} · 约 {Math.round(fit.coverage * 100)}% 的词认识{fit.bookWords ? ` · 含 ${fit.bookWords} 个在学词` : ''}</small></span>
          <ChevronRight size={16} />
        </button></li>)}</ul>
    </section>}
    <section className="reading-levels" aria-label="按难度选读">
      <div className="reading-library-head"><div><h2>按难度选读</h2><span>从入门到精通，先选难度再选主题</span></div></div>
      <ul className="level-grid">{shelves.map(({ cefr, total, done }) => <li key={cefr}>
        <button className="level-tile" data-level={cefr} disabled={!total} aria-label={`${cefr} ${cefrNames[cefr]}，${total} 篇`} onClick={() => onShelf(cefr, total <= pageSize ? '*' : undefined)}>
          <strong>{cefr}</strong><span>{cefrNames[cefr]}</span>
          <small>{total ? `${total} 篇 · 已读 ${done}` : '暂无'}</small>
        </button></li>)}</ul>
    </section>
    <section className="reading-catalog" aria-label="文章筛选">
      <div className="reading-library-head"><div><h2>文章目录</h2><span>共 {catalog.length} 篇，按难度、主题、篇幅筛选</span></div></div>
      <div className="catalog-filters">
        <FilterRow label="难度">{chip('全部', !filter.cefr, () => setFilter({ cefr: '' }), '全部难度')}{readingLevels.map(cefr => <Fragment key={cefr}>{chip(cefr, filter.cefr === cefr, () => setFilter({ cefr }), `难度 ${cefr}`)}</Fragment>)}</FilterRow>
        <FilterRow label="篇幅">{chip('全部', !filter.length, () => setFilter({ length: '' }), '全部篇幅')}{readingLengths.map(length => <Fragment key={length}>{chip(readingLengthNames[length], filter.length === length, () => setFilter({ length }), `篇幅 ${readingLengthNames[length]}`)}</Fragment>)}</FilterRow>
        <FilterRow label="状态">{(['all', 'unread', 'read'] as const).map(status => { const name = status === 'all' ? '全部' : status === 'unread' ? '未读' : '已读'; return <Fragment key={status}>{chip(name, filter.status === status, () => setFilter({ status }), `状态 ${name}`)}</Fragment> })}</FilterRow>
        <FilterRow label="主题">{chip('全部', !filter.topic, () => setFilter({ topic: '' }), '全部主题筛选')}{topics.map(([topic, count]) => <Fragment key={topic}>{chip(<>{topic}<i>{count}</i></>, filter.topic === topic, () => setFilter({ topic }), `主题 ${topic}`)}</Fragment>)}</FilterRow>
      </div>
      <p className="filter-summary" role="status">{matching.length ? `找到 ${matching.length} 篇` : '没有符合条件的文章，换个条件试试'}</p>
      <ul className="magazine-list">{matching.slice(0, limit).map(item => {
        const count = englishWordCount(item.paragraphs.join(' '))
        return <li key={item.id}><button className="magazine-card" aria-label={`目录 ${item.title}`} onClick={() => onOpen('daily', item.id, scope)}>
          <span className="magazine-card-body">
            <small className="magazine-kicker">{item.topic} · {articleCefr(item)}{readIds.has(item.id) ? ' · 已读' : ''}</small>
            <strong lang="en">{item.title}</strong>
            {item.intro && <span className="magazine-card-dek">{item.intro}</span>}
            <small>{count} 词 · 约 {minutesFor(count)} 分钟{item.translations || articleTranslations(item.id, item.paragraphs.length) ? ' · 有译文' : ''}</small>
          </span>
          {item.image && <img src={item.image.path} alt="" loading="lazy" onError={hideBroken} />}
        </button></li>
      })}</ul>
      {matching.length > limit && <button className="text-button reading-more" onClick={() => setLimit(value => value + filterPage * 2)}>显示更多目录（还有 {matching.length - limit} 篇）</button>}
    </section>
    <div className="reading-sync" role="status">
      <span>{library.syncing ? '正在更新在线选读库…' : library.fromLibrary ? `在线选读库 ${library.fromLibrary} 篇${library.syncedAt ? ` · ${syncedText(library.syncedAt, now)}更新` : ''}` : '在线选读库暂无文章，联网后自动更新'}</span>
      <button className="text-button" disabled={library.syncing} onClick={() => void refreshLibrary()}><RefreshCw size={14} className={library.syncing ? 'spin' : undefined} />更新选读库</button>
    </div>
    {library.error && <p className="field-note">{library.error}</p>}
    <p className="reading-hub-note">已读文章 {readIds.size} 篇 · 阅读设置在“我的 → 发音与阅读”</p>
  </div>
}
/** One difficulty: first its topics (when there are many articles), then a short paged list. */
function ReadingShelf({ store, scope, onOpen, onShelf }: Props & { scope: ReadingScope & { cefr: ReadingCefr } }) {
  const { articles: catalog } = useReadingArticles(false)
  const [limit, setLimit] = useState(pageSize)
  useEffect(() => setLimit(pageSize), [scope.cefr, scope.topic])
  const readIds = new Set(store.readArticleIds)
  const level = useMemo(() => catalog.filter(item => articleCefr(item) === scope.cefr), [catalog, scope.cefr])
  const topics = useMemo(() => {
    const counts = new Map<string, { total: number; done: number }>()
    for (const item of level) {
      const entry = counts.get(item.topic) ?? { total: 0, done: 0 }
      entry.total++; if (readIds.has(item.id)) entry.done++
      counts.set(item.topic, entry)
    }
    return [...counts].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
  }, [level, store.readArticleIds])
  const finished = level.filter(item => readIds.has(item.id)).length
  if (!catalog.length) return <div className="empty" role="status"><LoaderCircle className="spin" size={24} /><p>正在读取选读</p></div>
  if (!level.length) return <div className="empty"><BookOpen size={28} /><p>这个难度暂时没有文章，在线选读库更新后会出现。</p></div>
  const progress = <div className="reading-progress" role="progressbar" aria-label="选读进度" aria-valuemin={0} aria-valuemax={level.length} aria-valuenow={finished}><i style={{ width: `${Math.round(finished / level.length * 100)}%` }} /></div>
  if (scope.topic === undefined && topics.length > 1) return <div className="reading-shelf">
    <div className="shelf-head"><h2>{scope.cefr} · {cefrNames[scope.cefr]}</h2><span>共 {level.length} 篇 · 已读 {finished} 篇，选一个主题继续</span></div>
    {progress}
    <ul className="topic-list">
      <li><button className="topic-row" onClick={() => onShelf(scope.cefr, '*')}><strong>全部主题</strong><small>{level.length} 篇</small><ChevronRight size={16} /></button></li>
      {topics.map(([topic, { total, done }]) => <li key={topic}><button className="topic-row" aria-label={`${topic}，${total} 篇`} onClick={() => onShelf(scope.cefr, topic)}>
        <strong>{topic}</strong><small>{total} 篇{done ? ` · 已读 ${done}` : ''}</small><ChevronRight size={16} /></button></li>)}
    </ul>
  </div>
  const matching = level.filter(item => inScope(item, scope))
  const shown = matching.slice(0, limit)
  const next = matching.find(item => !readIds.has(item.id))
  return <div className="reading-shelf">
    <div className="shelf-head"><h2>{scope.cefr} · {cefrNames[scope.cefr]}{scope.topic && scope.topic !== '*' ? ` · ${scope.topic}` : ''}</h2>
      <span>共 {matching.length} 篇 · 已读 {matching.filter(item => readIds.has(item.id)).length} 篇</span></div>
    {next && <button className="text-button reading-next" onClick={() => onOpen('daily', next.id, scope)}>读下一篇没读过的：{next.title}<ChevronRight size={15} /></button>}
    <ul className="reading-list">{shown.map(item => {
      const count = englishWordCount(item.paragraphs.join(' '))
      return <li key={item.id}><button className="reading-list-item" aria-label={`${item.title}，${item.topic}`} onClick={() => onOpen('daily', item.id, scope)}>
        {item.image ? <img src={item.image.path} alt="" loading="lazy" onError={hideBroken} /> : <span className="reading-list-icon"><DailyIcon size={20} /></span>}
        <span className="reading-list-body"><strong lang="en">{item.title}</strong><small>{item.topic}{item.cefr ? ` · ${item.cefr}` : ''} · {count} 词 · 约 {minutesFor(count)} 分钟</small>{item.intro && <small className="reading-list-intro">{item.intro}</small>}</span>
        {readIds.has(item.id) ? <CheckCheck size={16} className="reading-list-read" aria-label="已读" /> : <ChevronRight size={16} />}
      </button></li>
    })}</ul>
    {matching.length > shown.length && <button className="text-button reading-more" onClick={() => setLimit(value => value + pageSize)}>显示更多（还有 {matching.length - shown.length} 篇）</button>}
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
type AIState = { mode: ReadingAIMode; paragraph?: number; question?: string; result?: ReadingAIResult; error?: string; busy: boolean }
function DailyEnglish({ store, now, saving, articleId, scope, onRead, onWord, onAddWord, onSpeak, onStop }: Props) {
  const { articles: catalog, loadError, reload } = useReadingArticles(false)
  const [offset, setOffset] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [updated, setUpdated] = useState<ReadingArticle | null>(null)
  const [refreshError, setRefreshError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [selectedWord, setSelectedWord] = useState('')
  const [translated, setTranslated] = useState(false)
  const [aiTranslation, setAITranslation] = useState<string[] | undefined>()
  const [ai, setAI] = useState<AIState | null>(null)
  const [explained, setExplained] = useState<Record<number, AIState>>({})
  const [question, setQuestion] = useState('')
  const refreshRequest = useRef(0)
  const aiRequest = useRef(0)
  const wanted = useRef(articleId)
  const level = readingLevel(store)
  const date = dayKey(new Date(now))
  useEffect(() => () => { refreshRequest.current++; aiRequest.current++ }, [])
  const scopeKey = scope ? `${scope.cefr ?? ''}:${scope.topic ?? ''}:${scope.length ?? ''}` : ''
  useEffect(() => { setOffset(0); setTranslated(false); onStop() }, [level, date, scopeKey])
  const choices = useMemo(() => scope ? catalog.filter(article => inScope(article, scope)) : catalog.filter(article => article.level === level), [catalog, level, scopeKey])
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
  useEffect(() => {
    refreshRequest.current++; aiRequest.current++
    setRefreshing(false); setRefreshError(''); setUpdated(null); setTranslated(false); setAI(null); setExplained({}); setQuestion('')
    setAITranslation(base ? cachedAITranslation(base.id, base.paragraphs.length) : undefined)
  }, [base?.id])
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
  /** One built-in AI request at a time; answers for an article that is no longer open are dropped. */
  async function runAI(mode: ReadingAIMode, extra: { paragraph?: number; question?: string } = {}) {
    if (!article) return
    const request = ++aiRequest.current
    const update = (state: AIState) => extra.paragraph === undefined ? setAI(state) : setExplained(value => ({ ...value, [extra.paragraph!]: state }))
    update({ mode, ...extra, busy: true })
    try {
      const result = await askReadingAI({ mode, title: article.title, paragraphs: article.paragraphs,
        ...(extra.paragraph !== undefined ? { focus: article.paragraphs[extra.paragraph] } : {}), ...(extra.question ? { question: extra.question } : {}) })
      if (request !== aiRequest.current) return
      if (mode === 'translate' && result.paragraphs) {
        saveAITranslation(article.id, result.paragraphs); setAITranslation(result.paragraphs); setTranslated(true); setAI(null)
      } else update({ mode, ...extra, result, busy: false })
    } catch (error) {
      if (request === aiRequest.current) update({ mode, ...extra, error: (error as Error).message, busy: false })
    }
  }
  function move(next: number) { onStop(); setOffset(next) }
  if (loadError) return <div className="empty"><BookOpen size={28} /><p role="alert">{loadError}</p><button className="secondary" onClick={reload}><RefreshCw size={16} />重新加载</button></div>
  if (!article) return <div className="empty" role="status"><LoaderCircle className="spin" size={24} /><p>正在读取选读</p></div>
  const words = englishWordCount(article.paragraphs.join(' '))
  const read = store.readArticleIds.includes(article.id)
  const online = article.id.startsWith('lib-')
  const translations = article.translations ?? articleTranslations(article.id, article.paragraphs.length) ?? aiTranslation
  const aiTranslated = !article.translations && !articleTranslations(article.id, article.paragraphs.length) && !!aiTranslation
  const highlights = new Set([...knownSet, ...targets])
  const busy = !!ai?.busy || Object.values(explained).some(item => item.busy)
  const translating = ai?.mode === 'translate' && ai.busy
  return <div className="daily-english" data-article-id={article.id}>
    <div className="daily-article-toolbar">
      <div className="article-picker">
        <button className="icon-button" aria-label="上一篇文章" title="上一篇文章" onClick={() => move(offset - 1)}><ChevronLeft size={18} /></button>
        <button className="article-picker-title" onClick={() => setPickerOpen(true)} aria-label="选择英语文章">{scope ? `${scopeLabel(scope)} · 第 ${index + 1} / ${choices.length} 篇` : index === todayIndex ? '今日选读' : '精选选读'}<ChevronDown size={12} /></button>
        <button className="icon-button" aria-label="下一篇文章" title="下一篇文章" onClick={() => move(offset + 1)}><ChevronRight size={18} /></button>
      </div>
      <span>{new Date(now).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span>
    </div>
    <article className="source-article">
      <p className="magazine-kicker article-kicker">{article.topic}<span>{article.cefr ? `${article.cefr} ${cefrNames[article.cefr]}` : level === 'easy' ? '基础选读' : '进阶选读'}</span></p>
      <h2 lang="en">{article.title}</h2>
      {article.intro && <p className="article-intro">{article.intro}{article.tags?.length ? <span className="article-tags">{article.tags.map(tag => <i key={tag}>{tag}</i>)}</span> : null}</p>}
      <div className="article-meta"><span>{article.source}</span><span>{words} 词 · 约 {Math.max(1, Math.ceil(words / 120))} 分钟</span></div>
      {article.image && <figure className="reading-image"><img src={article.image.path} alt={article.image.alt} onError={hideBroken} /><figcaption>{plainCredit(article.image.credit)}</figcaption></figure>}
      <div className="reader-tools">
        {translations
          ? <button className="reader-pill" aria-label={translated ? '隐藏译文' : '显示译文'} aria-pressed={translated} onClick={() => setTranslated(value => !value)}>{translated ? <EyeOff size={16} /> : <Languages size={16} />}{translated ? '收起译文' : '中文译文'}</button>
          : <button className="reader-pill" aria-label="AI 翻译全文" disabled={busy} onClick={() => void runAI('translate')}>{translating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{translating ? '正在翻译…' : 'AI 翻译全文'}</button>}
        <div className="small-tools">
          <button className="icon-button" aria-label="朗读英语文章" title="朗读文章" onClick={() => onSpeak(article.paragraphs.join('\n'))}><Volume2 size={20} /></button>
          <button className="icon-button" aria-label="停止英语文章朗读" title="停止朗读" onClick={onStop}><Square size={16} /></button>
          {!online && <button className="icon-button" aria-label="更新英语文章" title="联网更新摘录" disabled={refreshing} onClick={refresh}>{refreshing ? <LoaderCircle size={18} className="spin" /> : <RefreshCw size={18} />}</button>}
        </div>
      </div>
      {ai?.mode === 'translate' && ai.error && <p className="error-banner" role="alert">{ai.error}</p>}
      {refreshError && <p className="error-banner" role="alert">{refreshError}</p>}
      <div className="article-paragraphs">{article.paragraphs.map((paragraph, i) => {
        const note = explained[i]
        return <div className="article-block" key={`${article.id}:${i}`}>
          <ReadableParagraph text={paragraph} targets={highlights} onWord={selectWord} />
          {translated && translations && <p className="article-translation">{translations[i]}</p>}
          <button className="paragraph-ai" aria-label={`AI 解析第 ${i + 1} 段`} disabled={busy} onClick={() => void runAI('explain', { paragraph: i })}>{note?.busy ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}解析</button>
          {note && !note.busy && <div className="paragraph-explain" role="note">{note.error ? <p className="error-banner" role="alert">{note.error}</p> : <p>{note.result?.answer}</p>}<button className="text-button" onClick={() => setExplained(value => { const next = { ...value }; delete next[i]; return next })}>收起</button></div>}
        </div>
      })}</div>
      {translated && aiTranslated && <p className="source-note">译文由内置 AI 生成，仅供参考</p>}
    </article>
    <section className="article-assist" aria-label="AI 助读">
      <div className="article-assist-heading"><div><Sparkles size={16} /><strong>AI 助读</strong></div><span>内置，无需配置</span></div>
      <div className="assist-actions">
        <button className={ai?.mode === 'summary' ? 'active' : undefined} disabled={busy} onClick={() => void runAI('summary')}>导读</button>
        <button className={ai?.mode === 'vocabulary' ? 'active' : undefined} disabled={busy} onClick={() => void runAI('vocabulary')}>重点词汇</button>
        {!translations && <button disabled={busy} onClick={() => void runAI('translate')}>全文翻译</button>}
      </div>
      <form className="assist-ask" onSubmit={event => { event.preventDefault(); const text = question.trim(); if (text) void runAI('ask', { question: text }) }}>
        <input value={question} maxLength={300} onChange={event => setQuestion(event.target.value)} placeholder="就这篇文章提问，例如：作者的主要观点是什么？" aria-label="向 AI 提问" />
        <button className="primary" type="submit" disabled={busy || !question.trim()}>{ai?.mode === 'ask' && ai.busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}提问</button>
      </form>
      {ai && ai.mode !== 'translate' && <div className="article-assist-output" aria-live="polite">
        {ai.busy ? <p className="muted"><LoaderCircle size={15} className="spin" /> AI 正在阅读这篇文章…</p> : ai.error ? <p className="error-banner" role="alert">{ai.error}</p> : <>
          {ai.mode === 'ask' && ai.question && <p className="assist-question">问：{ai.question}</p>}
          <p>{ai.result?.answer}</p>
          {!!ai.result?.items.length && <div className="assist-items">{ai.result.items.map(item => <div className="assist-item" key={item.word}>
            <button className="text-button" lang="en" onClick={() => selectWord(item.word.split(/\s+/)[0])}>{item.word}</button><span>{item.meaning}</span>{item.example && <em lang="en">{item.example}</em>}</div>)}</div>}
          <small>内置 AI 生成，仅供参考</small>
        </>}
      </div>}
    </section>
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
      options={choices.map((choice, i) => ({ value: choice.id, label: `${choice.title}${!scope && i === todayIndex ? ' · 今日' : ''}`, count: englishWordCount(choice.paragraphs.join(' ')) }))}
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
