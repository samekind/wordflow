// One-off: the study plan is "第 N 天" (one day's words, split into groups of 20), not "单元".
// Exact string replacements, longest first, applied to app sources and the browser tests.
import fs from "node:fs";

const pairs = [
  ["选一本词书，按单元学习。每本书的进度分别保留。", "选一本词书，按天学习，每天的词分成 20 个一组。每本书的进度分别保留。"],
  ["选择词书后可设置每单元词量。词表来自 ECDICT 分类，非官方出版词书。", "选择词书后可设置每天词量。词表来自 ECDICT 分类，非官方出版词书。"],
  ["本单元的词已学过或已标熟，可以回看，或继续下一单元。", "今天的词已学过或已标熟，可以回看，或继续下一天。"],
  ["只用于以后添加的词书，现有词书的单元和进度保留。", "只用于以后添加的词书，现有词书的每天词量和进度保留。"],
  ["设置新词书的单元大小，以及后续复习的方法。", "设置新词书每天学多少词，以及后续复习的方法。"],
  ["从本单元选词后生成。短文会保存在这里，随时回来读。", "从当天的词里选词后生成。短文会保存在这里，随时回来读。"],
  ["未完成单元较多，请先完成已有任务后再开始新单元", "未完成的天数较多，请先完成已有任务后再开始新的一天"],
  ["学习单元已切换，请回到原单元继续", "学习的天已切换，请回到原来那一天继续"],
  ["这个学习单元不存在", "这一天不存在"],
  ["回看本单元 · 不改变复习计划", "回看当天 · 不改变复习计划"],
  ["返回本单元新词", "返回当天新词"],
  ["继续本单元新词", "继续当天新词"],
  ["本单元暂无新词", "今天暂无新词"],
  ["进入下一单元", "进入下一天"],
  ["新词书每单元词量", "新词书每天词量"],
  ["保存单元词量", "保存每天词量"],
  ["本书每单元词量", "每天学多少词"],
  ["单元词量、复习方法", "每天词量、复习方法"],
  ["选择学习单元", "选择学习的天"],
  ["短文上一单元", "短文前一天"],
  ["短文下一单元", "短文后一天"],
  ["上一单元", "前一天"],
  ["下一单元", "后一天"],
  ["回看本单元", "回看当天"],
  ["本单元待学", "今天待学"],
  ["本单元有", "今天有"],
  ["本单元词", "当天的词"],
  ["学习单元", "学习的天"],
  ["词 / 单元", "词 / 天"],
  ["词 · 每单元", "词 · 每天"],
  ["每单元", "每天"],
  ["个单元 · 最后单元", "天学完 · 最后一天"],
  ["单元短文已保存", "天短文已保存"],
  ["第 ${index + 1} 单元", "第 ${index + 1} 天"],
  ["第 ${day + 1} 单元", "第 ${day + 1} 天"],
  ["单元</span>", "天</span>"],
  ["第 2 单元", "第 2 天"],
  ["每天新学一个单元；学过的单元在第 1、2、4、7、15 天后回来复习。", "每天学当天的词，20 个一组；学过的那一天在第 1、2、4、7、15 天后回来复习。"],
  ["词。每天学一个单元，之后按时复习。", "词。每天学一天的词，20 个一组，之后按时复习。"],
  ["<span>个单元</span>", "<span>天</span>"],
  ["{day + 1} 单元", "{day + 1} 天"],
  ["{days.length || 1} 单元", "{days.length || 1} 天"],
  ["个单元", "天"],
];

const files = [
  ...["src", "src/components", "src/pages", "src/app"].flatMap((dir) => fs.readdirSync(dir).filter((f) => /\.(tsx?|mjs)$/.test(f)).map((f) => `${dir}/${f}`)),
  "tests/browser.spec.ts", "tests/learning.browser.spec.ts",
];
let total = 0;
for (const file of files) {
  let s = fs.readFileSync(file, "utf8");
  const before = s;
  for (const [from, to] of pairs) { const n = s.split(from).length - 1; if (n) { s = s.split(from).join(to); total += n; } }
  if (s !== before) fs.writeFileSync(file, s);
}
console.log("replaced", total);
for (const file of files) {
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => { if (line.includes("单元")) console.log(`  left ${file}:${i + 1}  ${line.trim().slice(0, 120)}`); });
}
