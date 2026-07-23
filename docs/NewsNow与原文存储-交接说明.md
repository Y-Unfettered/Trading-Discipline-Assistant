# NewsNow 与原文存储交接说明

交接日期：2026-07-22

## 已完成

资讯影响中心现在包含三条互相独立的链路：

1. 本地采集器定时获取标题、来源、排名、热度和原文链接。
2. 原文补抓器读取公开网页、提取正文并存入本机 SQLite。
3. 可选 AI 代理读取本地正文或摘要，生成标签、摘要和优先级。

任意一层失败都不会阻塞前一层。AI 不可用时，资讯仍会正常采集、分页、搜索并按发布时间展示。

首次交接联调已经实际启用基础 NewsNow 来源。2026-07-22 扩展为 14 个推荐来源，原文队列会在后台继续逐条补齐，不需要保持 Codex 运行。

## NewsNow 推荐来源

点击“资讯影响中心 → 接入推荐 NewsNow 来源”会幂等添加并启用：

| 来源 | NewsNow ID | 随机间隔 |
| --- | --- | --- |
| 财联社电报 | `cls-telegraph` | 5–10 分钟 |
| 财联社热门 | `cls-hot` | 10–15 分钟 |
| 财联社深度 | `cls-depth` | 15–25 分钟 |
| 华尔街见闻快讯 | `wallstreetcn-quick` | 5–10 分钟 |
| 华尔街见闻最新 | `wallstreetcn-news` | 10–15 分钟 |
| 华尔街见闻最热 | `wallstreetcn-hot` | 15–25 分钟 |
| 金十数据 | `jin10` | 10–15 分钟 |
| 格隆汇事件 | `gelonghui` | 5–10 分钟 |
| 参考消息 | `cankaoxiaoxi` | 20–30 分钟 |
| 卫星通讯社 | `sputniknewscn` | 20–30 分钟 |
| 雪球热门股票 | `xueqiu-hotstock` | 5–10 分钟 |
| 澎湃新闻热榜 | `thepaper` | 20–30 分钟 |
| 微博实时热搜 | `weibo` | 10–15 分钟 |
| 知乎热榜 | `zhihu` | 15–25 分钟 |

NewsNow 完整源码已经固定保存在 `vendor/newsnow`，默认服务地址为 `http://127.0.0.1:4444`。当前固定版本是 `0.0.41`，提交为 `2173126f804bec0201769f59d933add6c4632d17`。应用不再调用 `newsnow.busiyi.world` 或其他公共 NewsNow 服务器；数据库里旧的公共地址会在读取时自动迁移到本机地址。

`start.ps1`、`start-background.ps1` 和开机自启任务现在都会运行 `scripts/start-local-stack.mjs`：先检查并启动本地 NewsNow，再启动交易工具。NewsNow 只监听 `127.0.0.1:4444`，不会向局域网开放。上游项目以后关站、删服务或停止维护，不会影响我们已经固定并构建好的这份代码；各资讯来源自身的网站仍然是采集所需的原始数据源。

首次换电脑或主动更新 NewsNow 源码后，需要在项目根目录执行 `npm run newsnow:install` 和 `npm run newsnow:build`。更详细的版本和构建记录见 `vendor/newsnow/LOCAL_DEPLOYMENT.md`。

NewsNow 每个来源最多返回约 30 条。应用在同一来源内按外部 ID 去重，并会对不同分类返回的相同原文 URL 再做一次跨分类去重；同一篇文章同时进入“热门”和“深度”时只保存一条，并记录它出现过的采集频道。

36氪没有加入默认组，因为 2026-07-22 联调时其 NewsNow 接口返回 HTTP 500。后续恢复后可以单独配置 `36kr-quick`。

## 原文如何保存在本地

新资讯默认标记为“待补抓”。后台每分钟最多处理四条，同一网站每轮最多两条且两次请求至少间隔 3.5 秒；最近六小时的新资讯优先，同时为历史积压保留处理机会。正文独立存放在：

```text
data/trade-discipline.sqlite
└─ information_content
```

主资讯记录只保存正文状态、哈希和抓取时间，不把大段正文写进 `store.json`。

正文状态和内容类型分开保存：

- `complete + article`：完整文章；
- `complete + brief`：完整快讯。快讯即使只有一句话，也可能已经是来源发布的全部内容；
- `summary_only + substantial_summary`：NewsNow 或来源列表提供的较长摘要，能够辅助阅读，但不冒充完整原文；
- `headline_only`：只有热榜标题或股票热度名称，只作线索展示，不交给 AI 推断事实；
- `pending`：等待后台补抓；
- `blocked`：网站返回 401、403 或 429；
- `failed`：网络、格式、安全校验或页面解析失败。

失败会按 30 分钟、6 小时、24 小时退避重试，自动尝试最多三次。详情窗口可以点击“重新抓取”手动重试。

当前逐站处理策略：

| 来源 | 正文方式 |
| --- | --- |
| 财联社 | 读取详情页 `__NEXT_DATA__` 中公开的电报正文 |
| 华尔街见闻 | 读取公开快讯详情 JSON 的 `content_text` / `content_more` |
| 金十 | 优先保存 NewsNow 自带快讯内容，再从详情页升级 |
| 格隆汇、澎湃、国家统计局 | 从公开详情页提取文章正文 |
| 知乎 | 先保存 NewsNow 自带的长摘要；页面允许时再升级正文 |
| 雪球热门股票、微博热搜 | 明确标记为“仅标题线索”，不伪造正文 |

## 安全边界

- 只允许 HTTP/HTTPS 原文。
- 拒绝 localhost、局域网和私有 IP，防止原文链接访问本机服务。
- 每次最多读取 2MB，最多跟随 5 次经过重新校验的重定向。
- 不绕过验证码、登录、订阅墙或平台访问控制。
- 不保存微博、知乎、雪球等个人账号的密码或 Cookie。
- 页面只展示提取后的纯文本正文，不执行原网页脚本。

## 与 AI 整理的关系

AI 任务会优先携带本地正文。`headline_only` 不会进入 AI 任务；`substantial_summary` 可以进入，但代理必须降低置信度并说明尚未取得完整原文。正文稍后补抓成功时，内容哈希会变化，旧 AI 结果自动失效并重新进入待整理队列。

## 页面运行面板

“自动采集来源”在桌面宽度下占左侧区域并独立滚动，右侧“采集运行面板”每 5 秒读取一次本地状态。面板可以收起，收起不会停止脚本。它显示：

- 当前是在抓取资讯、补全正文还是等待下一轮；
- 本地 NewsNow 是“本机在线”还是“本机离线”；
- 完整文章、完整快讯、来源摘要、仅标题线索和可供 AI 的数量；
- 待补、待升级和重试队列；
- 最近采集、正文解析的时间与结果。

AI 代理交接方式见 `docs/AI资讯整理代理交接.md`。

## 相关接口

```text
POST /api/information-sources/newsnow-defaults
POST /api/information-collection/run
GET  /api/information-content/:eventId
POST /api/information-content/run
GET  /api/information-content/runs
GET  /api/information-runtime
```

以上接口全部由本地 Node.js 服务提供，不依赖 Codex 或其他 AI。
