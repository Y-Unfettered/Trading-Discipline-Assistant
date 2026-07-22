<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, BrainCircuit, ExternalLink, FileText, Network, Pencil, Plus, ShieldAlert, Sparkles, Target } from 'lucide-vue-next'
import PageHeading from '@/components/app/PageHeading.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

const props = defineProps<{ asset: Record<string, any>; evidence: Record<string, any>[] }>()
const emit = defineEmits<{ back: []; edit: [asset: Record<string, any>]; addEvidence: [code: string] }>()

type TaggedItem = { title: string; details: string[]; tags: { label: string; value: string }[] }

const statusLabel = (status?: string) => ({
  watching: '观察中', researching: '研究中', planning: '待计划', planned: '已有计划', paused: '暂停', archived: '已归档',
} as Record<string, string>)[status || ''] || status || '持仓中'

const kindLabel = (kind?: string) => ({ fact: '事实', analysis: '分析', user_judgment: '用户判断' } as Record<string, string>)[kind || ''] || kind
const confidenceLabel = (confidence?: string) => ({ high: '高可信', medium: '中等可信', low: '低可信' } as Record<string, string>)[confidence || ''] || '未评级'

function displayTime(value?: string) {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function segments(value?: string) {
  return String(value || '').split(/\n+|[；;]+/).map(item => item.trim()).filter(Boolean)
}

function taggedLines(value?: string): TaggedItem[] {
  return String(value || '').split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split(/[；;]+/).map(item => item.trim()).filter(Boolean)
    const title = parts.shift() || '未命名项目'
    const details: string[] = []
    const tags: { label: string; value: string }[] = []
    for (const part of parts) {
      const match = part.match(/^([^：:]{1,10})[：:](.+)$/)
      if (match) tags.push({ label: match[1].trim(), value: match[2].trim() })
      else details.push(part)
    }
    return { title, details, tags }
  })
}

function severityVariant(value: string) {
  const normalized = value.toLowerCase()
  if (normalized === 'high' || normalized.includes('高')) return 'destructive' as const
  if (normalized === 'medium' || normalized.includes('中')) return 'secondary' as const
  return 'outline' as const
}

function severityText(value: string) {
  return ({ high: '高', medium: '中', low: '低' } as Record<string, string>)[value.toLowerCase()] || value
}

const relatedEvidence = computed(() => props.evidence
  .filter(item => String(item.assetCode) === String(props.asset.code))
  .sort((a, b) => String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt))))
const facts = computed(() => relatedEvidence.value.filter(item => item.kind === 'fact'))
const interpretations = computed(() => relatedEvidence.value.filter(item => item.kind !== 'fact'))
const evidenceById = computed(() => new Map(props.evidence.map(item => [item.id, item])))

const researchFields = computed(() => [
  { label: '基本面', value: props.asset.fundamentalView },
  { label: '技术面', value: props.asset.technicalView },
  { label: '量价结构', value: props.asset.volumePriceView },
  { label: '趋势判断', value: props.asset.trendView },
].filter(field => String(field.value || '').trim()))

const upstreamNodes = computed(() => segments(props.asset.upstream))
const downstreamNodes = computed(() => segments(props.asset.downstream))
const indicatorNodes = computed(() => segments(props.asset.linkedIndicators))
const risks = computed(() => taggedLines(props.asset.riskView))
const catalysts = computed(() => taggedLines(props.asset.catalysts))
const invalidations = computed(() => taggedLines(props.asset.invalidationConditions))

function citedFacts(item: Record<string, any>) {
  return (item.evidenceIds || []).map((id: string) => evidenceById.value.get(id)).filter(Boolean)
}
</script>

<template>
  <PageHeading eyebrow="Asset detail" :title="asset.name" :description="`${asset.code} · ${asset.industry || '行业尚未填写'} · ${asset.holding ? '当前持仓' : '候选标的'}`">
    <template #actions>
      <Button variant="outline" @click="emit('back')"><ArrowLeft class="size-4" />返回标的中心</Button>
      <Button variant="outline" @click="emit('addEvidence', String(asset.code))"><Plus class="size-4" />补充证据</Button>
      <Button v-if="asset.candidateId" @click="emit('edit', asset)"><Pencil class="size-4" />编辑标的</Button>
    </template>
  </PageHeading>

  <Card class="shadow-none">
    <CardHeader><div class="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>标的概览</CardTitle><CardDescription>身份、状态、研究时效与当前持仓统一查看</CardDescription></div><Badge variant="secondary">{{ asset.holding && !asset.status ? '持仓中' : statusLabel(asset.status) }}</Badge></div></CardHeader>
    <CardContent class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      <div><p class="text-xs text-muted-foreground">股票代码</p><p class="mt-1 font-semibold">{{ asset.code }}</p></div>
      <div><p class="text-xs text-muted-foreground">股票名称</p><p class="mt-1 font-semibold">{{ asset.name }}</p></div>
      <div><p class="text-xs text-muted-foreground">所属行业</p><p class="mt-1 font-semibold">{{ asset.industry || '未填写' }}</p></div>
      <div><p class="text-xs text-muted-foreground">交易市场</p><p class="mt-1 font-semibold">{{ asset.market || '未填写' }}</p></div>
      <div><p class="text-xs text-muted-foreground">研究截至</p><p class="mt-1 font-semibold">{{ asset.researchAsOf || '未记录' }}</p></div>
      <div><p class="text-xs text-muted-foreground">相关证据</p><p class="mt-1 font-semibold">{{ relatedEvidence.length }} 张</p></div>
      <template v-if="asset.holding">
        <div><p class="text-xs text-muted-foreground">持仓数量</p><p class="mt-1 font-semibold">{{ asset.quantity ?? '未记录' }}</p></div>
        <div><p class="text-xs text-muted-foreground">可用数量</p><p class="mt-1 font-semibold">{{ asset.availableQuantity ?? '未记录' }}</p></div>
        <div><p class="text-xs text-muted-foreground">持仓成本</p><p class="mt-1 font-semibold">{{ asset.cost ?? '未记录' }}</p></div>
        <div><p class="text-xs text-muted-foreground">最新记录价格</p><p class="mt-1 font-semibold">{{ asset.lastPrice ?? '未记录' }}</p></div>
      </template>
    </CardContent>
  </Card>

  <section class="mt-4 grid gap-4 lg:grid-cols-2">
    <Card class="shadow-none">
      <CardHeader><CardTitle>我的收益要求</CardTitle><CardDescription>由我本人维护，AI 不会覆盖</CardDescription></CardHeader>
      <CardContent><p class="leading-7">{{ asset.expectedReturn || '尚未由你填写' }}</p></CardContent>
    </Card>
    <Card class="shadow-none">
      <CardHeader><CardTitle>我的市场判断</CardTitle><CardDescription>主观判断与外部事实分开保存</CardDescription></CardHeader>
      <CardContent><p class="leading-7">{{ asset.userMarketView || '尚未由你填写' }}</p></CardContent>
    </Card>
  </section>

  <Card v-if="asset.aiResearchSummary" class="mt-4 border-red-100 shadow-none dark:border-red-900/40">
    <CardHeader><div class="flex items-start gap-3"><span class="grid size-9 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/30"><BrainCircuit class="size-4" /></span><div><CardTitle>AI 研究摘要</CardTitle><CardDescription>研究截至 {{ asset.researchAsOf || '未记录' }}，用于形成线索，不替代个人判断</CardDescription></div></div></CardHeader>
    <CardContent class="space-y-2"><p v-for="item in segments(asset.aiResearchSummary)" :key="item" class="border-l-2 border-red-200 pl-4 leading-7 dark:border-red-900/50">{{ item }}</p></CardContent>
  </Card>

  <Card v-if="researchFields.length" class="mt-4 shadow-none">
    <CardHeader><div class="flex items-start gap-3"><span class="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground"><Target class="size-4" /></span><div><CardTitle>核心研究</CardTitle><CardDescription>只展示已有内容，并按分号自动拆分成易读段落</CardDescription></div></div></CardHeader>
    <CardContent class="grid gap-6 lg:grid-cols-2">
      <section v-for="field in researchFields" :key="field.label" class="border-l-2 pl-4">
        <h3 class="font-semibold">{{ field.label }}</h3>
        <div class="mt-3 space-y-2"><p v-for="item in segments(field.value)" :key="item" class="leading-7 text-muted-foreground">{{ item }}</p></div>
      </section>
    </CardContent>
  </Card>

  <Card v-if="upstreamNodes.length || downstreamNodes.length || indicatorNodes.length" class="mt-4 shadow-none">
    <CardHeader><div class="flex items-start gap-3"><span class="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground"><Network class="size-4" /></span><div><CardTitle>产业链与外部关联</CardTitle><CardDescription>从上游输入，经核心标的，连接下游需求和外部变量</CardDescription></div></div></CardHeader>
    <CardContent class="space-y-5">
      <div class="grid items-stretch gap-4 md:grid-cols-3">
        <div class="rounded-lg border bg-muted/40 p-4">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">上游输入</p>
          <div class="mt-3 flex flex-wrap gap-2"><Badge v-for="item in upstreamNodes" :key="item" variant="outline">{{ item }}</Badge><p v-if="!upstreamNodes.length" class="text-sm text-muted-foreground">暂无上游资料</p></div>
        </div>
        <div class="grid place-items-center rounded-lg border border-red-200 bg-red-50 p-4 text-center dark:border-red-900/50 dark:bg-red-950/20">
          <div><p class="text-xs font-semibold uppercase tracking-wide text-red-600">核心标的</p><p class="mt-2 text-lg font-bold">{{ asset.name }}</p><p class="mt-1 text-sm text-muted-foreground">{{ asset.code }} · {{ asset.industry || '行业未填写' }}</p></div>
        </div>
        <div class="rounded-lg border bg-muted/40 p-4">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">下游需求</p>
          <div class="mt-3 flex flex-wrap gap-2"><Badge v-for="item in downstreamNodes" :key="item" variant="outline">{{ item }}</Badge><p v-if="!downstreamNodes.length" class="text-sm text-muted-foreground">暂无下游资料</p></div>
        </div>
      </div>
      <div v-if="indicatorNodes.length" class="flex flex-wrap items-center gap-2"><span class="text-sm font-semibold">外部变量</span><Badge v-for="item in indicatorNodes" :key="item" variant="secondary">{{ item }}</Badge></div>
    </CardContent>
  </Card>

  <section v-if="risks.length || catalysts.length || invalidations.length" class="mt-4 grid gap-4 xl:grid-cols-3">
    <Card v-if="risks.length" class="shadow-none">
      <CardHeader><div class="flex items-start gap-3"><ShieldAlert class="size-5 text-red-600" /><div><CardTitle>核心风险</CardTitle><CardDescription>严重程度和观察信号已标签化</CardDescription></div></div></CardHeader>
      <CardContent class="space-y-4">
        <div v-for="item in risks" :key="item.title" class="space-y-2">
          <div class="flex flex-wrap items-center gap-2"><p class="font-semibold">{{ item.title }}</p><template v-for="tag in item.tags" :key="`${tag.label}-${tag.value}`"><Badge v-if="tag.label.includes('程度')" :variant="severityVariant(tag.value)">程度：{{ severityText(tag.value) }}</Badge><Badge v-else variant="outline">{{ tag.label }}：{{ tag.value }}</Badge></template></div>
          <p v-for="detail in item.details" :key="detail" class="text-sm leading-6 text-muted-foreground">{{ detail }}</p>
          <Separator />
        </div>
      </CardContent>
    </Card>
    <Card v-if="catalysts.length" class="shadow-none">
      <CardHeader><div class="flex items-start gap-3"><Sparkles class="size-5 text-red-600" /><div><CardTitle>潜在催化</CardTitle><CardDescription>按事件与验证信号拆分</CardDescription></div></div></CardHeader>
      <CardContent class="space-y-4"><div v-for="item in catalysts" :key="item.title" class="space-y-2"><p class="font-semibold">{{ item.title }}</p><p v-for="detail in item.details" :key="detail" class="text-sm leading-6 text-muted-foreground">{{ detail }}</p><div class="flex flex-wrap gap-2"><Badge v-for="tag in item.tags" :key="`${tag.label}-${tag.value}`" variant="outline">{{ tag.label }}：{{ tag.value }}</Badge></div><Separator /></div></CardContent>
    </Card>
    <Card v-if="invalidations.length" class="shadow-none">
      <CardHeader><CardTitle>逻辑失效条件</CardTitle><CardDescription>出现以下情况时应重新研究，而不是继续沿用旧结论</CardDescription></CardHeader>
      <CardContent class="space-y-4"><div v-for="item in invalidations" :key="item.title" class="border-l-2 border-red-200 pl-4 dark:border-red-900/50"><p class="font-semibold">{{ item.title }}</p><p v-for="detail in item.details" :key="detail" class="mt-2 text-sm leading-6 text-muted-foreground">{{ detail }}</p><div class="mt-2 flex flex-wrap gap-2"><Badge v-for="tag in item.tags" :key="`${tag.label}-${tag.value}`" variant="outline">{{ tag.label }}：{{ tag.value }}</Badge></div></div></CardContent>
    </Card>
  </section>

  <Card class="mt-4 shadow-none">
    <CardHeader><CardTitle>事实证据</CardTitle><CardDescription>按消息发布时间排序；F1 是证据编号，L1-L4 是来源等级</CardDescription></CardHeader>
    <CardContent class="space-y-3">
      <article v-for="item in facts" :key="item.id" class="rounded-lg border p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-2"><div class="flex flex-wrap items-center gap-2"><Badge variant="outline">{{ item.externalRef || '本地记录' }}</Badge><Badge variant="secondary">{{ item.sourceLevel || '来源未分级' }}</Badge><Badge variant="outline">{{ confidenceLabel(item.confidence) }}</Badge></div><h3 class="font-semibold">{{ item.title }}</h3></div>
          <p class="text-sm text-muted-foreground">发布时间：{{ displayTime(item.publishedAt) }}</p>
        </div>
        <div class="mt-4 space-y-2"><p v-for="part in segments(item.content)" :key="part" class="leading-7">{{ part }}</p></div>
        <Separator class="my-4" />
        <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><p>来源：{{ item.source || '未填写来源' }}</p><Button v-if="item.sourceUrl" as-child size="sm" variant="outline"><a :href="item.sourceUrl" target="_blank" rel="noreferrer"><ExternalLink class="size-4" />查看原文</a></Button></div>
        <p class="mt-2 text-xs text-muted-foreground">录入时间：{{ displayTime(item.createdAt) }}</p>
      </article>
      <div v-if="!facts.length" class="py-8 text-center text-muted-foreground"><FileText class="mx-auto mb-2 size-8" /><p>这只标的尚无事实证据</p></div>
    </CardContent>
  </Card>

  <Card v-if="interpretations.length" class="mt-4 shadow-none">
    <CardHeader><CardTitle>分析与判断</CardTitle><CardDescription>分析结论及其引用的事实依据</CardDescription></CardHeader>
    <CardContent class="space-y-3">
      <article v-for="item in interpretations" :key="item.id" class="rounded-lg border p-4">
        <div class="flex flex-wrap items-center gap-2"><Badge variant="outline">{{ kindLabel(item.kind) }}</Badge><Badge variant="secondary">{{ confidenceLabel(item.confidence) }}</Badge><h3 class="font-semibold">{{ item.title }}</h3></div>
        <div class="mt-4 space-y-2"><p v-for="part in segments(item.content)" :key="part" class="leading-7">{{ part }}</p></div>
        <div v-if="citedFacts(item).length" class="mt-4 rounded-lg border bg-muted/40 p-3"><p class="text-sm font-semibold">引用事实</p><p v-for="fact in citedFacts(item)" :key="fact.id" class="mt-1 text-sm text-muted-foreground">{{ fact.externalRef || '本地记录' }} · {{ fact.title }}</p></div>
        <p class="mt-3 text-xs text-muted-foreground">记录时间：{{ displayTime(item.createdAt) }}</p>
      </article>
    </CardContent>
  </Card>
</template>
