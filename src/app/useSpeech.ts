import { useRef } from 'react'
import type { Store } from '../model'
import { isAndroidApp, phone } from '../platform'
import { lookupDictionary, safeExternalUrl } from '../dictionary'
import { cloudBase } from '../cloud'
import { speechClips } from '../speech-clips'

/** Words and short phrases (up to five words, no sentence punctuation) have human recordings. */
export const recordable = (text: string) => /^[A-Za-z][A-Za-z' -]{0,59}$/.test(text.trim()) && text.trim().split(/\s+/).length <= 5
/** Youdao's dictionary recordings: real speakers, reachable from mainland China, type 1 = UK, 2 = US. */
export const recordingUrl = (word: string, accent: 'us' | 'uk') => `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word.trim())}&type=${accent === 'uk' ? 1 : 2}`

/** Human recordings for words (Youdao, then the dictionary's own audio); sentences use the cloud voice; system text-to-speech when offline. */
export function useSpeech(storeRef: { current: Store }, notify: (message: string) => void) {
  const sequence = useRef(0)
  const recording = useRef<HTMLAudioElement | null>(null)
  const clips = useRef(new Map<string, Promise<string>>())
  const liveRate = useRef(storeRef.current.pronunciation.rate)

  /** Fetches (and keeps) one sentence of cloud speech as a local blob so the next one can load while this one plays. */
  function clip(text: string, accent: 'us' | 'uk') {
    const key = `${accent}|${text}`
    let found = clips.current.get(key)
    if (!found) {
      found = fetch(`${cloudBase}/v1/tts?accent=${accent}&text=${encodeURIComponent(text)}`, { credentials: 'omit', signal: AbortSignal.timeout(20000) })
        .then(async response => { if (!response.ok) throw new Error('tts'); return URL.createObjectURL(await response.blob()) })
      found.catch(() => clips.current.delete(key))
      clips.current.set(key, found)
      if (clips.current.size > 40) {
        const oldest = clips.current.keys().next().value!
        const stale = clips.current.get(oldest)!
        clips.current.delete(oldest)
        void stale.then(url => URL.revokeObjectURL(url), () => {})
      }
    }
    return found
  }

  /** Changes the speed of what is playing now and of every clip after it. */
  function setRate(rate: number) {
    liveRate.current = rate
    if (recording.current) recording.current.playbackRate = Math.max(.5, Math.min(1.5, rate))
  }

  function stop() {
    sequence.current++; recording.current?.pause(); recording.current = null
    if (isAndroidApp) { void phone.stopSpeech().catch(() => {}); return }
    if ('speechSynthesis' in window) speechSynthesis.cancel()
  }

  /** Resolves when the clip ends; rejects if it cannot load or start within a few seconds (offline, unknown word). */
  function play(url: string, request: number, rate: number | null) {
    return new Promise<void>((resolve, reject) => {
      if (request !== sequence.current) { resolve(); return }
      const player = new Audio(url); recording.current = player
      player.preload = 'auto'
      player.preservesPitch = true
      player.playbackRate = Math.max(.5, Math.min(1.5, rate ?? liveRate.current))
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
    speakOne(text, accent, storeRef.current.pronunciation.rate, sequence.current)
  }

  /** Speaks paragraphs one after another; onPart reports each paragraph index as playback reaches
   * it, and -1 when the whole text finished on its own. A new play/stop invalidates the chain. */
  function speakParagraphs(paragraphs: string[], onPart?: (index: number) => void) {
    stop()
    const request = sequence.current
    const accent = storeRef.current.pronunciation.accent
    const rate = storeRef.current.pronunciation.rate
    void (async () => {
      for (let index = 0; index < paragraphs.length; index++) {
        if (request !== sequence.current) return
        onPart?.(index)
        await speakOne(paragraphs[index], accent, rate, request)
      }
      if (request === sequence.current) onPart?.(-1)
    })()
  }

  /** Speaks one text to the end: word recordings sentence by sentence, then cloud voice clips,
   * then the system voice; resolves when the text finished or the request was superseded. */
  function speakOne(text: string, accent: 'us' | 'uk', rate: number, request: number): Promise<void> {
    // "朗读本组" sends words joined by ". ": play each recording in turn.
    const parts = text.split(/\.\s+/).map(part => part.trim().replace(/\.$/, '')).filter(Boolean)
    if (!parts.length || !parts.every(recordable)) return speakProse(text, accent, rate, request)
    return (async () => {
      for (let index = 0; index < parts.length; index++) {
        if (request !== sequence.current) return
        try {
          await play(recordingUrl(parts[index], accent), request, rate)
        } catch {
          if (request !== sequence.current) return
          await speakProse(parts.slice(index).join('. '), accent, rate, request)
          return
        }
      }
    })()
  }

  /** Sentences and articles: cloud voice clip by clip, then the system voice from the failed clip on. */
  function speakProse(text: string, accent: 'us' | 'uk', rate: number, request: number): Promise<void> {
    const pieces = speechClips(text)
    if (!pieces.length) { speakSystem(text, accent, rate, request); return Promise.resolve() }
    return (async () => {
      let next = clip(pieces[0], accent)
      for (let index = 0; index < pieces.length; index++) {
        if (request !== sequence.current) return
        try {
          const url = await next
          if (request !== sequence.current) return
          if (index + 1 < pieces.length) { next = clip(pieces[index + 1], accent); next.catch(() => {}) }
          await play(url, request, null)
        } catch {
          if (request !== sequence.current) return
          speakSystem(pieces.slice(index).join(' '), accent, rate, request)
          return
        }
      }
    })()
  }

  return { speak, speakParagraphs, stop, setRate }
}
