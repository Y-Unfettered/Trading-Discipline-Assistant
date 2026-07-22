<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Banknote, Landmark, Plus, TrendingDown, TrendingUp } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import DatePickerControl from '@/components/app/DatePickerControl.vue'
import FieldBlock from '@/components/app/FieldBlock.vue'
import LedgerDataTable from '@/components/app/LedgerDataTable.vue'
import PageHeading from '@/components/app/PageHeading.vue'
import MetricCard from '@/components/app/MetricCard.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { NumberField, NumberFieldContent, NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api, dateTime, localDateKey, money } from '@/lib/trade-api'

const props = defineProps<{ store: Record<string, any>; dashboard: Record<string, any> }>()
const emit = defineEmits<{ refresh: []; navigate: [page: string] }>()
const account = computed(() => props.dashboard?.account || {})
const funding = computed(() => [...(props.store?.fundingLedger || [])].sort((a: any, b: any) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)))
const cashRows = computed(() => [
  ...(props.store?.trades || []).map((trade: any) => ({ kind: 'trade' as const, id: trade.id, raw: trade, date: trade.date, time: trade.time, name: trade.name, operation: trade.side === 'BUY' ? '证券买入' : '证券卖出', side: trade.side, quantity: trade.quantity, price: trade.price, amount: trade.price * trade.quantity, fee: trade.fee, cashEffect: trade.cashEffect })),
  ...funding.value.map((item: any) => ({ kind: 'funding' as const, id: item.id, raw: item, date: item.date, time: item.time, name: item.type === 'DEPOSIT' ? '资金转入' : item.type === 'WITHDRAWAL' ? '资金转出' : '利息入账', operation: item.type === 'DEPOSIT' ? '资金转入' : item.type === 'WITHDRAWAL' ? '资金转出' : '利息入账', quantity: 0, price: null, amount: Math.abs(item.amount), fee: 0, cashEffect: item.amount })),
].sort((a: any, b: any) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)))
const maxValue = computed(() => Math.max(Number(account.value.netContributions || 0), Number(account.value.totalAssets || 0), 1))
const bars = computed(() => [{ label: '累计净投入', value: Number(account.value.netContributions || 0) }, { label: '当前账户资产', value: Number(account.value.totalAssets || 0) }])
const metrics = computed(() => [{ label: '累计净投入', value: money(account.value.netContributions), icon: Banknote }, { label: '账本计算总资产', value: money(account.value.totalAssets), icon: Landmark }, { label: '累计盈亏', value: money(account.value.cumulativePnl), icon: Number(account.value.cumulativePnl) >= 0 ? TrendingUp : TrendingDown }, { label: '累计收益率', value: `${Number(account.value.cumulativeReturnPct || 0).toFixed(2)}%`, icon: TrendingUp }])

const editOpen = ref(false)
const deleteOpen = ref(false)
const busy = ref(false)
const message = ref('')
const selectedRow = ref<any>(null)
const editForm = reactive({ kind: 'trade', id: '', date: localDateKey(), time: '09:30:00', name: '', operation: '', quantity: '', price: '', fee: '', reason: '', type: 'DEPOSIT', amount: '', note: '', correctionReason: '修正录入错误' })
const deleteReason = ref('删除错误录入')

function numericValue(value: unknown) {
  if (value === '' || value == null) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function updateNumeric(key: 'quantity' | 'price' | 'fee' | 'amount', value: number | undefined) {
  editForm[key] = value == null ? '' : String(value)
}

function openEdit(row: any) {
  selectedRow.value = row
  message.value = ''
  Object.assign(editForm, { kind: row.kind, id: row.id, date: row.date, time: row.time, name: row.name, operation: row.operation, quantity: '', price: '', fee: '', reason: '', type: 'DEPOSIT', amount: '', note: '', correctionReason: '修正录入错误' })
  if (row.kind === 'trade') Object.assign(editForm, { quantity: String(row.raw.quantity), price: String(row.raw.price), fee: row.raw.fee == null ? '' : String(row.raw.fee), reason: row.raw.reason || '' })
  else Object.assign(editForm, { type: row.raw.type, amount: String(Math.abs(Number(row.raw.amount))), note: row.raw.note || '' })
  editOpen.value = true
}

function startFunding() {
  selectedRow.value = null
  message.value = ''
  Object.assign(editForm, { kind: 'funding', id: '', date: localDateKey(), time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), name: '资金转入', operation: '资金转入', quantity: '', price: '', fee: '', reason: '', type: 'DEPOSIT', amount: '', note: '', correctionReason: '新增资金流水' })
  editOpen.value = true
}

async function saveEntry() {
  busy.value = true
  message.value = ''
  try {
    if (editForm.kind === 'trade') {
      await api(`/api/trades/${encodeURIComponent(editForm.id)}`, { method: 'PUT', body: JSON.stringify({ date: editForm.date, time: editForm.time, quantity: Number(editForm.quantity), price: Number(editForm.price), fee: editForm.fee === '' ? null : Number(editForm.fee), reason: editForm.reason, correctionReason: editForm.correctionReason }) })
    } else {
      const route = editForm.id ? `/api/funding/${encodeURIComponent(editForm.id)}` : '/api/funding'
      await api(route, { method: editForm.id ? 'PUT' : 'POST', body: JSON.stringify({ date: editForm.date, time: editForm.time, type: editForm.type, amount: Number(editForm.amount), note: editForm.note, correctionReason: editForm.correctionReason }) })
    }
    editOpen.value = false
    toast.success('总账明细已保存', { description: '现金、持仓、成本、总资产和盈亏已从完整总账重新计算。' })
    emit('refresh')
  } catch (error) {
    message.value = error instanceof Error ? error.message : '保存失败'
    toast.error('总账明细保存失败', { description: message.value })
  } finally {
    busy.value = false
  }
}

function requestDelete(row: any) {
  selectedRow.value = row
  deleteReason.value = '删除错误录入'
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!selectedRow.value) return
  busy.value = true
  try {
    const route = selectedRow.value.kind === 'trade' ? `/api/trades/${encodeURIComponent(selectedRow.value.id)}` : `/api/funding/${encodeURIComponent(selectedRow.value.id)}`
    await api(route, { method: 'DELETE', body: JSON.stringify({ reason: deleteReason.value }) })
    deleteOpen.value = false
    toast.success('总账记录已删除', { description: '所有账户数据已重新计算；删除痕迹保留在审计日志中。' })
    emit('refresh')
  } catch (error) {
    toast.error('无法删除这条记录', { description: error instanceof Error ? error.message : '删除失败' })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <PageHeading eyebrow="Capital journey" title="资金轨迹" description="现金与持仓成本由总账推导；持仓市值按最新价计算；总资产始终等于可用现金加持仓市值。"><template #actions><Badge variant="outline">账本截至 {{ dateTime(account.asOf) }}</Badge></template></PageHeading>
  <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard v-for="metric in metrics" :key="metric.label" v-bind="metric" /></section>
  <section class="mt-4 grid gap-4 lg:grid-cols-2">
    <Card class="shadow-none"><CardHeader><CardTitle>入金时间线</CardTitle><CardDescription>按券商资金流水发生时间排序</CardDescription></CardHeader><CardContent class="space-y-2"><Card v-for="item in funding" :key="item.id" class="border-red-100 shadow-none dark:border-red-900/40"><CardHeader><CardDescription>{{ item.date }} {{ item.time }}</CardDescription><CardTitle>{{ item.type === 'DEPOSIT' ? '资金转入' : item.type === 'WITHDRAWAL' ? '资金转出' : '利息入账' }} · {{ Number(item.amount) >= 0 ? '+' : '' }}{{ money(item.amount) }}</CardTitle></CardHeader></Card><Empty v-if="!funding.length"><EmptyHeader><EmptyTitle>尚无入出金记录</EmptyTitle><EmptyDescription>导入券商资金流水后会显示在这里。</EmptyDescription></EmptyHeader></Empty></CardContent></Card>
    <Card class="shadow-none"><CardHeader><CardTitle>投入与当前资产</CardTitle><CardDescription>账户资金桥，不代表单笔交易收益</CardDescription></CardHeader><CardContent class="space-y-6"><div v-for="item in bars" :key="item.label"><div class="mb-2 flex items-center justify-between"><span>{{ item.label }}</span><strong>{{ money(item.value) }}</strong></div><Progress class="bg-red-100 [&>div]:bg-red-600 dark:bg-red-950/40" :model-value="item.value / maxValue * 100" /></div><MetricCard label="从累计投入到当前资产" :value="`${money(account.netContributions)} → ${money(account.totalAssets)}`" :detail="`累计${Number(account.cumulativePnl) >= 0 ? '盈利' : '亏损'} ${money(Math.abs(account.cumulativePnl || 0))}`" /></CardContent></Card>
  </section>
  <Card class="mt-4 shadow-none">
    <CardHeader>
      <div class="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>年度资金明细 · 账户总账</CardTitle><CardDescription>这张表是账户资金的唯一事实源；点击任意一行可修改，保存后所有账户数据自动重算</CardDescription></div><div class="flex flex-wrap gap-2"><Button variant="outline" @click="emit('navigate', 'intraday')"><Plus class="size-4" />新增成交</Button><Button @click="startFunding"><Plus class="size-4" />新增资金流水</Button></div></div>
    </CardHeader>
    <CardContent>
      <LedgerDataTable :data="cashRows" @edit="openEdit" @delete="requestDelete" />
    </CardContent>
  </Card>

  <Dialog v-model:open="editOpen">
    <DialogContent class="max-w-3xl">
      <DialogHeader><DialogTitle>{{ editForm.id ? '修改总账明细' : '新增资金流水' }}</DialogTitle><DialogDescription>{{ editForm.kind === 'trade' ? `${editForm.name} · ${editForm.operation}；证券与方向保持不变，其他金额字段可校正。` : '资金转入、转出和利息都会进入账户总账。' }}</DialogDescription></DialogHeader>
      <form class="space-y-4" @submit.prevent="saveEntry">
        <div class="grid gap-4 sm:grid-cols-2"><FieldBlock label="日期"><DatePickerControl v-model="editForm.date" /></FieldBlock><FieldBlock label="时间"><Input v-model="editForm.time" type="time" step="1" required /></FieldBlock></div>
        <template v-if="editForm.kind === 'trade'">
          <div class="grid gap-4 sm:grid-cols-2"><FieldBlock label="证券"><Input :model-value="editForm.name" readonly /></FieldBlock><FieldBlock label="业务类型"><Input :model-value="editForm.operation" readonly /></FieldBlock></div>
          <div class="grid gap-4 sm:grid-cols-3"><FieldBlock label="数量（股）"><NumberField :model-value="numericValue(editForm.quantity)" :min="1" @update:model-value="value => updateNumeric('quantity', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput required /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="成交单价（元）"><NumberField :model-value="numericValue(editForm.price)" :min="0.001" :step="0.001" @update:model-value="value => updateNumeric('price', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput required /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="交易费用（元，可留空）"><NumberField :model-value="numericValue(editForm.fee)" :min="0" :step="0.01" @update:model-value="value => updateNumeric('fee', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock></div>
          <FieldBlock label="原交易说明"><Textarea v-model="editForm.reason" /></FieldBlock>
        </template>
        <template v-else>
          <div class="grid gap-4 sm:grid-cols-2"><FieldBlock label="资金类型"><Select v-model="editForm.type"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="DEPOSIT">资金转入</SelectItem><SelectItem value="WITHDRAWAL">资金转出</SelectItem><SelectItem value="INTEREST">利息入账</SelectItem></SelectContent></Select></FieldBlock><FieldBlock label="金额（元）"><NumberField :model-value="numericValue(editForm.amount)" :min="0.01" :step="0.01" @update:model-value="value => updateNumeric('amount', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput required /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock></div>
          <FieldBlock label="备注"><Textarea v-model="editForm.note" /></FieldBlock>
        </template>
        <FieldBlock v-if="editForm.id" label="修改原因" hint="修改前后的内容都会保留在审计日志"><Input v-model="editForm.correctionReason" required /></FieldBlock>
        <Alert v-if="message" variant="destructive"><AlertTitle>总账明细暂未保存</AlertTitle><AlertDescription>{{ message }}</AlertDescription></Alert>
        <DialogFooter><Button type="button" variant="outline" @click="editOpen = false">取消</Button><Button type="submit" :disabled="busy">保存并重算账户</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="deleteOpen">
    <DialogContent>
      <DialogHeader><DialogTitle>删除这条总账记录？</DialogTitle><DialogDescription>删除 {{ selectedRow?.name }}（{{ selectedRow?.date }} {{ selectedRow?.time }}）后，系统会从第一条流水重新计算整个账户；若导致卖出数量超过持仓，删除会被拒绝。</DialogDescription></DialogHeader>
      <FieldBlock label="删除原因"><Input v-model="deleteReason" required /></FieldBlock>
      <DialogFooter><Button variant="outline" @click="deleteOpen = false">取消</Button><Button variant="destructive" :disabled="busy" @click="confirmDelete">确认删除并重算</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
