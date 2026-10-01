import { useRef, type ReactNode } from 'react'

const ACTION = 56      // width of the revealed action
const START = 12       // horizontal travel before the row follows the finger
const COMMIT = ACTION / 2

type Props = {
  children: ReactNode
  /** Label of the single revealed action, e.g. 不熟 / 取消. */
  action: ReactNode
  tone?: 'warn' | 'neutral'
  disabled?: boolean
  /** Runs when the row is released past half the action width. */
  onAction: () => void
  /** Told as soon as the gesture becomes a horizontal swipe, so taps / long-press can cancel. */
  onSwipeStart?: () => void
}

/**
 * Left-swipe row. The row follows the finger after 12px of horizontal travel; releasing past
 * half of the 56px action runs it, otherwise the row springs back. Vertical movement keeps the
 * page scrolling (touch-action: pan-y). Transforms are written straight to the element during
 * the drag, so no React render happens per pointer move.
 */
export default function SwipeRow({ children, action, tone = 'warn', disabled, onAction, onSwipeStart }: Props) {
  const layer = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; dx: number; locked: 'x' | 'y' | null } | null>(null)
  const swiped = useRef(false)

  function place(dx: number, animate: boolean) {
    const el = layer.current
    if (!el) return
    el.style.transition = animate ? 'transform .2s cubic-bezier(.2,.8,.2,1)' : 'none'
    el.style.transform = dx ? `translate3d(${dx}px,0,0)` : ''
    el.parentElement?.style.setProperty('--reveal', String(Math.min(1, -dx / ACTION)))
  }
  function end(commit: boolean) {
    const state = drag.current
    drag.current = null
    if (!state || state.locked !== 'x') return
    place(0, true)
    if (commit && -state.dx >= COMMIT) onAction()
  }

  return <div className={`swipe-row tone-${tone}`}
    onPointerDown={event => {
      // Reset first: a swipe never produces a click, so a stale flag would swallow the next tap.
      swiped.current = false
      if (disabled || event.pointerType === 'mouse' && event.button !== 0) return
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, locked: null }
    }}
    onPointerMove={event => {
      const state = drag.current
      if (!state || state.id !== event.pointerId) return
      const dx = event.clientX - state.x, dy = event.clientY - state.y
      if (!state.locked) {
        if (Math.abs(dy) > START && Math.abs(dy) > Math.abs(dx)) { state.locked = 'y'; return }
        if (dx < -START && Math.abs(dx) > Math.abs(dy)) {
          state.locked = 'x'; swiped.current = true
          ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
          onSwipeStart?.()
        } else return
      }
      if (state.locked !== 'x') return
      // Follow the finger from the lock point; resist past the action width.
      const travel = Math.min(0, dx + START)
      state.dx = travel < -ACTION ? -ACTION - (-travel - ACTION) * 0.3 : travel
      place(state.dx, false)
    }}
    onPointerUp={() => end(true)}
    onPointerCancel={() => end(false)}
    // Touch pointers are implicitly captured by the inner button; taking capture here makes that
    // button fire lostpointercapture, which bubbles up. Only our own capture ending counts.
    onLostPointerCapture={event => { if (event.target === event.currentTarget) end(true) }}
    // A swipe must not also count as a tap on the row's button.
    onClickCapture={event => { if (swiped.current) { event.stopPropagation(); event.preventDefault(); swiped.current = false } }}>
    <span className="swipe-action" aria-hidden="true">{action}</span>
    <div className="swipe-layer" ref={layer}>{children}</div>
  </div>
}
