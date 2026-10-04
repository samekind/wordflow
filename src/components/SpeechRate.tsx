import { createContext, useContext } from 'react'
import { Gauge } from 'lucide-react'

/** Read-aloud speeds offered next to the speaker button; the choice is the same saved setting as 设置 › 朗读速度. */
export const speechRates = [.7, .85, 1, 1.15, 1.3]
export const SpeechRateContext = createContext<{ rate: number; setRate: (rate: number) => void } | null>(null)

export function nextSpeechRate(rate: number) {
  return speechRates.find(item => item > rate + .001) ?? speechRates[0]
}

/** One tap moves to the next speed; the clip that is playing follows at once. */
export function SpeechRatePill() {
  const control = useContext(SpeechRateContext)
  if (!control) return null
  const label = `${control.rate}x`
  return <button type="button" className="icon-button speed-button" aria-label="朗读速度" title={`朗读速度 ${label}，点按切换`} data-rate={control.rate}
    onClick={() => control.setRate(nextSpeechRate(control.rate))}><Gauge size={16} /><span>{label}</span></button>
}
