import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { AIIcon } from '../icons'
import type { AIContext } from '../ai'
import AssistantSheet from './AssistantSheet'

/** What the assistant is told about the screen: `label` is shown to the user, the rest goes to the model. */
export type AssistantCtx = AIContext & { label: string }

type Actions = { register: (id: string, ctx: AssistantCtx | null) => void; ask: (ctx?: AssistantCtx | null) => void }
const AssistantActions = createContext<Actions | null>(null)

/** Owns the one AI assistant sheet. Screens publish what they show with `useAssistantContext`;
 * any button can open the assistant with `useAssistant().ask()` (current screen) or `ask(ctx)` (something specific). */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<{ id: string; ctx: AssistantCtx }[]>([])
  const latest = useRef(entries)
  latest.current = entries
  const [session, setSession] = useState<{ ctx: AssistantCtx | null } | null>(null)
  const actions = useMemo<Actions>(() => ({
    register: (id, ctx) => setEntries(previous => {
      const rest = previous.filter(entry => entry.id !== id)
      return ctx ? [...rest, { id, ctx }] : rest
    }),
    // The most recently published context wins, so a word card opened over an article is about the word.
    ask: ctx => setSession({ ctx: ctx === undefined ? latest.current[latest.current.length - 1]?.ctx ?? null : ctx }),
  }), [])
  return <AssistantActions.Provider value={actions}>
    {children}
    <AssistantSheet open={!!session} ctx={session?.ctx ?? null} onClose={() => setSession(null)} />
  </AssistantActions.Provider>
}

export const useAssistant = () => useContext(AssistantActions)?.ask ?? (() => {})

/** Tells the assistant what this screen is about while it is mounted. Pass null when there is nothing to share. */
export function useAssistantContext(ctx: AssistantCtx | null) {
  const actions = useContext(AssistantActions)
  const id = useId()
  const key = ctx ? JSON.stringify(ctx) : ''
  const value = useRef(ctx)
  value.current = ctx
  useEffect(() => {
    actions?.register(id, value.current)
    return () => actions?.register(id, null)
  }, [actions, id, key])
}

/** The entry point: opens the assistant about whatever the current screen published. */
export function AssistantButton({ className = 'icon-button', context }: { className?: string; context?: AssistantCtx | null }) {
  const ask = useAssistant()
  return <button type="button" className={className} aria-label="AI 助手" title="AI 助手" onClick={() => ask(context)}><AIIcon size={23} /></button>
}
