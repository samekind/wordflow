import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

/** Long enough for the entrance to read once, short enough not to hold up a device that is already ready. */
const holdMs = 800
const holdReducedMs = 350
const leaveMs = 280

/** The opening screen: the logo settles in, the name rises under it, three pixels count while the data loads,
 * then the whole thing lets go and the app lifts into its place. `onReveal` fires as it starts to leave. */
export default function BootSplash({ ready, error, onReveal }: { ready: boolean; error?: string; onReveal: () => void }) {
  const reduced = useReducedMotion()
  const [held, setHeld] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)
  const reveal = useRef(onReveal)
  reveal.current = onReveal
  useEffect(() => {
    const timer = setTimeout(() => setHeld(true), reduced ? holdReducedMs : holdMs)
    return () => clearTimeout(timer)
  }, [reduced])
  useEffect(() => {
    if (!ready || !held) return
    setLeaving(true); reveal.current()
  }, [ready, held])
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setGone(true), reduced ? 160 : leaveMs + 40)
    return () => clearTimeout(timer)
  }, [leaving, reduced])
  if (gone) return null
  return <div className="boot-splash" data-leaving={leaving} role={error ? 'alert' : 'status'} aria-label={error ? undefined : '正在打开拾词'}>
    <div className="boot-stage">
      <img className="boot-mark" src="/logo.png" alt="" width={112} height={112} />
      <h1 className="boot-name">拾词</h1>
      <p className="boot-sub">WORDFLOW</p>
      {error ? <div className="boot-error"><p>{error}</p><button className="primary" onClick={() => location.reload()}>重新加载</button></div>
        : <div className="boot-pixels" aria-hidden="true"><i /><i /><i /></div>}
    </div>
  </div>
}
