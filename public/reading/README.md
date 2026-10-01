# 每日英语选读

`catalog.json` 由 `scripts/build-reading.mjs` 从 Wikipedia / Simple English
Wikipedia 的 Page Content Service 接口生成。正文是来源文章的开头段落选读，
不是新闻全文、人工英语分级结果或 AI 生成故事。

每项包含原文链接、来源、作者署名和提取时间。摘录正文按
CC BY-SA 4.0 提供，保留选中段落的文字，省略引用标记、表格和导航内容：

- https://creativecommons.org/licenses/by-sa/4.0/
- https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use/en
- https://www.mediawiki.org/wiki/Page_Content_Service

图片单独从 Wikimedia Commons 核对许可后纳入。每张图片的作者、来源与
许可在对应记录的 `image` 字段中；图片许可不与文字许可混同。
生成器只缩略展示来源图片，不移除来源署名，不纳入 Wikipedia 非自由图片。

基础/进阶是应用内选读参考：分别使用 Simple English / English Wikipedia，
不声称经过 CEFR 等级测评。每日推荐在有限精选库中轮换，不声称每日新发表。
应用可按用户操作刷新对应正文，更新失败保留本地版本。
