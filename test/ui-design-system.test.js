const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('shadcn-vue CLI and configuration are frozen', () => {
  const packageJson = JSON.parse(read('package.json'))
  const components = JSON.parse(read('components.json'))
  assert.equal(packageJson.devDependencies['shadcn-vue'], '2.7.4')
  assert.equal(components.style, 'new-york')
  assert.equal(components.tailwind.baseColor, 'neutral')
  assert.equal(components.iconLibrary, 'lucide')
})

test('application entry uses only the official global theme stylesheet', () => {
  const index = read('index.html')
  assert.doesNotMatch(index, /ui-tokens\.css|styles\.css/)
  assert.equal(fs.existsSync(path.join(root, 'public/ui-tokens.css')), false)
  assert.equal(fs.existsSync(path.join(root, 'public/styles.css')), false)
})

test('baseline checker covers frozen source and business pages', () => {
  const checker = read('scripts/check-ui-baseline.mjs')
  assert.match(checker, /ui-baseline\.sha256\.json/)
  assert.match(checker, /nativeInteractive/)
  assert.match(checker, /allowedClass/)
})

test('legacy entry only redirects old bookmarks into the Vue application', () => {
  const legacy = read('public/legacy.html')
  assert.match(legacy, /location\.replace/)
  assert.doesNotMatch(legacy, /<main|<form|<table|<button/i)
})
