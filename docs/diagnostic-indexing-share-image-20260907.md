# Diagnostic 索引核查与 Learndiag 分享图更新

核查日期：2026-09-07。范围：公开 HTTP 检查、本地分享图和回归测试。不部署、不 push、不提交 Google 索引请求、不在 X 发帖。

## 结论

当前线上 /diagnostic 未复现 noindex；分享元数据仍引用旧通用图。已完成本地版本化图片及元数据更新，尚未上线。

## 线上事实与证据

2026-09-07 11:01–11:04 UTC，从本次执行环境发起公开 GET 请求：

| URL | 结果 |
|---|---|
| https://learndiag.com/ | 200；robots=index, follow；canonical 指向首页 |
| https://learndiag.com/diagnostic | 200；robots=index, follow；canonical=https://learndiag.com/diagnostic |
| https://learndiag.com/diagnostic.html | 301 至 /diagnostic，再返回 200 |
| https://learndiag.com/diagnostic/ | 308 至 /diagnostic，再返回 200 |

普通浏览器、Googlebot、Twitterbot User-Agent 共 12 组请求结果一致；未发现冲突 robots/googlebot 元数据或 X-Robots-Tag。HTML 为 public, max-age=0, must-revalidate，CF-Cache-Status=DYNAMIC。UA 对比不等于真实 Google/X 抓取证明。

首页与诊断页线上 og:image / twitter:image 均为 https://learndiag.com/og-image.png。Twitterbot UA 请求图片返回 200 image/png，35,282 字节，max-age=14400。首次 Python 默认 UA 图片请求 403；带 Twitterbot UA 和 curl 后成功，不能据首次 403 判断 X 被阻挡。

线上与本地旧图 SHA256 均为：
`c88c857162fe2ef8b7c5cdf80684f86dbd5f729ac1edf6dda1cbefb9f3d0f6b7`

旧图 Git 最后记录在 8/24，品牌规范 8/28 从 Triumph 切至 Learndiag。本轮图像通道不可用，未直接确认旧图内文字；用户报告旧图显示 Triumph 与上述资源沿用证据一致。

## noindex 历史判断边界

- site/diagnostic.html 原有 index, follow 保留，没有再次修改正确 robots 标签。
- Git 中 8/29 已有移除 noindex 的改动，不等于当日已部署。
- 旧稿 triumph/diagnostic.html 仍为 noindex；sync-site.ps1 已有防覆盖保护，未执行或修改。
- 未取得 Search Console 上次抓取时间、完整受影响 URL、抓取 HTML 和实时检测结果，不能断言 9/4 是代码回退，也不能断言 Google 已恢复收录。
- 本轮不修改 Worker、robots.txt、sitemap 或生产缓存配置。

## 修改文件

以下路径均相对于 E:/Triumph/praxis-5001/：

新增：
- tools/generate-share-image.mjs：复用 sharp，显式加载已入库 Instrument Serif italic 字体，生成 1200×630 新图。
- site/og-image-learndiag-v1.png：Learndiag 通用分享图。
- docs/diagnostic-indexing-share-image-20260907.md：本报告。

更新通用分享元数据的 22 个文件：
- site/404.html
- site/about.html
- site/contact.html
- site/dashboard.html
- site/developers.html
- site/diagnostic.html
- site/drill.html
- site/index.html
- site/login.html
- site/mistake-log.html
- site/mock-exam.html
- site/practice.html
- site/privacy.html
- site/reset.html
- site/resources.html
- site/score-calculator.html
- site/srs.html
- site/study-planner.html
- site/support.html
- site/terms.html
- site/tools.html
- site/upgrade.html

仅更新通用图片 META URL，补齐 OG/Twitter 图片配对、尺寸和 alt。21 个现有专属文章配图页面保持不变。保留旧 og-image.png，JSON-LD 旧 logo 引用未纳入本次 META 分享图迁移。原有个别 drill/mock-exam Twitter 标题的 Triumph 文案未顺手修改；本任务针对头图。

其他更新：
- tools/patch-seo-heads.mjs：默认图及已有通用图的幂等补全；未执行全站补丁循环。
- tools/verify-live-home.mjs：仅更改分享图期望地址；该工具仍有原有旧首页断言，本轮不以其为验收依据。
- test/agentic.test.mjs：新增索引指令、canonical、图片资源/尺寸、通用与专属配图区分、诊断页跳转与查询参数、未来元数据补全幂等性测试。

技术标识、业务逻辑、密钥及原有未跟踪文件 deploy-out.txt / 项目计划完成情况-20260906.md 均未改动。

## 验证结果

- `node tools/generate-share-image.mjs`：成功。
- sharp 检查：PNG、1200×630、sRGB；品牌字标边界 x=78..790、y=194..343，未超出画布。
- `npm test`：101 项通过，0 失败，0 跳过；含 Worker smoke tests。
- `git diff --check`：无空白错误；Git 提示 Windows LF/CRLF 转换警告，不是测试失败。
- 图像验收工具返回 Unverified：所选模型不支持图像输入。无观察到的视觉缺陷，但无法确认字体实际效果、整体排版和缩略图可读性；程序检查不替代视觉验收。

## 发布状态与剩余验收

尚未部署，所以线上和 X 当前仍可能显示旧图。新文件名避免复用旧图片缓存键，但 X 已发布卡片仍需平台重新抓取；不承诺部署后即时刷新。

发布前需完成图片人工视觉验收及明确部署授权。Google 是否仍在使用历史抓取结果，需以 Search Console 对准确 URL 的抓取时间和实时检测为准。

## 同日追加：CSV 缺少 Meta Description

用户提供 `C:/Users/abc27/Downloads/learndiag.com_PagesByIssueCategory_2026_9_7.csv`，列出 support、upgrade、mock-exam、drill、dashboard 五页。核实五页均缺少标准 description，且 twitter:description 为空。

仅在上述五个 `E:/Triumph/praxis-5001/site/<页面名>.html` 文件补充与实际用途对应的 description，并同步原有空 Twitter 描述。描述长度分别为 139、157、150、155、148 字符。保留原有 noindex, nofollow（账户、订阅与应用工具页），不与 /diagnostic 的公开索引策略混淆。未改业务脚本、图片或标题。

Python 标准库 HTMLParser 检查五页各有且仅有一个非空 description、Twitter 描述一致、robots 和新分享图地址保留，五页全部通过；再次运行 npm test 成功。仍未部署，线上扫描需发布后重新抓取才会更新。
