# Creem 切 live 操作手册（2026-09-10，第 2 版）

> 目的：把这站点从"从来没扣过款"切到"能收真钱"。
> 适用对象：你本人，坐在 Creem 后台前照着点。
> 所有 Creem 侧的说法都标注了来源；**官方文档自相矛盾的地方我明确写了矛盾在哪，没替你猜。**
>
> **第 2 版修掉了第 1 版我写错的 3 处**（都是没核就写的）：
> 1. 🔴 **测试卡号整套是错的** —— 我写的是 Stripe 的卡（`4242…`），Creem 根本不认。已换成官方 4 张（第 8 节）
> 2. 🔴 **"改价后产品 ID 作废"是错的** —— 官方 `PATCH /v1/products/{id}` 支持改价且保留 ID（第 3 节）
> 3. 🟡 **live key 前缀** —— 之前写"官方自相矛盾、不确定"，现已拿到官方明文：test = `creem_test_`，live = `creem_`（第 4 节）
>
> **第 2 版新增**：建产品表单逐字段怎么填（第 3 节）、价格改 $19.99 的 21 处文案清单（附录 F）、
> **你问的两个验证项的完整答案**（附录 G —— 两条都核到了，对账方案成立）。

---

## 0. 先读这段：为什么会踩坑

**test 与 live 是两套完全隔离的环境**（[官方 API reference](https://docs.creem.io/api-reference/introduction) 原文：*"The test and production environments are completely isolated. Data created in test mode does not affect your production environment, and API keys are not interchangeable between environments."*）

隔离到什么程度：**API key 不通用、产品 ID 不通用、webhook secret 不通用、数据不通用。**

所以"切 live"不是改一个开关，是**在 live 环境里把东西重做一遍**。你现有那套 test 的产品 ID（`prod_6YuHXkbpSu7Lvyv7YMtoq9` 等）在 live 下**全部无效**。

**要动的只有 5 个变量**，全在 Cloudflare Pages：

| 变量 | 动作 | 值从哪来 |
|---|---|---|
| `CREEM_MODE` | 改 `live` ← 唯一手输的 | 手输 |
| `CREEM_API_KEY` | 换成 live key（`creem_` 开头，27 字符） | **已在手** → `key0910/CreemKey.txt` |
| `CREEM_PRODUCT_ID` | 换成 live Pro 产品 ID（$19.99） | **已在手** → `prod_2BCJyvFBUnLGuln1yPIVPW` |
| `CREEM_REPORT_PRODUCT_ID` | **新增**（本轮才接进代码） | **已在手** → `prod_5SzuHiJqubsXug5fFno9ft` |
| `CREEM_WEBHOOK_SECRET` | 换成 live signing secret（`whsec_` 开头，28 字符） | **已在手** → `key0910/CreemKey.txt` |

> 🔴 **这 5 个必须一次改齐再部署。** 只改 `CREEM_MODE` 会让线上直接 401（详见第 6 节）。
> 而且变量改动**不部署就不生效**，所以你慢慢改没关系 —— 只要部署前是齐的。

### 📁 实际值在哪里（2026-09-10 补齐，**已实证核验**）

值放在 **`E:\Triumph\key0910\`（在 git 仓库外，勿提交、勿部署）**，对应关系：

| CF 变量 | 取自 | 核验状态 |
|---|---|---|
| `CREEM_MODE` | 手输 `live` | 手输 |
| `CREEM_API_KEY` | `key0910/CreemKey.txt` → `CREEM_API_KEY` 那一行 | ✅ 实证是 **live key**（打 test 域 401、打 prod 域认证通过） |
| `CREEM_WEBHOOK_SECRET` | `key0910/CreemKey.txt` → `CREEM_WEBHOOK_SECRET` 那一行 | ⚠️ 无法用 API 核（Creem **没有** webhook 管理 API），只能靠后台比对 |
| `CREEM_PRODUCT_ID` | `key0910/produnct-link.txt` → **19.9 的 PRO 那行**<br>值 = **`prod_2BCJyvFBUnLGuln1yPIVPW`** | ✅ `GET /v1/products` 200：`price=1999` / `recurring/every-month` / `status=active` |
| `CREEM_REPORT_PRODUCT_ID` | `key0910/produnct-link.txt` → **9.9 一次性报告那行**<br>值 = **`prod_5SzuHiJqubsXug5fFno9ft`** | ✅ 200：`price=999` / `onetime/once` / `status=active` |

> 🔒 **两个产品 ID 可以直接写在文档里** —— 拿到它最多能生成一个指向你账户的结账链接，钱还是进你账上，无实际危害（test 产品 ID 早就这么写在仓库里了）。
> **但 `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` 永远只写「在哪个文件的哪一行」，不写值** —— 仓库是**公开**的，key 泄露等于别人能替你改产品、发退款。
>
> ⚠️ 复制时**别把两个产品 ID 搞反**（Pro ↔ 报告）—— 搞反会让"买报告"变成"买 $19.99 订阅"。

### ✅ 一次性报告价已对齐为 $9.99

Creem 上报告产品实际是 **999 分（$9.99）**，而站内文案原本全写 `$9.90` → **页面价与实扣价不符**。
已于 2026-09-10 把站内 **11 处** + 文档统一改成 **$9.99**。
→ **别再写回 `$9.90`**；若确实想要 $9.90，应在 Creem `PATCH /v1/products` 把该产品改成 `990`，而不是改文案。

---

## 1. 关掉 Test Mode

**位置**：dashboard **左侧栏最底部**（官方原文：*"To activate test mode, toggle Test Mode in the bottom of the left sidebar of your dashboard"*）

关掉之后，你能看到的**产品和 API key 会整批换掉** —— 这不是 bug，是环境切换。

**验证**：关掉后 Products 列表应该变空（或只剩 live 的），因为你从没在 live 建过产品。

---

## 2. 账户与 Payout 验证

关 Test Mode 后如果还不能建产品、或提示验证未完成，就是这步卡着。

这是**人工审核**，不是即时生效 —— 你说"审核已通过"，那应该已经过了。但这步没过的典型症状是：能进后台、能看界面、**建产品时报错或按钮不可用**。

---

## 3. 建两个 live 产品

**入口**：Products → Create product（`https://creem.io/dashboard/products`）

> 📌 **先记一个价格改动**：Pro 从 $15 改成 **$19.99**。
>
> **产品 ID 不受影响。** 官方 `PATCH /v1/products/{id}` 的支持字段里包含 `price`，说明原文是 *"Only supplied fields change; **a price change mints a new default price**"* —— 改价是给同一个产品铸一个新默认价，**不是新建产品、ID 不变**。
> （我上一版这里写"改价后 ID 作废"是**推的、错的**，已更正。你在 live 是全新创建，直接把价格填 1999 就行。）
>
> 但**全站文案有 21 处写着 `$15`**，这些必须跟着改，清单见附录 F。

### 建产品表单逐字段怎么填

Creem 的建产品表单分 4 个折叠区（Details / Delivery / Pricing / Checkout）。对着填：

#### Details 区

| 表单字段 | 填什么 | 对应 API 字段 |
|---|---|---|
| 产品名 | `Learndiag Pro` | `name`（必填） |
| 描述 | 随便写清价值，支持 Markdown | `description`（必填） |
| Add images | **跳过**（最多 8 张，非必填） | `image_urls` |

#### Delivery 区

**整个跳过**（保持 "Nothing to deliver yet"）。

> 为什么不填：我们的 Pro 权益是**服务端 webhook 自己落权的**（`billing.mjs` 里写 KV），不靠 Creem 的文件/许可证密钥投递。填了反而多一个要维护的东西。

#### Pricing 区 —— 这区最关键

| 表单字段 | Pro 订阅填 | 一次性报告填 | 对应 API 字段 |
|---|---|---|---|
| 价格 | **19.99** | **9.99** | `price`（分：`1999` / `999`） |
| 币种 | `USD` | `USD` | `currency`（**只支持 `USD` / `EUR`**） |
| 支付类型 | **Monthly**（`every-month`） | **One time**（`once`） | `billing_type` + `billing_period` |
| 税务分类 | `digital-goods-service` 或 `saas` | 同左 | `tax_category`（只允许 `saas` / `digital-goods-service` / `ebooks`） |

> ✅ **你截图里 Pricing 填的是对的**：`19.99 / USD / Monthly / one-m...` —— `one-m` 是下拉被截断的 `every-month`，就是对的。Pro 保持 Monthly 即可。
>
> ⚠️ **但**：`Billing period` 是 **`billing_type = recurring` 时的必填项**；一次性报告要选 **One time / once**，**不要**留 Monthly。选错的话 $9.99 会变成一个月付订阅——而我们服务端是靠 `metadata.kind === 'report'` 分叉的，配上订阅型产品会得到很别扭的权益状态。
>
> ⚠️ **税务分类是判断题，不是对错题**：`saas` 和 `digital-goods-service` 都是官方允许值，但**两类税率可能不同**，而且 MoR 模式下这影响的是 Creem 替你代缴的税。我们是个月度软件服务，`saas` 字面更贴；但你后台默认给了 `digital-goods-service`——**拿不准就保持默认，别为了"更准"去改一个会影响税率的字段**。这我给不了税务建议。

#### Checkout 区

| 表单字段 | 填什么 | 对应 API 字段 |
|---|---|---|
| 返回 URL（你截图里显示 `https://example.com/thanks`） | ⚠️ **留空，不要填** | `default_success_url` |
| Custom checkout fields | **留空** | `custom_fields`（最多 3 个） |
| 购物车放弃挽回 | **关掉** | `abandoned_cart_recovery_enabled` |

> ⚠️ **返回 URL 为什么必须留空**：这个字段是产品级的**默认**回跳地址。而我们**每次建结账会话时都会显式传 `success_url`**（Pro → `/upgrade.html?checkout=done`，报告 → `/diagnostic?purchase=done`）。
>
> 官方文档**只写明了 per-checkout 的 `successUrl` 覆盖适配器的 `defaultSuccessUrl`**，对"per-checkout vs 产品级 return URL 谁优先"**没有明确结论**。如果产品级优先，用户付完钱就会被送到 `example.com/thanks`——跟上一轮那个 `/report.html` 是同一类事故。
>
> **留空 = 把这个不确定性直接消掉。** 反正我们每次都传 `success_url`，这个字段留着没有任何用处，只有风险。（`example.com/thanks` 是占位提示，不是已填的值。）

**建完各复制一次产品 ID**（`prod_` 开头）。

**验证**：Products 列表里能看到这两条，价格显示 **$19.99** 和 **$9.99**。

---

## 4. 拿 live API key

**直接访问这个地址，不用找菜单**：
```
https://creem.io/dashboard/developers
```

> 官方原文（[API introduction](https://docs.creem.io/api-reference/introduction)）：*"You can find your API keys in the [Developers section](https://creem.io/dashboard/developers) of your dashboard."*
>
> **你说"只在设置里找到 API-key"——你没找错，官方自己两个地方都写了。** 同一个 OpenAPI 规范的 `securitySchemes` 里，说明写的是：
> *"You can find your API key in the Creem dashboard under **Settings > API Keys**."*
> 也就是说 **Developers 和 Settings 两处官方都认**（官方文档一贯的这个小毛病）。你能在设置里找到，就用设置里那把，不必再找 Developers。
>
> ⚠️ **但 Developers 页显示的是"当前模式"的 key。** 官方原文：*"Test and production environments use different API keys. You can find both keys in the Developers section. **Make sure to toggle Test Mode in the bottom of the left sidebar.**"*
> → **先确认左侧栏底部的 Test Mode 是关的，再复制 key。** 开着 Test Mode 复制到的是 `creem_test_` 那把。

### 前缀这个问题，现在有官方答案了

官方 API introduction 的原话：

> *"Keys prefixed with `creem_test_` use the sandbox environment."*

所以：**test key = `creem_test_` 开头，live key = `creem_` 开头**（官方 production 的 curl 示例写的是 `x-api-key: creem_YOUR_API_KEY`）。

我上一轮说"三个社区实现都写 `creem_live_`、我没能拿到权威结论"——**现在拿到了，以官方为准**。社区那批 `creem_live_` 要么是旧格式要么是抄错的。

> 不过**前缀仍然不该当判据**（用眼睛看去区分环境，比 curl 打一发脆弱得多）。往下看验证方法。

### 验证（这步别跳）

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.creem.io/v1/products -H "x-api-key: <你的live key>"
```

- **200** = key 有效、环境是 production ✅
- **401** = 没带 key / key 格式不对
- **403** = key 有效但**权限不够**（或这是把 test key 打到了生产端点）

**反证也要打一次**（确认你没拿错环境）：
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://test-api.creem.io/v1/products -H "x-api-key: <你的live key>"
```
**预期 403**（生产 key 在 test 环境不认）。如果这里返回 200，说明你复制到的是 test key。

**权限按最小给**：`Checkouts 写入`（必需）、`Products 读取`（对账 + 上面那条验证命令要用）、`Customers 写入`（客户门户用）。其余留空。

---

## 5. 建 webhook + 拿 signing secret

**入口**：**Developers > Webhook**（官方原文：*"You can find your webhook secret on the Developers > Webhook page."*）

**Endpoint URL**：
```
https://learndiag.com/api/billing/webhook
```

**订阅事件**：勾上 **全部**，或至少这些（我们代码全都处理了）：

```
checkout.completed
subscription.paid
subscription.active
subscription.update
subscription.canceled
subscription.scheduled_cancel
subscription.past_due
subscription.unpaid
subscription.expired
subscription.trialing
subscription.paused
refund.created
dispute.created
```

复制 **Signing secret**。

> ⚠️ **`CREEM_API_KEY` 和 `CREEM_WEBHOOK_SECRET` 是两样东西。**
> - API key = 你主动打 Creem 用的
> - webhook secret = 验证 Creem 打你用的，**不走 API key，也不受 API key 权限影响**
>
> 给 API key 勾 webhook 权限**不会**让验签变得可用；验签失败也**不要**去动 API key。

> ⚠️ **webhook 只能用后台建，没有 API。** 官方 Webhooks 指南里 webhook 的创建/管理入口全部标注为 Dashboard，未提供 API 方式。

**验证**：保存后，在这个 webhook 详情里点 **Send test event**（官方路径：`Settings → Webhooks → Send test event`），选 `checkout.completed`。然后去 D1 的 `webhook_events` 表看有没有新行。

---

## 6. 填 Cloudflare Pages 变量

**入口**：Cloudflare → Pages → 项目 **`triumph`** → Settings → Variables（**Production** 环境）

> ⚠️ **项目名是 `triumph`，不是 `learndiag`。** 域名是 learndiag.com，但 Pages 项目名还叫 triumph。

### ⚠️ 先说一件最容易误判的事：这些变量的**值读不出来**

我查了你的生产环境实况：14 个变量里 **13 个是 `secret_text`**，只有 `EMAIL_FROM` 是 `plain_text`。

**Cloudflare 对 `secret_text` 只写不读** —— API 返回空值，控制台里也看不到，只能看到"这个变量存在"。

**所以：想换新值，只能覆盖重设，没有"先查一眼再改"这条路。** 别看到变量名在上面就以为已经配好了 —— **名字在 ≠ 值是 live 的。**

### 你当前的实况（2026-09-10 查证）

已有 14 个：`ADMIN_EMAILS` `CREEM_API_KEY` `CREEM_MODE` `CREEM_PRODUCT_ID` `CREEM_TEST_API_KEY` `CREEM_TEST_PRODUCT_ID` `CREEM_TEST_WEBHOOK_SECRET` `CREEM_WEBHOOK_SECRET` `EMAIL_FROM` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `JWT_SECRET` `OPENROUTER_API_KEY` `RESEND_API_KEY`

**缺一个：`CREEM_REPORT_PRODUCT_ID`** ← 本轮新接进代码的，必须**新增**（不是修改）。

**不用管的**（易误伤）：
- `TRIUMPH_KV` / `TRIUMPH_D1` 不在上面的列表里 —— 它们是 **bindings 不是 env_vars**，配在另一处，**两个都在、正常**：
  - `TRIUMPH_KV` → `07ad9fc5b16b4bccb31cc92080a29e88`
  - `TRIUMPH_D1` → `5d04a307-4dc9-4236-9492-817f17f3a351`
  - **别去"补"它们，补了会冲突。**
- 没有 `SITE_URL` → 代码走默认 `https://learndiag.com`，正常。
- 没有 `CREEM_TEST_REPORT_PRODUCT_ID` → 代码会 fallback，不设也行。

> 📌 **preview 环境是完全空的**（0 个变量、无 bindings）。PR 预览分支跑不起来。现在不影响生产，但**别在预览里测支付** —— 那里什么都没绑。

### 要改/要加的 5 个

| 变量 | 动作 | 填什么值 | 状态 |
|---|---|---|---|
| `CREEM_MODE` | 改 `live` ← **最关键的一个** | 字面量 `live` | ✅ 你已改 |
| `CREEM_API_KEY` | 覆盖为 live key | `key0910/CreemKey.txt` 里那把（`creem_` 开头、**27 字符**、**不含 `_test_`**） | 待办 |
| `CREEM_PRODUCT_ID` | 覆盖为 live Pro 产品 ID | **`prod_2BCJyvFBUnLGuln1yPIVPW`** | 待办 |
| `CREEM_REPORT_PRODUCT_ID` | **新增** | **`prod_5SzuHiJqubsXug5fFno9ft`** | 待办 |
| `CREEM_WEBHOOK_SECRET` | 覆盖为 live signing secret | `key0910/CreemKey.txt` 里那把（`whsec_` 开头、**28 字符**） | 待办 |

**两个产品 ID 的确切值（2026-09-11 用 live key 打 Creem API 实测确认，不是从文件里抄的猜）**：

| 用途 | 产品 ID | API 返回 |
|---|---|---|
| Pro 订阅 | `prod_2BCJyvFBUnLGuln1yPIVPW` | `name="LearnDiag Pro"` / `price=1999` / `recurring` / `every-month` / `status=active` |
| 一次性报告 | `prod_5SzuHiJqubsXug5fFno9ft` | `name="report"` / `price=999` / `onetime` / `once` / `status=active` |

两把 ID 都是干净来源（`key0910/produnct-link.txt`），且**同一次调用反证了 key 是 live**：同一把 key 打 `test-api.creem.io` 返回 `401 Invalid API Key`，打 `api.creem.io` 返回 200。<br>
→ 也就是说 **key / 产品 ID / `CREEM_MODE=live` 这三样在外部已经自洽**，剩下纯粹是"把它们填进 Cloudflare"的体力活。

`CREEM_TEST_*` 那几个留着（代码只在 `CREEM_MODE==='test'` 时读）。

> 🔴 **`CREEM_MODE` 改对了，另外 4 个没改，比不改更糟。**
>
> 看代码（`worker-src/billing.mjs:16-20,123,160`）：`CREEM_MODE` 是**唯一的开关**，它同时决定
> - 打哪个域名（`api.creem.io` / `test-api.creem.io`）
> - 用哪把 key（`CREEM_API_KEY` / `CREEM_TEST_API_KEY`）
> - 用哪个产品 ID
> - 验签用哪个 secret
>
> 现在你把开关拨到 live 了，但它指向的 **key 和产品 ID 还是 test 的** —— 而 test 的 key/产品在 live 环境里**不存在**。结果不是"回到旧行为"，是**建结账会话直接 401/404**，用户点升级按钮报错。
>
> **所以这 5 个必须一次性改齐，再一起部署。** 分批改 = 中间必坏一次。
>
> 另一个小坑：代码是 `env.CREEM_MODE === 'test'`，所以**只要不是精确的 `test` 就走 live**（大小写敏感）。写 `live` 最稳，写成 `Live` 也能工作但没好处。

### 每个值的**来源**（这张表直接回答"去 CF 拿还是去 Creem 拿"）

| 变量 | 值从哪来 | 在哪填 |
|---|---|---|
| `CREEM_MODE` | 手输，就写 `live` | Cloudflare |
| `CREEM_API_KEY` | **已经在手** → `key0910/CreemKey.txt` | Cloudflare |
| `CREEM_PRODUCT_ID` | **已经在手** → `key0910/produnct-link.txt`（19.9 的 PRO 那行） | Cloudflare |
| `CREEM_REPORT_PRODUCT_ID` | **已经在手** → `key0910/produnct-link.txt`（9.9 一次性报告那行） | Cloudflare（**新增变量**） |
| `CREEM_WEBHOOK_SECRET` | **已经在手** → `key0910/CreemKey.txt` | Cloudflare |

> 🟢 **四把值你都已经拿到了，别再去 Creem 后台翻一遍。** 这一轮不需要打开 Creem 任何页面，纯 Cloudflare 侧的填表动作。
>
> （最初这四把值确实来自 Creem：API key 在 **Settings → API Keys**，产品 ID 在 **Products**，signing secret 在 **Webhooks** —— 留着这段只为说明"值为什么长这样"，不是让你现在去跑一遍。）

**规律**：**值全部来自 Creem 的产物，Cloudflare 只是放变量名的柜子。** 四把已经在手，直接填，不用回 Creem 翻。

> 关于 `CREEM_REPORT_PRODUCT_ID`（**本轮唯一"新增"而非"修改"的变量**）：
>
> 🔴 **漏配它的症状最像"支付坏了"，但根本不是支付问题。** 代码 `worker-src/billing.mjs:61`：
>
> ```js
> if (!productId) return apiError('internal_error', { hint: 'CREEM_REPORT_PRODUCT_ID not configured.' });
> ```
>
> 只要这个变量不存在，用户点"解锁完整报告"**当场 500** —— 报错跟 Creem、跟卡、跟钱全不沾边。也就是说 $9.99 那条路会在最后一跳断掉，而你会以为是支付通道的问题。**它是本轮 5 个变量里唯一"不补就一定坏"的那个。**
>
> ⚠️ **它跟 `CREEM_PRODUCT_ID` 是两回事**，别把 Pro 的 ID 粘到这个里 —— 那会让"买报告"变成"买 Pro"，而 webhook 那边的分叉是按 `metadata.kind` 走的，两边对不上会得到一个很别扭的权益状态。

> ⚠️ 变量改动**对已有构建不生效**。必须走第 7 步重新部署，否则 Functions 读到的还是旧值。**这是最容易漏、且症状最像"支付坏了"的一步。**
>
> 具体到你的情况：**最后一次部署是 2026-09-07 14:35**（2026-09-11 复查仍是这个时间）。所以你改的 `CREEM_MODE` **线上完全没生效**，只是暂存在配置里 —— 这反而给了你一个安全窗口：**5 个变量一次改齐，再一起部署**，中间不会有一段"线上半配"的坏状态。

### 随时自查

```bash
node tools/deploy-state.mjs
```
一次列出：变量名清单 + 缺了哪些必需的 + bindings + 最近 5 次部署 + 支付流水 + 生产路由存活。**改完变量和部署完之后各跑一次。**

---

## 7. 重新部署

> 📌 **上一次成功部署是 2026-09-07 14:35。** 那之后的所有改动（含本轮全部）**都还没上线**。这也是为什么线上 `/api/diagnostic/report` 至今是 404。

部署前**先确认工作区状态** —— 本轮所有改动目前都没部署，原因是 `site/_worker.js` 这个 esbuild 产物和源码不同步：

```bash
cd praxis-5001
node test/diff-worker.mjs      # 现在是 5 DIFFS
git status --porcelain | wc -l # 现在是 66
```

那 5 处 diff 来自**另一个会话**（`openapi.yaml` / MCP 里的 Triumph→Learndiag 改名，源码改了产物没跟上）。**重建 `site/_worker.js` 会把别的会话尚未发布的改动一起带上线。** 所以部署前先跟那个会话对齐，或者接受"一起上线"。

> ✅ **你已拍板：`site/_worker.js` 最后处理。** 顺序是 → 建产品 → 填变量 → 处理 `_worker.js` → 部署。

部署后**立刻验证后端活着**：
```bash
node tools/deploy-state.mjs
```
看最后一段「生产路由存活」：

| 路由 | 部署前 | 部署后应为 |
|---|---|---|
| `POST /api/billing/webhook` | 401 | **401**（fail-closed 正确） |
| `POST /api/diagnostic/report` | **404** | **400**（路由存在了，只是 body 不合法） |
| `GET /api/me` | 401 | 401 |

**如果 `/api/diagnostic/report` 部署完还是 404，说明 Functions 没更新，别往下走。**

---

## 8. 全链路验证

### ⚠️ 先分清：你现在到底在验哪个环境

| | 用什么卡 | 会不会真扣钱 |
|---|---|---|
| **Test Mode 开着**（`CREEM_MODE=test`） | 下面的测试卡 | 不会，模拟的 |
| **Test Mode 关着**（`CREEM_MODE=live`） | **必须真卡** | **会真扣**，测试卡会被直接拒 |

**测试卡只在 test 环境有效。** 切到 live 之后拿测试卡去付，结果是"卡被拒"——这**不是**支付坏了，是设计如此。别把这两个搞混，否则切 live 后第一笔验证会得出完全错误的结论。

### 测试卡（官方明确，任意有效期 / 任意 CVV / 任意账单信息）

| 卡号 | 行为 |
|---|---|
| `4111 1111 1111 1111` | 支付成功 |
| `4507 9900 0000 0028` | 卡被拒（declined） |
| `4507 9900 0000 0010` | 余额不足 |
| `4507 9900 0000 0044` | CVC 错误 |

> 🔧 **修正我上一版的错误**：这里原来写的是 `4242 4242 4242 4242` / `4000 0000 0000 0002` / `…9995` / `…0127` / `…0069` —— **那套是 Stripe 的测试卡，Creem 完全不认**（Creem 只有上面 4 张，没有"卡已过期"那张）。我凭印象写的，已按官方 [Test Mode 文档](https://docs.creem.io/getting-started/test-mode) 全部换成真实卡号。
>
> 后 3 张是**用来提前验失败路径的** —— 你现在没验过任何失败路径，而失败路径恰恰是最容易掉单的地方。

### 关于"临时把价格调到 $1 验证"

**在 live 环境不推荐。** 改价虽然保留产品 ID（见第 3 节），但这是**在你的生产店铺上改一个真实产品的价格**——忘了改回来就是一个 $1 的 Pro。更稳的做法：

- 失败路径（declined / 余额不足 / CVC 错）**在 test 模式全验一遍**，不用花一分钱
- live 只验**一笔成功单**，用 $19.99 真实金额跑，跑完立刻退款（顺便把 `refund.created` 这条路径也验了）

#### live 那笔成功单要额外确认的

- [ ] 结账页金额显示 **$19.99**（不是 $15）
- [ ] 回跳落到 `https://learndiag.com/upgrade.html?checkout=done`，**且 query 没丢**（会 308 到 `/upgrade`，正常）
- [ ] **地址栏里 Creem 自动追加了 `checkout_id` / `order_id` / `customer_id` / `product_id` / `signature`**（官方行为，见附录 G —— 这是对账方案的接口）
- [ ] webhook 递送记录 `200`、D1 `webhook_events` 有新行、KV 里 `plan` 变 `pro`
- [ ] 页面上 **Pro 文案是 $19.99**（如果还显示 $15，说明 21 处文案没改全）
- [ ] 退款后权益按设计处理

### 逐项确认清单

| # | 检查 | 怎么看 |
|---|---|---|
| 1 | 结账页正常打开 | 点升级按钮 → 跳 Creem 结账页 |
| 2 | 支付成功 | test 模式用 `4111 1111 1111 1111`；live 模式用真卡 |
| 3 | **回跳落到正确页面** | 应回到 `https://learndiag.com/diagnostic?purchase=done`（**不是** `/report.html`，见附录 D） |
| 4 | webhook 到达 | Creem 后台该 webhook 的递送记录里有 `200` |
| 5 | D1 落库 | `webhook_events` 有新行；`orders` 有新订单 |
| 6 | 权益落权 | KV `users:<邮箱>` 里 `plan` 变成 `pro` |
| 7 | 前端认账 | `/api/me` 返回 pro |
| 8 | 一次性报告 | 免登录买 $9.99 → 回跳后报告能出、能下载 |
| 9 | **取消不立刻降级** | 取消订阅 → 按 Terms §4 应**当期结束时**才降级，不是立刻 |
| 10 | 退款路径 | 后台发起退款 → `refund.created` 到达 → 权益按设计处理 |

> 第 9 项是**契约项**：我们的 Terms §4 承诺"取消在当期结束生效"，代码里 `subscription.canceled` 是**不**立刻降级的。实测时要专门验这条。

---

## 附录 A · 环境变量完整清单

代码实际引用到的全部变量（`grep env\.[A-Z_]* worker-src/*.mjs`）：

**Creem 相关**
- `CREEM_MODE` ← 改 `live`
- `CREEM_API_KEY` ← 改 live key
- `CREEM_PRODUCT_ID` ← 改 live Pro 产品 ID
- `CREEM_REPORT_PRODUCT_ID` ← **新增**
- `CREEM_WEBHOOK_SECRET` ← 改 live signing secret
- `CREEM_TEST_API_KEY` / `CREEM_TEST_PRODUCT_ID` / `CREEM_TEST_REPORT_PRODUCT_ID` / `CREEM_TEST_WEBHOOK_SECRET` ← 留着备用，代码只在 `CREEM_MODE==='test'` 时读

**基础设施（不要动）**
- `TRIUMPH_KV`、`TRIUMPH_D1`、`ASSETS`、`CF_PAGES_BRANCH`、`SITE_URL`
- `JWT_SECRET`
- `OPENROUTER_API_KEY`（缺了报告不白屏，会走确定性兜底）
- `RESEND_API_KEY` / `MAILGUN_API_KEY` / `MAILGUN_DOMAIN` / `EMAIL_FROM`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `ADMIN_EMAILS`

---

## 附录 B · 三个可复用的检查命令

```bash
# 1. webhook 端点是否可达、是否被机器人防护拦截
#    预期：401 + application/json，且响应头无 cf-mitigated
curl -s -D - -o /dev/null -X POST https://learndiag.com/api/billing/webhook \
  -H "Content-Type: application/json" -H "User-Agent: node-fetch/1.0" -d '{}'

# 2. 报告路由是否已上线（部署前 404 / 部署后 400）
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://learndiag.com/api/diagnostic/report

# 3. Creem live key 是否有效
curl -s https://api.creem.io/v1/products -H "x-api-key: <live key>"
```

**第 1 条已经实测过了（2026-09-10）**：返回 `401` + `application/json`，响应头里**没有** `cf-mitigated`、没有挑战页 —— 说明无签名的服务器请求能穿透到 worker，`fail closed` 逻辑生效。

---

## 附录 C · Cloudflare 机器人防护：影响到底是什么、要做什么

### 官方原话

官方 Webhooks 指南里有一段专门针对 Cloudflare 的警告：

> **Bot Fight Mode 无法通过自定义规则跳过**（*"Bot Fight Mode cannot be skipped via custom rules"*）—— 必须**禁用**它，或改用 Super Bot Fight Mode / Bot Management 并配置跳过规则。

同一区块还有两条：
- **Creem 在 test 和 live 都不提供固定出站 IP** → **不要用 IP allowlist 当认证**，认证只能靠 `creem-signature` 验签
- 端点必须保持 HTTPS 可访问

### 影响链条（具体到我们的代码，不是泛泛而谈）

我查过了：全代码里 `plan: 'pro'` **只出现在一个地方** —— `worker-src/billing.mjs:308`，也就是 webhook 处理函数内部。**没有任何主动对账 / 补权逻辑。**

所以影响链条是：

```
webhook 被 Cloudflare 挑战
   → Creem 收到非 2xx（或超时）
   → Creem 按退避重投，最多 5 次
   → 仍然失败 → 放弃
   → 用户付了钱，KV 里 plan 永远是 free
   → 前端一切正常地显示"未解锁"，用户以为白付了
   → ⚠️ 没有任何自动补救，只能人工修 KV
```

**这就是它真正的危害**：不是"偶尔报错"，而是**静默的、永久的、只能人工补救的**掉单。症状是 Creem 后台递送记录连续失败 + 用户说"我付了钱怎么还是免费"。

### 要怎么做（按性价比排序）

**① 现在什么都不用动。**
2026-09-10 实测：无签名 + 服务器风格 UA POST `/api/billing/webhook` → `401 application/json`，响应头**没有** `cf-mitigated`、没有挑战页。服务器请求能穿透到 worker，fail-closed 生效。**当前没被拦。**

关掉 Bot Fight Mode 是有代价的（会放进更多垃圾流量），**没必要为一个还没发生的问题先付代价**。

**② 换 live 后再测一次**（成本为零）。命令见附录 B 第 1 条。

**③ 真被拦了再动手**：

**路径**（官方明文，注意**不在 Bots 菜单下**）：
> Cloudflare dashboard → **Security → Settings** → 按 **Bot traffic** 过滤 → 找到 **Bot fight mode** → 关掉

**直链**：`https://dash.cloudflare.com/?to=/:account/:zone/security/settings`

**先别急着关，先查它到底有没有拦过东西**（这比猜有用）：
> **Security → Analytics → Events** 标签页 → 被 Bot Fight Mode 拦的请求会在 **Service** 字段里标成 `Bot Fight Mode`。
> **如果这个筛选结果一直是空的，就说明它从没对我们的流量动过手** —— 那你更没理由关它。

**⚠️ 关于"能不能只给 webhook 这条路径开例外" —— 答案是不能，而且原因比我上次说的更具体**（官方原文）：

> *"You cannot bypass or skip Bot Fight Mode using WAF custom rules or Page Rules. This is because Bot Fight Mode does not run on the Ruleset Engine — it operates in a separate evaluation pipeline where Skip, Bypass, and Allow actions have no effect."*

也就是说 **Skip / Bypass / Allow 这三种动作对它统统无效**。唯一的例外机制是 IP Access 规则（*"it will not trigger if an IP Access rule matches the request first"*）—— 但**这条路对我们无用**：Creem 在 test 和 live 都不提供固定出站 IP，没法写白名单。

想要能配 skip 规则，只能升级 **Super Bot Fight Mode**（付费，且它跑在 Ruleset Engine 上）。

**④ 但真正该补的不是这个 —— 是「回跳对账」。**

理由：Bot Fight Mode 只是掉单的**一个**可能原因。网络抖动、我们自己的 5xx、D1 报错……都会掉单。**盯着某一个原因防，是在防不对的地方。**

**→ 这个方案现在已经核实过了，可行性、接口路径、字段名全都在附录 G。** 结论是**可以做**，而且比只靠 webhook 强。但我**没写代码**（属 P1，要单独一轮做）。

**有了它，bot mode 拦不拦都不影响用户拿到权益。** 这才是正解。

> ✅ 上一版这里写着"我必须先核实两件事，没核所以不给代码"。**这两件事现在已经核完了** —— 见附录 G。当时的谨慎是对的，结论是两条都有解。

### 兜底（现在就有、不用写代码）

Creem 后台 **Developers** 区块可以**手动重发事件**。真出现掉单，手工补一条即可 —— 所以掉单是"可恢复但需人工"，不是"钱进了黑洞"。**但你要能发现它**，所以第 8 节的检查清单第 4 项（Creem 递送记录看到 200）必须逐笔核对，尤其上线第一个月。

---

## 附录 D · 本轮顺手修掉的一个 P0（会直接吞掉 $9.99）

核对变量名时发现的不一致，**不是猜的，是验过的**：

| 项 | 事实 |
|---|---|
| 代码原本的回跳地址 | `https://learndiag.com/report.html?purchase=done` |
| 该地址线上状态 | **404**（`curl` 实测；`site/report.html` 这个文件根本不存在） |
| `site/js/report.js` 设计上在哪运行 | **诊断页** —— 它查的是 `#root main` / `.paywall` / `.intro`，全是 React 诊断页的元素，而且专门处理 `purchase=done`（`report.js:732/752`） |
| 修复后 | `https://learndiag.com/diagnostic?purchase=done`（实测 **200**） |

**没修之前会发生什么**：用户付完 $9.99 → Creem 送到 `/report.html` → **404** → 报告拿不到。
症状跟你们上次那个「钱付了显示 FREE」是同一类 —— 而且更糟，因为这次连页面都没有。

修复位置：`worker-src/billing.mjs:75`，代码里留了注释点名，防止以后改回去。

**这是我这轮写的代码里的 bug，不是既有问题。** 记在这里是因为它正好证明了一件事：**支付链路上的每个 URL 都必须 curl 验一遍，不能凭设计意图假设它存在。**

### 顺带核对了 Pro 那条回跳（没动）

`hCheckout` 用的是 `/upgrade.html?checkout=done`，实测 **308 → `/upgrade?checkout=done` → 200**，**query 保留了**，功能正常。

**我没动它** —— 一是它能工作，二是 `MEMORY.md` 里明确记着"结账回跳是 `/upgrade.html?checkout=done`，该页轮询 `/api/me` 等落权，别去掉，否则会重现「钱付了显示 FREE」"。

只提一句：这条比另一条多一跳 308。想省掉这一跳可以改成 `/upgrade?checkout=done`，但**改之前先确认 upgrade 页的脚本没有依赖 `location.pathname === '/upgrade.html'` 做判断**，否则又是一次"钱付了显示 FREE"。**建议这次不动。**

---

## 附录 E · 一条捷径（已决定不采用）

> ❌ **2026-09-10 决定：手动建产品。** 本附录保留备查，不用执行。

Creem 官方在文档里主推 agent 自主建店：*"Point any AI coding assistant at `creem.io/SKILL.md`"*，配套有 CLI 和 REST API。

- **CLI 路由不通**：官方只给了 Homebrew（`brew tap armitage-labs/creem`），Windows 上装不了。
- **REST API 可用**：`POST https://api.creem.io/v1/products` 能建产品。

当时的提议：你给 live key，我用 API 把 Pro(1500) 和 Report(999) 建出来。

**不采用的原因**：手动建两个产品也就两分钟，而走 API 需要先核实 `POST /v1/products` 的确切字段名（`billing_type` 还是 `type`、周期怎么写、一次性怎么标）—— 在**生产店铺**上猜着写数据的风险，不值得为省两分钟承担。**手动更稳。**

（如果哪天要批量建产品，再回来走这条路；届时先 `GET /v1/products` 探环境，再核字段。）

---

## 附录 F · Pro 改 $19.99 的改动清单

**代码侧不用改**——价格不存在代码里，它只存在于 **Creem 产品本身**（`price: 1999`）。我们服务端只传 `product_id`，金额是 Creem 那边决定的。webhook payload 里的 `amount` 也是 Creem 给的。

**但文案侧有 21 处硬编码 `$15`**（精确统计，已排除州页那些 `$156` 的 Praxis 报名费）：

| 文件 | 处数 | 位置 |
|---|---|---|
| `site/index.html` | 4 | 主页定价区、对比表等 |
| `site/js/conversion-hook.js` | 4 | `var PRO = '$15/mo'` 及 3 处引用 |
| `site/terms.html` | 3 | meta og / twitter description + §正文 |
| `site/score-calculator.html` | 2 | 正文 + 退款说明段 |
| `site/upgrade.html` | 2 | `<span class="price">$15<small>/month` + 第 110 行 |
| `site/about.html` | 1 | 商业模式段 |
| `site/diagnostic.html` | 1 | 付费墙内的价格标签 |
| `site/drill.html` | 1 | 付费墙 |
| `site/mock-exam.html` | 1 | 付费墙 |
| `site/practice.html` | 1 | 付费墙 |
| `site/js/report.js` | 1 | 报告里的 Pro 对比文案 |

**外加 3 处 Markdown 镜像**（`site/md/about.md` / `md/index.md` / `md/terms.md`）——这几个是 `.md` 内容协商（`Accept: text/markdown`）用的，**不同步改的话，AI 爬虫读到的还是 $15**，而这是我们对外的一个卖点，别漏。

> ⚠️ **`site/practice.html` 有个额外发现**：它的付费墙里**还留着 `new Date("2026-10-01")` 这个旧的 `PAYWALL_DEADLINE`**（第 117 行）——诊断页那处上一轮已经删了，练习页这处**漏了**。你定的规矩是"新阶梯立即生效、去掉免费期"，所以这里也是**没对齐的存量**。改价格时顺手把它一起处理掉。

### ✅ 已执行（2026-09-10 23:30）

**23 处替换一次跑完，全部命中**（用一个要求「每处恰好命中 N 次，否则中止不写盘」的一次性脚本，跑完即删）：

- 11 个 HTML/JS 文件 + 2 个 md 孤儿文件（`md/index.md` / `md/terms.md`），共 13 个文件
- 其中 2 处在**压缩成单行的 React**里（`diagnostic.html` / `practice.html` 的价格标签）—— 这种地方手工改极容易改坏，所以走脚本
- 跑完用 `node --check` 验过两个压缩页的 babel 段：**语法 OK**
- **验证**：`grep -rnoE '\$15([^0-9]|$)' site/ --include=*.{html,js,md} | wc -l` → **0**（原 24）

### 顺带修掉一个**上一轮漏改的真错**：`$130`

上一轮把「重考 $130」纠正成 `$180` 时，**只改了 HTML，漏了 3 个 Markdown 镜像**：

| 文件 | 原文 | 改成 |
|---|---|---|
| `site/md/index.md` | `A retake costs about $130 and 28 days.` | `…$180 and 28 days.` |
| `site/md/about.md` | `$130` | `$180` |
| `site/md/praxis-5001-four-gate-strategy.md`（2 处） | `$130` | `$180` |

**为什么这个漏改要紧**：`.md` 是给 `Accept: text/markdown` 的 AI 爬虫读的那一份。**HTML 说 $180、md 说 $130**，等于对外同时给了两个重考价 —— 而"重考贵"正是我们说服用户的锚点，数字不一致会直接伤到这个论证。

`about.md` 和 `four-gate-strategy.md` 属于 `build:md` 的维护范围，重建即自动修正；`md/index.md` 是孤儿文件（见下），只能手改。

**验证**：`grep -rnE '\$130([^0-9]|$)' site/ --include=*.md` → **0**

### ⚠️ 顺带发现：`site/md/` 有 9 个孤儿文件，永远不会被重建

`npm run build:md`（`tools/html-to-md.mjs`）只维护 `PAGES` 数组里的 **21 个**页面。但 `site/md/` 里实际有 **30 个** `.md`，多出来的 9 个**不在任何构建管线里**：

```
index · terms · resources · praxis-5001-subtests-explained
praxis-5001-alabama-requirements · praxis-5001-maryland-requirements
praxis-5001-pennsylvania-requirements · praxis-5001-passing-score-by-state
praxis-8006-teaching-reading
```

**后果**：这 9 个页面改了 HTML，md 不会跟着变，**永久漂移**。而它们是通过 `Accept: text/markdown` 对外提供的 —— AI 爬虫、聚合器读到的会是**旧版本**。上面 `$130` 那处漏改就是这个机制的直接产物。

其中 3 个是**州页**（AL / MD / PA）。我抽查过它们的分数线，跟 HTML 一致，**没有发现违规数字**，所以这次不是紧急问题；但**结构上它们是"改了不会同步"的定时炸弹**。

**建议**：把这 9 个补进 `PAGES` 数组（如果它们的 HTML 结构能被转换器正常解析），让 md 真正由 HTML 派生。**这次没动** —— 补进去要先确认转换器对这几页的输出不会比现有手写版更差，属于独立一轮的事。

### 又顺带发现：8 个 md 镜像此前**已经**和 HTML 漂移了

重建 `build:md` 时，除我改的价格外，还带出了 8 个文件的真实内容差异（`contact` / `developers` / `free-practice-test` / `new-jersey` / `passing-scores` / `retake-guide` / `5003-math` / `5004-social-studies`，合计约 600 行）。

**这不是我改出来的，是重建把已有的漂移对齐了。** 这些 md 早就落后于 HTML。保留这次重建（md 与 HTML 一致优于漂移），但要知道：

> ⚠️ **`site/md/` 也是构建耦合点之一**（跟 `site/_worker.js` 同类）：重建会把**其他会话尚未提交的 HTML 改动**一起写进 md。区别是 md 是**内容不是代码**，风险低得多，且下次重建会自我校正。

### 另一个**真 bug（已修）**：首页丢了一个 `</script>`

改价格时跑内联脚本检查，发现 `site/index.html` **开 10 闭 9 不配平**（HEAD 是 8/8 配平）：

```
git diff 里是孤零零一行  -</script>
后面跟着的是        + <!-- 埋点层… -->
                   + <script src="/js/tracking.js?v=1"></script>
                   + <script>window.LDTrack&&…</script>
```

**另一会话注入首页埋点时，删掉了一个 `</script>` 却没补回来。** 这是**它未提交的改动**（HEAD 版本配平正常，我对比过）。

**为什么必须修**：浏览器在 `<script>` 内部把内容当**原始文本**，直到第一个 `</script>` 才结束。所以丢一个闭合标签**不会报 HTML 错** —— 而是让后面的 HTML 注释和 `<script src=...>` 被**当成 JS 代码吃进去**，整段脚本抛 `SyntaxError` 后静默失效。后果是**首页最后一个内联脚本（诊断体验区）完全不工作，tracking.js 也不会加载**，而页面看着毫无异常。首页是漏斗第一站，这个必须修。

已补回闭合标签（10/10 配平），并加了**守卫测试**（`test/agentic.test.mjs`）：扫全部 49 个页面，`<script>` 与 `</script>` 数量必须相等。临时把缺陷植回去验过，**守卫报红**。

**测试：150/150 全绿**（原 149，新增 1 条守卫）。

---

## 附录 G · 你问的那两个验证项 —— 都核到了

上一轮我把这两条列为"必须先核实才能动"。现在已经查实，**两条都有明确答案，而且结论比对账方案本身更好**。

### ① Creem 有没有"按 checkout_id 查付款状态"的 API？—— **有**

```
GET /v1/checkouts?checkout_id=<chk_...>
x-api-key: <你的 key>
```
（operationId `retrieveCheckout`，官方 [Retrieve a checkout session](https://docs.creem.io/api-reference/endpoint/get-checkout)）

`checkout_id` 是 **query 参数**（不是路径参数），必填。返回 `CheckoutEntity`，关键字段：

| 字段 | 取值 | 用途 |
|---|---|---|
| `status` | `pending` / `processing` / `completed` / `expired` | 结账本身的状态 |
| **`order.status`** | **`pending` / `paid`** | ← **这才是"钱到底付没付"** |
| `order.amount_paid` | 整数（分） | 实付金额，可用来核对是不是 $19.99 |
| `order.amount_due` | 整数（分） | 未付金额 |
| `order.transaction` | `tx_...` | 交易 ID |
| `order.type` | `recurring` / `onetime` | 订单类型 |
| **`metadata`** | 我们建结账时塞的 `{kind, visitor_id, ...}` | ← **用来确认这笔属于谁** |
| `mode` | `test` / `prod` / `sandbox` | 环境（**可用来防"跨环境串单"**） |

**注意 `CheckoutEntity` 里 `status` 有一层、`order.status` 又有一层**，别只看外层：外层 `completed` 指的是结账流程走完，**要判断"钱到位"应该看 `order.status === 'paid'`**。

### ② `success_url` 能不能带模板变量？—— **不能，但根本不需要**

官方**没有**模板变量（不存在 `{checkout_id}` 这种占位符）。

**但 Creem 会自己往上追加**（官方 [One-time payments](https://docs.creem.io/features/one-time-payment) 明文）：

```
https://yoursite.com/success?checkout_id=ch_xxx&order_id=ord_xxx&customer_id=cust_xxx&product_id=prod_xxx&signature=xxx
```

| 追加参数 | 说明 |
|---|---|
| `checkout_id` | ✅ 正好是 ① 那个接口要的入参 |
| `order_id` | 订单 ID |
| `customer_id` | 客户 ID |
| `subscription_id` | 订阅 ID（订阅单才有，一次性单没有） |
| `product_id` | 产品 ID |
| `request_id` | 建结账时我们自己传的引用 ID（我们目前**没传**） |
| `signature` | **对以上所有参数签名，可用我们的 API key 验证** |

**→ 所以我们的回跳 URL `/diagnostic?purchase=done` 不需要改**，用户被送回来时会**自动变成** `/diagnostic?purchase=done&checkout_id=ch_xxx&order_id=ord_xxx&...&signature=xxx`。前端本来就在监听 `purchase=done`，白捡一个 `checkout_id`。

**签名算法**（官方文档给了，必须知道否则验不对）：

> SHA-256 的 hex 摘要。对**重定向 URL 里出现的顺序**（不是字母序），把有值的参数拼成 `key=value`，用 `|` 连接，**末尾追加 `salt={apiKey}`**。**`null` 或空值的参数必须整体排除**（写成 `order_id=null` 会导致验签失败）。

```
sha256("checkout_id=ch_xxx|order_id=ord_xxx|customer_id=cust_xxx|product_id=prod_xxx|salt=<API_KEY>") -> hex
```

### 于是对账方案成立了（但**我没实现**）

```
用户在 Creem 付完 → 回跳到 /diagnostic?purchase=done&checkout_id=ch_xxx&...
   ↓ 前端把 checkout_id 发给服务端（连同自己的 visitor_id）
   ↓ 服务端 GET /v1/checkouts?checkout_id=ch_xxx   （用我们自己的 key）
   ↓ 校验三件事：
        metadata.visitor_id === 请求方 visitor_id     ← 这笔确实是他发起的
        order.status === 'paid'                        ← 钱到位了
        product_id === CREEM_REPORT_PRODUCT_ID         ← 买的是报告不是 Pro
   ↓ 全过 → 幂等补发凭证（复用已有 grantReportCredit，它本来就按 order_id 去重）
```

**为什么这条路比只靠 webhook 强**：webhook 掉单（被 bot mode 挑战、我们 5xx、D1 抖动）时，用户**回跳这条路是独立的**，能自己把权益捞回来。**不依赖 bot mode 到底拦不拦。**

**为什么不需要验 `signature`**：`metadata.visitor_id` 是更强的绑定 —— 攻击者伪造一个 `checkout_id` 过来，他没法让 Creem 那边这笔 checkout 的 metadata 里写上他的 visitor_id。真要防重放，再加 `signature` 校验即可（算法上面给了）。

**⚠️ 但这是 P1，我没写代码。** 要动就要动 `hReportCheckout`（塞 `request_id`）+ 新增一个对账端点 + 前端把 `checkout_id` 传上去，且**必须补测试**覆盖"伪造 checkout_id / 别人的 checkout_id / 未付款的 checkout_id"三种攻击面。**要上就单独开一轮，不要夹在切 live 里做。**

### 另一件顺手查到的事

`PATCH /v1/products/{id}` 支持改 `price` / `billing_type` / `billing_period`，**产品 ID 保留**（"a price change mints a new default price"）。如果哪天要正式调价，不用重建产品——但**存量订阅不受影响，改的只是新单的价格**，跟用户沟通时别说成"老用户也涨价"。

---

## 最短路径（已按你的决定排序）

1. **后台**：确认不在 Test Mode（左侧栏底部）→ **这是 `CREEM_MODE` 那个开关的"后台对应物"，但决定线上行为的是变量，不是它**
2. **后台 · Products**：手动建 2 个 live 产品
   - Pro → **19.99**（= `1999` 分）、Recurring、`every-month`、**返回 URL 留空** → 记下 `prod_`
   - Diagnostic Report → **9.99**（= `999` 分）、**One time**、**返回 URL 留空** → 记下 `prod_`
3. **后台设置 · API Keys**：拿 live API key
   - 判据不是前缀，而是 `curl https://api.creem.io/v1/products` → **200**；再拿同一把打 `test-api.creem.io` 应 **403**
4. **后台 · Developers > Webhook**：建 `https://learndiag.com/api/billing/webhook`，勾事件，拿 signing secret
   （webhook 只能后台建，没有 API）
5. ✅ **全站 21 处 `$15` → `$19.99` 已完成**（附录 F）
   ｜ 顺带修掉：md 镜像里漏改的 4 处 `$130`、首页丢失的 `</script>`、`practice.html` 残留的免费期
   ｜ **测试 150/150**
6. **Cloudflare Pages（项目 `triumph`）**：改 4 个 + **新增 1 个**
   - `CREEM_MODE=live` ✅ 你已改
   - `CREEM_API_KEY` ← live key
   - `CREEM_PRODUCT_ID` ← 新 Pro 产品 ID
   - `CREEM_REPORT_PRODUCT_ID` ← **新增**（报告产品 ID，去 Creem 拿，不是 CF 里取）
   - `CREEM_WEBHOOK_SECRET` ← live signing secret
   - ⚠️ 值**读不出来**，只能覆盖重设；名字在 ≠ 值对
   - ⚠️ **改完不部署 = 没改。** 最后一次部署是 2026-09-07 14:35，变量改动对已有构建不生效
7. **处理 `site/_worker.js`**（你决定放最后）：先跟另一会话对齐那 5 处 diff
8. **重新部署**
9. `node tools/deploy-state.mjs` → 确认 `/api/diagnostic/report` 从 **404 变 400**
10. 跑 $19.99 那一笔（test 模式先全验失败路径）→ 逐项过第 8 节
    - **重点看第 3 条**（回跳落到 `/diagnostic?purchase=done`，不是 404）
    - **重点看第 4 条**（Creem 递送记录 200）—— 掉单是静默的，只能靠这里发现
    - **重点看第 9 条**（取消不立刻降级，Terms §4 契约）

**上线第一个月，每笔真单都手核一遍第 4 条。** 因为没有对账机制，掉单只能靠人发现。
