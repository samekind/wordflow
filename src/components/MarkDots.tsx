import { markLevel } from '../model'

export default function MarkDots({ count, large = false }: { count: number; large?: boolean }) {
  const level = markLevel(count)
  return <span className={`mark-dots${large ? ' large' : ''}`} data-level={level} role="img" aria-label={`记忆进度 ${level} / 6`}>
    <span className="mark-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} data-filled={index < level} />)}</span>
  </span>
}
