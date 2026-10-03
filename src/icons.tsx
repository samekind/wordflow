import { useId, type ReactNode, type SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Glyph({ size = 24, children, ...props }: IconProps & { children: ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>
}

export function StudyIcon(props: IconProps) {
  return <Glyph {...props}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="3.2" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="11.2" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.4" cy="8" r="1" fill="currentColor" stroke="none" />
    <path d="M8 12.2h8M8 15.4h5.2" />
  </Glyph>
}

export function ReadIcon(props: IconProps) {
  return <Glyph {...props}>
    <path d="M4.2 6.2c2.3-1.3 4.6-1.3 6.9.1V18.4c-2.3-1.3-4.6-1.3-6.9 0V6.2z" />
    <path d="M19.8 6.2c-2.3-1.3-4.6-1.3-6.9.1V18.4c2.3-1.3 4.6-1.3 6.9 0V6.2z" />
  </Glyph>
}

export function ProfileIcon(props: IconProps) {
  return <Glyph {...props}>
    <circle cx="12" cy="8" r="3" />
    <path d="M5.6 19.2c1-3.2 3.2-4.7 6.4-4.7s5.4 1.5 6.4 4.7" />
  </Glyph>
}

export function PreviewIcon(props: IconProps) {
  return <Glyph {...props}>
    <path d="M3.8 12S7 7.2 12 7.2 20.2 12 20.2 12 17 16.8 12 16.8 3.8 12 3.8 12z" />
    <circle cx="12" cy="12" r="2.1" />
  </Glyph>
}

export function RecallIcon(props: IconProps) {
  return <Glyph {...props}>
    <rect x="5" y="4.2" width="14" height="15.6" rx="3" />
    <path d="M8.2 9.2h7.6M8.2 12.4h4.2" strokeDasharray="1.6 1.8" />
  </Glyph>
}

export function EssayIcon(props: IconProps) {
  return <Glyph {...props}>
    <path d="M7 4.2h7.2L18 8v11.2a1.6 1.6 0 0 1-1.6 1.6H7.6A1.6 1.6 0 0 1 6 19.2V5.8A1.6 1.6 0 0 1 7.6 4.2H7z" />
    <path d="M14 4.4V8h3.6M8.6 12h6.2M8.6 15.2h4" />
  </Glyph>
}

export function DailyIcon(props: IconProps) {
  return <Glyph {...props}>
    <rect x="4.5" y="5.2" width="15" height="14.2" rx="3" />
    <path d="M4.5 9.2h15M8 3.6v3.2M16 3.6v3.2" />
  </Glyph>
}

/** The AI mark: a large four-point spark with two small ones, drawn in the soft multi-colour gradient used for every AI surface.
 * `active` makes the colours drift while the AI is working (the motion stops under reduced-motion). */
export function AIIcon({ size = 24, active = false, className, ...props }: IconProps & { active?: boolean }) {
  const id = useId()
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    className={`ai-icon${active ? ' ai-icon-active' : ''}${className ? ` ${className}` : ''}`} aria-hidden="true" {...props}>
    <defs>
      <linearGradient id={id} x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="var(--ai-4)" />
        <stop offset=".38" stopColor="var(--ai-3)" />
        <stop offset=".7" stopColor="var(--ai-2)" />
        <stop offset="1" stopColor="var(--ai-1)" />
      </linearGradient>
    </defs>
    <g stroke={`url(#${id})`}>
      <path d="M10.2 4.2c.5 3.7 2.3 5.5 6 6-3.7.5-5.5 2.3-6 6-.5-3.7-2.3-5.5-6-6 3.7-.5 5.5-2.3 6-6z" />
      <path d="M18.4 14.6c.2 1.7 1 2.5 2.7 2.7-1.7.2-2.5 1-2.7 2.7-.2-1.7-1-2.5-2.7-2.7 1.7-.2 2.5-1 2.7-2.7z" />
      <path d="M17.6 2.8v2.4M16.4 4h2.4" />
    </g>
  </svg>
}
