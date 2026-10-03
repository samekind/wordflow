// Builds public/avatars/library.json: a fixed set of cartoon avatars from DiceBear's CC0 styles.
// The app ships the SVGs (no runtime dependency) and turns the chosen one into a PNG for the profile.
import { createAvatar } from '@dicebear/core'
import { lorelei, notionists, openPeeps, pixelArt, thumbs } from '@dicebear/collection'
import { mkdirSync, writeFileSync } from 'node:fs'

const backgrounds = ['ffe3e3', 'ffeccc', 'fff4c2', 'dff5e1', 'd9f0ff', 'e5e0ff', 'fde2f3', 'e6edf5']
const sets = [
  { style: lorelei, id: 'lorelei', name: 'Lorelei', seeds: ['Mochi', 'Luna', 'Kiki', 'Bao', 'Coco', 'Momo', 'Nana', 'Pudding', 'Taro', 'Yuzu', 'Sakura', 'Doudou'] },
  { style: notionists, id: 'notionists', name: 'Notionists', seeds: ['Felix', 'Aneka', 'Milo', 'Zoe', 'Leo', 'Iris', 'Otto', 'Mia'] },
  { style: pixelArt, id: 'pixel-art', name: 'Pixel Art', seeds: ['Pixel', 'Byte', 'Chip', 'Nova', 'Bit', 'Retro', 'Arcade', 'Joy'] },
  { style: openPeeps, id: 'open-peeps', name: 'Open Peeps', seeds: ['Sunny', 'River', 'Maple', 'Pebble'] },
  { style: thumbs, id: 'thumbs', name: 'Thumbs', seeds: ['Thumb', 'Wave', 'Peace', 'Cheer'] },
]
const avatars = []
for (const set of sets) {
  set.seeds.forEach((seed, index) => {
    const svg = createAvatar(set.style, { seed, size: 256, radius: 0, backgroundColor: [backgrounds[(avatars.length + index) % backgrounds.length]] }).toString()
    avatars.push({ id: `${set.id}-${index + 1}`, style: set.id, svg })
  })
}
const library = {
  version: 1,
  styles: sets.map(set => ({ id: set.id, name: set.name, creator: set.style.meta?.creator, source: set.style.meta?.source, license: set.style.meta?.license?.name })),
  avatars,
}
if (library.styles.some(style => style.license !== 'CC0 1.0')) throw new Error('Only CC0 styles belong in the avatar library')
mkdirSync('public/avatars', { recursive: true })
writeFileSync('public/avatars/library.json', JSON.stringify(library))
console.log(`${avatars.length} avatars, ${Math.round(JSON.stringify(library).length / 1024)} KB`)
