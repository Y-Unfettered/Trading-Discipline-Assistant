<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/trade-api'

export type StockOption = {
  code: string
  name: string
  market?: string
}

const selected = defineModel<StockOption | null>({ default: null })
const root = ref<HTMLElement | null>(null)
const input = ref<InstanceType<typeof Input> | null>(null)
const query = ref('')
const results = ref<StockOption[]>([])
const open = ref(false)
const searching = ref(false)
const composing = ref(false)
const activeIndex = ref(-1)
const hint = ref('输入至少 2 个字或 2 位代码，再从下拉列表选择')
let searchTimer: ReturnType<typeof setTimeout> | null = null
let requestSequence = 0

function marketLabel(market?: string) {
  return market === 'SH' ? '沪市' : market === 'SZ' ? '深市' : market === 'BJ' ? '北交所' : 'A股'
}

function cancelPendingSearch() {
  requestSequence += 1
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = null
}

async function searchStocks(keyword: string) {
  const sequence = ++requestSequence
  searching.value = true
  hint.value = '正在本地 A 股证券库中匹配…'
  try {
    const payload = await api<{ stocks: StockOption[] }>(`/api/stocks/search?q=${encodeURIComponent(keyword)}`)
    if (sequence !== requestSequence) return
    results.value = payload.stocks || []
    activeIndex.value = results.value.length ? 0 : -1
    open.value = true
    hint.value = results.value.length
      ? `找到 ${results.value.length} 只，请选择正确的股票`
      : '本地证券库中没有找到，请检查名称或代码'
  } catch (error) {
    if (sequence !== requestSequence) return
    results.value = []
    activeIndex.value = -1
    open.value = false
    hint.value = error instanceof Error ? `匹配失败：${error.message}` : '股票匹配失败'
  } finally {
    if (sequence === requestSequence) searching.value = false
  }
}

function queueSearch(value: string) {
  cancelPendingSearch()
  const keyword = value.trim()
  if (keyword.length < 2) {
    results.value = []
    open.value = false
    activeIndex.value = -1
    searching.value = false
    hint.value = '输入至少 2 个字或 2 位代码，再从下拉列表选择'
    return
  }
  searchTimer = setTimeout(() => searchStocks(keyword), 300)
}

function onInput(event: Event) {
  const value = (event.target as HTMLInputElement).value
  query.value = value
  if (selected.value && value !== selected.value.name && value !== selected.value.code) selected.value = null
  if (!composing.value) queueSearch(value)
}

function choose(stock: StockOption) {
  cancelPendingSearch()
  selected.value = { code: String(stock.code), name: stock.name, market: stock.market }
  query.value = stock.name
  results.value = []
  open.value = false
  activeIndex.value = -1
  searching.value = false
  hint.value = `${stock.code} · ${marketLabel(stock.market)} · 已从本地证券库匹配`
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    open.value = false
    return
  }
  if (!open.value || !results.value.length) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % results.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + results.value.length) % results.value.length
  } else if (event.key === 'Enter' && activeIndex.value >= 0) {
    event.preventDefault()
    choose(results.value[activeIndex.value])
  }
}

function onCompositionStart() {
  composing.value = true
  cancelPendingSearch()
  open.value = false
}

function onCompositionEnd(event: CompositionEvent) {
  composing.value = false
  const value = (event.target as HTMLInputElement).value
  query.value = value
  queueSearch(value)
}

watch(selected, stock => {
  cancelPendingSearch()
  query.value = stock?.name || ''
  results.value = []
  open.value = false
  hint.value = stock
    ? `${stock.code} · ${marketLabel(stock.market)} · 已选择`
    : '输入至少 2 个字或 2 位代码，再从下拉列表选择'
}, { immediate: true })

onClickOutside(root, () => { open.value = false })
onBeforeUnmount(cancelPendingSearch)

defineExpose({
  focus: () => nextTick(() => (input.value?.$el as HTMLInputElement | undefined)?.focus()),
})
</script>

<template>
  <div ref="root">
    <div>
      <Input
        ref="input"
        :model-value="query"
        role="combobox"
        autocomplete="off"
        aria-label="搜索股票名称或代码"
        aria-autocomplete="list"
        aria-controls="trade-stock-results"
        :aria-expanded="open"
        :aria-activedescendant="activeIndex >= 0 ? `trade-stock-option-${activeIndex}` : undefined"
        placeholder="输入股票名称或代码，例如：华天"
        required
        @input="onInput"
        @focus="() => { if (results.length) open = true }"
        @keydown="onKeydown"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
      />
    </div>

    <div
      v-if="open"
      id="trade-stock-results"
      role="listbox"
      class="mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground"
    >
      <Button
        v-for="(stock, index) in results"
        :id="`trade-stock-option-${index}`"
        :key="stock.code"
        type="button"
        role="option"
        size="sm"
        :variant="index === activeIndex ? 'secondary' : 'ghost'"
        :aria-selected="selected?.code === stock.code"
        class="w-full justify-between text-left"
        @mouseenter="activeIndex = index"
        @click="choose(stock)"
      >
        <strong>{{ stock.name }}</strong>
        <span class="shrink-0 text-xs text-muted-foreground">{{ stock.code }} · {{ marketLabel(stock.market) }}</span>
      </Button>
      <p v-if="!results.length && !searching" class="px-3 py-4 text-center text-sm text-muted-foreground">没有匹配的 A 股股票</p>
    </div>

    <p class="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground"><Spinner v-if="searching" />{{ hint }}</p>
  </div>
</template>
