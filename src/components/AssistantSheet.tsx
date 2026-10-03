import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { LoaderCircle, Send, Trash2, X } from 'lucide-react'
import { aiRemaining, chat, onAIRemaining, type ChatMessage } from '../ai'
import Sheet from './Sheet'
import type { AssistantCtx } from './AssistantContext'

const storageKey = 'wordflow.ai.chats'
const maxChats = 30, maxMessages = 40
type Saved = Record<string, { at: number; messages: ChatMessage[] }>

function readAll(): Saved {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}') as unknown
    return parsed && typeof parsed === 'object' ? parsed as Saved : {}
  } catch { return {} }
}
function writeAll(all: Saved) {
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, maxChats)
  try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(keep))) } catch { /* history is a convenience; the chat still works */ }
}
const loadChat = (key: string): ChatMessage[] => {
  const messages = readAll()[key]?.messages
  return Array.isArray(messages) ? messages.filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string') : []
}
function saveChat(key: string, messages: ChatMessage[]) {
  const all = readAll()
  if (messages.length) all[key] = { at: Date.now(), messages: messages.slice(-maxMessages) }; else delete all[key]
  writeAll(all)
}

/** Each article, word and study group keeps its own conversation on this device; everything else shares one. */
export function chatKey(ctx: AssistantCtx | null) {
  if (!ctx) return 'general'
  if (ctx.kind === 'article') return `article:${ctx.title}`
  if (ctx.kind === 'word') return `word:${ctx.word.toLowerCase()}`
  return `study:${ctx.words.map(item => item.word.toLowerCase()).join(',')}`.slice(0, 300)
}

const suggestions: Record<string, string[]> = {
  article: ['用中文概括这篇文章', '帮我解释文中的难句', '这篇文章有哪些值得积累的词'],
  word: ['这个词怎么记？', '再举几个例句', '它和近义词有什么区别？'],
  study: ['这组词里哪些容易混淆？', '帮我给这些词想记忆窍门', '用这几个词编几句话'],
  general: ['怎么高效背单词？', '什么是现在完成时？', 'affect 和 effect 怎么区分？'],
}

function Conversation({ ctx }: { ctx: AssistantCtx | null }) {
  const [useContext, setUseContext] = useState(true)
  const active = useContext ? ctx : null
  const key = chatKey(active)
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat(key))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const live = useRef({ key, mounted: true })
  live.current.key = key
  const end = useRef<HTMLDivElement>(null)
  const left = useSyncExternalStore(onAIRemaining, aiRemaining)
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false } }, [])
  useEffect(() => { setMessages(loadChat(key)); setError('') }, [key])
  // Not scrollIntoView: it would also scroll the sheet's clipped wrapper and push the whole sheet out of view.
  useEffect(() => { void (end.current?.closest('ion-content') as HTMLIonContentElement | null)?.scrollToBottom(150) }, [messages.length, busy])

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy) return
    const asked = key
    const history = [...loadChat(asked), { role: 'user' as const, content: question }]
    saveChat(asked, history); setMessages(history); setDraft(''); setError(''); setBusy(true)
    try {
      const reply = await chat(history.slice(-12), active ? contextOf(active) : undefined)
      const next = [...loadChat(asked), { role: 'assistant' as const, content: reply }]
      saveChat(asked, next)
      if (live.current.mounted && live.current.key === asked) setMessages(next)
    } catch (failure) {
      const next = loadChat(asked).slice(0, -1)
      saveChat(asked, next)
      if (live.current.mounted && live.current.key === asked) { setMessages(next); setDraft(question); setError((failure as Error).message) }
    } finally { if (live.current.mounted) setBusy(false) }
  }

  const hints = suggestions[active?.kind ?? 'general']
  return <div className="assistant-chat">
    <div className="assistant-context">
      {active ? <span className="assistant-chip" data-kind={active.kind}><span>{active.label}</span>
        <button type="button" className="assistant-chip-x" aria-label="不带上下文提问" title="不带上下文提问" onClick={() => setUseContext(false)}><X size={14} /></button></span>
        : <span className="assistant-chip" data-kind="general"><span>{ctx ? '不带上下文' : '通用问答'}</span>
          {ctx && <button type="button" className="assistant-chip-x text" onClick={() => setUseContext(true)}>带上{ctx.label}</button>}</span>}
      {!!messages.length && <button type="button" className="text-button assistant-clear" disabled={busy} onClick={() => { saveChat(key, []); setMessages([]) }}><Trash2 size={14} />清空记录</button>}
    </div>
    <div className="assistant-messages" role="log" aria-label="对话" aria-live="polite">
      {!messages.length && !busy && <div className="assistant-empty">
        <p>{active ? '可以直接问我，我已经看到了当前内容。' : '问我任何英语学习的问题。'}</p>
        <div className="assistant-hints">{hints.map(hint => <button type="button" className="reader-pill" key={hint} onClick={() => void send(hint)}>{hint}</button>)}</div>
      </div>}
      {messages.map((message, index) => <div className="assistant-bubble" data-role={message.role} key={index}>{message.content}</div>)}
      {busy && <div className="assistant-bubble" data-role="assistant" role="status"><LoaderCircle size={16} className="spin" />思考中…</div>}
      <div ref={end} />
    </div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <form className="assistant-form" onSubmit={event => { event.preventDefault(); void send(draft) }}>
      <textarea aria-label="向 AI 提问" rows={1} maxLength={1000} placeholder="输入问题…" value={draft} disabled={busy}
        onChange={event => setDraft(event.target.value)} />
      <button type="submit" className="primary assistant-send" aria-label="发送" disabled={busy || !draft.trim()}><Send size={18} /></button>
    </form>
    <p className="source-note assistant-note">内置 AI 生成，仅供参考。{left !== undefined ? `今日还剩 ${left} 点额度。` : '每天有免费额度，次日刷新。'}</p>
  </div>
}

function contextOf(ctx: AssistantCtx) {
  const { label: _label, ...rest } = ctx
  return rest
}

export default function AssistantSheet({ open, ctx, onClose }: { open: boolean; ctx: AssistantCtx | null; onClose: () => void }) {
  return <Sheet open={open} title="AI 助手" onClose={onClose} tall>{open && <Conversation ctx={ctx} />}</Sheet>
}
