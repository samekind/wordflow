/** Reads the ECDICT fields the app bundles (meaning, definition, exchange) into the lines a dictionary page shows. */
export type DictLine = { pos: string; text: string }

const englishPos: Record<string, string> = { n: 'n.', v: 'v.', a: 'adj.', s: 'adj.', r: 'adv.', adj: 'adj.', adv: 'adv.', vt: 'vt.', vi: 'vi.', prep: 'prep.', conj: 'conj.', pron: 'pron.', int: 'int.', num: 'num.', art: 'art.', aux: 'aux.' }

/** The Chinese meaning: one line per part of speech, e.g. "vt. 放弃, 抛弃". Domain-tagged lines ("[计] ...") keep their tag as the label. */
export function chineseSenses(raw: string, limit = 8): DictLine[] {
  return raw.split(/\n+/).map(line => line.trim()).filter(Boolean).slice(0, limit).map(line => {
    const match = line.match(/^([a-z]{1,6}\.)\s*(.*)$/i) || line.match(/^(\[[^\]]{1,8}\])\s*(.*)$/)
    return match && match[2] ? { pos: match[1], text: match[2] } : { pos: '', text: line }
  })
}

/** The English definition: "n. ..." / "n ..." lines, with indented lines continuing the previous one. */
export function englishSenses(raw: string, limit = 6): DictLine[] {
  const lines: DictLine[] = []
  for (const line of raw.split(/\n/)) {
    if (!line.trim()) continue
    const match = /^\S/.test(line) ? line.trim().match(/^([a-z]{1,4})\.?\s+(.*)$/) : null
    if (match && englishPos[match[1]]) lines.push({ pos: englishPos[match[1]], text: match[2].trim() })
    else if (lines.length && /^\s/.test(line)) lines[lines.length - 1].text += ` ${line.trim()}`
    else lines.push({ pos: '', text: line.trim() })
  }
  return lines.slice(0, limit)
}

const formLabels: Record<string, string> = { p: '过去式', d: '过去分词', i: '现在分词', '3': '第三人称单数', r: '比较级', t: '最高级', s: '复数' }
/** Inflections from the exchange field ("p:abandoned/d:abandoned/i:abandoning"), merging labels of identical forms. */
export function wordInflections(raw: string): { form: string; labels: string[] }[] {
  const merged = new Map<string, string[]>()
  for (const part of raw.split('/')) {
    const [type, values] = part.split(':')
    if (!formLabels[type] || !values) continue
    for (const form of values.split(',').map(value => value.trim()).filter(Boolean)) merged.set(form, [...(merged.get(form) ?? []), formLabels[type]])
  }
  return [...merged].map(([form, labels]) => ({ form, labels }))
}
