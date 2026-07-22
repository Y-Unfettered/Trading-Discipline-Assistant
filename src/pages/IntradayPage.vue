<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowUpRight, CheckCircle2, CircleAlert, ClipboardCheck, Eye, Save, ShieldAlert } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import PageHeading from '@/components/app/PageHeading.vue'
import FieldBlock from '@/components/app/FieldBlock.vue'
import DatePickerControl from '@/components/app/DatePickerControl.vue'
import StockPicker, { type StockOption } from '@/components/app/StockPicker.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { NumberField, NumberFieldContent, NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api, localDateKey, planLabel } from '@/lib/trade-api'

const props = defineProps<{ store: Record<string, any>; dashboard: Record<string, any> }>()
const emit = defineEmits<{ refresh: []; navigate: [page: string] }>()
const busy = ref(false)
const message = ref('')
const tradeDialogOpen = ref(false)
const detailDialogOpen = ref(false)
const selectedRule = ref<any>(null)
const selectedTradeAsset = ref<any>(null)
const selectedStock = ref<StockOption | null>(null)
const nowTime = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const blankTrade = () => ({ date: localDateKey(), time: nowTime(), side: 'SELL', holdingCode: '', code: '', name: '', quantity: '', price: '', fee: '', executionStatus: 'followed', reason: '', ruleTrigger: '', adjustmentReason: '', emotion: '' })
const form = reactive(blankTrade())
const plan = computed(() => props.dashboard?.plan)
const universe = computed(() => {
  const map = new Map<string, any>()
  for (const item of props.store?.holdings || []) map.set(String(item.code), { ...item, holding: true })
  for (const item of (props.store?.plannedAssets || []).filter((row: any) => row.status !== 'archived')) map.set(String(item.code), { ...(map.get(String(item.code)) || {}), ...item })
  return [...map.values()]
})
const actionCards = computed(() => {
  const planned = (plan.value?.rules || []).map((rule: any) => {
    const asset = universe.value.find(item => String(item.code) === String(rule.code))
    return { ...asset, code: String(rule.code), name: rule.name || asset?.name || rule.code, rule, holding: Boolean(asset?.holding), unplannedHolding: false }
  })
  const plannedCodes = new Set(planned.map((item: any) => String(item.code)))
  const uncoveredHoldings = (props.store?.holdings || [])
    .filter((holding: any) => !plannedCodes.has(String(holding.code)))
    .map((holding: any) => ({ ...holding, holding: true, unplannedHolding: true, rule: null }))
  return [...planned, ...uncoveredHoldings]
})

watch(() => form.holdingCode, code => {
  const holding = (props.store?.holdings || []).find((item: any) => String(item.code) === code)
  if (holding) { form.code = holding.code; form.name = holding.name }
})
watch(() => form.side, side => {
  if (side !== 'BUY') return
  form.holdingCode = ''
  selectedStock.value = selectedTradeAsset.value?.code
    ? { code: String(selectedTradeAsset.value.code), name: selectedTradeAsset.value.name, market: selectedTradeAsset.value.market }
    : null
})
watch(selectedStock, stock => {
  if (form.side !== 'BUY') return
  form.code = stock?.code || ''
  form.name = stock?.name || ''
})

function numericValue(value: unknown) {
  if (value === '' || value == null) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}
function updateNumeric(key: 'quantity' | 'price' | 'fee', value: number | undefined) {
  form[key] = value == null ? '' : String(value)
}
function directionLabel(direction: unknown) {
  return ({ long: '做多 / 持有', reduce: '减仓 / 退出', observe: '仅观察' } as Record<string, string>)[String(direction || '')] || '方向未设'
}
function valueOrFallback(value: unknown, fallback = '未设置，盘中自行判断') {
  return String(value || '').trim() || fallback
}
function riskSummary(rule: any) {
  const parts = []
  if (Number(rule?.maxPositionPct) > 0) parts.push(`仓位≤${rule.maxPositionPct}%`)
  if (Number(rule?.maxRiskPct) > 0) parts.push(`风险≤${rule.maxRiskPct}%`)
  if (Number(rule?.stopPrice) > 0) parts.push(`止损价 ${rule.stopPrice}`)
  return parts
}
function openRuleDetail(card: any) {
  if (!card.rule) {
    emit('navigate', 'plan')
    return
  }
  selectedRule.value = card
  detailDialogOpen.value = true
}
function openTradeDialog(card?: any) {
  selectedTradeAsset.value = card || null
  Object.assign(form, blankTrade())
  selectedStock.value = null
  message.value = ''
  if (card) {
    form.side = card.holding ? 'SELL' : 'BUY'
    form.holdingCode = card.holding ? String(card.code) : ''
    form.code = String(card.code)
    form.name = card.name
    if (!card.holding) selectedStock.value = { code: String(card.code), name: card.name, market: card.market }
    form.ruleTrigger = card.rule?.triggerCondition || card.rule?.wait || ''
  }
  tradeDialogOpen.value = true
}

async function saveTrade() {
  busy.value = true
  message.value = ''
  try {
    if (form.side === 'BUY' && !selectedStock.value?.code) throw new Error('请先从股票匹配下拉列表中选择正确的证券')
    const result = await api<any>('/api/trades', { method: 'POST', body: JSON.stringify({ date: form.date, time: form.time, code: form.code, name: form.name || form.code, side: form.side, quantity: Number(form.quantity), price: Number(form.price), fee: form.fee === '' ? null : Number(form.fee), reason: form.reason, ruleTrigger: form.ruleTrigger, adjustmentReason: form.adjustmentReason, emotion: form.emotion, planFollowed: form.executionStatus === 'followed', executionStatus: form.executionStatus }) })
    const summary = `成交已保存${result.trade?.planVersion ? `，已绑定计划 V${result.trade.planVersion}` : '，未绑定有效计划'}${result.trade?.violations?.length ? `；触发：${result.trade.violations.join('、')}` : ''}`
    toast.success('实际成交已记录', { description: summary, duration: 8000 })
    tradeDialogOpen.value = false
    Object.assign(form, blankTrade())
    selectedTradeAsset.value = null
    selectedStock.value = null
    emit('refresh')
  } catch (error) {
    message.value = error instanceof Error ? error.message : '保存失败'
    toast.error('成交保存失败', { description: message.value })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <PageHeading eyebrow="Execution only" title="盘中行动卡" :description="planLabel(plan)">
    <template #meta><Badge variant="outline">默认不显示实时行情</Badge></template>
    <template #actions><Button type="button" @click="openTradeDialog()"><ClipboardCheck class="size-4" />记录实际成交</Button></template>
  </PageHeading>

  <Alert v-if="!plan || plan.status !== 'active'" variant="destructive" class="mb-4"><CircleAlert class="size-4" /><AlertTitle>当前没有已确认生效的计划</AlertTitle><AlertDescription>先在“下一交易日计划”中完成确认，才能把规则作为执行依据。</AlertDescription><Button class="mt-3" size="sm" variant="outline" @click="emit('navigate', 'plan')">前往确认计划</Button></Alert>

  <section v-else class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
    <Card v-for="card in actionCards" :key="card.code" role="button" tabindex="0" class="flex h-full flex-col shadow-none hover:border-red-300 focus-visible:border-red-400" @click="openRuleDetail(card)" @keydown.enter.self="openRuleDetail(card)" @keydown.space.self.prevent="openRuleDetail(card)">
      <CardHeader class="space-y-3 pb-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0"><CardDescription>{{ card.code }} · {{ card.unplannedHolding ? '当前持仓未被计划覆盖' : `计划 V${plan.version}` }}</CardDescription><CardTitle class="mt-1 text-lg">{{ card.name }}</CardTitle></div>
          <Badge :variant="card.unplannedHolding ? 'destructive' : 'secondary'">{{ card.holding ? `${card.quantity || 0} 股` : '候选' }}</Badge>
        </div>
        <div class="flex flex-wrap gap-2"><Badge variant="outline">{{ card.unplannedHolding ? '计划外持仓' : directionLabel(card.rule?.direction) }}</Badge><Badge v-if="card.rule?.allowedActions" variant="outline">{{ card.rule.allowedActions }}</Badge></div>
      </CardHeader>
      <CardContent class="flex-1 space-y-3 pb-3">
        <div><p class="text-xs font-semibold text-red-600">关键执行条件</p><p class="mt-1 line-clamp-2 text-sm leading-6">{{ card.unplannedHolding ? '这只持仓来自计划外成交，当前没有可引用的盘前规则；请先补充风险与退出条件。' : valueOrFallback(card.rule?.triggerCondition || card.rule?.wait) }}</p></div>
        <div v-if="riskSummary(card.rule).length" class="flex flex-wrap gap-2"><Badge v-for="item in riskSummary(card.rule)" :key="item" variant="secondary">{{ item }}</Badge></div>
        <div><p class="text-xs font-semibold text-muted-foreground">信息不足时</p><p class="mt-1 line-clamp-1 text-sm">{{ valueOrFallback(card.rule?.defaultAction, '默认观望，不新增风险') }}</p></div>
      </CardContent>
      <CardFooter class="gap-2 border-t pt-3">
        <Button v-if="card.rule" type="button" size="sm" variant="outline" @click.stop="openRuleDetail(card)"><Eye class="size-4" />完整计划</Button>
        <Button v-else type="button" size="sm" variant="outline" @click.stop="emit('navigate', 'plan')"><CircleAlert class="size-4" />补充计划</Button>
        <Button type="button" size="sm" @click.stop="openTradeDialog(card)"><ClipboardCheck class="size-4" />记录成交</Button>
      </CardFooter>
    </Card>
    <Empty v-if="!actionCards.length" class="col-span-full"><EmptyHeader><EmptyTitle>当前计划没有标的</EmptyTitle><EmptyDescription>请回到下一交易日计划添加交易标的。</EmptyDescription></EmptyHeader></Empty>
  </section>

  <Dialog v-model:open="detailDialogOpen">
    <DialogScrollContent class="max-w-5xl">
      <DialogHeader>
        <DialogTitle>{{ selectedRule?.name }} · 完整盘中计划</DialogTitle>
        <DialogDescription>{{ selectedRule?.code }} · {{ planLabel(plan) }}</DialogDescription>
      </DialogHeader>
      <template v-if="selectedRule?.rule">
        <div class="flex flex-wrap gap-2"><Badge>{{ directionLabel(selectedRule.rule.direction) }}</Badge><Badge variant="outline">允许动作：{{ valueOrFallback(selectedRule.rule.allowedActions, '未限制') }}</Badge><Badge v-for="item in riskSummary(selectedRule.rule)" :key="item" variant="secondary">{{ item }}</Badge></div>

        <div class="grid gap-3 lg:grid-cols-2">
          <Card class="shadow-none"><CardHeader><CardTitle class="text-base">日期总原则</CardTitle></CardHeader><CardContent class="space-y-3 text-sm"><div><p class="font-medium">我的市场判断</p><p class="mt-1 leading-6 text-muted-foreground">{{ valueOrFallback(plan.userMarketView) }}</p></div><div><p class="font-medium">系统市场整理</p><p class="mt-1 leading-6 text-muted-foreground">{{ valueOrFallback(plan.systemMarketView) }}</p></div><div><p class="font-medium">账户级限制</p><p class="mt-1 leading-6 text-muted-foreground">{{ valueOrFallback(plan.accountRules) }}</p></div></CardContent></Card>
          <Card class="shadow-none"><CardHeader><CardTitle class="text-base">动作与风险</CardTitle></CardHeader><CardContent class="space-y-3 text-sm"><div><p class="font-medium">触发条件</p><p class="mt-1 leading-6 text-muted-foreground">{{ valueOrFallback(selectedRule.rule.triggerCondition || selectedRule.rule.wait) }}</p></div><div><p class="font-medium">减仓条件</p><p class="mt-1 leading-6 text-muted-foreground">{{ valueOrFallback(selectedRule.rule.reduceCondition || selectedRule.rule.sell) }}</p></div><div><p class="font-medium">止损 / 退出条件</p><p class="mt-1 leading-6 text-muted-foreground">{{ valueOrFallback(selectedRule.rule.exitCondition || selectedRule.rule.stop) }}</p></div></CardContent></Card>
        </div>

        <Card class="shadow-none"><CardHeader><CardTitle class="text-base">三种情景</CardTitle></CardHeader><CardContent class="grid gap-3 lg:grid-cols-3"><div class="rounded-lg border p-3"><p class="text-sm font-semibold">基准情景</p><p class="mt-2 text-sm leading-6 text-muted-foreground">{{ valueOrFallback(selectedRule.rule.baseScenario) }}</p></div><div class="rounded-lg border p-3"><p class="text-sm font-semibold">乐观情景</p><p class="mt-2 text-sm leading-6 text-muted-foreground">{{ valueOrFallback(selectedRule.rule.bullScenario) }}</p></div><div class="rounded-lg border p-3"><p class="text-sm font-semibold">悲观情景</p><p class="mt-2 text-sm leading-6 text-muted-foreground">{{ valueOrFallback(selectedRule.rule.bearScenario) }}</p></div></CardContent></Card>

        <Card class="shadow-none"><CardHeader><CardTitle class="text-base">执行边界</CardTitle></CardHeader><CardContent class="grid gap-3 sm:grid-cols-2"><div><p class="text-sm font-medium">当日禁止事项</p><p class="mt-1 text-sm leading-6 text-muted-foreground">{{ valueOrFallback(selectedRule.rule.forbidden, '未设置') }}</p></div><div><p class="text-sm font-medium">计划失效条件</p><p class="mt-1 text-sm leading-6 text-muted-foreground">{{ valueOrFallback(selectedRule.rule.invalidationCondition, '未设置') }}</p></div><div><p class="text-sm font-medium">信息不足默认动作</p><p class="mt-1 text-sm leading-6 text-muted-foreground">{{ valueOrFallback(selectedRule.rule.defaultAction, '默认观望，不新增风险') }}</p></div><div><p class="text-sm font-medium">允许微调范围</p><p class="mt-1 text-sm leading-6 text-muted-foreground">{{ valueOrFallback(selectedRule.rule.flexibleRange, '未设置') }}</p></div></CardContent></Card>
      </template>
      <DialogFooter><Button type="button" variant="outline" @click="detailDialogOpen = false">关闭</Button><Button type="button" @click="detailDialogOpen = false; openTradeDialog(selectedRule)"><ArrowUpRight class="size-4" />记录这只股票的成交</Button></DialogFooter>
    </DialogScrollContent>
  </Dialog>

  <Dialog v-model:open="tradeDialogOpen">
    <DialogScrollContent class="max-w-4xl">
      <DialogHeader><DialogTitle>记录一笔实际成交</DialogTitle><DialogDescription>时间默认取当前系统时间；保存时会绑定当前生效计划，并检查已经填写的动作、仓位和风险边界。</DialogDescription></DialogHeader>
      <form class="space-y-4" @submit.prevent="saveTrade">
        <Alert v-if="selectedTradeAsset"><CheckCircle2 class="size-4" /><AlertTitle>已带入 {{ selectedTradeAsset.name }}</AlertTitle><AlertDescription>{{ selectedTradeAsset.code }} · {{ selectedTradeAsset.holding ? '当前持仓，默认卖出' : '候选标的，默认买入' }}；你仍可在下面调整。</AlertDescription></Alert>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><FieldBlock label="日期"><DatePickerControl v-model="form.date" /></FieldBlock><FieldBlock label="时间"><Input v-model="form.time" type="time" step="1" class="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none" required /></FieldBlock><FieldBlock label="方向"><Select v-model="form.side"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SELL">卖出</SelectItem><SelectItem value="BUY">买入</SelectItem></SelectContent></Select></FieldBlock><FieldBlock label="计划执行状态"><Select v-model="form.executionStatus"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="followed">按计划执行</SelectItem><SelectItem value="delayed">触发后延迟</SelectItem><SelectItem value="unplanned">计划外操作</SelectItem></SelectContent></Select></FieldBlock></div>
        <div v-if="form.side === 'SELL'" class="grid gap-4 sm:grid-cols-2"><FieldBlock label="选择当前持仓"><Select v-model="form.holdingCode"><SelectTrigger><SelectValue placeholder="请选择要卖出的股票" /></SelectTrigger><SelectContent><SelectItem v-for="holding in store?.holdings || []" :key="holding.code" :value="String(holding.code)">{{ holding.name }}（{{ holding.code }}）· 可卖 {{ holding.quantity }} 股</SelectItem></SelectContent></Select></FieldBlock><FieldBlock label="股票代码"><Input v-model="form.code" readonly /></FieldBlock></div>
        <div v-else class="grid gap-4 sm:grid-cols-2"><FieldBlock label="搜索并选择股票"><StockPicker v-model="selectedStock" /></FieldBlock><FieldBlock label="股票代码" hint="选择股票后自动绑定，不需要手工输入"><Input v-model="form.code" readonly required placeholder="选择股票后自动出现" /></FieldBlock></div>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><FieldBlock label="数量（股）"><NumberField :model-value="numericValue(form.quantity)" :min="1" @update:model-value="value => updateNumeric('quantity', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput required /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="成交价"><NumberField :model-value="numericValue(form.price)" :min="0.001" :step="0.001" @update:model-value="value => updateNumeric('price', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput required /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="费用（可后补）"><NumberField :model-value="numericValue(form.fee)" :min="0" :step="0.01" @update:model-value="value => updateNumeric('fee', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock></div>
        <FieldBlock label="当时的客观触发事实"><Textarea v-model="form.reason" required placeholder="哪条条件触发了？不要用结果解释决策" /></FieldBlock><FieldBlock label="对应计划触发条件"><Input v-model="form.ruleTrigger" /></FieldBlock><FieldBlock label="偏离或临时调整原因"><Input v-model="form.adjustmentReason" /></FieldBlock><FieldBlock label="情绪备注"><Input v-model="form.emotion" placeholder="平静 / 犹豫 / 怕踏空 / 想回本" /></FieldBlock>
        <Alert v-if="message" variant="destructive"><ShieldAlert class="size-4" /><AlertTitle>成交暂未保存</AlertTitle><AlertDescription>{{ message }}</AlertDescription></Alert>
        <DialogFooter><Button type="button" variant="outline" @click="tradeDialogOpen = false">取消</Button><Button type="submit" :disabled="busy"><Save class="size-4" />保存成交并检查纪律</Button></DialogFooter>
      </form>
    </DialogScrollContent>
  </Dialog>
</template>
