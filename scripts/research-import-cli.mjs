#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const command = args[0]
const baseUrl = process.env.TRADE_ASSISTANT_URL || 'http://127.0.0.1:3768'

function usage() {
  console.log(`交易纪律助手 AI 研究接口

用法：
  node scripts/research-import-cli.mjs schema
  node scripts/research-import-cli.mjs prompt [股票名称或代码]
  node scripts/research-import-cli.mjs write-prompt
  node scripts/research-import-cli.mjs preview <研究包.json>
  node scripts/research-import-cli.mjs import <研究包.json> --confirm

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
  if (!fileName) throw new Error('必须提供研究包JSON文件路径')
  const resolved = path.resolve(fileName)
  if (!fs.existsSync(resolved)) throw new Error(`研究包文件不存在：${resolved}`)
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(`研究包不是合法JSON：${error.message}`)
  }
}

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage()
    return
  }

  if (command === 'schema' || command === 'prompt' || command === 'write-prompt') {
    const target = command === 'prompt' ? args.slice(1).join(' ') : ''
    const result = await request(`/api/research-import/prompts?target=${encodeURIComponent(target)}`)
    if (command === 'schema') console.log(JSON.stringify(result.schema, null, 2))
    else if (command === 'prompt') console.log(result.researchPrompt)
    else console.log(result.writePrompt)
    return
  }

  if (command === 'preview') {
    const packet = readPacket(args[1])
    const result = await request('/api/research-import/preview', { method: 'POST', body: JSON.stringify({ packet }) })
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (command === 'import') {
    if (!args.includes('--confirm')) throw new Error('正式写入必须添加--confirm；请先运行preview检查')
    const packet = readPacket(args[1])
    const preview = await request('/api/research-import/preview', { method: 'POST', body: JSON.stringify({ packet }) })
    const result = await request('/api/research-import/commit', { method: 'POST', body: JSON.stringify({ packet, confirmed: true }) })
    console.log(JSON.stringify({ preview: preview.summary, imported: result.summary, asset: { id: result.asset.id, code: result.asset.code, name: result.asset.name } }, null, 2))
    return
  }

  throw new Error(`未知命令：${command}`)
}

main().catch(error => {
  console.error(`研究接口调用失败：${error.message}`)
  process.exitCode = 1
})
