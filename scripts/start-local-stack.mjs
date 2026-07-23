import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, "..")
const newsNowDir = path.join(rootDir, "vendor", "newsnow")
const newsNowEntry = path.join(newsNowDir, "dist", "output", "server", "index.mjs")
const newsNowBaseUrl = process.env.TRADE_NEWSNOW_URL || "http://127.0.0.1:4444"
const appBaseUrl = `http://127.0.0.1:${process.env.PORT || "3768"}`

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function isOnline(url, timeoutMs = 1200) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

function pipeOutput(child, label) {
  child.stdout?.on("data", chunk => process.stdout.write(`[${label}] ${chunk}`))
  child.stderr?.on("data", chunk => process.stderr.write(`[${label}] ${chunk}`))
}

async function ensureNewsNow() {
  if (await isOnline(`${newsNowBaseUrl}/`)) {
    console.log(`[启动] 本地 NewsNow 已运行：${newsNowBaseUrl}`)
    return null
  }
  if (!fs.existsSync(newsNowEntry)) {
    throw new Error(`本地 NewsNow 尚未构建：${newsNowEntry}\n请先运行 npm run newsnow:install 和 npm run newsnow:build。`)
  }
  const url = new URL(newsNowBaseUrl)
  const child = spawn(process.execPath, [newsNowEntry], {
    cwd: newsNowDir,
    env: {
      ...process.env,
      HOST: url.hostname,
      PORT: url.port || "4444",
      NODE_ENV: "production",
      INIT_TABLE: "true",
      ENABLE_CACHE: "true"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  })
  pipeOutput(child, "NewsNow")
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) throw new Error(`本地 NewsNow 启动失败，退出码 ${child.exitCode}`)
    if (await isOnline(`${newsNowBaseUrl}/`, 600)) {
      console.log(`[启动] 本地 NewsNow 已就绪：${newsNowBaseUrl}`)
      return child
    }
    await sleep(250)
  }
  child.kill()
  throw new Error("本地 NewsNow 在 15 秒内没有就绪，请查看 logs/server-error.log。")
}

const appWasOnline = await isOnline(`${appBaseUrl}/`)
let newsNowChild
let appChild
let stopping = false

function stopOwnedChildren() {
  stopping = true
  if (appChild?.exitCode == null) appChild.kill()
  if (newsNowChild?.exitCode == null) newsNowChild.kill()
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopOwnedChildren()
    process.exitCode = 0
  })
}

async function superviseNewsNow() {
  while (!stopping) {
    newsNowChild = await ensureNewsNow()
    if (!newsNowChild) {
      await sleep(10_000)
      continue
    }
    const exitCode = await new Promise(resolve => newsNowChild.once("exit", code => resolve(code)))
    newsNowChild = null
    if (!stopping) {
      console.error(`[启动] 本地 NewsNow 已退出（退出码 ${exitCode ?? "unknown"}），2 秒后自动重启。`)
      await sleep(2_000)
    }
  }
}

try {
  const newsNowSupervisor = superviseNewsNow()
  if (appWasOnline) {
    console.log(`[启动] 交易工具已运行：${appBaseUrl}`)
    await newsNowSupervisor
  } else {
    appChild = spawn(process.execPath, [path.join(rootDir, "server.js")], {
      cwd: rootDir,
      env: { ...process.env, TRADE_NEWSNOW_URL: newsNowBaseUrl },
      stdio: "inherit",
      windowsHide: true
    })
    const exitCode = await new Promise(resolve => {
      appChild.once("error", error => {
        console.error(`[启动] 交易工具启动失败：${error.message}`)
        resolve(1)
      })
      appChild.once("exit", code => resolve(Number(code || 0)))
    })
    stopping = true
    if (newsNowChild?.exitCode == null) newsNowChild.kill()
    await newsNowSupervisor
    process.exitCode = exitCode
  }
} catch (error) {
  console.error(`[启动] ${error.message}`)
  stopOwnedChildren()
  process.exitCode = 1
}
