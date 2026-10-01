import { useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

type Props = {
  min: number
  max: number
  value: number
  name?: string
  caption?: string
  label: (value: number) => string
  onChange?: (value: number) => void
  onCommit?: (value: number) => void
  accessory?: ReactNode
  thumbWidth?: number
}

export default function GlassSlider({ min, max, value, name, caption, label, onChange, onCommit, accessory, thumbWidth = 76 }: Props) {
  const reduced = useReducedMotion()
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const [stretch, setStretch] = useState(1)
  const ratioRef = useRef<number | null>(null)
  const lastX = useRef<number | null>(null)
  const grab = useRef<{ x: number; ratio: number; jump: boolean } | null>(null)
  const span = Math.max(1, max - min)
  const ratio = dragRatio ?? (value - min) / span
  const shown = dragRatio == null ? value : Math.round(min + dragRatio * span)
  function ratioAt(rect: DOMRect, clientX: number) {
    const travel = Math.max(1, rect.width - thumbWidth)
    return Math.min(1, Math.max(0, (clientX - rect.left - thumbWidth / 2) / travel))
  }
  function point(track: HTMLDivElement, clientX: number) {
    const zone = track.querySelector('.glass-slider-track') as HTMLElement | null
    const rect = (zone || track).getBoundingClientRect()
    if (!rect.width) return
    if (!grab.current) {
      const thumbLeft = rect.left + (rect.width - thumbWidth) * ratio
      grab.current = { x: clientX, ratio, jump: clientX < thumbLeft || clientX > thumbLeft + thumbWidth }
    }
    const nextRatio = grab.current.jump ? ratioAt(rect, clientX) : Math.min(1, Math.max(0, grab.current.ratio + (clientX - grab.current.x) / Math.max(1, rect.width - thumbWidth)))
    const delta = lastX.current == null ? 0 : clientX - lastX.current
    lastX.current = clientX
    ratioRef.current = nextRatio
    setStretch(Math.min(1.55, 1 + Math.abs(delta) / 28))
    setDragRatio(nextRatio)
    if (!onCommit) onChange?.(Math.round(min + nextRatio * span))
  }
  function release() {
    const ratioNow = ratioRef.current
    ratioRef.current = null
    lastX.current = null
    grab.current = null
    setStretch(1)
    setDragRatio(null)
    if (ratioNow == null) return
    const next = Math.round(min + ratioNow * span)
    onCommit ? onCommit(next) : onChange?.(next)
  }
  return <div className="glass-slider" role="slider" tabIndex={0} aria-label={name} aria-valuemin={min} aria-valuemax={max} aria-valuenow={shown} aria-valuetext={label(shown)}
    onPointerDown={event => { const el = event.currentTarget as HTMLDivElement; el.setPointerCapture(event.pointerId); point(el, event.clientX) }}
    onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) point(event.currentTarget, event.clientX) }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? Math.min(max, value + 1) : event.key === 'ArrowLeft' ? Math.max(min, value - 1) : null
      if (next == null) return
      onChange?.(next)
      onCommit?.(next)
    }}>
    {caption && <p className="glass-slider-caption">{caption}</p>}
    <div className="glass-slider-rail">
      <span>{min}</span>
      <span className="glass-slider-track">
        <motion.span className="glass-slider-fill" animate={{ width: `calc((100% - ${thumbWidth}px) * ${ratio} + 22px)` }} transition={dragRatio == null && !reduced ? { type: 'spring', stiffness: 520, damping: 32, mass: .55 } : { duration: 0 }} />
        <motion.span className="glass-slider-thumb" style={{ width: thumbWidth }} animate={{ left: `calc((100% - ${thumbWidth}px) * ${ratio})`, scaleX: stretch, scaleY: stretch === 1 ? 1 : .96 }} transition={dragRatio == null && !reduced ? { type: 'spring', stiffness: 520, damping: 32, mass: .55 } : { duration: 0 }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={label(shown)} className="glass-slider-thumb-label" initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -4 }} transition={{ duration: .12 }}>{label(shown)}</motion.span>
          </AnimatePresence>
          {accessory}
        </motion.span>
      </span>
      <span>{max}</span>
    </div>
  </div>
}
