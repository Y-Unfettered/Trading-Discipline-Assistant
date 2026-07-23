<script setup lang="ts">
import { computed } from 'vue'
import { ChartCandlestick, ChevronRight, CircleAlert, Landmark, ListChecks, ShieldCheck, Target, WalletCards } from 'lucide-vue-next'
import DataTable, { type DataTableColumn } from '@/components/app/DataTable.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { dateTime, holdingMarketValue, holdingPnl, money, planLabel } from '@/lib/trade-api'

const props = defineProps<{ store: Record<string, any>; dashboard: Record<string, any>; loading: boolean; loadError: string }>()
const emit = defineEmits<{ navigate: [page: string]; account: []; retry: [] }>()

const workflow = computed(() => props.dashboard?.dailyWorkflow || { tasks: [], completedCount: 0 })
const completionPct = computed(() => workflow.value.tasks.length ? Math.round(workflow.value.completedCount / workflow.value.tasks.length * 100) : 0)
const nextTask = computed(() => workflow.value.tasks.find((task: any) => !task.completed && !task.optional))
const latestQuote = computed(() => (props.store?.holdings || []).map((item: any) => item.quoteUpdatedAt).filter(Boolean).sort().at(-1))
const disciplineV2 = computed(() => props.dashboard?.disciplineV2 || {})
const holdingColumns: DataTableColumn[] = [
  { key: 'stock', label: '股票' },
  { key: 'quantity', label: '数量' },
  { key: 'cost', label: '成本', format: 'decimal', digits: 3 },
  { key: 'latestPrice', label: '最新价', format: 'decimal', digits: 3 },
  { key: 'marketValue', label: '最新价市值', format: 'money' },
  { key: 'unrealizedPnl', label: '浮动盈亏', format: 'money' },
]
const holdingRows = computed(() => (props.store?.holdings || []).map((holding: any) => ({
  id: holding.code,
  stock: `${holding.name} · ${holding.code}`,
  quantity: holding.quantity,
  cost: holding.cost,
  latestPrice: holding.lastPrice,
  marketValue: holdingMarketValue(holding),
  unrealizedPnl: holdingPnl(holding),
})))
const metrics = computed(() => {
  const account = props.dashboard?.account || {}
  const health = props.dashboard?.health || {}
  return [
    { label: '账本总资产', value: money(account.totalAssets), detail: '可用现金 + 按最新价计算的持仓市值', icon: WalletCards },
    { label: '账本可用现金', value: money(account.availableCash), detail: account.pendingSettlementAdjustment ? `另有待核对差额 ${money(account.pendingSettlementAdjustment)}` : '由现金基线和逐笔成交推导', icon: Landmark },
    { label: '持仓市值', value: money(account.marketValue), detail: `${props.store?.holdings?.length || 0} 个当前持仓`, icon: ChartCandlestick },
    { label: '数据健康', value: `${health.score ?? '--'} 分`, detail: health.issues?.length ? `${health.issues.length} 项需要处理` : '没有发现阻断复盘的问题', icon: ShieldCheck },
  ]
})
const disciplineMetrics = computed(() => [
  { label: '成交', value: props.dashboard?.discipline?.tradeCount || 0 },
  { label: '计划外', value: props.dashboard?.discipline?.unplannedCount || 0 },
  { label: '触发后延迟', value: props.dashboard?.discipline?.delayedCount || 0 },
  { label: '同日反向', value: props.dashboard?.discipline?.sameDayReversals || 0 },
  { label: '计划执行率', value: props.dashboard?.discipline?.planFollowRate == null ? '暂无' : `${props.dashboard.discipline.planFollowRate}%` },
  { label: '累计费用', value: money(props.dashboard?.discipline?.fees) },
])
const disciplineV2Metrics = computed(() => [
  { label: '今日正式纪律分', value: disciplineV2.value.todayScore == null ? '待完成' : `${disciplineV2.value.todayScore} 分`, detail: `${disciplineV2.value.assessedCount || 0} / ${disciplineV2.value.todayTradeCount || 0} 笔已评估` },
  { label: '待正式评估', value: `${disciplineV2.value.pendingAssessmentCount || 0} 笔`, detail: '盘中检查不能替代盘后正式评分' },
  { label: '今日严重违规', value: `${disciplineV2.value.criticalAssessmentCount || 0} 笔`, detail: '严重规则不会被平均分抵消' },
  { label: '最近20次决策', value: disciplineV2.value.rolling20Score == null ? '样本不足' : `${disciplineV2.value.rolling20Score} 分`, detail: `已结算 ${disciplineV2.value.rolling20Count || 0} 次` },
])
</script>

<template>
  <div class="grid gap-4">
    <section class="flex flex-col items-stretch justify-between gap-6 overflow-hidden rounded-xl border border-red-200 bg-gradient-to-br from-red-50 to-card p-6 md:flex-row md:items-end dark:border-red-900/50 dark:from-red-950/20">
      <div class="max-w-3xl">
        <p class="mb-2 text-xs font-bold tracking-widest text-red-600">DISCIPLINE DASHBOARD</p>
        <h1 class="text-4xl font-bold tracking-tight">纪律驾驶舱</h1>
        <p class="mt-2 leading-6 text-muted-foreground">先确认边界，再执行动作。这里只保留会影响今天交易决策的信息。</p>
      </div>
      <div class="flex flex-wrap justify-start gap-2 md:justify-end">
        <Button variant="outline" @click="emit('account')"><WalletCards class="size-4" />资产口径</Button>
        <Button class="border-red-600 bg-red-600 text-white hover:bg-red-700 hover:text-white" @click="emit('navigate', 'plan')">查看交易计划<ChevronRight class="size-4" /></Button>
      </div>
    </section>

    <Alert v-if="loadError" variant="destructive">
      <AlertTitle>数据加载失败</AlertTitle>
      <AlertDescription>{{ loadError }}</AlertDescription>
      <Button size="sm" variant="outline" @click="emit('retry')">重新加载</Button>
    </Alert>

    <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="账户概览">
      <Card v-for="metric in metrics" :key="metric.label" class="relative overflow-hidden shadow-none after:absolute after:inset-x-0 after:bottom-0 after:h-1 after:bg-red-600 after:content-['']">
        <CardHeader>
          <div class="flex items-center justify-between gap-4">
            <CardDescription>{{ metric.label }}</CardDescription>
            <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/30"><component :is="metric.icon" class="size-4" /></span>
          </div>
          <CardTitle class="text-3xl tracking-tight">{{ metric.value }}</CardTitle>
          <CardDescription>{{ metric.detail }}</CardDescription>
        </CardHeader>
      </Card>
    </section>

    <section class="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <Card class="shadow-none">
        <CardHeader><div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle class="flex items-center gap-2"><ListChecks class="size-5 text-red-600" />纪律评分闭环</CardTitle><CardDescription>只评价过程，不用单笔盈亏倒推决策质量。</CardDescription></div><Button size="sm" variant="outline" @click="emit('navigate', 'postmarket')">处理逐笔评估<ChevronRight class="size-4" /></Button></div></CardHeader>
        <CardContent class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div v-for="item in disciplineV2Metrics" :key="item.label" class="rounded-lg border bg-muted/40 p-3"><p class="text-xs text-muted-foreground">{{ item.label }}</p><p class="mt-1 text-xl font-semibold">{{ item.value }}</p><p class="mt-1 text-xs leading-5 text-muted-foreground">{{ item.detail }}</p></div></CardContent>
      </Card>
      <Card class="shadow-none">
        <CardHeader><CardTitle class="flex items-center gap-2"><Target class="size-5 text-red-600" />当前唯一训练目标</CardTitle><CardDescription>完成后再替换下一条，不同时堆叠十几条建议。</CardDescription></CardHeader>
        <CardContent><Alert :variant="disciplineV2.criticalAssessmentCount ? 'destructive' : 'default'"><component :is="disciplineV2.criticalAssessmentCount ? CircleAlert : ShieldCheck" class="size-4" /><AlertTitle>{{ disciplineV2.pendingAssessmentCount ? '先完成未评估成交' : '本阶段纠正目标' }}</AlertTitle><AlertDescription>{{ disciplineV2.trainingTarget || '继续按已确认触发和风险边界执行。' }}</AlertDescription></Alert></CardContent>
      </Card>
    </section>

    <section class="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]">
      <Card class="shadow-none">
        <CardHeader>
          <div class="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <CardTitle>今日执行闭环</CardTitle>
              <CardDescription>{{ planLabel(dashboard?.plan) }}</CardDescription>
            </div>
            <Badge variant="outline" class="border-red-200 bg-red-50 text-red-600 dark:border-red-900/50 dark:bg-red-950/30">{{ workflow.completedCount }} / {{ workflow.tasks.length }} 已完成</Badge>
          </div>
        </CardHeader>
        <CardContent class="grid gap-4">
          <div class="flex items-center justify-between gap-4 text-sm text-muted-foreground">
            <span>今日流程进度</span>
            <strong class="text-red-600">{{ completionPct }}%</strong>
          </div>
          <Progress class="bg-red-100 [&>div]:bg-red-600 dark:bg-red-950/40" :model-value="completionPct" />
          <div class="grid gap-3 sm:grid-cols-2">
            <Button v-for="(task, index) in workflow.tasks" :key="task.label" variant="outline" class="h-auto min-h-12 justify-start p-3 data-[completed=true]:border-red-200 data-[completed=true]:bg-red-50 dark:data-[completed=true]:border-red-900/50 dark:data-[completed=true]:bg-red-950/20" :data-completed="task.completed" @click="emit('navigate', task.page)">
              <Badge :variant="task.completed ? 'default' : 'outline'">{{ index + 1 }}</Badge>
              <span>{{ task.label }}</span>
              <small class="ml-auto max-w-48 truncate text-xs font-normal text-muted-foreground">{{ task.detail }}</small>
            </Button>
          </div>
          <Alert v-if="nextTask" class="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20">
            <AlertTitle>建议下一步</AlertTitle>
            <AlertDescription>{{ nextTask.label }} · {{ nextTask.detail }}</AlertDescription>
            <Button size="sm" class="border-red-600 bg-red-600 text-white hover:bg-red-700 hover:text-white" @click="emit('navigate', nextTask.page)">去处理<ChevronRight class="size-4" /></Button>
          </Alert>
        </CardContent>
      </Card>

      <Card id="health-card" class="shadow-none">
        <CardHeader>
          <div class="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div><CardTitle>数据健康</CardTitle><CardDescription>数据是否足以支持今天的判断</CardDescription></div>
            <span class="grid size-14 shrink-0 place-items-center rounded-full border border-red-200 bg-red-50 text-lg font-bold text-red-600 dark:border-red-900/50 dark:bg-red-950/30">{{ dashboard?.health?.score ?? '--' }}</span>
          </div>
        </CardHeader>
        <CardContent class="grid gap-3">
          <Alert v-if="!dashboard?.health?.issues?.length" class="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20">
            <ShieldCheck class="size-4" />
            <AlertTitle>当前数据可用于复盘</AlertTitle>
            <AlertDescription>没有发现阻断复盘的问题。</AlertDescription>
          </Alert>
          <Alert v-for="issue in dashboard?.health?.issues?.slice(0, 4) || []" v-else :key="issue.message" variant="destructive">
            <AlertTitle>需要处理</AlertTitle>
            <AlertDescription>{{ issue.message }}</AlertDescription>
          </Alert>
          <Button variant="outline" @click="emit('navigate', 'postmarket')">进入盘后核对<ChevronRight class="size-4" /></Button>
        </CardContent>
      </Card>
    </section>

    <section class="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]">
      <Card class="shadow-none">
        <CardHeader>
          <div class="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div><CardTitle>当前持仓</CardTitle><CardDescription>行情更新：{{ latestQuote ? dateTime(latestQuote) : '无持仓' }}</CardDescription></div>
            <Button size="sm" variant="outline" @click="emit('navigate', 'assets')">交易标的中心<ChevronRight class="size-4" /></Button>
          </div>
        </CardHeader>
        <CardContent>
          <Empty v-if="!store?.holdings?.length">
            <EmptyHeader><EmptyTitle>当前没有持仓记录</EmptyTitle><EmptyDescription>可前往交易标的中心维护候选标的。</EmptyDescription></EmptyHeader>
          </Empty>
          <DataTable v-else :columns="holdingColumns" :data="holdingRows" search-placeholder="搜索当前持仓" initial-sort-key="marketValue" />
        </CardContent>
      </Card>

      <Card class="shadow-none">
        <CardHeader><CardTitle>近 {{ dashboard?.discipline?.days || 7 }} 日纪律</CardTitle><CardDescription>只评价执行，不评价结果</CardDescription></CardHeader>
        <CardContent class="grid grid-cols-2 gap-3">
          <div v-for="item in disciplineMetrics" :key="item.label" class="grid gap-1 rounded-lg border bg-muted/40 p-3">
            <span class="text-xs text-muted-foreground">{{ item.label }}</span>
            <strong class="text-lg">{{ item.value }}</strong>
          </div>
        </CardContent>
      </Card>
    </section>
  </div>
</template>
