import { useEffect, useRef, type ReactNode } from 'react'

const START = 12       // horizontal travel before the row follows the finger

export type SwipeAction = { label: ReactNode; ariaLabel: string; tone: 'neutral' | 'known'; disabled?: boolean; onClick: () => void }
type Props = {
  children: ReactNode
  /** Revealed right-to-left behind the row; each is 64px wide. */
  actions: SwipeAction[]
  disabled?: boolean
  /** Told as soon as the gesture becomes a horizontal swipe, so taps / long-press can cancel. */
  onSwipeStart?: () => void
}

/** Only one row is open at a time: opening a row closes the previous one. */
let closeOpen: (() => void) | null = null

/**
 * Left-swipe row with action buttons behind it (减标记 · 熟词). The row follows the finger after
 * 12px of horizontal travel; released past half the action width it stays open, otherwise it
 * springs back. Vertical movement keeps the page scrolling (touch-action: pan-y). Transforms are
 * written straight to the element during the drag, so no React render happens per pointer move.
 */
export default function SwipeRow({ children, actions, disabled, onSwipeStart }: Props) {
  const width = actions.length * 64
  const layer = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; from: number; dx: number; locked: 'x' | 'y' | null } | null>(null)
  const offset = useRef(0)
  const swiped = useRef(false)

  function place(dx: number, animate: boolean) {
    const el = layer.current
    if (!el) return
    el.style.transition = animate ? 'transform .22s cubic-bezier(.2,.8,.2,1)' : 'none'
    el.style.transform = dx ? `translate3d(${dx}px,0,0)` : ''
    el.parentElement?.style.setProperty('--reveal', String(Math.min(1, -dx / width)))
  }
  function settle(open: boolean) {
    offset.current = open ? -width : 0
    place(offset.current, true)
    if (open) { if (closeOpen && closeOpen !== close) closeOpen(); closeOpen = close }
    else if (closeOpen === close) closeOpen = null
  }
  const close = () => settle(false)
  useEffect(() => () => { if (closeOpen === close) closeOpen = null }, [])
  useEffect(() => { if (disabled && offset.current) settle(false) }, [disabled])

  function end(commit: boolean) {
    const state = drag.current
    drag.current = null
    if (!state || state.locked !== 'x') return
    settle(commit && -state.dx >= width / 2)
  }

  return <div className="swipe-row"
    onPointerDown={event => {
      // Reset first: a swipe never produces a click, so a stale flag would swallow the next tap.
      swiped.current = false
      if (disabled || event.pointerType === 'mouse' && event.button !== 0) return
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, from: offset.current, dx: offset.current, locked: null }
    }}
    onPointerMove={event => {
      const state = drag.current
      if (!state || state.id !== event.pointerId) return
      const dx = event.clientX - state.x, dy = event.clientY - state.y
      if (!state.locked) {
        if (Math.abs(dy) > START && Math.abs(dy) > Math.abs(dx)) { state.locked = 'y'; return }
        if (Math.abs(dx) > START && Math.abs(dx) > Math.abs(dy)) {
          state.locked = 'x'; swiped.current = true
          ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
          onSwipeStart?.()
        } else return
      }
      if (state.locked !== 'x') return
      // Follow the finger from the lock point; resist past the action width and past closed.
      const travel = state.from + dx + (dx < 0 ? START : -START)
      state.dx = travel > 0 ? travel * 0.2 : travel < -width ? -width - (-travel - width) * 0.3 : travel
      place(state.dx, false)
    }}
    onPointerUp={() => end(true)}
    onPointerCancel={() => end(false)}
    // Touch pointers are implicitly captured by the inner button; taking capture here makes that
    // button fire lostpointercapture, which bubbles up. Only our own capture ending counts.
    onLostPointerCapture={event => { if (event.target === event.currentTarget) end(true) }}
    // A swipe must not also count as a tap; a tap on an open row just closes it.
    onClickCapture={event => {
      if ((event.target as HTMLElement).closest('.swipe-actions')) return
      if (swiped.current || offset.current) { event.stopPropagation(); event.preventDefault(); swiped.current = false; if (offset.current) settle(false) }
    }}>
    <div className="swipe-actions" style={{ width }}>
      {actions.map(action => <button key={action.ariaLabel} type="button" className={`swipe-action tone-${action.tone}`} aria-label={action.ariaLabel}
        disabled={disabled || action.disabled} tabIndex={-1} onClick={() => { settle(false); action.onClick() }}>{action.label}</button>)}
    </div>
    <div className="swipe-layer" ref={layer}>{children}</div>
  </div>
}
