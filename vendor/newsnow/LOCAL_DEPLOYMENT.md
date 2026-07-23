# 本地部署说明

本目录保存 NewsNow 的完整源码快照，用于本交易工具自己的资讯聚合服务，不依赖任何公共 NewsNow 服务器。

- 上游项目：`ourongxing/newsnow`
- 开源协议：MIT（见同目录 `LICENSE`）
- 版本：`0.0.41`
- 固定提交：`2173126f804bec0201769f59d933add6c4632d17`
- 本地地址：`http://127.0.0.1:4444`
- 构建产物：`vendor/newsnow/dist/output/server/index.mjs`
- 本地缓存：`vendor/newsnow/.data/`

正常使用只需运行项目根目录的 `start.ps1`。启动器会先检查并启动本地 NewsNow，再启动交易工具。两者都只监听本机回环地址。

首次安装或主动更新源码后执行：

```powershell
npm run newsnow:install
npm run newsnow:build
```

本地快照已经把上游 `sputniknewscn` 和 `ghxi` 的公共 NewsNow 代理分支移除，这两个来源在任何部署模式下都只运行自身的原站抓取器。不要把 `CF_PAGES` 设置为真，本项目只维护和验证本地 Node 模式。
