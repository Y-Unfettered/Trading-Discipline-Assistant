# 交易纪律助手 v0.3.3

本地运行的 A 股交易账本、计划执行、纪律检查与 Codex 复盘工具。它不负责选股或自动下单，重点是保护本金、减少临时决策，并让账户数字可以追溯。

## Vue 3 应用与 UI 基线

- 所有业务页面已经统一到 Vue 3、Vite、Tailwind CSS v4 和 shadcn-vue。
- shadcn-vue CLI 精确锁定为 `2.7.4`；`components.json`、`src/components/ui/**` 和 `src/style.css` 属于冻结区。
- 第一阶段只允许组合官方组件、官方 Props、官方 Variant 和 neutral/new-york 官方主题，不允许业务视觉定制。
- `npm run check:ui` 会校验冻结区哈希，并拦截原生交互控件、自定义 CSS、视觉覆盖类、非官方 Variant、普通日期/数字 Input 和业务层直接使用 reka-ui。
- `npm run build` 会依次执行 UI 基线检查、Vue 类型检查和 Vite 生产构建；日常启动方式仍为 `npm start`。

## 第一次使用

打开首页后，使用向导会先识别本机已有的持仓、成交与旧计划，不要求重复录入：

1. 检查已识别的数据；当前持仓会自动进入“交易标的中心”；空账户也可以明确确认后继续
2. 为会影响计划的信息追加至少一张事实卡；事实必须保留来源
3. 如存在 v0.2 旧计划，可生成一份新的 v0.3.3 待确认草稿；旧计划原样保留
4. 按“日期与总原则 → 动作与风险 → 三种情景 → 边界与确认”完成计划
5. 保存版本并明确确认后，计划才会进入盘中行动卡

完成首次设置后，首页的“今天的闭环进度”会按盘前证据、计划确认、盘中记录和盘后复盘提示下一步。

## v0.3.1 易用性更新

- 新增首次使用向导和安全的旧计划升级入口
- 当前持仓与候选标的合并为统一交易标的中心，空卡片不再造成误解
- 计划改为四步向导，并在进入下一步前检查缺失项
- 首页增加每日闭环进度和明确的下一步入口
- 数据升级只生成新版本，不删除、覆盖或上传本地隐私数据

## v0.3 重点

- 新增独立于当前持仓的“计划交易标的”，支持观察、研究、待计划、已有计划、暂停和归档
- 计划规则覆盖方向、触发条件、允许动作、最大仓位、单笔风险、退出、禁忌、失效、默认动作和三种情景
- 计划必须显式确认才生效；确认保存时间、说明、具体版本和 SHA-256 内容指纹
- 已生效计划发生修改时自动回到待确认状态，历史版本、差异摘要与修改原因不可覆盖
- 事实、分析、用户判断分层保存；事实要求来源和发布时间，分析必须引用事实或声明基于用户判断
- 每笔成交绑定当时有效的计划 ID、版本和内容指纹，并生成结构化纪律事件
- 对无计划新增风险、动作越界、仓位超限、单笔风险超限和触发条件缺失进行分级提示
- 计划失效只改变当前执行状态，不删除历史确认、证据和成交关联

## 纪律与资讯决策闭环

- 盘中成交先生成临时纪律预览，盘后补齐复盘事实后才形成正式逐笔纪律分；盈亏与过程分分开。
- 首页展示今日正式纪律分、待评估成交、重大违规、最近 20 次决策分和一个当前训练目标。
- “资讯影响中心”使用可搜索、可排序、可分页的资讯库；没有 AI 时按时间展示，AI 完整整理后可按阅读优先级展示。
- 自动采集器支持零费用官方来源和 NewsNow 聚合来源。首批推荐来源包括财联社、华尔街见闻、金十、格隆汇、雪球、澎湃、微博和知乎；每个来源使用独立随机窗口，付费 X 接口仍被阻止。
- 后台会安全补抓公开原文并独立保存到本地 SQLite；财联社、华尔街见闻、金十和格隆汇使用逐站正文适配。内容区分完整文章、完整快讯、来源摘要和仅标题线索，AI 不会仅凭热榜标题生成事实判断。
- 资讯影响中心采用“来源列表 + 可收起运行面板”的桌面双栏布局，实时显示采集、正文队列、有效内容覆盖率和最近运行记录。
- AI 整理使用与模型厂商无关的任务和回写接口，Codex 或其他代理都必须遵守同一份 schema；AI 不可用不会影响采集、正文保存和阅读。
- 标的详情包含九段公司传导关系图。支持或反证结论必须引用事实卡，关键节点缺证据时不生成公司影响分。
- “概率研报”冻结比较基准、周期、三情景阈值、信号证据和模型版本；冷启动时只展示相对证据权重。

## v0.2 可信账本基线

- 使用本地 SQLite 事务保存应用状态，首次启动会自动导入原有 `data/store.json`
- 从迁移时点建立不可变账本事件；新成交、费用补录、现金和持仓校正都可重放
- 生效计划与成交纪律检查使用同一套计划数据
- 每次保存计划都会保留完整版本快照
- 支持在页面录入带来源的政策、公司公告和市场研究
- CSV 先预览再原子导入，错误批次不会留下半份账
- 自动补跑最近遗漏的工作日收盘快照
- `review-latest.json` 随每次成功写入同步更新
- 首页展示近 7 日计划外交易、延迟执行、同日反向和费用摘要

## 运行要求

- Windows
- Node.js 22.5 或更高版本
- 可选：已登录的 Codex CLI，用于生成纪律分析

## 启动

### 推荐：一次启动全部本地服务

这个项目实际包含两个必须同时运行的本机服务：

| 服务 | 地址 | 用途 |
|---|---|---|
| 交易纪律助手 | `http://127.0.0.1:3768` | 页面、账本、纪律、AI整理和概率研报 |
| 本地 NewsNow | `http://127.0.0.1:4444` | 财联社、华尔街见闻等聚合资讯来源 |

正常启动必须使用下面任意一种方式，它们都会同时启动两个服务：

```powershell
npm start
```

或者在 PowerShell 中运行：

```powershell
.\start.ps1
```

需要在后台运行、不保持当前窗口时，使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-background.ps1
```

浏览器打开：

```text
http://127.0.0.1:3768
```

不要把下面的命令当作正常启动方式：

```powershell
node server.js
```

它只会启动3768主应用，不会启动4444 NewsNow，因此资讯影响中心会显示“本机 NewsNow 聚合服务未连接”。该命令只适合开发人员单独调试主服务。

### 出现“本机 NewsNow 离线”时

在 `D:\交易` 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-background.ps1
```

等待约5秒后刷新资讯影响中心。也可以检查两个服务：

```powershell
Invoke-RestMethod http://127.0.0.1:3768/api/information-runtime
Invoke-RestMethod 'http://127.0.0.1:4444/api/s?id=cls-hot'
```

第一条结果中的 `newsNow.online` 应为 `true`；第二条应返回财联社热门资讯列表。

如果提示本地 NewsNow 尚未构建，只需执行一次：

```powershell
npm run newsnow:install
npm run newsnow:build
powershell -ExecutionPolicy Bypass -File .\start-background.ps1
```

运行日志位于：

```text
D:\交易\logs\server.log
D:\交易\logs\server-error.log
```

联合启动器会监控它自己启动的NewsNow子进程；如果NewsNow意外退出，会等待2秒后自动重新启动。

程序只监听 `127.0.0.1`，不会主动开放给局域网。

## 测试

```powershell
npm test
```

测试覆盖账本重放、部分卖出、费用后补、现金与持仓校正、SQLite 迁移、CSV 整批回滚，以及计划标的、证据约束、计划确认、逐笔纪律评分、资讯去重、随机采集、公司传导关系、影响评估和概率结算。

## 数据与隐私

- `data/trade-discipline.sqlite`：本地主数据库，同时保存独立的资讯原文正文表
- `data/store.json`：兼容镜像，便于人工恢复
- `data/backups/`：写入前的本地 JSON 备份
- `reports/`：复盘数据包与 Markdown 报告

`data/`、`reports/`、日志、券商截图和私人导入脚本均被 Git 忽略，只保存在本机。请勿使用 `git add -f` 强制提交这些文件。

应用本身不需要 OpenAI API Key。点击生成纪律分析后，应用会通过本机 Codex CLI 读取当次复盘包并作为模型输入处理；原始账户目录不会被 Git 上传。

产品 PRD 位于 `docs/PRD-交易纪律助手-v1.0.md`。PRD 与代码均不包含真实持仓、金额、成交记录或个人规则内容。

## 行情说明

行情刷新使用第三方公开接口，可能延迟、限流或发生字段变化，只用于记录和复盘，不应替代券商行情作为下单依据。

证券目录会在应用启动后检查新鲜度并后台更新；本地搜索没有命中时，会按名称或六位代码实时核验并安全补库。也可以手工执行：

```powershell
npm run stocks:update
```

相关接口：

- `GET /api/stocks/search?q=名称或代码`：搜索并按需补库；
- `GET /api/stocks/status`：查看目录数量、更新时间和是否过期；
- `POST /api/stocks/refresh`：强制刷新全市场目录。

## AI 研究接入

“交易标的中心”内置两段可一键复制的提示词：第一段让任意 AI 生成 `trade-research/v1` 研究包，第二段指导能访问本机工具的 AI 预览并写入应用。

本地 CLI：

```powershell
node scripts/research-import-cli.mjs schema
node scripts/research-import-cli.mjs prompt 贵州茅台
node scripts/research-import-cli.mjs preview .\research.json
node scripts/research-import-cli.mjs import .\research.json --confirm
```

本地 HTTP 接口：

- `GET /api/research-import/prompts`：读取提示词、JSON 结构和接口说明；
- `POST /api/research-import/preview`：校验并预览，不写入数据；
- `POST /api/research-import/commit`：传入 `{ "packet": {...}, "confirmed": true }` 后原子写入候选标的和证据卡。

AI 研究接口不会写入或覆盖 `expectedReturn`（预期收益）和 `userMarketView`（我的市场判断）。重复导入同一研究包时，已有证据卡会自动跳过。

## 通用 AI 代理 Skill

项目内置可随应用一起复制的 Skill：

```text
skills/trade-discipline-assistant/
```

它让支持 `SKILL.md` 或自定义代理规则的 AI 工具按“盘前核对 → 计划确认 → 盘中记录 → 盘后复盘 → 下一交易日草稿”的闭环协助工作，并包含安全边界、接口参考和无第三方依赖的 Python 客户端。默认本地地址为 `http://127.0.0.1:3768`，也可通过 `TRADE_ASSISTANT_URL` 修改。

```powershell
python skills\trade-discipline-assistant\scripts\trade_assistant_client.py status
python skills\trade-discipline-assistant\scripts\trade_assistant_client.py stock-search 惠科股份
```

除研究包和计划包外，外部 AI 还可以读取 `POST /api/review/export` 生成的复盘包，并通过以下代理中立接口把新报告写入历史版本：

- `POST /api/analysis/import/preview`：校验 `trade-review-ai/v1`；
- `POST /api/analysis/import`：必须传入 `confirmed: true`，不覆盖旧报告。

Skill 明确禁止自动下单；券商成交、持仓和资金始终是事实源，高影响写入和计划确认必须由用户明确授权。

## 纪律、影响因子与概率研报规则

项目现在包含三套与代理无关的纯规则模块：

- `lib/discipline-engine.js`：逐笔六维纪律分、硬风险上限、记录完整度和周期自查；盈亏不进入纪律分；
- `lib/influence-engine.js`：来源/内容双评分、事件强度和政策到公司的九段传导链；
- `lib/probability-engine.js`：冷启动保护、概率发布门槛和到期 Brier 结算。

规则通过 `GET /api/rulebooks` 查询。三类对象均支持先 `/preview`、再由用户确认保存；正式记录保存输入哈希和规则版本，不覆盖历史。详细说明见：

- `docs/规则体系-v2-交易纪律闭环.md`
- `docs/规则体系-v1-资讯影响与概率研报闭环.md`
- `docs/规则体系-v2-落地映射与验收.md`
- `docs/资讯采集来源调研-v1.md`
