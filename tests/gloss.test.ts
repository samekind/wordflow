import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coreGloss } from '../src/gloss'

test('study gloss keeps the core senses and drops dictionary leftovers', () => {
  assert.equal(coreGloss('n. 作家, 作家的著作, 创始人\n[法] 作者, 著作人, 本人'), '作家，作家的著作')
  assert.equal(coreGloss('vt. 建立, 创立, 铸造\nfind的过去式和过去分词'), '建立，创立')
  assert.equal(coreGloss('n. 增加, 增进, 利益\nvt. 增加, 加大\nvi. 增加, 繁殖'), '增加，增进')
  assert.equal(coreGloss('a. 社会的, 群居的, 社交的\nn. 联欢会'), '社会的，群居的')
  assert.equal(coreGloss('n. 大学'), '大学')
  assert.equal(coreGloss('n. 给予(物), 出价, 提议'), '给予(物)，出价')
  assert.equal(coreGloss('有韧性的'), '有韧性的')
  assert.equal(coreGloss('n. 圆, 圆形物, 巡回, 循环, 一轮, 一回合, 一局, 范围, 轮唱\na. 圆的, 球形的, 丰满的'), '圆，圆形物')
})
