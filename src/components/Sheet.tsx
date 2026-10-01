import { useId, useRef, type ReactNode } from 'react'
import { IonContent, IonHeader, IonModal } from '@ionic/react'
import { X } from 'lucide-react'
import { useReducedMotion } from 'motion/react'

type Props = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  tall?: boolean
  dismissible?: boolean
}
export default function Sheet({ open, title, onClose, children, tall = false, dismissible = true }: Props) {
  const ref = useRef<HTMLIonModalElement>(null)
  const reduced = useReducedMotion()
  const heading = useId()
  const initial = tall ? 0.94 : 0.62
  return <IonModal ref={ref} isOpen={open} mode="ios" className="app-sheet"
    animated={!reduced} initialBreakpoint={initial} breakpoints={[0, 0.62, 0.94]} expandToScroll={false}
    handle handleBehavior="cycle" canDismiss={async (_data, role) => role === 'saved' || dismissible} onDidDismiss={onClose}
    aria-labelledby={heading} aria-label={title}>
    <IonHeader className="ion-no-border">
      <div className="sheet-heading"><h2 id={heading}>{title}</h2>
        <button type="button" className="icon-button" aria-label="关闭" disabled={!dismissible} onClick={() => ref.current?.dismiss()}>
          <X size={19} />
        </button>
      </div>
    </IonHeader>
    <IonContent className="sheet-content" onFocusCapture={event => {
      if ((event.target as HTMLElement).matches('input,textarea')) void ref.current?.setCurrentBreakpoint(0.94)
    }}>
      <div className="sheet-body">{children}</div>
    </IonContent>
  </IonModal>
}
