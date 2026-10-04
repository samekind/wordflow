import test from 'node:test'
import assert from 'node:assert/strict'
import { chineseSenses, englishSenses, wordInflections } from '../src/local-dictionary'

test('Chinese senses split into part-of-speech lines and keep tagged lines', () => {
  assert.deepEqual(chineseSenses('vt. 放弃, 抛弃\nn. 放任, 无拘束\n[计] 句子'), [
    { pos: 'vt.', text: '放弃, 抛弃' }, { pos: 'n.', text: '放任, 无拘束' }, { pos: '[计]', text: '句子' }])
  assert.deepEqual(chineseSenses('海洋'), [{ pos: '', text: '海洋' }])
  assert.equal(chineseSenses('n. a\nn. b\nn. c', 2).length, 2)
})

test('English definitions accept both ECDICT styles and join indented continuation lines', () => {
  assert.deepEqual(englishSenses('n. the trait of lacking restraint\nv a recording of both\ns. reflecting\n  the latest information'), [
    { pos: 'n.', text: 'the trait of lacking restraint' }, { pos: 'v.', text: 'a recording of both' }, { pos: 'adj.', text: 'reflecting the latest information' }])
  assert.deepEqual(englishSenses(''), [])
})

test('inflections merge labels of identical forms and ignore the lemma and type fields', () => {
  assert.deepEqual(wordInflections('d:abandoned/p:abandoned/i:abandoning/3:abandons/0:abandon/1:p'), [
    { form: 'abandoned', labels: ['过去分词', '过去式'] }, { form: 'abandoning', labels: ['现在分词'] }, { form: 'abandons', labels: ['第三人称单数'] }])
  assert.deepEqual(wordInflections(''), [])
})
