import { useRef } from 'react'
import type { Store } from '../model'
import { isAndroidApp, phone } from '../platform'
import { lookupDictionary, safeExternalUrl } from '../dictionary'

/** Words and short phrases (up to five words, no sentence punctuation) have human recordings. */
export const recordable = (text: string) => /^[A-Za-z][A-Za-z' -]{0,59}$/.test(text.trim()) && text.trim().split(/\s+/).length <= 5
/** Youdao's dictionary recordings: real speakers, reachable from mainland China, type 1 = UK, 2 = US. */
export const recordingUrl = (word: string, accent: 'us' | 'uk') => `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word.trim())}&type=${accent === 'uk' ? 1 : 2}`

/** Human recordings for words (Youdao, then the dictionary's own audio); system text-to-speech for sentences or when offline. */
export function useSpeech(storeRef: { current: Store }, notify: (message: string) => void) {
  const sequence = useRef(0)
  const recording = useRef<HTMLAudioElement | null>(null)

  function stop() {
    sequence.current++; recording.current?.pause(); recording.current = null
    if (isAndroidApp) { void phone.stopSpeech().catch(() => {}); return }
    if ('speechSynthesis' in window) speechSynthesis.cancel()
  }

  /** Resolves when the clip ends; rejects if it cannot load or start within a few seconds (offline, unknown word). */
  function play(url: string, request: number, rate: number) {
    return new Promise<void>((resolve, reject) => {
      if (request !== sequence.current) { resolve(); return }
      const player = new Audio(url); recording.current = player
      player.preload = 'auto'
      player.playbackRate = Math.max(.6, Math.min(1.2, rate))
      const timer = setTimeout(() => { player.pause(); reject(new Error('timeout')) }, 6000)
      player.onplaying = () => clearTimeout(timer)
      player.onended = () => { clearTimeout(timer); resolve() }
      player.onerror = () => { clearTimeout(timer); reject(new Error('audio')) }
      player.play().catch(error => { clearTimeout(timer); reject(error) })
    })
  }

  function speakSystem(text: string, accent: 'us' | 'uk', rate: number, request: number) {
    async function dictionaryFallback(message: string) {
      if (request !== sequence.current) return
      if (!recordable(text)) { notify(message); return }
      try {
        const entries = await lookupDictionary(text)
        if (request !== sequence.current) return
        const audio = entries.flatMap(entry => entry.phonetics).map(item => safeExternalUrl(item.audio)).filter(Boolean)
        const preferred = accent === 'uk' ? /[-_](uk|gb)[-_.]/i : /[-_]us[-_.]/i
        const url = audio.find(item => preferred.test(item)) || audio[0]
        if (!url) throw new Error('暂无录音')
        await play(url, request, 1)
      } catch {
        if (request === sequence.current) notify('发音暂不可用：请联网，或在系统设置里安装英语语音')
      }
    }
    if (isAndroidApp) { void phone.speak({ word: text, accent, rate }).catch(error => dictionaryFallback(error.message)); return }
    if (!('speechSynthesis' in window)) { void dictionaryFallback('当前浏览器不支持朗读'); return }
    const speech = new SpeechSynthesisUtterance(text); speech.lang = accent === 'uk' ? 'en-GB' : 'en-US'; speech.rate = rate
    speech.onerror = event => { if (event.error !== 'interrupted' && event.error !== 'canceled') void dictionaryFallback('朗读暂不可用，请检查系统英语语音') }
    speechSynthesis.speak(speech)
  }

  function speak(text: string, accent = storeRef.current.pronunciation.accent) {
    stop()
    const request = sequence.current
    const rate = storeRef.current.pronunciation.rate
    // "朗读本组" sends words joined by ". ": play each recording in turn.
    const parts = text.split(/\.\s+/).map(part => part.trim().replace(/\.$/, '')).filter(Boolean)
    if (!parts.length || !parts.every(recordable)) { speakSystem(text, accent, rate, request); return }
    void (async () => {
      for (let index = 0; index < parts.length; index++) {
        if (request !== sequence.current) return
        try {
          await play(recordingUrl(parts[index], accent), request, rate)
        } catch {
          if (request !== sequence.current) return
          speakSystem(parts.slice(index).join('. '), accent, rate, request)
          return
        }
      }
    })()
  }

  return { speak, stop }
}
