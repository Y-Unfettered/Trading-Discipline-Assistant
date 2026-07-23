<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowUpRight, CheckCircle2, CircleAlert, ClipboardCheck, Eye, ListChecks, Save, ShieldAlert } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import PageHeading from '@/components/app/PageHeading.vue'
import FieldBlock from '@/components/app/FieldBlock.vue'
import DatePickerControl from '@/components/app/DatePickerControl.vue'
import StockPicker, { type StockOption } from '@/components/app/StockPicker.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
const disciplinePreview = ref<any>(null)
const nowTime = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const blankTrade = () => ({ date: localDateKey(), time: nowTime(), side: 'SELL', holdingCode: '', code: '', name: '', quantity: '', price: '', fee: '', executionStatus: 'followed', reason: '', ruleTrigger: '', adjustmentReason: '', emotion: '', tradeIntent: 'reduce', riskEffect: 'reduce', thesisStatus: 'unknown', trendState: 'unknown', triggerSatisfied: 'unknown', withinTolerance: 'unknown', stopChange: 'not_applicable', factsLinked: false, newInfoVerified: false, emotionState: 'calm', actualPositionPct: '', actualRiskPct: '' })
const form = reactive(blankTrade())
const plan = computed(() => props.dashboard?.plan)
const latestResearch = computed(() => [...(props.store?.researchSnapshots || [])].sort((a: any, b: any) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null)
const technicalByCode = computed(() => new Map((latestResearch.value?.holdingsTechnical || []).map((item: any) => [String(item.code), item])))
const universe = computed(() => {
  const map = new Map<string, any>()
  for (const item of props.store?.holdings || []) map.set(String(item.code), { ...item, holding: true })
  for (const item of (props.store?.plannedAssets || []).filter((row: any) => row.status !== 'archived')) map.set(String(item.code), { ...(map.get(String(item.code)) || {}), ...item })
  return [...map.values()]
})
const actionCards = computed(() => {
  const planned = (plan.value?.rules || []).map((rule: any) => {
    const asset = universe.value.find(item => String(item.code) === String(rule.code))
    return { ...asset, code: String(rule.code), name: rule.name || asset?.name || rule.code, rule, technical: technicalByCode.value.get(String(rule.code)), holding: Boolean(asset?.holding), unplannedHolding: false }
  })
  const plannedCodes = new Set(planned.map((item: any) => String(item.code)))
  const uncoveredHoldings = (props.store?.holdings || [])
    .filter((holding: any) => !plannedCodes.has(String(holding.code)))
    .map((holding: any) => ({ ...holding, technical: technicalByCode.value.get(String(holding.code)), holding: true, unplannedHolding: true, rule: null }))
  return [...planned, ...uncoveredHoldings]
})

watch(() => form.holdingCode, code => {
  const holding = (props.store?.holdings || []).find((item: any) => String(item.code) === code)
  if (holding) { form.code = holding.code; form.name = holding.name }
})
watch(() => form.side, side => {
  form.tradeIntent = side === 'BUY' ? 'add' : 'reduce'
  form.riskEffect = side === 'BUY' ? 'increase' : 'reduce'
  form.stopChange = side === 'BUY' ? 'unchanged' : 'not_applicable'
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
function updateNumeric(key: 'quantity' | 'price' | 'fee' | 'actualPositionPct' | 'actualRiskPct', value: number | undefined) {
  form[key] = value == null ? '' : String(value)
}
function optionalBoolean(value: string) {
  return value === 'yes' ? true : value === 'no' ? false : null
}
function disciplineMissingLabel(value: string) {
  return ({
    'record.reviewComplete': '盘后逐笔复盘',
    'plan.active': '有效计划状态',
    'execution.triggerSatisfied': '触发条件是否成立',
    'risk.positionWithinLimit': '成交后仓位是否在上限内',
    'risk.tradeRiskWithinLimit': '实际风险是否在上限内',
  } as Record<string, string>)[value] || value
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
function evidenceStatus(card: any) {
  if (card.unplannedHolding) return '未建立执行规则'
  if (card.researchUnknowns || card.researchWarnings) return '公司逻辑待核验'
  if (card.researchAsOf || card.fundamentalView || card.aiResearchSummary) return '已有研究，按失效条件管理'
  return '公司证据不足'
}
function trendStatus(card: any) {
  return card.technical?.structure || '技术状态未刷新'
}
function currentRiskStatus(card: any) {
  if (!card.holding) return '当前无持仓'
  const totalAssets = Number(props.dashboard?.account?.totalAssets || 0)
  const price = Number(card.lastPrice || card.technical?.close || 0)
  const pct = totalAssets > 0 && price > 0 ? Number(card.quantity || 0) * price / totalAssets * 100 : null
  const limit = Number(card.rule?.maxPositionPct || 0)
  if (pct == null) return '仓位比例待核对'
  return `${pct.toFixed(2)}%${limit ? ` / 上限 ${limit}%` : ' / 未设上限'}`
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
  disciplinePreview.value = null
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

function tradePayload() {
  return {
    date: form.date,
    time: form.time,
    code: form.code,
    name: form.name || form.code,
    side: form.side,
    quantity: Number(form.quantity),
    price: Number(form.price),
    fee: form.fee === '' ? null : Number(form.fee),
    reason: form.reason,
    ruleTrigger: form.ruleTrigger,
    adjustmentReason: form.adjustmentReason,
    emotion: form.emotion,
    planFollowed: form.executionStatus === 'followed',
    executionStatus: form.executionStatus,
    tradeIntent: form.tradeIntent,
    riskEffect: form.riskEffect,
    thesisStatus: form.thesisStatus,
    trendState: form.trendState,
    triggerSatisfied: optionalBoolean(form.triggerSatisfied),
    withinTolerance: optionalBoolean(form.withinTolerance),
    stopChange: form.stopChange,
    factsLinked: form.factsLinked,
    newInfoVerified: form.newInfoVerified,
    emotionState: form.emotionState,
    actualPositionPct: form.actualPositionPct === '' ? null : Number(form.actualPositionPct),
    actualRiskPct: form.actualRiskPct === '' ? null : Number(form.actualRiskPct),
  }
}
async function fetchDisciplinePreview() {
  if (form.side === 'BUY' && !selectedStock.value?.code) throw new Error('请先从股票匹配下拉列表中选择正确的证券')
  const result = await api<any>('/api/trades/discipline-preview', { method: 'POST', body: JSON.stringify(tradePayload()) })
  disciplinePreview.value = result.result
  return result.result
}
async function previewTrade() {
  busy.value = true
  message.value = ''
  try {
    const result = await fetchDisciplinePreview()
    toast.success('即时纪律检查已完成', { description: `记录完整度 ${result.completeness}%；正式评分将在盘后补齐复盘后生成。` })
  } catch (error) {
    message.value = error instanceof Error ? error.message : '纪律检查失败'
  } finally {
    busy.value = false
  }
}

async function saveTrade() {
  busy.value = true
  message.value = ''
  try {
    await fetchDisciplinePreview()
    const result = await api<any>('/api/trades', { method: 'POST', body: JSON.stringify(tradePayload()) })
    const preview = result.disciplinePreview
    const summary = `成交已保存${result.trade?.planVersion ? `，已绑定计划 V${result.trade.planVersion}` : '，未绑定有效计划'}；纪律记录完整度 ${preview?.completeness ?? 0}%${result.trade?.violations?.length ? `；触发：${result.trade.violations.join('、')}` : ''}`
    toast.success('实际成交已记录', { description: summary, duration: 8000 })
    tradeDialogOpen.value = false
    Object.assign(form, blankTrade())
    selectedTradeAsset.value = null
    selectedStock.value = null
    disciplinePreview.value = null
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
  <PageHeading eyebrow="Conditional boundaries" title="盘中执行边界" :description="`${planLabel(plan)} · 只显示条件、边界与失效，不预测当日涨跌`">
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
        <div class="flex flex-wrap gap-2"><Badge variant="outline">{{ card.unplannedHolding ? '计划外持仓' : directionLabel(card.rule?.direction) }}</Badge><Badge variant="secondary">{{ evidenceStatus(card) }}</Badge><Badge variant="outline">{{ trendStatus(card) }}</Badge></div>
      </CardHeader>
      <CardContent class="flex-1 space-y-3 pb-3">
        <div><p class="text-xs font-semibold text-red-600">关键执行条件</p><p class="mt-1 line-clamp-2 text-sm leading-6">{{ card.unplannedHolding ? '这只持仓来自计划外成交，当前没有可引用的盘前规则；请先补充风险与退出条件。' : valueOrFallback(card.rule?.triggerCondition || card.rule?.wait) }}</p></div>
        <div><p class="text-xs font-semibold text-muted-foreground">当前仓位风险</p><p class="mt-1 text-sm">{{ currentRiskStatus(card) }}</p></div>
        <div><p class="text-xs font-semibold text-muted-foreground">允许动作</p><p class="mt-1 line-clamp-1 text-sm">{{ valueOrFallback(card.rule?.allowedActions, '未明确允许动作') }}</p></div>
        <div><p class="text-xs font-semibold text-muted-foreground">禁止 / 失效</p><p class="mt-1 line-clamp-2 text-sm">{{ valueOrFallback(card.rule?.forbidden || card.rule?.invalidationCondition, '尚未设置，不能新增风险') }}</p></div>
        <div><p class="text-xs font-semibold text-muted-foreground">信息不足时</p><p class="mt-1 line-clamp-1 text-sm">{{ valueOrFallback(card.rule?.defaultAction, '默认观望，不新增风险') }}</p></div>
      </CardContent>
      <CardFooter class="gap-2 border-t pt-3">
        <Button v-if="card.rule" type="button" size="sm" variant="outline" @click.stop="openRuleDetail(card)"><Eye class="size-4" />完整边界</Button>
        <Button v-else type="button" size="sm" variant="outline" @click.stop="emit('navigate', 'plan')"><CircleAlert class="size-4" />补充计划</Button>
        <Button type="button" size="sm" @click.stop="openTradeDialog(card)"><ClipboardCheck class="size-4" />记录成交</Button>
      </CardFooter>
    </Card>
    <Empty v-if="!actionCards.length" class="col-span-full"><EmptyHeader><EmptyTitle>当前计划没有标的</EmptyTitle><EmptyDescription>请回到下一交易日计划添加交易标的。</EmptyDescription></EmptyHeader></Empty>
  </section>

  <Dialog v-model:open="detailDialogOpen">
    <DialogScrollContent class="max-w-5xl">
      <DialogHeader>
        <DialogTitle>{{ selectedRule?.name }} · 完整执行边界</DialogTitle>
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

        <Card class="shadow-none">
          <CardHeader><CardTitle class="flex items-center gap-2 text-base"><ListChecks class="size-4" />成交时纪律快照</CardTitle><CardDescription>记录成交当时的状态，不用盘后结果反推理由。</CardDescription></CardHeader>
          <CardContent class="space-y-4">
            <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <FieldBlock label="风险变化"><Select v-model="form.riskEffect"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="increase">新增风险</SelectItem><SelectItem value="reduce">降低风险</SelectItem><SelectItem value="neutral">风险基本不变</SelectItem></SelectContent></Select></FieldBlock>
              <FieldBlock label="操作意图"><Select v-model="form.tradeIntent"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">新建仓位</SelectItem><SelectItem value="add">加仓</SelectItem><SelectItem value="reduce">减仓</SelectItem><SelectItem value="exit">退出</SelectItem><SelectItem value="t_buy">做T买入腿</SelectItem><SelectItem value="t_sell">做T卖出腿</SelectItem></SelectContent></Select></FieldBlock>
              <FieldBlock label="长期逻辑"><Select v-model="form.thesisStatus"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="valid">仍然有效</SelectItem><SelectItem value="uncertain">待验证</SelectItem><SelectItem value="invalidated">已经失效</SelectItem><SelectItem value="unknown">尚未判断</SelectItem></SelectContent></Select></FieldBlock>
              <FieldBlock label="短期状态"><Select v-model="form.trendState"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="up">上升 / 改善</SelectItem><SelectItem value="sideways">震荡</SelectItem><SelectItem value="down">下跌</SelectItem><SelectItem value="rapid_down">急跌 / 波动扩大</SelectItem><SelectItem value="unknown">尚未判断</SelectItem></SelectContent></Select></FieldBlock>
              <FieldBlock label="触发条件已成立"><Select v-model="form.triggerSatisfied"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">是</SelectItem><SelectItem value="no">否</SelectItem><SelectItem value="unknown">未核实</SelectItem></SelectContent></Select></FieldBlock>
              <FieldBlock label="价格数量在容差内"><Select v-model="form.withinTolerance"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">是</SelectItem><SelectItem value="no">否</SelectItem><SelectItem value="unknown">未核实</SelectItem></SelectContent></Select></FieldBlock>
              <FieldBlock label="退出条件变化"><Select v-model="form.stopChange"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unchanged">未改变</SelectItem><SelectItem value="tightened">已经收紧</SelectItem><SelectItem value="loosened">已经放宽</SelectItem><SelectItem value="not_applicable">不适用</SelectItem></SelectContent></Select></FieldBlock>
              <FieldBlock label="当时情绪"><Select v-model="form.emotionState"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="calm">平静</SelectItem><SelectItem value="hesitant">犹豫</SelectItem><SelectItem value="fomo">怕踏空 / 追涨</SelectItem><SelectItem value="panic">恐慌</SelectItem><SelectItem value="revenge">报复性交易</SelectItem><SelectItem value="recover">想回本</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></FieldBlock>
            </div>
            <div class="grid gap-4 sm:grid-cols-2"><FieldBlock label="成交后仓位（可选，%）" hint="留空时由账本估算"><NumberField :model-value="numericValue(form.actualPositionPct)" :min="0" :max="100" :step="0.01" @update:model-value="value => updateNumeric('actualPositionPct', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="实际风险（可选，%）" hint="留空时按计划止损估算"><NumberField :model-value="numericValue(form.actualRiskPct)" :min="0" :max="100" :step="0.01" @update:model-value="value => updateNumeric('actualRiskPct', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock></div>
            <div class="grid gap-3 sm:grid-cols-2"><div class="flex items-center gap-3 rounded-lg border p-3 text-sm"><Checkbox v-model="form.factsLinked" /><span>理由引用了已保存或可核验的事实</span></div><div class="flex items-center gap-3 rounded-lg border p-3 text-sm"><Checkbox v-model="form.newInfoVerified" /><span>计划外调整具有新事实并已核验</span></div></div>
          </CardContent>
        </Card>

        <FieldBlock label="当时的客观触发事实"><Textarea v-model="form.reason" required placeholder="哪条条件触发了？不要用结果解释决策" /></FieldBlock><FieldBlock label="对应计划触发条件"><Input v-model="form.ruleTrigger" /></FieldBlock><FieldBlock label="偏离或临时调整原因"><Input v-model="form.adjustmentReason" /></FieldBlock><FieldBlock label="情绪备注"><Input v-model="form.emotion" placeholder="补充当时的身体感受、犹豫或紧迫感" /></FieldBlock>
        <Alert v-if="disciplinePreview" :variant="disciplinePreview.events?.some((item: any) => item.severity === 'critical') ? 'destructive' : 'default'"><ListChecks class="size-4" /><AlertTitle>即时纪律检查 · 记录完整度 {{ disciplinePreview.completeness }}%</AlertTitle><AlertDescription><span v-if="disciplinePreview.observedScore != null">当前已观察过程分 {{ disciplinePreview.observedScore }}；</span>正式分将在盘后逐笔复盘完成后生成。<span v-if="disciplinePreview.missingRequired?.length"> 待补：{{ disciplinePreview.missingRequired.map(disciplineMissingLabel).join('、') }}。</span><span v-if="disciplinePreview.events?.length"> 触发：{{ disciplinePreview.events.map((item: any) => item.title).join('、') }}。</span></AlertDescription></Alert>
        <Alert v-if="message" variant="destructive"><ShieldAlert class="size-4" /><AlertTitle>成交暂未保存</AlertTitle><AlertDescription>{{ message }}</AlertDescription></Alert>
        <DialogFooter><Button type="button" variant="outline" @click="tradeDialogOpen = false">取消</Button><Button type="button" variant="outline" :disabled="busy" @click="previewTrade"><ListChecks class="size-4" />预览纪律检查</Button><Button type="submit" :disabled="busy"><Save class="size-4" />保存成交并检查纪律</Button></DialogFooter>
      </form>
    </DialogScrollContent>
  </Dialog>
</template>
