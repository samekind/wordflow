const partOfSpeech = /^(?:n|vt|vi|v|a|adj|adv|prep|conj|pron|art|num|int|aux|abbr|pl)\.\s*/i
const inflection = /过去式|过去分词|第三人称|现在分词|复数/
const senseLimit = 14
const maxSenses = 2

function pieces(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('[')) return []
  if (inflection.test(trimmed) && !partOfSpeech.test(trimmed)) return []
  let text = trimmed.replace(/\[[^\]]{0,16}\]/g, ' ')
  while (partOfSpeech.test(text)) text = text.replace(partOfSpeech, '')
  return text.split(/[,，;；、]/).map(part => part.trim()).filter(part => part && !part.startsWith('['))
}

export function coreGloss(raw: string): string {
  const seen = new Set<string>()
  const senses: string[] = []
  for (const line of raw.split(/\n+/)) {
    for (const part of pieces(line)) {
      const key = part.replace(/[（(][^）)]*[）)]/g, '')
      if (!key || seen.has(key)) continue
      const next = senses.length ? `${senses.join('，')}，${part}` : part
      if (senses.length && (senses.length >= maxSenses || next.length > senseLimit)) return senses.join('，')
      seen.add(key)
      senses.push(part)
    }
  }
  return senses.length ? senses.join('，') : raw.trim()
}
