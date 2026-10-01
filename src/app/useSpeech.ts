import { useRef } from 'react'
import type { Store } from '../model'
import { isAndroidApp, phone } from '../platform'
import { lookupDictionary, safeExternalUrl } from '../dictionary'

/** System text-to-speech with a dictionary-recording fallback for single words. */
export function useSpeech(storeRef: { current: Store }, notify: (message: string) => void) {
  const sequence = useRef(0)
  const recording = useRef<HTMLAudioElement | null>(null)

  function stop() {
    sequence.current++; recording.current?.pause(); recording.current = null
    if (isAndroidApp) { void phone.stopSpeech().catch(() => {}); return }
    if ('speechSynthesis' in window) speechSynthesis.cancel()
  }

  function speak(text: string, accent = storeRef.current.pronunciation.accent) {
    stop()
    const request = sequence.current
    const rate = storeRef.current.pronunciation.rate
    async function fallback(message: string) {
      if (request !== sequence.current) return
      if (text.length > 100 || /[.!?\n]/.test(text)) { notify(message); return }
      try {
        const entries = await lookupDictionary(text)
        if (request !== sequence.current) return
        const audio = entries.flatMap(entry => entry.phonetics).map(item => safeExternalUrl(item.audio)).filter(Boolean)
        const preferred = accent === 'uk' ? /[-_](uk|gb)[-_.]/i : /[-_]us[-_.]/i
        const url = audio.find(item => preferred.test(item)) || audio[0]
        if (!url) throw new Error('暂无录音')
        const player = new Audio(url); recording.current = player
        await player.play()
      } catch {
        if (request === sequence.current) notify('录音暂不可用，请安装系统英语语音后重试')
      }
    }
    if (isAndroidApp) { void phone.speak({ word: text, accent, rate }).catch(error => fallback(error.message)); return }
    if (!('speechSynthesis' in window)) { void fallback('当前浏览器不支持朗读'); return }
    const speech = new SpeechSynthesisUtterance(text); speech.lang = accent === 'uk' ? 'en-GB' : 'en-US'; speech.rate = rate
    speech.onerror = event => { if (event.error !== 'interrupted' && event.error !== 'canceled') void fallback('朗读暂不可用，请检查系统英语语音') }
    speechSynthesis.speak(speech)
  }

  return { speak, stop }
}
