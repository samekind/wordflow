import { useRef, useState } from 'react'
import type { SettingsSection } from '../components/SettingsPage'

export type TabId = 'today' | 'stats' | 'story' | 'settings'
export type Screen =
  | { name: TabId }
  | { name: 'books' }
  | { name: 'library' }
  | { name: 'frequency' }
  | { name: 'article' }
  | { name: 'stories' }
  | { name: 'section'; section: Exclude<SettingsSection, 'home'> }
type Entry = { screen: Screen; scroll: number }
type State = { stack: Entry[]; direction: -1 | 0 | 1; seq: number }

const tabIds: readonly string[] = ['today', 'stats', 'story', 'settings']
export const isTab = (screen: Screen): screen is { name: TabId } => tabIds.includes(screen.name)
export const screenKey = (screen: Screen) => screen.name === 'section' ? `section:${screen.section}` : screen.name

const scrollTop = () => document.getElementById('app-scroll')?.scrollTop || 0

/** Screen stack. The bottom entry is always one of the four tabs. The library, exam frequency and
 * settings sections are pushed on top, so the header back button and Android back pop one level
 * and the screen underneath comes back at the scroll position it was left at. */
export function useNavigation(onLeave: () => void) {
  const [state, setState] = useState<State>({ stack: [{ screen: { name: 'today' }, scroll: 0 }], direction: 0, seq: 0 })
  const current = useRef(state)
  function apply(stack: Entry[], direction: State['direction']) {
    onLeave()
    const next = { stack, direction, seq: current.current.seq + 1 }
    current.current = next
    setState(next)
  }
  /** Tabs reset the stack to that tab; every other screen is pushed on top of the current one. */
  function navigate(screen: Screen) {
    const { stack } = current.current
    if (isTab(screen)) { apply([{ screen, scroll: 0 }], 0); return }
    const top = stack[stack.length - 1]
    if (screenKey(top.screen) === screenKey(screen)) return
    apply([...stack.slice(0, -1), { ...top, scroll: scrollTop() }, { screen, scroll: 0 }], 1)
  }
  /** Pops one level. At a tab root other than 学习 it returns to 学习; at the 学习 root it reports false. */
  function back() {
    const { stack } = current.current
    if (stack.length > 1) { apply(stack.slice(0, -1), -1); return true }
    if (stack[0].screen.name !== 'today') { apply([{ screen: { name: 'today' }, scroll: 0 }], 0); return true }
    return false
  }
  const top = state.stack[state.stack.length - 1]
  return {
    screen: top.screen,
    scroll: top.scroll,
    tab: state.stack[0].screen.name as TabId,
    direction: state.direction,
    seq: state.seq,
    navigate,
    back,
  }
}
