<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { BookOpenCheck, CircleAlert, DatabaseZap, Eye, ListChecks, RefreshCw, ShieldCheck, Sparkles } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import DataTable, { type DataTableColumn } from '@/components/app/DataTable.vue'
import PageHeading from '@/components/app/PageHeading.vue'
import FieldBlock from '@/components/app/FieldBlock.vue'
import DatePickerControl from '@/components/app/DatePickerControl.vue'
import MetricCard from '@/components/app/MetricCard.vue'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogFooter, DialogHeader, DialogScrollContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NumberField, NumberFieldContent, NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { api, dateTime, localDateKey, money } from '@/lib/trade-api'
import FeeEditor from '@/components/app/FeeEditor.vue'

const props = defineProps<{ store: Record<string, any>; dashboard: Record<string, any> }>()
const emit = defineEmits<{ refresh: []; navigate: [page: string] }>()
const busy = ref('')
const reviewDialogOpen = ref(false)
const closeDate = ref(localDateKey())
const review = reactive({ factsCorrection: '', executionEvidence: '', deviationContext: '', correctionRule: '' })
const factor = reactive({ category: '', title: '', source: '', publishedAt: localDateKey(), url: '', impact: '' })
const analyses = ref<any[]>([])
const analysisMessage = ref('')
const assessmentDialogOpen = ref(false)
const selectedTrade = ref<any>(null)
const assessmentPreview = ref<any>(null)
const assessmentForm = reactive({ thesisStatus: 'unknown', trendState: 'unknown', triggerSatisfied: 'unknown', withinTolerance: 'unknown', stopChange: 'not_applicable', factsLinked: false, newInfoVerified: false, emotionState: 'other', actualPositionPct: '', actualRiskPct: '', reviewNote: '', correctionRule: '', outcomeNote: '' })

const close = computed(() => props.dashboard?.latestMarketClose)
const pendingTrades = computed(() => (props.store?.trades || []).filter((trade: any) => trade.fee == null))
const todayTrades = computed(() => (props.store?.trades || []).filter((trade: any) => trade.date === localDateKey()).sort((a: any, b: any) => String(a.time).localeCompare(String(b.time))))
const latestResearch = computed(() => [...(props.store?.researchSnapshots || [])].sort((a: any, b: any) => `${b.reviewDate} ${b.updatedAt || b.createdAt}`.localeCompare(`${a.reviewDate} ${a.updatedAt || a.createdAt}`))[0])
const technicalRows = computed(() => latestResearch.value ? [latestResearch.value.marketTechnical, ...(latestResearch.value.holdingsTechnical || [])].filter(Boolean) : [])
const technicalColumns: DataTableColumn[] = [
  { key: 'stock', label: '标的' },
  { key: 'close', label: '收盘', format: 'decimal', digits: 2 },
  { key: 'ma5', label: 'MA5', format: 'decimal', digits: 2 },
  { key: 'ma10', label: 'MA10', format: 'decimal', digits: 2 },
  { key: 'ma30', label: 'MA30', format: 'decimal', digits: 2 },
  { key: 'ma60', label: 'MA60', format: 'decimal', digits: 2 },
  { key: 'structure', label: '结构' },
]
const technicalTableRows = computed(() => technicalRows.value.map((item: any) => ({ ...item, id: item.code, stock: `${item.name} · ${item.code}` })))
const savedPostmarket = computed(() => props.store?.dailySessions?.[localDateKey()]?.postmarket || null)
const reviewSavedAt = computed(() => savedPostmarket.value?.completedAt || props.store?.dailySessions?.[localDateKey()]?.updatedAt || '')
const reviewCompletedCount = computed(() => ['factsCorrection', 'executionEvidence', 'deviationContext', 'correctionRule'].filter(field => String((review as any)[field] || '').trim()).length)
const latestAssessmentByTrade = computed(() => {
  const map = new Map<string, any>()
  for (const assessment of props.store?.disciplineAssessments || []) if (assessment.tradeId) map.set(String(assessment.tradeId), assessment)
  return map
})
const pendingAssessmentCount = computed(() => todayTrades.value.filter((trade: any) => !Number.isFinite(latestAssessmentByTrade.value.get(String(trade.id))?.result?.score)).length)
function assessmentFor(trade: any) { return latestAssessmentByTrade.value.get(String(trade.id)) }
watch(() => props.store, () => {
  const post = props.store?.dailySessions?.[localDateKey()]?.postmarket || {}; Object.assign(review, { factsCorrection: post.factsCorrection ?? post.narrative ?? '', executionEvidence: post.executionEvidence ?? post.goodDecision ?? '', deviationContext: post.deviationContext ?? post.badDecision ?? '', correctionRule: post.correctionRule ?? post.tomorrowFocus ?? '' })
}, { immediate: true, deep: false })

async function task<T>(name: string, action: () => Promise<T>, success: string) {
  busy.value = name
  try { const value = await action(); toast.success(success); emit('refresh'); return value }
  catch (error) { toast.error('操作失败', { description: error instanceof Error ? error.message : '请稍后重试', duration: 10000 }); return null }
  finally { busy.value = '' }
}
async function refreshClose() { await task('close', () => api('/api/market-close/refresh', { method: 'POST', body: JSON.stringify({ date: closeDate.value }) }), '收盘行情已经刷新') }
async function updateFee(trade: any, fee: string) { await task(`fee-${trade.id}`, () => api(`/api/trades/${encodeURIComponent(trade.id)}/fee`, { method: 'PUT', body: JSON.stringify({ fee: Number(fee) }) }), '费用已经补录') }
async function saveReview() { const result = await task('review', () => api('/api/daily-session', { method: 'PUT', body: JSON.stringify({ date: localDateKey(), session: { postmarket: { ...review, completedAt: new Date().toISOString() } } }) }), '行为证据已保存'); if (result) reviewDialogOpen.value = false }
async function refreshTechnicals() { await task('technicals', () => api('/api/research/technicals', { method: 'POST', body: JSON.stringify({ date: localDateKey() }) }), '市场与持仓均线已刷新') }
async function saveFactor() { const result = await task('factor', () => api('/api/research/external-factors', { method: 'PUT', body: JSON.stringify({ date: localDateKey(), factor }) }), '研究来源已保存'); if (result) Object.assign(factor, { category: '', title: '', source: '', publishedAt: localDateKey(), url: '', impact: '' }) }
async function generatePlan() { const result = await task<any>('generate', () => api('/api/plans/generate-from-review', { method: 'POST', body: JSON.stringify({ date: localDateKey() }) }), '下一交易日计划草稿已生成'); if (result) emit('navigate', 'plan') }
function optionalBoolean(value: string) { return value === 'yes' ? true : value === 'no' ? false : null }
function numericValue(value: unknown) { if (value === '' || value == null) return undefined; const number = Number(value); return Number.isFinite(number) ? number : undefined }
function updateAssessmentNumeric(key: 'actualPositionPct' | 'actualRiskPct', value: number | undefined) { assessmentForm[key] = value == null ? '' : String(value) }
function openAssessment(trade: any) {
  selectedTrade.value = trade
  const prior = latestAssessmentByTrade.value.get(String(trade.id))?.input
  Object.assign(assessmentForm, {
    thesisStatus: prior?.evidence?.thesisStatus || trade.thesisStatus || 'unknown',
    trendState: prior?.evidence?.trendState || trade.trendState || 'unknown',
    triggerSatisfied: (prior?.execution?.triggerSatisfied ?? trade.triggerSatisfied) === true ? 'yes' : (prior?.execution?.triggerSatisfied ?? trade.triggerSatisfied) === false ? 'no' : 'unknown',
    withinTolerance: (prior?.execution?.withinTolerance ?? trade.withinTolerance) === true ? 'yes' : (prior?.execution?.withinTolerance ?? trade.withinTolerance) === false ? 'no' : 'unknown',
    stopChange: trade.stopChange || 'not_applicable',
    factsLinked: prior?.evidence?.factsLinked ?? trade.factsLinked ?? false,
    newInfoVerified: prior?.adjustment?.deviationVerified ?? trade.newInfoVerified ?? false,
    emotionState: trade.emotionState || 'other',
    actualPositionPct: trade.actualPositionPct == null ? '' : String(trade.actualPositionPct),
    actualRiskPct: trade.actualRiskPct == null ? '' : String(trade.actualRiskPct),
    reviewNote: prior?.review?.note || '',
    correctionRule: prior?.review?.correctionRule || review.correctionRule || '',
    outcomeNote: prior?.outcome?.note || '',
  })
  assessmentPreview.value = null
  assessmentDialogOpen.value = true
}
function assessmentOverrides() {
  return {
    reviewComplete: true,
    thesisStatus: assessmentForm.thesisStatus,
    trendState: assessmentForm.trendState,
    triggerSatisfied: optionalBoolean(assessmentForm.triggerSatisfied),
    withinTolerance: optionalBoolean(assessmentForm.withinTolerance),
    stopChange: assessmentForm.stopChange,
    factsLinked: assessmentForm.factsLinked,
    newInfoVerified: assessmentForm.newInfoVerified,
    emotionState: assessmentForm.emotionState,
    actualPositionPct: assessmentForm.actualPositionPct === '' ? null : Number(assessmentForm.actualPositionPct),
    actualRiskPct: assessmentForm.actualRiskPct === '' ? null : Number(assessmentForm.actualRiskPct),
    reviewNote: assessmentForm.reviewNote,
    correctionRule: assessmentForm.correctionRule,
    outcomeNote: assessmentForm.outcomeNote,
  }
}
async function previewAssessment() {
  if (!selectedTrade.value) return null
  busy.value = `assessment-preview-${selectedTrade.value.id}`
  try {
    const result = await api<any>(`/api/trades/${encodeURIComponent(selectedTrade.value.id)}/discipline-preview`, { method: 'POST', body: JSON.stringify(assessmentOverrides()) })
    assessmentPreview.value = result
    return result
  } catch (error) {
    toast.error('正式评分预览失败', { description: error instanceof Error ? error.message : '请检查记录' })
    return null
  } finally { busy.value = '' }
}
async function confirmAssessment() {
  const preview = await previewAssessment()
  if (!preview) return
  if (!Number.isFinite(preview.result?.score)) {
    toast.error('还不能形成正式纪律分', { description: `请补齐：${(preview.result?.missingRequired || []).join('、')}` })
    return
  }
  busy.value = `assessment-save-${selectedTrade.value.id}`
  try {
    await api('/api/discipline-assessments', { method: 'POST', body: JSON.stringify({ input: preview.input, confirmed: true }) })
    toast.success('逐笔正式纪律评估已保存', { description: `${preview.result.score} 分 · ${preview.result.correction}` })
    assessmentDialogOpen.value = false
    emit('refresh')
  } catch (error) {
    toast.error('正式评分保存失败', { description: error instanceof Error ? error.message : '请稍后重试' })
  } finally { busy.value = '' }
}
async function loadAnalyses() { try { analyses.value = (await api<any>('/api/analyses')).analyses || [] } catch {} }
async function exportReview() { const result = await api<any>('/api/review/export', { method: 'POST', body: '{}' }); analysisMessage.value = `复盘包已生成：${result.file}` }
async function runAnalysis() {
  busy.value = 'analysis'; analysisMessage.value = '正在生成纪律分析…'
  try {
    const created = await api<any>('/api/analysis', { method: 'POST', body: '{}' })
    for (let count = 0; count < 150; count += 1) {
      await new Promise(resolve => setTimeout(resolve, 2000)); const status = await api<any>(`/api/analysis/${encodeURIComponent(created.id)}`); analysisMessage.value = status.progress || status.status || '分析中'
      if (['completed', 'failed'].includes(status.status)) { analysisMessage.value = status.status === 'completed' ? '纪律分析已生成并加入历史版本' : status.error || '分析失败'; break }
    }
    await loadAnalyses()
  } catch (error) { analysisMessage.value = error instanceof Error ? error.message : '分析失败' }
  finally { busy.value = '' }
}
onMounted(loadAnalyses)
</script>

<template>
  <PageHeading eyebrow="Verify before review" title="盘后核对与复盘" description="先把成交、费用、收盘价和账户口径核对清楚，再讨论决策。">
    <template #actions><DatePickerControl v-model="closeDate" /><Button variant="outline" :disabled="busy === 'close'" @click="refreshClose"><Spinner v-if="busy === 'close'" /><RefreshCw v-else class="size-4" />补跑收盘行情</Button></template>
  </PageHeading>

  <section class="grid gap-4 lg:grid-cols-2">
    <Card class="shadow-none"><CardHeader><div class="flex items-start justify-between"><div><CardTitle>收盘行情自动任务</CardTitle><CardDescription>交易日 15:35 执行</CardDescription></div><Badge :variant="close?.status === 'failed' ? 'destructive' : 'secondary'">{{ ({ completed: '已完成', partial: '部分成功', failed: '失败', running: '运行中' } as any)[close?.status] || '尚未运行' }}</Badge></div></CardHeader><CardContent class="grid gap-3 sm:grid-cols-3"><MetricCard label="最近快照" :value="close?.date || '无'" /><MetricCard label="抓取成功" :value="close?.quotes?.length || 0" /><MetricCard label="抓取失败" :value="close?.errors?.length || 0" /></CardContent></Card>
    <Card class="shadow-none"><CardHeader><div class="flex items-start justify-between"><div><CardTitle>复盘前待处理</CardTitle><CardDescription>费用缺失会影响账户复盘</CardDescription></div><Badge variant="outline">{{ pendingTrades.length }} 项</Badge></div></CardHeader><CardContent class="space-y-3"><div v-for="trade in pendingTrades" :key="trade.id" class="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-end"><div class="min-w-0 flex-1"><p class="font-medium">{{ trade.date }} {{ trade.time }} · {{ trade.side === 'BUY' ? '买入' : '卖出' }} {{ trade.name }}</p><p class="text-sm text-muted-foreground">{{ trade.quantity }} 股 @ {{ trade.price }}</p></div><FeeEditor :busy="busy === `fee-${trade.id}`" @save="value => updateFee(trade, value)" /></div><p v-if="!pendingTrades.length" class="py-8 text-center text-muted-foreground">成交费用已完整</p></CardContent></Card>
  </section>

  <Card class="mt-4 shadow-none"><CardHeader><CardTitle>系统已锁定的当日事实</CardTitle><CardDescription>成交、收盘、账户和持仓自动汇总</CardDescription></CardHeader><CardContent class="grid gap-3 lg:grid-cols-3"><MetricCard label="当日成交" :value="`${todayTrades.length} 笔`" :detail="todayTrades.map((trade: any) => `${trade.time} ${trade.side === 'BUY' ? '买入' : '卖出'}${trade.name}`).join('；') || '无成交'" /><MetricCard label="收盘账户" :value="money(dashboard?.account?.totalAssets)" :detail="`今日盈亏 ${money(store?.account?.todayPnl)}`" /><MetricCard label="收盘持仓" :value="`${store?.holdings?.length || 0} 只`" :detail="(store?.holdings || []).map((item: any) => `${item.name} ${item.quantity}股`).join('；') || '无持仓'" /></CardContent></Card>

  <Card class="mt-4 shadow-none">
    <CardHeader><div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>逐笔纪律评估</CardTitle><CardDescription>过程结论与盈亏结果分开；补齐记录后确认正式分。</CardDescription></div><Badge :variant="pendingAssessmentCount ? 'destructive' : 'secondary'">{{ pendingAssessmentCount ? `${pendingAssessmentCount} 笔待评估` : '当日逐笔评估已完成' }}</Badge></div></CardHeader>
    <CardContent class="space-y-3">
      <div v-for="trade in todayTrades" :key="trade.id" class="grid gap-4 rounded-lg border p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center">
        <div><p class="font-medium">{{ trade.time }} · {{ trade.side === 'BUY' ? '买入' : '卖出' }} {{ trade.name }}</p><p class="mt-1 text-sm text-muted-foreground">{{ trade.quantity }} 股 @ {{ trade.price }} · {{ trade.riskEffect === 'increase' ? '新增风险' : trade.riskEffect === 'reduce' ? '降低风险' : '风险不变' }}</p></div>
        <div class="rounded-lg border bg-muted/40 p-3"><p class="text-xs text-muted-foreground">过程结论</p><template v-if="Number.isFinite(assessmentFor(trade)?.result?.score)"><p class="mt-1 text-lg font-semibold">{{ assessmentFor(trade).result.score }} 分</p><p class="text-xs text-muted-foreground">{{ assessmentFor(trade).result.classification }} · 完整度 {{ assessmentFor(trade).result.completeness }}%</p></template><template v-else><p class="mt-1 font-medium">尚未正式评分</p><p class="text-xs text-muted-foreground">盘中记录只用于即时检查</p></template></div>
        <div class="rounded-lg border bg-muted/40 p-3"><p class="text-xs text-muted-foreground">结果记录</p><p class="mt-1 font-medium">{{ trade.realizedPnlEstimate == null ? '尚无已实现盈亏' : money(trade.realizedPnlEstimate) }}</p><p class="text-xs text-muted-foreground">费用 {{ trade.fee == null ? '待补' : money(trade.fee) }} · 不进入纪律分</p></div>
        <Button type="button" :variant="Number.isFinite(assessmentFor(trade)?.result?.score) ? 'outline' : 'default'" @click="openAssessment(trade)"><ListChecks class="size-4" />{{ Number.isFinite(assessmentFor(trade)?.result?.score) ? '查看 / 新增修订' : '补齐并评分' }}</Button>
      </div>
      <p v-if="!todayTrades.length" class="py-8 text-center text-muted-foreground">今天没有成交，不自动记100分。</p>
    </CardContent>
  </Card>

  <Card class="relative mt-4 shadow-none">
    <CardHeader><div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>行为证据</CardTitle><CardDescription>只补充系统不知道的事实；正文在弹窗中查看和编辑</CardDescription></div><div class="flex flex-col items-start gap-2 sm:items-end"><Badge variant="outline">{{ reviewSavedAt ? dateTime(reviewSavedAt) : '尚未保存' }}</Badge><Button type="button" variant="outline" @click="reviewDialogOpen = true"><Eye class="size-4" />填写 / 查看行为证据</Button></div></div></CardHeader>
    <CardContent><div class="flex flex-wrap gap-2"><Badge variant="secondary">已填写 {{ reviewCompletedCount }} / 4 项</Badge><span class="text-sm text-muted-foreground">保存行为证据不会自动生成或修改交易计划。</span></div></CardContent>
  </Card>

  <Card class="mt-4 shadow-none"><CardHeader><div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>环境、持仓与情景研究</CardTitle><CardDescription>技术数据由本地程序获取；外部资讯必须附来源并留存快照</CardDescription></div><div class="flex flex-wrap gap-2"><Button variant="outline" :disabled="busy === 'technicals'" @click="refreshTechnicals"><Spinner v-if="busy === 'technicals'" /><RefreshCw v-else class="size-4" />刷新均线数据</Button><Button class="bg-red-600 text-white hover:bg-red-700" :disabled="busy === 'generate'" @click="generatePlan"><Sparkles class="size-4" />基于研究生成计划草稿</Button></div></div></CardHeader><CardContent class="space-y-5">
    <Alert v-if="!latestResearch" variant="destructive"><DatabaseZap class="size-4" /><AlertTitle>尚无研究快照</AlertTitle><AlertDescription>先刷新均线，再补充带来源的外部研究。</AlertDescription></Alert>
    <div v-else class="space-y-4"><div class="flex items-center justify-between"><p>研究日期 {{ latestResearch.reviewDate }}</p><Badge variant="secondary">{{ latestResearch.status === 'ready' ? '可生成计划' : '资料未完整' }}</Badge></div><DataTable :columns="technicalColumns" :data="technicalTableRows" search-placeholder="搜索标的或技术结构" initial-sort-key="stock" /></div>
    <form class="space-y-4 rounded-lg border bg-muted/40 p-4" @submit.prevent="saveFactor"><CardTitle>补充一条带来源的外部研究</CardTitle><div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><FieldBlock label="类别"><Input v-model="factor.category" placeholder="市场环境 / 公司公告" /></FieldBlock><FieldBlock label="标题"><Input v-model="factor.title" required /></FieldBlock><FieldBlock label="来源"><Input v-model="factor.source" required /></FieldBlock><FieldBlock label="发布日期"><DatePickerControl v-model="factor.publishedAt" /></FieldBlock></div><FieldBlock label="来源链接"><Input v-model="factor.url" type="url" placeholder="https://" /></FieldBlock><FieldBlock label="对计划的条件式影响"><Textarea v-model="factor.impact" required /></FieldBlock><Button type="submit" variant="outline" :disabled="busy === 'factor'">保存研究来源</Button></form>
  </CardContent></Card>

  <Card class="mt-4 shadow-none"><CardHeader><div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>纪律分析与历史报告</CardTitle><CardDescription>新分析形成新版本，不覆盖历史</CardDescription></div><Button variant="ghost" @click="exportReview">只生成复盘包</Button></div></CardHeader><CardContent class="space-y-4"><Button class="bg-red-600 text-white hover:bg-red-700" :disabled="busy === 'analysis'" @click="runAnalysis"><Spinner v-if="busy === 'analysis'" /><Sparkles v-else class="size-4" />重新生成纪律分析</Button><Alert v-if="analysisMessage"><AlertTitle>纪律分析</AlertTitle><AlertDescription>{{ analysisMessage }}</AlertDescription></Alert><Accordion type="single" collapsible><AccordionItem v-for="item in analyses" :key="item.id" :value="String(item.id)"><AccordionTrigger>{{ dateTime(item.startedAt) }} · {{ item.status === 'completed' ? '已完成' : item.status }}</AccordionTrigger><AccordionContent><pre v-if="item.content" class="max-h-96 overflow-auto">{{ item.content }}</pre><p v-else>{{ item.errorSummary || '没有可读报告' }}</p></AccordionContent></AccordionItem></Accordion></CardContent></Card>

  <Dialog v-model:open="reviewDialogOpen">
    <DialogScrollContent class="max-w-3xl">
      <DialogHeader><DialogTitle>行为证据</DialogTitle><DialogDescription>记录当时可观察的事实、计划执行情况和下次纠正规则；不会自动生成计划。</DialogDescription></DialogHeader>
      <form class="space-y-4" @submit.prevent="saveReview"><FieldBlock label="事实补充或更正"><Textarea v-model="review.factsCorrection" /></FieldBlock><FieldBlock label="执行证据：触发了哪条计划，是否按规则做？"><Textarea v-model="review.executionEvidence" /></FieldBlock><FieldBlock label="偏差与当时情境"><Textarea v-model="review.deviationContext" /></FieldBlock><FieldBlock label="同类情境再次出现时的纠正规则"><Textarea v-model="review.correctionRule" required /></FieldBlock><DialogFooter><Button type="button" variant="outline" @click="reviewDialogOpen = false">取消</Button><Button type="submit" :disabled="busy === 'review'"><BookOpenCheck class="size-4" />保存行为证据</Button></DialogFooter></form>
    </DialogScrollContent>
  </Dialog>

  <Dialog v-model:open="assessmentDialogOpen">
    <DialogScrollContent class="max-w-4xl">
      <DialogHeader><DialogTitle>逐笔正式纪律评估</DialogTitle><DialogDescription v-if="selectedTrade">{{ selectedTrade.date }} {{ selectedTrade.time }} · {{ selectedTrade.name }} · 盈亏结果不会进入纪律分。</DialogDescription></DialogHeader>
      <form class="space-y-4" @submit.prevent="confirmAssessment">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FieldBlock label="长期逻辑"><Select v-model="assessmentForm.thesisStatus"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="valid">仍然有效</SelectItem><SelectItem value="uncertain">待验证</SelectItem><SelectItem value="invalidated">已经失效</SelectItem><SelectItem value="unknown">尚未判断</SelectItem></SelectContent></Select></FieldBlock>
          <FieldBlock label="短期状态"><Select v-model="assessmentForm.trendState"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="up">上升 / 改善</SelectItem><SelectItem value="sideways">震荡</SelectItem><SelectItem value="down">下跌</SelectItem><SelectItem value="rapid_down">急跌 / 波动扩大</SelectItem><SelectItem value="unknown">尚未判断</SelectItem></SelectContent></Select></FieldBlock>
          <FieldBlock label="触发条件已成立"><Select v-model="assessmentForm.triggerSatisfied"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">是</SelectItem><SelectItem value="no">否</SelectItem><SelectItem value="unknown">无法核实</SelectItem></SelectContent></Select></FieldBlock>
          <FieldBlock label="价格数量在容差内"><Select v-model="assessmentForm.withinTolerance"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yes">是</SelectItem><SelectItem value="no">否</SelectItem><SelectItem value="unknown">无法核实</SelectItem></SelectContent></Select></FieldBlock>
          <FieldBlock label="退出条件变化"><Select v-model="assessmentForm.stopChange"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unchanged">未改变</SelectItem><SelectItem value="tightened">已经收紧</SelectItem><SelectItem value="loosened">已经放宽</SelectItem><SelectItem value="not_applicable">不适用</SelectItem></SelectContent></Select></FieldBlock>
          <FieldBlock label="当时情绪"><Select v-model="assessmentForm.emotionState"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="calm">平静</SelectItem><SelectItem value="hesitant">犹豫</SelectItem><SelectItem value="fomo">怕踏空 / 追涨</SelectItem><SelectItem value="panic">恐慌</SelectItem><SelectItem value="revenge">报复性交易</SelectItem><SelectItem value="recover">想回本</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></FieldBlock>
          <FieldBlock label="成交后仓位（%）"><NumberField :model-value="numericValue(assessmentForm.actualPositionPct)" :min="0" :max="100" :step="0.01" @update:model-value="value => updateAssessmentNumeric('actualPositionPct', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock>
          <FieldBlock label="实际风险（%）"><NumberField :model-value="numericValue(assessmentForm.actualRiskPct)" :min="0" :max="100" :step="0.01" @update:model-value="value => updateAssessmentNumeric('actualRiskPct', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock>
        </div>
        <div class="grid gap-3 sm:grid-cols-2"><div class="flex items-center gap-3 rounded-lg border p-3 text-sm"><Checkbox v-model="assessmentForm.factsLinked" /><span>操作理由引用了可核验事实</span></div><div class="flex items-center gap-3 rounded-lg border p-3 text-sm"><Checkbox v-model="assessmentForm.newInfoVerified" /><span>计划外调整具有新事实和确认</span></div></div>
        <FieldBlock label="逐笔复盘说明"><Textarea v-model="assessmentForm.reviewNote" required placeholder="只写成交当时能观察到的事实、执行过程和偏差" /></FieldBlock>
        <FieldBlock label="同类情况再次出现时的纠正规则"><Textarea v-model="assessmentForm.correctionRule" required placeholder="必须可执行、可验证，例如未绑定触发条件时不新增风险" /></FieldBlock>
        <FieldBlock label="结果备注（不进入纪律分）"><Textarea v-model="assessmentForm.outcomeNote" placeholder="记录盈亏、MFE、MAE或机会成本；不要用结果改写当时理由" /></FieldBlock>
        <Alert v-if="assessmentPreview" :variant="assessmentPreview.result.events?.some((item: any) => item.severity === 'critical') ? 'destructive' : 'default'"><component :is="assessmentPreview.result.events?.some((item: any) => item.severity === 'critical') ? CircleAlert : ShieldCheck" class="size-4" /><AlertTitle>{{ assessmentPreview.result.score == null ? '尚不能形成正式分' : `正式纪律分 ${assessmentPreview.result.score}` }}</AlertTitle><AlertDescription>完整度 {{ assessmentPreview.result.completeness }}% · {{ assessmentPreview.result.correction }}<span v-if="assessmentPreview.result.events?.length"> 触发：{{ assessmentPreview.result.events.map((item: any) => item.title).join('、') }}。</span><span v-if="assessmentPreview.result.missingRequired?.length"> 待补：{{ assessmentPreview.result.missingRequired.join('、') }}。</span></AlertDescription></Alert>
        <DialogFooter><Button type="button" variant="outline" @click="assessmentDialogOpen = false">取消</Button><Button type="button" variant="outline" :disabled="busy.startsWith('assessment')" @click="previewAssessment"><Eye class="size-4" />预览正式评分</Button><Button type="submit" :disabled="busy.startsWith('assessment')"><BookOpenCheck class="size-4" />确认并保存正式评分</Button></DialogFooter>
      </form>
    </DialogScrollContent>
  </Dialog>
</template>
