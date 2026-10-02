import fixes from './gloss-fixes.ts'

const partOfSpeech = /^(?:n|vt|vi|v|a|ad|adj|adv|prep|conj|pron|art|num|int|interj|aux|abbr|pl|det|pref|suf)\.\s*/i
const inflection = /过去式|过去分词|第三人称|现在分词|复数/
// A parenthesised note such as "（bird的复数）" or "( recycle的过去式和过去分词 )" names the base word,
// not the meaning, so it is dropped from the core gloss (the full text stays in 标准释义).
const inflectionNote = /[（(][^）)]*?(?:复数|过去式|过去分词|现在分词|第三人称|比较级|最高级)[^）)]*[）)]/g
const domainTag = /^\[[^\]]{1,12}\]\s*/
const openers = '（([【'
const closers = '）)]】'
const separators = ',，;；、'
const senseLimit = 14
const maxSenses = 2

/** Splits on commas and semicolons that are not inside brackets, so "占(时间、空间等)" stays whole. */
function split(text: string): string[] {
  const parts: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (openers.includes(char)) depth++
    else if (closers.includes(char)) depth = Math.max(0, depth - 1)
    else if (!depth && separators.includes(char)) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts.map(part => part.trim()).filter(Boolean)
}

function pieces(line: string, allowTagged: boolean): string[] {
  let text = line.trim()
  if (!text) return []
  if (domainTag.test(text)) {
    if (!allowTagged) return []
    text = text.replace(domainTag, '')
  }
  if (inflection.test(text) && !partOfSpeech.test(text) && !allowTagged) return []
  text = text.replace(inflectionNote, ' ').replace(/\[[^\]]{0,16}\]/g, ' ').trim()
  while (partOfSpeech.test(text)) text = text.replace(partOfSpeech, '')
  return split(text)
}

function senses(raw: string, allowTagged: boolean): string[] {
  const seen = new Set<string>()
  const chosen: string[] = []
  for (const line of raw.split(/\n+/)) {
    for (const part of pieces(line, allowTagged)) {
      const key = part.replace(/[（(][^）)]*[）)]/g, '')
      if (!key || seen.has(key)) continue
      const next = chosen.length ? `${chosen.join('，')}，${part}` : part
      if (chosen.length && (chosen.length >= maxSenses || next.length > senseLimit)) return chosen
      seen.add(key)
      chosen.push(part)
    }
  }
  return chosen
}

const corrections = new Map(Object.entries(fixes as Record<string, string>).map(([raw, core]) => [raw.trim(), core]))

/** The few words for study cards. A reviewed correction is keyed by the exact stored text, so a
 * meaning the user edited never picks up a correction written for the original entry. */
export function coreGloss(raw: string): string {
  return corrections.get(raw.trim()) ?? derivedGloss(raw)
}

/** The rule-based extraction alone, without reviewed corrections. */
export function derivedGloss(raw: string): string {
  // Entries that only carry field-tagged lines ([计], [经], ...) still have a meaning worth showing.
  const chosen = senses(raw, false)
  const result = chosen.length ? chosen : senses(raw, true)
  return result.length ? result.join('，') : raw.trim()
}
