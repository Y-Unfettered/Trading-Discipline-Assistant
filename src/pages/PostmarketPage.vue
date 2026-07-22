<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { BookOpenCheck, DatabaseZap, Eye, RefreshCw, Sparkles } from 'lucide-vue-next'
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
import { Dialog, DialogFooter, DialogHeader, DialogScrollContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
</template>
