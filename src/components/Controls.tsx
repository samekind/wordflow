import { IonAlert } from '@ionic/react'
import { useReducedMotion } from 'motion/react'
import { useCallback, useRef, useState, type ReactNode } from 'react'

/* Shared form controls. Every settings-style choice in the app goes through these, so they
   look and behave the same everywhere (glass segmented control, one row layout, one confirm). */

export type SegmentOption<T extends string> = { value: T; label: ReactNode; ariaLabel?: string; title?: string }

/** Pick one of a few options (2-4). Renders the glass segmented control. */
export function Segmented<T extends string>({ label, value, options, onChange, disabled, className = '' }: {
  label: string
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
}) {
  return <div className={`segment-control ${className}`.trim()} role="group" aria-label={label}>
    {options.map(option => <button key={option.ariaLabel || option.value} type="button" aria-pressed={value === option.value}
      aria-label={option.ariaLabel} title={option.title} disabled={disabled}
      onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>
}

/** One settings line: label on the left, control on the right, optional note underneath. */
export function SettingRow({ label, children, note, stacked = false }: {
  label: ReactNode
  children: ReactNode
  note?: ReactNode
  stacked?: boolean
}) {
  return <div className={`setting-row${stacked ? ' stacked' : ''}`}>
    <span className="setting-row-label">{label}</span>
    <div className="setting-row-control">{children}</div>
    {note && <p className="field-note setting-row-note">{note}</p>}
  </div>
}

type ConfirmRequest = {
  header: string
  message?: string
  confirm: string
  cancel?: string
  destructive?: boolean
}

/** Promise-based confirm dialog using the app's alert style (replaces window.confirm). */
export function useConfirm(): [(request: ConfirmRequest) => Promise<boolean>, ReactNode] {
  const reduced = useReducedMotion()
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolver = useRef<(ok: boolean) => void>(() => {})
  const ask = useCallback((next: ConfirmRequest) => new Promise<boolean>(resolve => {
    resolver.current(false)
    resolver.current = resolve
    setRequest(next)
  }), [])
  const finish = (ok: boolean) => { resolver.current(ok); resolver.current = () => {}; setRequest(null) }
  const element = <IonAlert isOpen={request !== null} cssClass="app-alert" animated={!reduced}
    header={request?.header} message={request?.message} onDidDismiss={() => finish(false)}
    buttons={[
      { text: request?.cancel || '取消', role: 'cancel', handler: () => finish(false) },
      { text: request?.confirm || '确定', role: request?.destructive ? 'destructive' : 'confirm', handler: () => finish(true) },
    ]} />
  return [ask, element]
}
