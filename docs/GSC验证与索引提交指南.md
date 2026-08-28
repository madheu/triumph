# GSC 验证与索引提交操作指南（trytriumph.de5.net）

> 适用场景：首页 Title 已改为 **Free Praxis 5001 Practice Test & Diagnostic | Triumph**，
> 新增两个页面 `praxis-5001-passing-score-by-state` 和 `praxis-5001-subtests-explained`，
> 需要部署到 Cloudflare Pages 并让 Google 尽快收录。
>
> 本地预检已确认（2026-08-25 快照）：
> - ✅ `site/index.html` 的 `<title>` 已是 `Free Praxis 5001 Practice Test & Diagnostic | Triumph`
> - ✅ `site/praxis-5001-passing-score-by-state.html`、`site/praxis-5001-subtests-explained.html` 已生成
> - ✅ `site/sitemap.xml` 已包含首页、两个新页面（lastmod 2026-08-25），共 28 条 URL
> - ✅ `site/robots.txt` 已声明 `Sitemap: https://trytriumph.de5.net/sitemap.xml`

---

## 第一步：部署到 Cloudflare Pages（先上线，再谈收录）

Google 只能抓取线上内容，**必须先部署**。

### 1.1 执行部署（PowerShell）

```powershell
# ① 把 "Triumph SEO/*.md" 文章重新渲染成 site/*.html（含两个新页面）
node "E:\Triumph\praxis-5001\seo-publish.js"

# ② 构建 worker bundle 并部署 site/ 到 Cloudflare Pages 项目 triumph
cd E:\Triumph\praxis-5001
.\deploy.ps1
```

### 1.2 预期结果

| 命令 | 成功标志 |
|---|---|
| `seo-publish.js` | 逐行输出 `✓ xxx.md -> xxx.html (N words)`，最后一行 `共生成 N 篇` |
| `deploy.ps1` | 黄色提示 `Building worker bundle...` → `Deploying...` → 绿色 **`=== DEPLOY OK ===`** 与 `URL: https://triumph-6eq.pages.dev` |

注意事项：
- 首次使用需一次性准备：`npm install -g wrangler` + `wrangler login`（浏览器授权）。脚本会自动检测并引导。
- 脚本内部已自动设置本机代理 `http://127.0.0.1:7890` 访问 Cloudflare API，无需手动配置；但代理本身必须在线。
- 自定义域名 `trytriumph.de5.net` 绑定在 Pages 项目上，部署完成后自动生效，无需额外操作。

### 1.3 部署后线上验证（浏览器或 curl）

| 检查项 | URL | 预期结果 |
|---|---|---|
| 新页面 A | https://trytriumph.de5.net/praxis-5001-passing-score-by-state | **HTTP 200**，页面正常渲染，H1 为文章标题 |
| 新页面 B | https://trytriumph.de5.net/praxis-5001-subtests-explained | **HTTP 200** |
| 首页 Title | https://trytriumph.de5.net/ （查看源代码 Ctrl+U） | `<title>Free Praxis 5001 Practice Test &amp; Diagnostic | Triumph</title>` |
| Sitemap | https://trytriumph.de5.net/sitemap.xml | 返回 XML，且包含上面两条新页面 URL |

命令行快速验证：

```powershell
curl.exe -I https://trytriumph.de5.net/praxis-5001-passing-score-by-state   # 期望 HTTP/2 200
curl.exe -I https://trytriumph.de5.net/praxis-5001-subtests-explained       # 期望 HTTP/2 200
curl.exe -s https://trytriumph.de5.net/ | findstr "<title>"                 # 期望新标题
curl.exe -s https://trytriumph.de5.net/sitemap.xml | findstr "subtests-explained passing-score-by-state"
```

> ⚠️ 若任一项返回 404 或旧标题，说明部署未生效或缓存未刷新——先做第五步的强刷，再排查 `deploy.ps1` 输出。

---

## 第二步：确认 GSC 属性设置（只需人工在浏览器完成）

打开 **https://search.google.com/search-console** 并登录 Google 账号。

### 2.1 确认是否已有 Domain 属性

- 在左上角属性下拉列表里找 **`trytriumph.de5.net`**：
  - **Domain 属性**显示为不带 `https://` 的裸域名（推荐形式，覆盖该域下所有协议与子路径）。
  - 如果列表里已有它且左侧无红色报错 → 直接跳到 2.3 提交 Sitemap。
- **如果没有**，按 2.2 添加（DNS TXT 验证）。

### 2.2 （仅当没有时）添加 Domain 属性并用 DNS TXT 验证

1. GSC 首页点 **添加属性 (Add property)** → 选择 **域 (Domain)**。
2. 输入 `trytriumph.de5.net`（不要带 https://）→ 继续。
3. Google 会给出一串 TXT 记录值，形如：
   `google-site-verification=AbC123...` —— 复制整串。
4. 到该域名的 DNS 托管商（de5.net 的解析后台；若域名托管在 Cloudflare 就在 Cloudflare DNS 面板）添加记录：

   | 字段 | 值 |
   |---|---|
   | 类型 (Type) | `TXT` |
   | 名称/主机 (Name) | `trytriumph`（若 trytriumph.de5.net 本身是一个独立 zone 则填 `@`） |
   | 内容 (Content) | `google-site-verification=AbC123...`（粘贴 GSC 给的完整字符串） |
   | TTL | Auto / 默认 |

5. 回到 GSC 点 **验证 (Verify)**。
   - **预期结果**：弹出绿色 ✅ "所有权已验证"。DNS 生效通常几分钟内；若失败等 10–30 分钟再点一次。
6. 验证成功后**不要再删除这条 TXT 记录**，否则属性会掉验证。

### 2.3 提交 Sitemap

1. 左侧菜单 → **站点地图 (Sitemaps)**。
2. 若历史列表里已有 `sitemap.xml` 且状态为 **Success（成功）**、已发现网址数 ≈ 28 → 无需重复提交。
3. 否则在输入框填 `sitemap.xml`（域名前缀已固定）→ 点 **提交 (Submit)**。
   - **预期结果**：状态列变为 **Success**，“已发现的网址数”约 **28**。首次处理可能先显示“无法获取”，一般 24 小时内转为 Success，不必反复重交。

---

## 第三步：用“网址检查”请求收录（每个 URL 只提交一次）

> **重要**：“请求编入索引”每天每属性只有约 10 次配额，且**对同一 URL 反复提交没有任何加速效果**。以下 3 个 URL 各提交一次即可。

### 3.1 操作步骤

1. 登录 GSC，顶部属性选择器选中 **trytriumph.de5.net**（Domain 属性）。
2. 把首页完整网址粘贴进最顶部的搜索框（即“网址检查 / URL Inspection”）：
   ```
   https://trytriumph.de5.net/
   ```
3. 回车，等待检查完成（首次会提示“正在从实际网址获取数据”，约十几秒）。
4. 结果页点击右侧 **请求编入索引 (REQUEST INDEXING)** 按钮 → 它会先做一次在线测试 → 弹窗确认 → 点 **是**。
   - **预期结果**：约 1–2 分钟后显示 **“已请求编入索引 (Indexing requested)”**。这表示请求已进入队列，不代表已完成收录。
5. 对两个新页面各重复一次：
   ```
   https://trytriumph.de5.net/praxis-5001-passing-score-by-state
   https://trytriumph.de5.net/praxis-5001-subtests-explained
   ```

完成后**到此为止**——不要当天再提交第二次。剩余 URL 靠 sitemap 让 Google 自然发现即可。

### 3.2 时间预期（正常范围，超时不代表出错）

| 动作 | 通常耗时 |
|---|---|
| “已请求编入索引”弹窗确认 | 即时～2 分钟 |
| 首次实际抓取 | 数小时～3 天 |
| 出现在搜索结果（site: 或关键词可查） | 1 天～2 周 |
| Coverage 报告整体状态刷新 | 最长 1–4 周 |

---

## 第四步：监控计划（部署后按节奏查看）

全部在 GSC 的 **trytriumph.de5.net** 属性内操作：

| 时间点 | 看哪里 | 看什么 / 判定标准 |
|---|---|---|
| T+24h | Sitemaps 报告 | `sitemap.xml` 状态 = **Success**，已发现网址 ≈ 28 |
| T+24h | 网址检查 → 输入首页 URL | “网页 IS on Google” 或至少“已抓取”；点 **查看已抓取的网页** 看 Google 视角的新 Title 是否生效 |
| T+3~7 天 | 索引 → **网页 (Pages)** 覆盖率报告 | “已编入索引”数量上升；在“网页为何未编入索引”里不应出现首页/新页面的“已抓取-尚未编入索引”长期滞留 |
| T+7 天 | 网址检查 → 分别输入两个新页面 URL | 状态应为 **“网址在 Google 上”**；未收录则再核对线上 200 与 canonical 是否指向自身 |
| T+14 天起 | 效果 (Performance) 报告 | 按“网页”筛选，看两个新页面的曝光/点击是否从 0 开始增长 |

辅助命令（不依赖 GSC，随时可用）：
```
site:trytriumph.de5.net                      ← Google 搜索，看已收录页面清单
site:trytriumph.de5.net praxis 5001 passing score by state   ← 确认新页面A
cache:https://trytriumph.de5.net/            ← 看 Google 最近一次缓存的版本
```

若 2 周后新页面仍未收录，按顺序排查：线上是否 200 → 页面 canonical 是否为自身 → sitemap 里是否有该 URL → GSC 网址检查“实际网址测试”报错信息。

---

## 第五步：缓存提示（部署后看不到变化时）

Cloudflare Pages 边缘节点更新很快，但**你本地浏览器的旧缓存**会让你误以为没生效：

- **桌面强刷**：`Ctrl + F5`（Windows）/ `Cmd + Shift + R`（Mac）。
- **绕过缓存参数**：在标签页地址后加查询串，例如
  `https://trytriumph.de5.net/?v=1`、`https://trytriumph.de5.net/praxis-5001-subtests-explained?v=1`
  —— 仅用于人工确认，不影响 SEO（canonical 标签仍指向无参数的干净 URL）。
- **手机端**：完全关闭标签页后重新打开；或换隐身/无痕窗口。
- **最可靠**：用 `curl.exe -s <URL> | findstr "<title>"` 直连源站看 HTML，彻底排除浏览器缓存干扰。

---

## 快速执行清单（Checklist）

- [ ] 1. `node E:\Triumph\praxis-5001\seo-publish.js` → 看到“共生成 N 篇”
- [ ] 2. `.\deploy.ps1` → 看到 `=== DEPLOY OK ===`
- [ ] 3. 线上抽查：两个新页面 200、首页 Title 为新版、sitemap.xml 含新页面
- [ ] 4. GSC：确认 Domain 属性 `trytriumph.de5.net` 存在（无则 DNS TXT 验证）
- [ ] 5. GSC：Sitemaps 中 `sitemap.xml` 状态 Success
- [ ] 6. GSC：网址检查依次请求首页 + 两个新页面索引，各一次
- [ ] 7. 浏览器 Ctrl+F5 / 加 `?v=1` 确认看到新版内容
- [ ] 8. 日历标记：T+24h、T+7d、T+14d 回查监控表
