<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Archive, Bot, Copy, Eye, FilePlus2, Network, Pencil, ShieldCheck, Target } from 'lucide-vue-next'
import PageHeading from '@/components/app/PageHeading.vue'
import AssetDetailView from '@/pages/AssetDetailView.vue'
import MetricCard from '@/components/app/MetricCard.vue'
import FieldBlock from '@/components/app/FieldBlock.vue'
import DatePickerControl from '@/components/app/DatePickerControl.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NumberField, NumberFieldContent, NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, dateTime } from '@/lib/trade-api'

const props = defineProps<{ store: Record<string, any> }>()
const emit = defineEmits<{ refresh: []; navigate: [page: string] }>()
const busy = ref(false)
const message = ref('')
const evidenceMessage = ref('')
const promptMessage = ref('')
const promptTarget = ref('')
const pendingArchive = ref<any | null>(null)
const assetDialogOpen = ref(false)
const evidenceDialogOpen = ref(false)
const aiDialogOpen = ref(false)
const relationDialogOpen = ref(false)
const selectedAssetCode = ref('')

const blankAsset = () => ({ id: '', code: '', name: '', status: 'watching', industry: '', expectedReturn: '', userMarketView: '', fundamentalView: '', technicalView: '', volumePriceView: '', trendView: '', upstream: '', downstream: '', linkedIndicators: '' })
const blankEvidence = () => ({ kind: 'fact', assetCode: '', title: '', confidence: 'medium', content: '', source: '', sourceLevel: '', publishedAt: '', sourceUrl: '', evidenceId: '', basis: '' })
const assetForm = reactive(blankAsset())
const evidenceForm = reactive(blankEvidence())
const blankRelation = () => ({ assetCode: '', stage: 'product_match', status: 'supported', score: '3', title: '', details: '', evidenceId: '', validAsOf: new Date().toISOString().slice(0, 10) })
const relationForm = reactive(blankRelation())
const relationStages = [
  { value: 'demand_created', label: '真实新增需求' }, { value: 'budget_funded', label: '预算与资金' },
  { value: 'product_match', label: '产品匹配' }, { value: 'procurement_route', label: '采购 / 招投标路径' },
  { value: 'company_eligibility', label: '公司资格与认证' }, { value: 'access_history', label: '历史项目 / 客户准入' },
  { value: 'capacity_delivery', label: '产能与交付' }, { value: 'economic_materiality', label: '收入利润重要性' },
  { value: 'timing_recognition', label: '签约、验收与收入确认时点' },
]

const candidates = computed(() => (props.store?.plannedAssets || []).filter((item: any) => item.status !== 'archived'))
const evidence = computed(() => [...(props.store?.evidenceRecords || [])].sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))))
const relations = computed(() => [...(props.store?.companyRelations || [])].sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))))
const universe = computed(() => {
  const map = new Map<string, any>()
  for (const holding of props.store?.holdings || []) map.set(String(holding.code), { ...holding, holding: true })
  for (const candidate of candidates.value) {
    const existing = map.get(String(candidate.code))
    map.set(String(candidate.code), { ...(existing || {}), ...candidate, holding: Boolean(existing), candidateId: candidate.id })
  }
  return [...map.values()]
})
const selectedAsset = computed(() => universe.value.find((item: any) => String(item.code) === selectedAssetCode.value) || null)
const metrics = computed(() => [
  { label: '当前持仓', value: props.store?.holdings?.length || 0, icon: Target },
  { label: '候选标的', value: candidates.value.length, icon: Target },
  { label: '事实卡', value: evidence.value.filter((item: any) => item.kind === 'fact').length, icon: ShieldCheck },
  { label: '分析 / 判断', value: evidence.value.filter((item: any) => item.kind !== 'fact').length, icon: FilePlus2 },
])
const assetStatusLabel = (status?: string) => ({ watching: '观察中', researching: '研究中', planning: '待计划', planned: '已有计划', paused: '暂停' } as Record<string, string>)[status || ''] || status || '持仓中'
const evidenceKindLabel = (kind?: string) => ({ fact: '事实', analysis: '分析', user_judgment: '用户判断' } as Record<string, string>)[kind || ''] || kind

const industryMatchCount = computed(() => {
  const industry = String(assetForm.industry || '').trim().toLowerCase()
  if (!industry) return 0
  const events = props.store?.informationEvents || []
  return events.filter((item: any) => {
    const tags = [
      ...(item.aiEnrichment?.industryTags || []),
      ...(item.industryTags || [])
    ]
    return tags.some((tag: string) => {
      const tagLower = tag.toLowerCase()
      return tagLower.includes(industry) || industry.includes(tagLower)
    })
  }).length
})

function resetAsset() { Object.assign(assetForm, blankAsset()) }
function resetEvidence() { Object.assign(evidenceForm, blankEvidence()) }
function openCandidateForm(asset?: any) {
  message.value = ''
  if (asset) Object.assign(assetForm, blankAsset(), asset)
  else resetAsset()
  selectedAssetCode.value = ''
  assetDialogOpen.value = true
}
function editAsset(asset: any) { openCandidateForm(asset) }
function setAssetDialogOpen(open: boolean) {
  assetDialogOpen.value = open
  if (!open) { resetAsset(); message.value = '' }
}
async function saveAsset() {
  busy.value = true; message.value = ''
  try { await api('/api/planned-assets', { method: 'PUT', body: JSON.stringify(assetForm) }); assetDialogOpen.value = false; resetAsset(); emit('refresh') }
  catch (error) { message.value = error instanceof Error ? error.message : '保存失败' }
  finally { busy.value = false }
}
function archiveAsset(asset: any) {
  pendingArchive.value = asset
}
async function confirmArchive() {
  if (!pendingArchive.value) return
  await api(`/api/planned-assets/${encodeURIComponent(pendingArchive.value.id)}`, { method: 'DELETE' })
  pendingArchive.value = null
  emit('refresh')
}
async function saveEvidence() {
  busy.value = true; evidenceMessage.value = ''
  const payload: any = { ...evidenceForm, evidenceIds: evidenceForm.evidenceId ? [evidenceForm.evidenceId] : [] }
  delete payload.evidenceId
  try { await api('/api/evidence', { method: 'POST', body: JSON.stringify(payload) }); evidenceDialogOpen.value = false; resetEvidence(); emit('refresh') }
  catch (error) { evidenceMessage.value = error instanceof Error ? error.message : '保存失败' }
  finally { busy.value = false }
}
function startEvidence(code = '') {
  selectedAssetCode.value = ''
  evidenceMessage.value = ''
  resetEvidence()
  evidenceForm.assetCode = code
  evidenceDialogOpen.value = true
}
function setEvidenceDialogOpen(open: boolean) {
  evidenceDialogOpen.value = open
  if (!open) { resetEvidence(); evidenceMessage.value = '' }
}
function openAssetDetail(asset: any) {
  selectedAssetCode.value = String(asset.code)
  document.querySelector('[data-workspace-scroll]')?.scrollTo({ top: 0, behavior: 'smooth' })
}
function startRelation(code = '') {
  selectedAssetCode.value = ''
  Object.assign(relationForm, blankRelation(), { assetCode: code })
  relationDialogOpen.value = true
}
async function saveRelation() {
  busy.value = true
  try {
    const input = { ...relationForm, score: relationForm.status === 'supported' ? Number(relationForm.score) : null, evidenceIds: relationForm.evidenceId && relationForm.evidenceId !== '__none__' ? [relationForm.evidenceId] : [] }
    await api('/api/company-relations', { method: 'POST', body: JSON.stringify({ input, confirmed: true }) })
    relationDialogOpen.value = false
    emit('refresh')
  } catch (error) { evidenceMessage.value = error instanceof Error ? error.message : '公司关系保存失败' }
  finally { busy.value = false }
}

async function writeClipboard(content: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(content)
  const textarea = document.createElement('textarea')
  textarea.value = content
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

async function copyAiPrompt(kind: 'research' | 'write') {
  promptMessage.value = ''
  try {
    const payload = await api(`/api/research-import/prompts?target=${encodeURIComponent(promptTarget.value.trim())}`)
    await writeClipboard(kind === 'research' ? payload.researchPrompt : payload.writePrompt)
    promptMessage.value = kind === 'research' ? '调查提示词已复制，可以直接发送给 AI' : '写入提示词已复制，请发送给能访问本机工具的 AI'
  } catch (error) {
    promptMessage.value = error instanceof Error ? error.message : '复制失败'
  }
}
</script>

<template>
  <AssetDetailView v-if="selectedAsset" :asset="selectedAsset" :evidence="evidence" :relations="relations" :information-events="store?.informationEvents || []" @back="selectedAssetCode = ''" @edit="editAsset" @add-evidence="startEvidence" @add-relation="startRelation" @open-influence="() => emit('navigate', 'influence')" />

  <template v-else>
  <PageHeading eyebrow="Asset center & evidence" title="交易标的中心" description="当前持仓自动出现；这里只添加尚未持有、但准备研究的候选标的。">
    <template #meta><Badge variant="outline">本地私密数据</Badge></template>
    <template #actions><Button variant="outline" @click="openCandidateForm()"><Target class="size-4" />候选标的</Button><Button variant="outline" @click="startEvidence()"><FilePlus2 class="size-4" />证据卡</Button><Button variant="outline" @click="startRelation()"><Network class="size-4" />公司关系</Button><Button variant="outline" @click="aiDialogOpen = true"><Bot class="size-4" />AI 研究接入</Button></template>
  </PageHeading>

  <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard v-for="metric in metrics" :key="metric.label" v-bind="metric" /></section>

  <section class="mt-6">
    <div class="mb-4"><h2 class="text-xl font-semibold">我的交易标的</h2><p class="mt-1 text-sm text-muted-foreground">持仓与候选标的统一展示；点击卡片查看完整研究档案</p></div>
    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <Card v-for="asset in universe" :key="asset.code" role="button" tabindex="0" class="flex h-full flex-col shadow-none hover:border-red-300 focus-visible:border-red-400" @click="openAssetDetail(asset)" @keydown.enter.self="openAssetDetail(asset)" @keydown.space.self.prevent="openAssetDetail(asset)">
        <CardHeader class="pb-3"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><CardDescription>{{ asset.code }} · {{ asset.holding ? '当前持仓' : '候选标的' }}</CardDescription><CardTitle class="mt-1 text-lg">{{ asset.name }}</CardTitle></div><Badge variant="secondary">{{ asset.holding && !asset.status ? '持仓中' : assetStatusLabel(asset.status) }}</Badge></div><div class="flex flex-wrap gap-2"><Badge v-if="asset.industry" variant="outline">{{ asset.industry }}</Badge><Badge v-if="asset.researchAsOf" variant="outline">截至 {{ asset.researchAsOf }}</Badge></div></CardHeader>
        <CardContent class="flex-1"><p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI 简介</p><p class="mt-2 line-clamp-3 min-h-18 text-sm leading-6">{{ asset.aiResearchSummary || '暂无 AI 简介，可通过 AI 研究接入补充。' }}</p></CardContent>
        <CardFooter class="flex flex-wrap gap-2 border-t pt-4"><Button size="sm" variant="outline" @click.stop="openAssetDetail(asset)"><Eye class="size-4" />详情</Button><Button size="sm" variant="ghost" @click.stop="startEvidence(String(asset.code))"><FilePlus2 class="size-4" />证据</Button><Button size="sm" variant="ghost" @click.stop="emit('navigate', 'plan')">计划</Button><Button v-if="asset.candidateId" size="icon-sm" variant="ghost" aria-label="编辑" @click.stop="editAsset(asset)"><Pencil class="size-4" /></Button><Button v-if="asset.candidateId" size="icon-sm" variant="ghost" aria-label="归档" @click.stop="archiveAsset(asset)"><Archive class="size-4" /></Button></CardFooter>
      </Card>
      <p v-if="!universe.length" class="col-span-full py-12 text-center text-muted-foreground">还没有交易标的</p>
    </div>
  </section>

  <Card class="mt-4 shadow-none">
    <CardHeader><CardTitle>事实、分析与判断记录</CardTitle><CardDescription>新更正以新记录追加，不覆盖历史</CardDescription></CardHeader>
    <CardContent class="space-y-3">
      <div v-for="item in evidence.slice(0, 80)" :key="item.id" class="rounded-lg border bg-muted/40 p-4"><div class="flex flex-wrap items-start justify-between gap-2"><div class="flex flex-wrap items-center gap-2"><Badge variant="outline">{{ evidenceKindLabel(item.kind) }}</Badge><Badge v-if="item.externalRef" variant="outline">{{ item.externalRef }}</Badge><Badge v-if="item.sourceLevel" variant="secondary">{{ item.sourceLevel }}</Badge><h3 class="font-semibold">{{ item.title }}</h3></div><span class="text-sm text-muted-foreground">发布时间：{{ item.publishedAt ? dateTime(item.publishedAt) : '未记录' }}</span></div><p class="mt-3">{{ item.content }}</p><div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{{ item.source ? `来源：${item.source}` : '未填写外部来源' }}</span><Button v-if="item.sourceUrl" as-child size="sm" variant="link"><a :href="item.sourceUrl" target="_blank" rel="noreferrer">查看原文</a></Button><span class="text-xs">录入：{{ dateTime(item.createdAt) }}</span></div></div>
      <p v-if="!evidence.length" class="py-8 text-center text-muted-foreground">尚未建立证据卡</p>
    </CardContent>
  </Card>
  </template>

  <Dialog :open="assetDialogOpen" @update:open="setAssetDialogOpen">
    <DialogScrollContent class="max-w-4xl">
      <DialogHeader>
        <DialogTitle>{{ assetForm.id ? '编辑候选标的' : '新增候选标的' }}</DialogTitle>
        <DialogDescription>{{ assetForm.id ? `正在编辑 ${assetForm.name}（${assetForm.code}）` : '添加尚未持有、但准备继续研究的交易标的' }}</DialogDescription>
      </DialogHeader>
      <form id="candidate-dialog-form" class="space-y-4" @submit.prevent="saveAsset">
        <div class="grid gap-4 sm:grid-cols-2">
          <FieldBlock label="股票代码"><Input v-model="assetForm.code" maxlength="6" required placeholder="000001" /></FieldBlock>
          <FieldBlock label="股票名称"><Input v-model="assetForm.name" required placeholder="输入证券名称" /></FieldBlock>
          <FieldBlock label="状态"><Select v-model="assetForm.status"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="watching">观察中</SelectItem><SelectItem value="researching">研究中</SelectItem><SelectItem value="planning">待计划</SelectItem><SelectItem value="planned">已有计划</SelectItem><SelectItem value="paused">暂停</SelectItem></SelectContent></Select></FieldBlock>
          <FieldBlock label="行业">
            <Input v-model="assetForm.industry" placeholder="所属行业" />
            <p v-if="industryMatchCount > 0" class="mt-2 text-xs text-emerald-600">
              已匹配到 {{ industryMatchCount }} 条同行业历史资讯，保存后可在标的详情页查看
            </p>
            <p v-else-if="assetForm.industry && !industryMatchCount" class="mt-2 text-xs text-muted-foreground">
              暂无该行业的历史资讯
            </p>
          </FieldBlock>
        </div>
        <FieldBlock label="预期收益（目标，不是承诺）"><Input v-model="assetForm.expectedReturn" placeholder="例如：风险收益比达到 1:2 才考虑" /></FieldBlock>
        <FieldBlock label="我的市场判断"><Textarea v-model="assetForm.userMarketView" placeholder="记录主观判断，并与事实分开" /></FieldBlock>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <FieldBlock label="基本面"><Textarea v-model="assetForm.fundamentalView" /></FieldBlock><FieldBlock label="技术面"><Textarea v-model="assetForm.technicalView" /></FieldBlock><FieldBlock label="量价结构"><Textarea v-model="assetForm.volumePriceView" /></FieldBlock><FieldBlock label="趋势判断"><Textarea v-model="assetForm.trendView" /></FieldBlock><FieldBlock label="上游关联"><Textarea v-model="assetForm.upstream" /></FieldBlock><FieldBlock label="下游关联"><Textarea v-model="assetForm.downstream" /></FieldBlock>
        </div>
        <FieldBlock label="指数 / 商品 / 汇率 / 事件关联"><Input v-model="assetForm.linkedIndicators" /></FieldBlock>
        <Alert v-if="message" variant="destructive"><AlertTitle>候选标的保存失败</AlertTitle><AlertDescription>{{ message }}</AlertDescription></Alert>
        <DialogFooter class="pt-2">
          <Button type="button" variant="ghost" @click="setAssetDialogOpen(false)">取消</Button>
          <Button v-if="!assetForm.id" type="button" variant="outline" @click="resetAsset">清空</Button>
          <Button type="submit" class="bg-red-600 text-white hover:bg-red-700" :disabled="busy">{{ assetForm.id ? '保存修改' : '保存候选标的' }}</Button>
        </DialogFooter>
      </form>
    </DialogScrollContent>
  </Dialog>

  <Dialog :open="evidenceDialogOpen" @update:open="setEvidenceDialogOpen">
    <DialogScrollContent class="max-w-3xl">
      <DialogHeader>
        <DialogTitle>新增证据卡</DialogTitle>
        <DialogDescription>事实、分析与用户判断分层保存；新记录只追加，不覆盖历史。</DialogDescription>
      </DialogHeader>
      <form id="evidence-dialog-form" class="space-y-4" @submit.prevent="saveEvidence">
        <div class="grid gap-4 sm:grid-cols-2">
          <FieldBlock label="类型"><Select v-model="evidenceForm.kind"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fact">事实</SelectItem><SelectItem value="analysis">分析</SelectItem><SelectItem value="user_judgment">用户判断</SelectItem></SelectContent></Select></FieldBlock>
          <FieldBlock label="关联标的"><Select v-model="evidenceForm.assetCode"><SelectTrigger><SelectValue placeholder="整体市场" /></SelectTrigger><SelectContent><SelectItem value="__market__">整体市场 / 无特定标的</SelectItem><SelectItem v-for="asset in universe" :key="asset.code" :value="String(asset.code)">{{ asset.name }}（{{ asset.code }}）</SelectItem></SelectContent></Select></FieldBlock>
          <FieldBlock label="标题"><Input v-model="evidenceForm.title" required /></FieldBlock>
          <FieldBlock label="可信度"><Select v-model="evidenceForm.confidence"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="high">高</SelectItem><SelectItem value="medium">中</SelectItem><SelectItem value="low">低</SelectItem></SelectContent></Select></FieldBlock>
        </div>
        <FieldBlock label="内容"><Textarea v-model="evidenceForm.content" required placeholder="事实只写可验证内容；分析写影响路径与不确定性" /></FieldBlock>
        <div class="grid gap-4 sm:grid-cols-2">
          <FieldBlock label="来源"><Input v-model="evidenceForm.source" placeholder="交易所 / 政府 / 公司官网" /></FieldBlock>
          <FieldBlock label="来源等级"><Select v-model="evidenceForm.sourceLevel"><SelectTrigger><SelectValue placeholder="选择 L1-L4" /></SelectTrigger><SelectContent><SelectItem value="L1">L1 · 监管 / 交易所 / 法定披露</SelectItem><SelectItem value="L2">L2 · 公司官网 / 行业主管部门</SelectItem><SelectItem value="L3">L3 · 数据商 / 研究机构 / 权威媒体</SelectItem><SelectItem value="L4">L4 · 其他媒体 / 社交线索</SelectItem></SelectContent></Select></FieldBlock>
          <FieldBlock label="发布时间"><DatePickerControl v-model="evidenceForm.publishedAt" include-time /></FieldBlock>
          <FieldBlock label="原文链接"><Input v-model="evidenceForm.sourceUrl" type="url" placeholder="https://" /></FieldBlock>
          <FieldBlock label="引用的事实"><Select v-model="evidenceForm.evidenceId"><SelectTrigger><SelectValue placeholder="未引用" /></SelectTrigger><SelectContent><SelectItem value="__none__">未引用</SelectItem><SelectItem v-for="item in evidence.filter((row: any) => row.kind === 'fact')" :key="item.id" :value="item.id">{{ item.title }}</SelectItem></SelectContent></Select></FieldBlock>
        </div>
        <Alert v-if="evidenceMessage" variant="destructive"><AlertTitle>证据卡保存失败</AlertTitle><AlertDescription>{{ evidenceMessage }}</AlertDescription></Alert>
        <DialogFooter class="pt-2">
          <Button type="button" variant="ghost" @click="setEvidenceDialogOpen(false)">取消</Button>
          <Button type="button" variant="outline" @click="resetEvidence">清空</Button>
          <Button type="submit" class="bg-red-600 text-white hover:bg-red-700" :disabled="busy">追加证据卡</Button>
        </DialogFooter>
      </form>
    </DialogScrollContent>
  </Dialog>

  <Dialog v-model:open="relationDialogOpen">
    <DialogScrollContent class="max-w-3xl">
      <DialogHeader><DialogTitle>新增公司传导关系</DialogTitle><DialogDescription>关系结论只追加不覆盖；支持或反证必须引用事实卡。</DialogDescription></DialogHeader>
      <form class="space-y-4" @submit.prevent="saveRelation">
        <div class="grid gap-4 sm:grid-cols-2"><FieldBlock label="关联标的"><Select v-model="relationForm.assetCode"><SelectTrigger><SelectValue placeholder="选择公司" /></SelectTrigger><SelectContent><SelectItem v-for="asset in universe" :key="asset.code" :value="String(asset.code)">{{ asset.name }}（{{ asset.code }}）</SelectItem></SelectContent></Select></FieldBlock><FieldBlock label="传导节点"><Select v-model="relationForm.stage"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="stage in relationStages" :key="stage.value" :value="stage.value">{{ stage.label }}</SelectItem></SelectContent></Select></FieldBlock><FieldBlock label="结论状态"><Select v-model="relationForm.status"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="supported">已有证据支持</SelectItem><SelectItem value="unknown">待核验</SelectItem><SelectItem value="contradicted">已有反证</SelectItem></SelectContent></Select></FieldBlock><FieldBlock v-if="relationForm.status === 'supported'" label="关系强度（1–5）"><NumberField :model-value="Number(relationForm.score)" :min="1" :max="5" @update:model-value="value => relationForm.score = String(value ?? '')"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="事实有效截至"><DatePickerControl v-model="relationForm.validAsOf" /></FieldBlock><FieldBlock label="引用事实卡"><Select v-model="relationForm.evidenceId"><SelectTrigger><SelectValue placeholder="选择事实依据" /></SelectTrigger><SelectContent><SelectItem value="__none__">暂无线索（仅待核验可用）</SelectItem><SelectItem v-for="item in evidence.filter((row: any) => row.kind === 'fact' && (!relationForm.assetCode || row.assetCode === relationForm.assetCode))" :key="item.id" :value="item.id">{{ item.externalRef }} · {{ item.title }}</SelectItem></SelectContent></Select></FieldBlock></div>
        <FieldBlock label="结论标题"><Input v-model="relationForm.title" required placeholder="例如：具备国家骨干网项目投标资格" /></FieldBlock>
        <FieldBlock label="关系说明"><Textarea v-model="relationForm.details" placeholder="说明产品、客户、资质、历史项目、产能或收入占比，不写涨跌预测" /></FieldBlock>
        <Alert v-if="evidenceMessage" variant="destructive"><AlertTitle>公司关系保存失败</AlertTitle><AlertDescription>{{ evidenceMessage }}</AlertDescription></Alert>
        <DialogFooter><Button type="button" variant="outline" @click="relationDialogOpen = false">取消</Button><Button type="submit" :disabled="busy"><Network class="size-4" />确认追加关系</Button></DialogFooter>
      </form>
    </DialogScrollContent>
  </Dialog>

  <Dialog v-model:open="aiDialogOpen">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>AI 研究接入</DialogTitle>
        <DialogDescription>输入准备调查的股票，一键复制研究提示词或写入应用提示词；预期收益和我的市场判断仍由我本人维护。</DialogDescription>
      </DialogHeader>
      <div class="space-y-4">
        <FieldBlock label="准备调查的股票" hint="可填写名称或代码；留空复制时会保留可替换占位符">
          <Input v-model="promptTarget" placeholder="例如：贵州茅台 或 600519" />
        </FieldBlock>
        <p class="text-sm leading-6 text-muted-foreground">第一段提示词交给任意联网 AI 生成标准研究包；第二段交给 Codex 或其他能访问本机命令行的 AI，先预览再写入。</p>
        <Alert v-if="promptMessage"><AlertTitle>AI 接入</AlertTitle><AlertDescription>{{ promptMessage }}</AlertDescription></Alert>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" @click="aiDialogOpen = false">关闭</Button>
        <Button type="button" variant="outline" @click="copyAiPrompt('write')"><Copy class="size-4" />复制写入提示词</Button>
        <Button type="button" class="bg-red-600 text-white hover:bg-red-700" @click="copyAiPrompt('research')"><Copy class="size-4" />复制调查提示词</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog :open="Boolean(pendingArchive)" @update:open="open => { if (!open) pendingArchive = null }">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>归档候选标的</DialogTitle>
        <DialogDescription>确认归档 {{ pendingArchive?.name }}（{{ pendingArchive?.code }}）？历史计划和证据不会删除。</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="pendingArchive = null">取消</Button>
        <Button variant="destructive" @click="confirmArchive">确认归档</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
