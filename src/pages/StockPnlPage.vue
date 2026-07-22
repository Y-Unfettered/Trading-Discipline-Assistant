<script setup lang="ts">
import { computed } from 'vue'
import { CircleDollarSign, Layers3, TrendingDown, TrendingUp } from 'lucide-vue-next'
import DataTable, { type DataTableColumn } from '@/components/app/DataTable.vue'
import PageHeading from '@/components/app/PageHeading.vue'
import MetricCard from '@/components/app/MetricCard.vue'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { holdingPnl, money } from '@/lib/trade-api'

const props = defineProps<{ store: Record<string, any> }>()
const columns: DataTableColumn[] = [
  { key: 'stock', label: '股票' },
  { key: 'statusLabel', label: '状态' },
  { key: 'realizedPnl', label: '已实现盈亏', format: 'money' },
  { key: 'unrealizedPnl', label: '浮动盈亏', format: 'money' },
  { key: 'currentPnl', label: '累计盈亏', format: 'money' },
]
const rows = computed(() => {
  const grouped = new Map<string, any>()
  for (const trade of props.store?.trades || []) {
    const code = String(trade.code)
    const item = grouped.get(code) || { id: code, code, name: trade.name || code, realizedPnl: 0, unrealizedPnl: 0, status: 'closed' }
    item.name = trade.name || item.name
    if (trade.side === 'SELL') item.realizedPnl += Number(trade.realizedPnlEstimate || 0)
    grouped.set(code, item)
  }
  for (const holding of props.store?.holdings || []) {
    const code = String(holding.code)
    const item = grouped.get(code) || { id: code, code, name: holding.name || code, realizedPnl: 0, unrealizedPnl: 0, status: 'holding' }
    item.name = holding.name || item.name
    item.status = 'holding'
    item.unrealizedPnl = holdingPnl(holding)
    grouped.set(code, item)
  }
  return [...grouped.values()].map(item => ({
    ...item,
    stock: `${item.name} · ${item.code}`,
    statusLabel: item.status === 'holding' ? '当前持仓' : '历史已清仓',
    realizedPnl: Number(item.realizedPnl.toFixed(2)),
    unrealizedPnl: Number(item.unrealizedPnl.toFixed(2)),
    currentPnl: Number((item.realizedPnl + item.unrealizedPnl).toFixed(2)),
  })).sort((a, b) => b.currentPnl - a.currentPnl)
})
const realizedTotal = computed(() => rows.value.reduce((sum, item) => sum + item.realizedPnl, 0))
const unrealizedTotal = computed(() => rows.value.reduce((sum, item) => sum + item.unrealizedPnl, 0))
const cumulativeTotal = computed(() => realizedTotal.value + unrealizedTotal.value)
const metrics = computed(() => [
  { label: '已实现盈亏', value: money(realizedTotal.value), icon: CircleDollarSign },
  { label: '持仓浮动盈亏', value: money(unrealizedTotal.value), icon: unrealizedTotal.value >= 0 ? TrendingUp : TrendingDown },
  { label: '个股累计盈亏', value: money(cumulativeTotal.value), icon: cumulativeTotal.value >= 0 ? TrendingUp : TrendingDown },
  { label: '涉及标的', value: `${rows.value.length} 只`, icon: Layers3 },
])
</script>

<template>
  <PageHeading eyebrow="Stock P&L ledger" title="个股盈亏" description="直接由年度资金总账和当前最新价推导；卖出形成已实现盈亏，未卖持仓形成浮动盈亏。">
    <template #actions><Badge variant="outline">不依赖券商快照</Badge></template>
  </PageHeading>
  <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard v-for="metric in metrics" :key="metric.label" v-bind="metric" /></section>
  <Card class="mt-4 shadow-none">
    <CardHeader><CardTitle>截至当前的个股累计盈亏</CardTitle><CardDescription>总账成交与最新行情统一计算，默认每页 10 条</CardDescription></CardHeader>
    <CardContent>
      <DataTable v-if="rows.length" :columns="columns" :data="rows" search-placeholder="搜索股票或持仓状态" initial-sort-key="currentPnl" />
      <Empty v-else><EmptyHeader><EmptyTitle>暂无个股盈亏记录</EmptyTitle><EmptyDescription>录入成交后会自动生成。</EmptyDescription></EmptyHeader></Empty>
    </CardContent>
  </Card>
</template>
