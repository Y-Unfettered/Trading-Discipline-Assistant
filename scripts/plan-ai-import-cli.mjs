#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const command = args[0]
const baseUrl = process.env.TRADE_ASSISTANT_URL || 'http://127.0.0.1:3768'
const mode = args.includes('--fill-empty') ? 'fill-empty' : 'replace-ai'

function usage() {
  console.log(`交易纪律助手 AI 计划写入接口

用法：
  node scripts/plan-ai-import-cli.mjs preview <AI计划包.json> [--fill-empty]
  node scripts/plan-ai-import-cli.mjs import <AI计划包.json> --confirm [--fill-empty]

说明：
  preview 只校验并显示将要修改的字段，不写入数据。
  import 会再次预览；只有 changedCount 大于 0 且带 --confirm 才会创建新计划版本。

环境变量：
  TRADE_ASSISTANT_URL  本地服务地址，默认 http://127.0.0.1:3768`)
}

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) }
  })
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
  return payload
}

function readPacket(fileName) {
  if (!fileName) throw new Error('必须提供 AI 计划包 JSON 文件路径')
  const resolved = path.resolve(fileName)
  if (!fs.existsSync(resolved)) throw new Error(`AI 计划包文件不存在：${resolved}`)
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(`AI 计划包不是合法 JSON：${error.message}`)
  }
}

async function preview(packet) {
  const result = await request('/api/plan-ai-import/preview', {
    method: 'POST',
    body: JSON.stringify({ packet, mode })
  })
  if (!result.summary?.changedCount) throw new Error('预览没有发现任何可写入字段，已停止')
  return result
}

async function main() {
  if (!command || ['help', '--help', '-h'].includes(command)) {
    usage()
    return
  }
  if (!['preview', 'import'].includes(command)) throw new Error(`未知命令：${command}`)

  const packet = readPacket(args[1])
  const checked = await preview(packet)
  if (command === 'preview') {
    console.log(JSON.stringify(checked, null, 2))
    return
  }

  if (!args.includes('--confirm')) throw new Error('正式写入必须添加 --confirm；请先运行 preview 检查')
  const result = await request('/api/plan-ai-import/commit', {
    method: 'POST',
    body: JSON.stringify({ packet, mode, confirmed: true })
  })
  console.log(JSON.stringify({
    preview: checked.summary,
    imported: result.summary,
    plan: { id: result.plan.id, date: result.plan.planForDate, version: result.plan.version }
  }, null, 2))
}

main().catch(error => {
  console.error(`AI 计划接口调用失败：${error.message}`)
  process.exitCode = 1
})
