// Frequency-ordered word list (with inflected forms) the library pipeline uses to measure how rare an article's words are.
import { readFileSync, writeFileSync } from 'node:fs'
const rows = JSON.parse(readFileSync(new URL('../public/vocabulary/ecdict.json', import.meta.url), 'utf8'))
const lines = rows.map(row => {
  const forms = new Set([String(row.word).toLowerCase()])
  for (const part of String(row.exchange || '').split('/')) {
    const value = part.split(':')[1]?.toLowerCase()
    if (value && /^[a-z]+$/.test(value)) forms.add(value)
  }
  return [...forms].filter(form => /^[a-z]+$/.test(form)).join(' ')
})
writeFileSync(new URL('../cloud/library-wordlist.txt', import.meta.url), lines.join('\n') + '\n')
console.log(lines.length, 'words')
