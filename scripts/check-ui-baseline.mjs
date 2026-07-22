import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const failures = []
const fail = (file, message) => failures.push(`${file}: ${message}`)
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const read = file => fs.readFileSync(file, 'utf8')

const packageJson = JSON.parse(read('package.json'))
if (packageJson.devDependencies?.['shadcn-vue'] !== '2.7.4') {
  fail('package.json', 'shadcn-vue CLI 必须精确锁定为 2.7.4')
}

for (const dependency of ['element-plus', 'ant-design-vue', 'vant', 'naive-ui', 'vuetify']) {
  if (packageJson.dependencies?.[dependency] || packageJson.devDependencies?.[dependency]) {
    fail('package.json', `禁止引入其他 UI 库 ${dependency}`)
  }
}

const manifest = JSON.parse(read('test/ui-baseline.sha256.json'))
if (manifest.cliVersion !== '2.7.4') fail('test/ui-baseline.sha256.json', '基线版本必须为 2.7.4')
if (hash(fs.readFileSync('components.json')) !== manifest.componentsJsonSha256) fail('components.json', '冻结配置已被修改')
if (hash(fs.readFileSync('src/style.css')) !== manifest.styleCssSha256) fail('src/style.css', '官方 neutral 主题基线已被修改')

const uiRoot = 'src/components/ui'
const actualUiFiles = new Map()
function walk(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(target, callback)
    else callback(target)
  }
}
walk(uiRoot, file => actualUiFiles.set(path.relative(uiRoot, file).replaceAll('\\', '/'), hash(fs.readFileSync(file))))
for (const [file, expectedHash] of Object.entries(manifest.files)) {
  if (!actualUiFiles.has(file)) fail(`${uiRoot}/${file}`, '官方组件文件缺失')
  else if (actualUiFiles.get(file) !== expectedHash) fail(`${uiRoot}/${file}`, '官方组件源码已被修改')
}
for (const file of actualUiFiles.keys()) {
  if (!(file in manifest.files)) fail(`${uiRoot}/${file}`, '冻结区出现未登记文件')
}

const businessFiles = []
walk('src', file => {
  const normalized = file.replaceAll('\\', '/')
  if (file.endsWith('.vue') && !normalized.startsWith('src/components/ui/')) businessFiles.push(file)
  if (/\.(?:css|scss|less)$/.test(file) && normalized !== 'src/style.css') fail(normalized, '禁止新增业务样式文件')
})

const nativeInteractive = /<(button|input|textarea|select|label|table|details|summary|kbd)(?:\s|>)/g
const forbiddenInputType = /<Input\b[^>]*\btype=["'](?:date|datetime-local|number)["']/gi
const nativeClick = /<(?:div|span)\b[^>]*@(?:click|keydown|keyup)=/gi
const bannedVariant = /\bvariant\s*=\s*["'](?:success|warning|info|profit|loss)["']|\bvariant\s*=\s*["'][^"']*["']\s*\?\s*["'](?:success|warning|info|profit|loss)["']/gi
const classModifiers = new Set(['sm', 'md', 'lg', 'xl', '2xl', 'dark', 'hover', 'focus', 'focus-visible', 'active', 'disabled', 'before', 'after'])
function allowedClass(token) {
  const officialCalendarExample = new Set([
    'font-normal',
    'bg-background',
    'appearance-none',
    '[&::-webkit-calendar-picker-indicator]:hidden',
    '[&::-webkit-calendar-picker-indicator]:appearance-none',
  ])
  if (officialCalendarExample.has(token)) return true
  const parts = token.split(':')
  if (parts.length > 1) {
    const modifiers = parts.slice(0, -1)
    return modifiers.every(prefix => classModifiers.has(prefix) || /^data-\[.+\]$/.test(prefix) || /^\[.+\]$/.test(prefix)) && allowedClass(parts.at(-1))
  }
  return /^(?:relative|absolute|flex|grid|block|hidden|truncate|line-clamp-[^\s]+|uppercase|aspect-square|border|shadow-none|rounded-full|flex-(?:row|col|wrap|nowrap|1)|shrink(?:-0)?|grow(?:-0)?|gap-[^\s]+|space-[xy]-[^\s]+|[mp][trblxy]?-[^\s]+|w-[^\s]+|h-[^\s]+|min-[wh]-[^\s]+|max-[wh]-[^\s]+|items-[^\s]+|justify-[^\s]+|self-[^\s]+|place-items-[^\s]+|overflow(?:-[xy])?-[^\s]+|grid-cols-[^\s]+|col-span-[^\s]+|size-[^\s]+|inset-[^\s]+|bottom-[^\s]+|top-[^\s]+|left-[^\s]+|right-[^\s]+|rounded-[^\s]+|border-[^\s]+|bg-[^\s]+|from-[^\s]+|to-[^\s]+|text-[^\s]+|font-[^\s]+|tracking-[^\s]+|leading-[^\s]+|content-[^\s]+)$/.test(token)
}

for (const file of businessFiles) {
  const source = read(file)
  const normalized = file.replaceAll('\\', '/')
  for (const match of source.matchAll(nativeInteractive)) fail(normalized, `禁止原生交互控件 <${match[1]}>`)
  if (forbiddenInputType.test(source)) fail(normalized, '日期和数字必须使用 Date Picker / Number Field')
  forbiddenInputType.lastIndex = 0
  if (nativeClick.test(source)) fail(normalized, '禁止 div/span 绑定交互事件')
  nativeClick.lastIndex = 0
  if (/<style(?:\s|>)/i.test(source) || /\sstyle\s*=/.test(source)) fail(normalized, '禁止业务 CSS 或内联 style；请使用 Tailwind CSS utility class')
  if (/\bwindow\.confirm\s*\(/.test(source)) fail(normalized, '确认操作必须使用 Dialog 或 Alert Dialog')
  if (/from\s+["']reka-ui["']/.test(source)) fail(normalized, '业务层禁止直接使用 reka-ui')
  if (bannedVariant.test(source)) fail(normalized, '禁止非官方 Variant')
  bannedVariant.lastIndex = 0
  if (/:class\s*=/.test(source)) fail(normalized, '业务层禁止动态样式覆盖；请使用官方 Props/Variant')
  for (const match of source.matchAll(/(?<!:)class="([^"]*)"/g)) {
    for (const token of match[1].split(/\s+/).filter(Boolean)) {
      if (!allowedClass(token)) fail(normalized, `Tailwind 类不在业务白名单：${token}`)
    }
  }
}

if (failures.length) {
  console.error(`UI 官方基线检查失败（${failures.length} 项）：`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`UI 官方基线检查通过：${Object.keys(manifest.files).length} 个冻结文件，${businessFiles.length} 个业务组件。`)
