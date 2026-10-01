import { IonItem, IonLabel, IonList } from '@ionic/react'
import { Check } from 'lucide-react'
import Sheet from './Sheet'

type Option = { value: string; label: string; detail?: string; count?: number }
export default function ChoiceSheet({ title, open, value, options, onSelect, onClose }: {
  title: string; open: boolean; value: string; options: Option[]
  onSelect: (value: string) => void; onClose: () => void
}) {
  return <Sheet open={open} title={title} onClose={onClose}>
    <IonList lines="none" className="choice-list">{options.map(option =>
      <IonItem key={option.value} button detail={false} className={value === option.value ? 'chosen' : ''}
        onClick={() => { onSelect(option.value); onClose() }}>
        <IonLabel><h3>{option.label}</h3>{option.detail && <p>{option.detail}</p>}</IonLabel>
        {option.count !== undefined && <span className="choice-count" slot="end">{option.count}</span>}
        <span className="choice-check" slot="end">{value === option.value && <Check size={19} />}</span>
      </IonItem>)}</IonList>
  </Sheet>
}
