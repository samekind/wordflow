import { useEffect, useRef, useState } from 'react'
import { markLevel } from '../model'

export default function MarkDots({ count, large = false }: { count: number; large?: boolean }) {
  const level = markLevel(count)
  const previous = useRef(level)
  // Only dots filled by this tap pop; dots that were already filled on first render stay still.
  const [gained, setGained] = useState(0)
  useEffect(() => {
    const added = level - previous.current
    previous.current = level
    setGained(added > 0 ? added : 0)
    if (added <= 0) return
    const timer = setTimeout(() => setGained(0), 450)
    return () => clearTimeout(timer)
  }, [level])
  return <span className={`mark-dots${large ? ' large' : ''}`} data-level={level} role="img" aria-label={`记忆进度 ${level} / 6`}>
    <span className="mark-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} data-filled={index < level} data-fresh={index < level && index >= level - gained} />)}</span>
  </span>
}
