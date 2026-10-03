import assert from 'node:assert/strict'
import test from 'node:test'
import { speechClips } from '../src/speech-clips'

test('short sentences merge, long ones split under the cloud limit, paragraphs stay in order', () => {
  assert.deepEqual(speechClips('Hi there. How are you?\nFine.'), ['Hi there. How are you? Fine.'])
  const long = `${'A clause that keeps going and going, '.repeat(12)}and then it ends.`
  const clips = speechClips(long)
  assert.ok(clips.length > 1)
  assert.ok(clips.every(clip => clip.length <= 180))
  assert.equal(clips.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '))
  const paragraphs = speechClips(`${'First paragraph sentence one is fairly long to stay alone here. '.repeat(2)}\n${'Second paragraph sentence is also fairly long to stay alone. '.repeat(2)}`)
  assert.ok(paragraphs[0].startsWith('First') && paragraphs.at(-1)!.startsWith('Second'))
})
test('text without letters yields no clips', () => {
  assert.deepEqual(speechClips('  \n 123 ... '), [])
})
