# Learndiag · Brand Spec（v3）

> 更新：2026-08-28（v2 → v3）
> 变更：产品名 **Triumph → Learndiag**；主域名 `trytriumph.de5.net → learndiag.com`
> 背景：原域名 praxis5001.com 因含 ETS 商标「Praxis」存在侵权隐患已退订；改用自有品牌域 **learndiag.com**（无品牌注册冲突，可直接用）
> 产品名：**Learndiag**（暂定，final）
> 定位：Praxis 5001 备考系统 —— 免费题库 + 诊断 + 通过率预测 + 个性化计划

## 🎯 核心资产

### Logo / Wordmark
- 文字 logo：衬线（Instrument Serif italic）wordmark "Learndiag."
- 风格：编辑式，像出版物栏题，不做图形标

### 产品截图/UI
- 无既有产品（新品牌），原型即第一版 UI

## ⚠️ 技术标识保留规则（重要，改品牌时勿动）

以下含 `triumph` 的**技术标识**是功能依赖，**不得**随品牌改名为 Learndiag —— 改动会导致功能/数据损坏：

| 技术标识 | 用途 | 为什么不能改 |
|---|---|---|
| `window.TriumphAuth` | 前端全局认证对象 | 所有页面 JS 依赖此名 |
| `triumph_token` / `triumph_user` / `triumph_pending_verify` | localStorage 登录态 | 改 key 会丢失用户登录/数据 |
| `triumph_*`（last_pass/today/answers/srs/exam_date 等） | localStorage 学习数据 | 同上，改了丢用户数据 |
| `env.TRIUMPH_KV` / `env.TRIUMPH_D1` | Cloudflare KV/D1 绑定名 | 与部署配置绑定，改则运行时崩溃 |
| `window.TRIUMPH_API` | 本地联调 API 覆盖标识 | 前端约定 |
| `triumph-api` | API service 标识 | 已签发 API key 的兼容性 |
| `triumph-6eq.pages.dev` | Cloudflare Pages 生成子域 | 平台生成，不可改 |
| `triumph`（MCP server name / wrangler 项目名） | 平台/协议标识 | 改动影响部署与兼容 |
| `triumph-praxis`（CLI 包名） | 对外 CLI 工具名 | 已发布产物命名 |
| URL fragment `#triumph_token=`（Google OAuth 回跳） | 登录回调约定 | 前后端必须一致 |

**品牌改名边界**：只改「页面显示给用户的品牌文字」（title/meta/wordmark/文案/邮件模板），技术标识一律保留。

## 🎨 辅助资产

### 色板（莫兰迪色系，低饱和灰调，主色灰调粉 #C09D9B）
- `--bg`: #F2EFE9            暖灰白（页面底，微粉调）
- `--bg-soft`: #E8E3D8       浅暖灰（section 交替底）
- `--ink`: #3C3733           深暖灰褐（正文）
- `--ink-soft`: #6E6760      中暖灰（次级文字）
- `--line`: #D8D1C5          浅暖灰（分隔线）
- `--accent`: #C09D9B        **莫兰迪粉（主色调）**——CTA、编号、链接、分数、斜体强调
- `--accent-deep`: #A67D7A   深粉（hover）
- `--on-accent`: #332E2B     粉底上的文字色（深暖灰）
- 禁用：纯灰（莫兰迪是灰调带色，不是纯灰）、高饱和色、蓝色系（竞品）、紫色渐变

### 字型（保持）
- Display: `"Instrument Serif", Georgia, serif`（衬线，400/italic）
- Body: `"Instrument Sans", system-ui, sans-serif`（400/500/600）
- Mono（分数/数据）: `"JetBrains Mono", ui-monospace, monospace`

### 签名细节（120% 做到的地方）
1. 标题斜体衬线强调词用**莫兰迪粉**（编辑感的色彩落点）
2. 大写小号字距拉开的"栏题"标签（eyebrow）
3. 分隔用细线 + 编号（01/02/03/04）——编号用粉色
4. 通过率/分数用等宽字体 + 粉色，像"报告书"上的数据
5. CTA 用莫兰迪粉底 + 深暖灰字（柔和低对比，莫兰迪式，不做高饱和科技感）

### 气质关键词
- editorial · calm · soft-confident · humane · deliberate

### 禁区
- 不用高饱和色（莫兰迪的"灰"是灵魂）
- 不用 emoji 装饰
- 不用圆角卡片 + 左 border accent
- 不用激进渐变
- 不编造数据/评价（全部用调研真实数据，没有就 placeholder）
