export type BundledMnemonic = { mnemonic: string; example: string; translation: string }
let cached: Promise<Record<string, BundledMnemonic>> | undefined
export function loadMnemonics() {
  cached ??= fetch('/vocabulary/mnemonics.json').then(async response => {
    if (!response.ok) return {}
    const data = await response.json() as { words?: Record<string, BundledMnemonic> }
    return data.words || {}
  }).catch(() => ({}))
  return cached
}
export function bundledMnemonic(words: Record<string, BundledMnemonic>, word: string) {
  return words[word.trim().toLowerCase()]
}
