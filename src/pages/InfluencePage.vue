<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Activity, Archive, Bot, CheckCircle2, ChevronRight, CircleAlert, Clock3, Database, Eye, FileSearch, FileText, Link2, ListChecks, LoaderCircle, PanelRightClose, PanelRightOpen, Play, Plus, RefreshCw, Rss, Save, Server, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import DataTable, { type DataTableColumn } from '@/components/app/DataTable.vue'
import DatePickerControl from '@/components/app/DatePickerControl.vue'
import FieldBlock from '@/components/app/FieldBlock.vue'
import PageHeading from '@/components/app/PageHeading.vue'
import StockPicker, { type StockOption } from '@/components/app/StockPicker.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NumberField, NumberFieldContent, NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, dateTime, localDateKey } from '@/lib/trade-api'

const props = defineProps<{ store: Record<string, any>; dashboard: Record<string, any> }>()
const emit = defineEmits<{ refresh: [] }>()
const busy = ref('')
const eventDialogOpen = ref(false)
const assessmentDialogOpen = ref(false)
const sourceDialogOpen = ref(false)
const eventDetailOpen = ref(false)
const selectedEvent = ref<any>(null)
const selectedDetail = ref<any>(null)
const selectedContent = ref<any>(null)
const contentBusy = ref(false)
const monitorOpen = ref(localStorage.getItem('trade-information-monitor-open') !== 'false')
const runtime = ref<any>(null)
const runtimeBusy = ref(false)
const runtimeError = ref('')
let runtimeTimer: number | undefined
let runtimeSignature = ''
const monitorCardRef = ref<any>(null)
const sourceCardHeight = ref<number | null>(null)
let monitorResizeObserver: ResizeObserver | undefined
const selectedStock = ref<StockOption | null>(null)
const eventPreview = ref<any>(null)
const influencePreview = ref<any>(null)

const sourceTypes = [
  { value: 'exchange_filing', label: '交易所 / 法定公告' },
  { value: 'regulator_or_government', label: '政府 / 监管政策' },
  { value: 'procurement_or_award', label: '招标 / 中标原文' },
  { value: 'company_official', label: '公司官方' },
  { value: 'audited_or_official_statistics', label: '官方统计' },
  { value: 'established_media', label: '权威媒体' },
  { value: 'industry_media', label: '行业媒体' },
  { value: 'social_verified_identity', label: '实名社交线索' },
  { value: 'social_unverified', label: '未核验社交线索' },
  { value: 'anonymous', label: '匿名线索' },
]
const transmissionStages = [
  { key: 'demand_created', label: '真实需求', critical: true },
  { key: 'budget_funded', label: '预算资金', critical: true },
  { key: 'product_match', label: '产品匹配', critical: true },
  { key: 'procurement_route', label: '采购路径', critical: true },
  { key: 'company_eligibility', label: '公司资格', critical: true },
  { key: 'access_history', label: '历史项目 / 客户准入', critical: false },
  { key: 'capacity_delivery', label: '产能交付', critical: false },
  { key: 'economic_materiality', label: '收入利润重要性', critical: true },
  { key: 'timing_recognition', label: '确认与回款时间', critical: false },
]
const eventFields = [
  { key: 'authority', label: '权威层级' },
  { key: 'enforceability', label: '执行强度' },
  { key: 'specificity', label: '措施明确度' },
  { key: 'budget', label: '预算确定性' },
  { key: 'novelty', label: '新增信息量' },
  { key: 'scope', label: '覆盖范围' },
  { key: 'duration', label: '持续时间' },
  { key: 'timing', label: '兑现时间明确度' },
]

const blankEvent = () => ({ title: '', summary: '', sourceName: '', sourceUrl: '', sourceType: 'regulator_or_government', publishedAt: localDateKey(), industryTags: '' })
const informationForm = reactive(blankEvent())
const assessmentForm = reactive<any>({ direction: '1', credibility: '5', originalAvailable: true, corroboration: '0', pricedIn: '0', authority: '3', enforceability: '3', specificity: '3', budget: '3', novelty: '3', scope: '3', duration: '3', timing: '3' })
const stageScores = reactive<Record<string, string>>(Object.fromEntries(transmissionStages.map(stage => [stage.key, ''])))
const stageEvidence = reactive<Record<string, string>>(Object.fromEntries(transmissionStages.map(stage => [stage.key, ''])))
const sourceAdapters = [
  { value: 'rss_atom', label: '官方 RSS / Atom' },
  { value: 'json_feed', label: '官方 JSON Feed' },
  { value: 'newsnow', label: 'NewsNow 开源聚合服务' },
  { value: 'sec_edgar_submissions', label: 'SEC EDGAR 公司申报' },
  { value: 'federal_register', label: '美国 Federal Register' },
]
const sourceTemplates = [
  { name: '国家统计局最新发布', adapter: 'rss_atom', sourceType: 'audited_or_official_statistics', url: 'https://www.stats.gov.cn/sj/zxfb/rss.xml' },
  { name: '国家统计局数据解读', adapter: 'rss_atom', sourceType: 'audited_or_official_statistics', url: 'https://www.stats.gov.cn/sj/sjjd/rss.xml' },
]
const blankSource = () => ({ name: '', adapter: 'rss_atom', sourceType: 'regulator_or_government', enabled: false, url: '', term: '', agency: '', cik: '', userAgent: '', perPage: '20', baseUrl: 'http://127.0.0.1:4444', newsnowSourceId: '', maxItems: '30', minIntervalMinutes: '50', maxIntervalMinutes: '75' })
const sourceForm = reactive(blankSource())

const events = computed(() => [...(props.store?.informationEvents || [])].sort((a: any, b: any) => String(b.publishedAt).localeCompare(String(a.publishedAt))))
const assessments = computed(() => [...(props.store?.influenceAssessments || [])].sort((a: any, b: any) => Number(b.result?.attentionPriorityScore || 0) - Number(a.result?.attentionPriorityScore || 0)))
const sources = computed(() => props.store?.informationSources || [])
const aiEligibleEvents = computed(() => events.value.filter((item: any) => item.contentStatus !== 'headline_only'))
const processedEvents = computed(() => aiEligibleEvents.value.filter((item: any) => item.aiProcessingStatus === 'completed' && item.aiEnrichment))
const highPriority = computed(() => processedEvents.value.filter((item: any) => Number(item.aiEnrichment?.attentionPriorityScore || 0) >= 50))
const impactConfirmations = computed(() => props.store?.informationImpactConfirmations || [])
const aiHoldingImpacts = computed(() => processedEvents.value.flatMap((event: any) => (event.aiEnrichment?.holdingRelevance || []).map((impact: any) => ({ event, impact }))).sort((a: any, b: any) => Number(b.impact.relevanceScore || 0) - Number(a.impact.relevanceScore || 0)))
const processingCoverage = computed(() => aiEligibleEvents.value.length ? Math.round(processedEvents.value.length / aiEligibleEvents.value.length * 100) : 0)
const smartReady = computed(() => aiEligibleEvents.value.length > 0 && processedEvents.value.length === aiEligibleEvents.value.length)
const viewMode = ref<'latest' | 'smart'>('latest')
const industryFilter = ref('')
const assetFilter = ref('')
watch(smartReady, ready => { if (ready) viewMode.value = 'smart' }, { immediate: true })

const allIndustryTags = computed(() => {
  const tags = new Set<string>()
  for (const event of events.value) {
    const enrichment = (event as any).aiEnrichment
    if (enrichment?.industryTags?.length) {
      for (const tag of enrichment.industryTags) tags.add(tag)
    }
    if ((event as any).industryTags?.length) {
      for (const tag of (event as any).industryTags) tags.add(tag)
    }
  }
  return [...tags].sort()
})
function monitorCardElement() {
  const target = monitorCardRef.value?.$el || monitorCardRef.value
  return target instanceof HTMLElement ? target : null
}
function syncSourceCardHeight() {
  if (!monitorOpen.value || window.innerWidth < 1280) {
    sourceCardHeight.value = null
    return
  }
  const height = monitorCardElement()?.getBoundingClientRect().height || 0
  sourceCardHeight.value = height > 0 ? Math.ceil(height) : null
}
function observeMonitorCard() {
  monitorResizeObserver?.disconnect()
  nextTick(() => {
    const target = monitorCardElement()
    if (!target || !monitorOpen.value) return
    monitorResizeObserver = new ResizeObserver(syncSourceCardHeight)
    monitorResizeObserver.observe(target)
    syncSourceCardHeight()
  })
}
watch(monitorOpen, open => {
  localStorage.setItem('trade-information-monitor-open', String(open))
  sourceCardHeight.value = null
  observeMonitorCard()
})

const runtimeCounts = computed(() => runtime.value?.counts || { total: events.value.length, article: 0, brief: 0, summaryOnly: 0, headlineOnly: 0, pending: events.value.length, blocked: 0, failed: 0, analyzable: 0, substantial: 0 })
const runtimeSourceMap = computed<Map<string, any>>(() => new Map<string, any>((runtime.value?.sources || []).map((item: any) => [String(item.sourceId), item])))
const monitorActivities = computed(() => {
  const collections = (runtime.value?.recentCollectionRuns || []).map((run: any) => ({
    id: run.id, at: run.finishedAt || run.startedAt, type: '采集', status: run.status,
    detail: `新增 ${run.insertedCount || 0} · 重复 ${run.duplicateCount || 0}`,
  }))
  const contents = (runtime.value?.recentContentRuns || []).map((run: any) => ({
    id: run.id, at: run.finishedAt || run.startedAt, type: '正文', status: run.status,
    detail: `完整 ${run.completedCount || 0} · 摘要 ${run.summaryOnlyCount || 0} · 失败 ${run.failedCount || 0}`,
  }))
  return [...collections, ...contents].sort((a: any, b: any) => String(b.at).localeCompare(String(a.at))).slice(0, 8)
})

async function loadRuntime() {
  if (runtimeBusy.value) return
  runtimeBusy.value = true
  try {
    const next = await api<any>('/api/information-runtime')
    runtime.value = next
    runtimeError.value = ''
    const signature = `${next.recentCollectionRuns?.[0]?.id || ''}|${next.recentContentRuns?.[0]?.id || ''}`
    if (runtimeSignature && signature !== runtimeSignature) emit('refresh')
    runtimeSignature = signature
  } catch (error) { runtimeError.value = error instanceof Error ? error.message : '运行状态读取失败' }
  finally { runtimeBusy.value = false }
}

onMounted(() => {
  loadRuntime()
  runtimeTimer = window.setInterval(loadRuntime, 5000)
  window.addEventListener('resize', syncSourceCardHeight)
  observeMonitorCard()
})
onUnmounted(() => {
  if (runtimeTimer) window.clearInterval(runtimeTimer)
  monitorResizeObserver?.disconnect()
  window.removeEventListener('resize', syncSourceCardHeight)
})

const informationColumns: DataTableColumn[] = [
  { key: 'priority', label: 'AI优先级' },
  { key: 'portfolio', label: '当前持仓', sortable: false },
  { key: 'publishedAt', label: '发布时间', format: 'datetime' },
  { key: 'sourceName', label: '来源' },
  { key: 'title', label: '资讯' },
  { key: 'tags', label: '标签', sortable: false },
  { key: 'contentState', label: '本地原文' },
  { key: 'aiState', label: '整理状态' },
  { key: 'actions', label: '操作', sortable: false },
]
const displayedEvents = computed(() => {
  let filtered = [...events.value]
  if (industryFilter.value.trim()) {
    const keyword = industryFilter.value.trim().toLowerCase()
    filtered = filtered.filter((item: any) => {
      const tags = [
        ...(item.aiEnrichment?.industryTags || []),
        ...(item.industryTags || [])
      ]
      return tags.some((tag: string) => tag.toLowerCase().includes(keyword) || keyword.includes(tag.toLowerCase()))
    })
  }
  if (assetFilter.value.trim()) {
    const keyword = assetFilter.value.trim()
    filtered = filtered.filter((item: any) =>
      (item.assetCodes || []).some((code: string) => code.includes(keyword)) ||
      (item.aiEnrichment?.assetCodes || []).some((code: string) => code.includes(keyword))
    )
  }
  if (viewMode.value === 'smart') {
    return filtered.sort((a: any, b: any) => {
      const aReady = a.aiProcessingStatus === 'completed' && a.aiEnrichment
      const bReady = b.aiProcessingStatus === 'completed' && b.aiEnrichment
      if (aReady !== bReady) return aReady ? -1 : 1
      const aHolding = Math.max(0, ...(a.aiEnrichment?.holdingRelevance || []).map((item: any) => Number(item.relevanceScore || 0)))
      const bHolding = Math.max(0, ...(b.aiEnrichment?.holdingRelevance || []).map((item: any) => Number(item.relevanceScore || 0)))
      if (aHolding !== bHolding) return bHolding - aHolding
      const priorityGap = Number(b.aiEnrichment?.attentionPriorityScore ?? -1) - Number(a.aiEnrichment?.attentionPriorityScore ?? -1)
      return priorityGap || String(b.publishedAt).localeCompare(String(a.publishedAt))
    })
  }
  return filtered.sort((a: any, b: any) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
})
const informationRows = computed(() => displayedEvents.value.map((event: any) => {
  const enrichment = event.aiProcessingStatus === 'completed' ? event.aiEnrichment : null
  const holdingLinks = enrichment?.holdingRelevance || []
  return {
    id: event.id,
    priority: enrichment?.attentionPriorityScore ?? null,
    portfolio: holdingLinks.map((item: any) => `${item.assetName} ${item.assetCode}`).join('、'),
    holdingLinks,
    publishedAt: event.publishedAt,
    sourceName: event.sourceName,
    rank: event.rank,
    hotValue: event.hotValue,
    title: event.title,
    summary: enrichment?.shortSummary || event.summary,
    tags: [...(enrichment?.topicTags || []), ...(enrichment?.industryTags || [])].join('、'),
    contentState: localContentLabel(event.contentStatus, event.contentKind),
    aiState: event.contentStatus === 'headline_only' ? '不进入 AI' : ({ completed: '已整理', processing: '处理中', failed: '失败', pending: '未整理' } as Record<string, string>)[event.aiProcessingStatus] || '未整理',
    actions: '',
    event,
  }
}))

function numericValue(value: unknown) { if (value === '' || value == null) return undefined; const number = Number(value); return Number.isFinite(number) ? number : undefined }
function updateFactor(key: string, value: number | undefined) { assessmentForm[key] = value == null ? '' : String(value) }
function updateStage(key: string, value: number | undefined) { stageScores[key] = value == null ? '' : String(value) }
function sourceLabel(value: string) { return sourceTypes.find(item => item.value === value)?.label || value }
function adapterLabel(value: string) { return sourceAdapters.find(item => item.value === value)?.label || (value === 'x_recent_search' ? 'X 近况搜索（付费已阻止）' : value) }
function localContentLabel(status: string, kind?: string | null) {
  if (status === 'complete') return kind === 'brief' ? '完整快讯' : '完整文章'
  return ({ summary_only: '来源摘要', headline_only: '仅标题线索', pending: '待补正文', blocked: '访问受限', failed: '抓取失败' } as Record<string, string>)[status] || '待补正文'
}
function statusLabel(value: string) { return ({ new: '待处理', assessing: '评估中', reviewed: '已读', archived: '已归档' } as Record<string, string>)[value] || value }
function holdingRelationLabel(value: string) { return ({ direct: '直接相关', industry: '同行业', upstream: '上游', downstream: '下游', commodity: '商品关联', macro: '宏观传导' } as Record<string, string>)[value] || value }
function directionLabel(value: string) { return ({ positive: '偏正面', negative: '偏负面', neutral: '中性', unknown: '方向待定' } as Record<string, string>)[value] || value }
function evidenceStatusLabel(value: string) { return ({ supported: '证据较充分', provisional: '初步判断', insufficient: '证据不足' } as Record<string, string>)[value] || value }
function impactTimeframeLabel(value: string) { return ({ immediate: '即时', short_term: '短期', medium_term: '中期', long_term: '长期', unknown: '时间待定' } as Record<string, string>)[value] || value }
function impactScoreLabel(value: number) { const score = Number(value || 0); return `${score > 0 ? '+' : ''}${score}` }
function latestImpactConfirmation(event: any, link: any) {
  return [...impactConfirmations.value].reverse().find((item: any) => item.eventId === event?.id && item.assetCode === link?.assetCode && item.inputHash === event?.aiEnrichment?.inputHash && item.ruleVersion === event?.aiEnrichment?.ruleVersion) || null
}
const contentParagraphs = computed(() => String(selectedContent.value?.content?.contentText || selectedDetail.value?.summary || '').split(/\n+/).map(item => item.trim()).filter(Boolean))
async function loadEventContent(event: any) {
  contentBusy.value = true
  try { selectedContent.value = await api<any>(`/api/information-content/${encodeURIComponent(event.id)}`) }
  catch (error) { selectedContent.value = { status: event.contentStatus || 'failed', error: error instanceof Error ? error.message : '原文读取失败', content: null } }
  finally { contentBusy.value = false }
}
function openEventDetail(event: any) { selectedDetail.value = event; selectedContent.value = null; eventDetailOpen.value = true; loadEventContent(event) }
async function retryContent(event: any) {
  contentBusy.value = true
  try {
    await api('/api/information-content/run', { method: 'POST', body: JSON.stringify({ eventId: event.id, confirmed: true }) })
    await loadEventContent(event)
    emit('refresh')
    toast.success('原文补抓已完成')
  } catch (error) { toast.error('原文补抓失败', { description: error instanceof Error ? error.message : '请稍后重试' }) }
  finally { contentBusy.value = false }
}
async function confirmHoldingImpact(event: any, link: any, decision: 'confirmed' | 'rejected') {
  busy.value = `impact-confirmation-${event.id}-${link.assetCode}`
  try {
    await api(`/api/information-events/${encodeURIComponent(event.id)}/holding-impact-confirmations`, { method: 'POST', body: JSON.stringify({ confirmed: true, assetCode: link.assetCode, decision }) })
    toast.success(decision === 'confirmed' ? '已确认这条持仓影响判断' : '已标记AI判断不准确', { description: decision === 'confirmed' ? '系统会保留你的确认记录。' : '该结论不会再作为已确认结果展示，可进入高级评估补充证据。' })
    emit('refresh')
  } catch (error) { toast.error('确认失败', { description: error instanceof Error ? error.message : '请稍后重试' }) }
  finally { busy.value = '' }
}
function openEventDialog() { Object.assign(informationForm, blankEvent()); selectedStock.value = null; eventPreview.value = null; eventDialogOpen.value = true }
function eventInput() {
  return { ...informationForm, assetCodes: selectedStock.value?.code ? [selectedStock.value.code] : [], industryTags: informationForm.industryTags.split(/[、,，]/).map(item => item.trim()).filter(Boolean) }
}
async function previewEvent() {
  busy.value = 'event-preview'
  try { eventPreview.value = await api<any>('/api/information-events/preview', { method: 'POST', body: JSON.stringify({ input: eventInput() }) }) }
  catch (error) { toast.error('资讯预览失败', { description: error instanceof Error ? error.message : '请检查来源字段' }) }
  finally { busy.value = '' }
}
async function saveEvent() {
  await previewEvent()
  if (!eventPreview.value) return
  busy.value = 'event-save'
  try {
    const result = await api<any>('/api/information-events', { method: 'POST', body: JSON.stringify({ input: eventInput(), confirmed: true }) })
    toast.success(result.duplicate ? '相同资讯已经存在' : '资讯事件已保存')
    eventDialogOpen.value = false
    emit('refresh')
  } catch (error) { toast.error('资讯保存失败', { description: error instanceof Error ? error.message : '请稍后重试' }) }
  finally { busy.value = '' }
}
function openAssessment(event: any, holdingLink: any = null) {
  selectedEvent.value = event
  const preferredCode = holdingLink?.assetCode || event.assetCodes?.[0]
  selectedStock.value = preferredCode
    ? { code: preferredCode, name: holdingLink?.assetName || (props.store?.holdings || []).find((item: any) => item.code === preferredCode)?.name || preferredCode, market: '' }
    : null
  Object.assign(assessmentForm, { direction: holdingLink?.direction === 'negative' ? '-1' : holdingLink?.direction === 'positive' ? '1' : '0', credibility: '5', originalAvailable: true, corroboration: '0', pricedIn: '0', authority: '3', enforceability: '3', specificity: '3', budget: '3', novelty: '3', scope: '3', duration: '3', timing: '3' })
  for (const stage of transmissionStages) { stageScores[stage.key] = ''; stageEvidence[stage.key] = '' }
  influencePreview.value = null
  assessmentDialogOpen.value = true
  applyCompanyRelations(selectedStock.value?.code || '')
}
function applyCompanyRelations(assetCode: string) {
  for (const stage of transmissionStages) { stageScores[stage.key] = ''; stageEvidence[stage.key] = '' }
  if (!assetCode) return
  const facts = new Map((props.store?.evidenceRecords || []).map((item: any) => [item.id, item]))
  const latest = new Map<string, any>()
  for (const relation of [...(props.store?.companyRelations || [])].filter((item: any) => item.assetCode === assetCode).sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))) {
    if (!latest.has(relation.stage)) latest.set(relation.stage, relation)
  }
  for (const stage of transmissionStages) {
    const relation = latest.get(stage.key)
    if (!relation) continue
    stageScores[stage.key] = relation.status === 'contradicted' ? '0' : relation.status === 'supported' ? String(relation.score) : ''
    stageEvidence[stage.key] = (relation.evidenceIds || []).map((id: string) => {
      const fact: any = facts.get(id)
      return fact?.externalRef || fact?.sourceUrl || id
    }).join('，')
  }
}
watch(() => selectedStock.value?.code, code => { if (assessmentDialogOpen.value) applyCompanyRelations(code || '') })
watch(() => sourceForm.adapter, adapter => {
  sourceForm.sourceType = adapter === 'sec_edgar_submissions' ? 'exchange_filing' : adapter === 'newsnow' ? 'established_media' : 'regulator_or_government'
})
function influenceInput() {
  return {
    eventId: selectedEvent.value?.id,
    assetCode: selectedStock.value?.code || null,
    eventMeta: { title: selectedEvent.value?.title, sourceUrl: selectedEvent.value?.sourceUrl, publishedAt: selectedEvent.value?.publishedAt },
    source: { type: selectedEvent.value?.sourceType || 'industry_media' },
    information: { credibility: Number(assessmentForm.credibility), originalAvailable: assessmentForm.originalAvailable, independentCorroborationCount: Number(assessmentForm.corroboration || 0), contradiction: 0 },
    event: { direction: Number(assessmentForm.direction), ...Object.fromEntries(eventFields.map(field => [field.key, assessmentForm[field.key] === '' ? null : Number(assessmentForm[field.key])])), timeDecay: 100 },
    market: { pricedIn: Number(assessmentForm.pricedIn || 0) },
    transmission: transmissionStages.map(stage => ({
      key: stage.key,
      score: stageScores[stage.key] === '' ? null : Number(stageScores[stage.key]),
      critical: stage.critical,
      evidenceRefs: stageEvidence[stage.key].split(/[、,，\n]/).map(item => item.trim()).filter(Boolean),
    })),
  }
}
async function previewInfluence() {
  busy.value = 'influence-preview'
  try {
    influencePreview.value = await api<any>('/api/influence-assessments/preview', { method: 'POST', body: JSON.stringify({ input: influenceInput() }) })
    return influencePreview.value
  } catch (error) { toast.error('影响评估失败', { description: error instanceof Error ? error.message : '请检查评分' }); return null }
  finally { busy.value = '' }
}
async function saveInfluence() {
  if (!selectedStock.value?.code) { toast.error('请先选择要评估的公司'); return }
  const preview = await previewInfluence()
  if (!preview) return
  busy.value = 'influence-save'
  try {
    await api('/api/influence-assessments', { method: 'POST', body: JSON.stringify({ input: influenceInput(), confirmed: true }) })
    toast.success('公司影响评估已保存', { description: preview.companyImpactScore == null ? '传导链仍有缺口，未生成公司影响分' : `公司影响分 ${preview.companyImpactScore}` })
    assessmentDialogOpen.value = false
    emit('refresh')
  } catch (error) { toast.error('影响评估保存失败', { description: error instanceof Error ? error.message : '请稍后重试' }) }
  finally { busy.value = '' }
}
async function updateEventStatus(event: any, status: string) {
  try { await api(`/api/information-events/${encodeURIComponent(event.id)}/status`, { method: 'PUT', body: JSON.stringify({ status }) }); emit('refresh') }
  catch (error) { toast.error('状态更新失败', { description: error instanceof Error ? error.message : '请稍后重试' }) }
}
function openSourceDialog() { Object.assign(sourceForm, blankSource()); sourceDialogOpen.value = true }
function applySourceTemplate(template: any) { Object.assign(sourceForm, blankSource(), template) }
function sourceInput() {
  const config = ['rss_atom', 'json_feed'].includes(sourceForm.adapter)
    ? { url: sourceForm.url }
    : sourceForm.adapter === 'newsnow'
      ? { baseUrl: sourceForm.baseUrl, sourceId: sourceForm.newsnowSourceId, maxItems: Number(sourceForm.maxItems) }
    : sourceForm.adapter === 'sec_edgar_submissions'
      ? { cik: sourceForm.cik, userAgent: sourceForm.userAgent }
      : { term: sourceForm.term, agency: sourceForm.agency, perPage: Number(sourceForm.perPage) }
  return { name: sourceForm.name, adapter: sourceForm.adapter, sourceType: sourceForm.sourceType, enabled: sourceForm.enabled, minIntervalMinutes: Number(sourceForm.minIntervalMinutes), maxIntervalMinutes: Number(sourceForm.maxIntervalMinutes), config }
}
async function addNewsNowDefaults() {
  busy.value = 'newsnow-defaults'
  try {
    const result = await api<any>('/api/information-sources/newsnow-defaults', { method: 'POST', body: JSON.stringify({ confirmed: true }) })
    toast.success('NewsNow 推荐来源已接入', { description: `新增 ${result.added.length} 个，已存在 ${result.existing.length} 个` })
    emit('refresh')
  } catch (error) { toast.error('NewsNow 来源接入失败', { description: error instanceof Error ? error.message : '请稍后重试' }) }
  finally { busy.value = '' }
}
async function saveSource() {
  busy.value = 'source-save'
  try {
    await api('/api/information-sources', { method: 'POST', body: JSON.stringify({ input: sourceInput(), confirmed: true }) })
    toast.success('资讯来源已保存', { description: sourceForm.enabled ? '下一轮调度将自动采集' : '当前保持停用，可核验后再启用' })
    sourceDialogOpen.value = false
    emit('refresh')
  } catch (error) { toast.error('来源保存失败', { description: error instanceof Error ? error.message : '请检查配置' }) }
  finally { busy.value = '' }
}
async function toggleSource(source: any) {
  busy.value = `source-${source.id}`
  try {
    await api(`/api/information-sources/${encodeURIComponent(source.id)}`, { method: 'PUT', body: JSON.stringify({ input: { enabled: !source.enabled }, confirmed: true }) })
    toast.success(source.enabled ? '自动采集已停用' : '自动采集已启用')
    emit('refresh')
  } catch (error) { toast.error('来源状态更新失败', { description: error instanceof Error ? error.message : '请稍后重试' }) }
  finally { busy.value = '' }
}
async function runSource(source: any) {
  busy.value = `run-${source.id}`
  try {
    const result = await api<any>('/api/information-collection/run', { method: 'POST', body: JSON.stringify({ sourceId: source.id, confirmed: true }) })
    toast.success('采集完成', { description: `新增 ${result.run.insertedCount} 条，重复 ${result.run.duplicateCount} 条` })
    emit('refresh')
  } catch (error) { toast.error('采集失败', { description: error instanceof Error ? error.message : '请检查网络与凭据' }) }
  finally { busy.value = '' }
}
</script>

<template>
  <PageHeading eyebrow="Evidence before impact" title="资讯影响中心" description="先保存原文事实，再评估事件强度和公司传导；影响分不是涨跌概率。">
    <template #actions><Button type="button" @click="openEventDialog"><Plus class="size-4" />录入资讯事件</Button></template>
  </PageHeading>

  <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <Card class="shadow-none"><CardHeader><CardDescription>资讯事件</CardDescription><CardTitle class="text-3xl">{{ events.length }}</CardTitle><CardDescription>保存原文、来源和发布时间</CardDescription></CardHeader></Card>
    <Card class="shadow-none"><CardHeader><CardDescription>AI 可处理 / 已整理</CardDescription><CardTitle class="text-3xl">{{ processedEvents.length }} / {{ aiEligibleEvents.length }}</CardTitle><CardDescription>仅标题线索不进入 AI；有效内容覆盖率 {{ processingCoverage }}%</CardDescription></CardHeader></Card>
    <Card class="shadow-none"><CardHeader><CardDescription>AI 持仓影响</CardDescription><CardTitle class="text-3xl">{{ aiHoldingImpacts.length }}</CardTitle><CardDescription>AI 自动初评，你只确认必要项目</CardDescription></CardHeader></Card>
    <Card class="shadow-none"><CardHeader><CardDescription>今日优先查看</CardDescription><CardTitle class="text-3xl">{{ highPriority.length }}</CardTitle><CardDescription>优先级≥50，不代表买卖信号</CardDescription></CardHeader></Card>
  </section>

  <section class="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.55fr)]">
    <Card class="flex min-h-0 min-w-0 flex-col shadow-none" :style="sourceCardHeight ? { height: `${sourceCardHeight}px` } : undefined">
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div><CardTitle>自动采集来源</CardTitle><CardDescription>NewsNow 固定源码已部署在本机，只访问 127.0.0.1；采集不再依赖任何公共 NewsNow 服务器。</CardDescription></div>
          <div class="flex flex-wrap gap-2">
            <Button type="button" variant="outline" :disabled="busy" @click="addNewsNowDefaults"><Plus class="size-4" />接入推荐 NewsNow 来源</Button>
            <Button type="button" variant="outline" @click="openSourceDialog"><Rss class="size-4" />配置来源</Button>
            <Button v-if="!monitorOpen" type="button" variant="outline" @click="monitorOpen = true"><PanelRightOpen class="size-4" />显示运行面板</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent class="flex min-h-0 flex-1 flex-col">
        <div class="min-h-0 max-h-[540px] flex-1 space-y-2 overflow-y-auto pr-1 xl:max-h-none">
          <div v-for="source in sources" :key="source.id" class="grid gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(190px,0.8fr)_auto] lg:items-center">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2"><Badge :variant="source.enabled ? 'default' : 'secondary'">{{ source.enabled ? '运行中' : '已停用' }}</Badge><Badge variant="outline">{{ adapterLabel(source.adapter) }}</Badge></div>
              <p class="mt-2 truncate font-medium">{{ source.name }}</p>
              <p v-if="runtimeSourceMap.get(source.id)" class="mt-1 text-xs text-muted-foreground">已入库 {{ runtimeSourceMap.get(source.id).counts.total }} · 可分析 {{ runtimeSourceMap.get(source.id).counts.analyzable }} · 仅标题 {{ runtimeSourceMap.get(source.id).counts.headlineOnly }}</p>
              <p v-if="source.lastError" class="mt-1 line-clamp-2 text-xs text-red-600">{{ source.lastError }}</p>
            </div>
            <div class="text-xs leading-5 text-muted-foreground"><p>随机窗口 {{ source.minIntervalMinutes }}–{{ source.maxIntervalMinutes }} 分钟</p><p>上次 {{ source.lastRunAt ? dateTime(source.lastRunAt) : '尚未运行' }}</p><p>下次 {{ source.nextRunAt ? dateTime(source.nextRunAt) : '未安排' }}</p></div>
            <div class="flex flex-wrap gap-2"><Button size="sm" :disabled="busy || source.costPolicy === 'paid_blocked' || source.adapter === 'x_recent_search'" @click="runSource(source)"><Play class="size-4" />采集</Button><Button size="sm" variant="outline" :disabled="busy || (!source.enabled && (source.costPolicy === 'paid_blocked' || source.adapter === 'x_recent_search'))" @click="toggleSource(source)">{{ source.enabled ? '停用' : '启用' }}</Button></div>
          </div>
          <div v-if="!sources.length" class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">尚未配置自动来源。</div>
        </div>
      </CardContent>
    </Card>

    <Card v-if="monitorOpen" ref="monitorCardRef" class="min-w-0 shadow-none">
      <CardHeader>
        <div class="flex items-start justify-between gap-3">
          <div><CardTitle class="flex items-center gap-2"><Activity class="size-5 text-red-600" />采集运行面板</CardTitle><CardDescription>每 5 秒刷新；可以随时收起，不影响后台运行。</CardDescription></div>
          <Button type="button" size="icon-sm" variant="ghost" title="收起运行面板" @click="monitorOpen = false"><PanelRightClose class="size-4" /></Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid grid-cols-2 gap-2">
          <div class="col-span-2 flex items-center gap-2 rounded-lg border p-3">
            <Server v-if="runtime?.newsNow?.online" class="size-4 text-emerald-600" />
            <Server v-else class="size-4 text-red-600" />
            <div class="min-w-0 flex-1"><p class="text-xs text-muted-foreground">本地 NewsNow 聚合服务</p><p class="truncate text-sm font-medium">{{ runtime?.newsNow?.online ? `运行正常 · ${runtime.newsNow.baseUrl}` : '未连接，本轮 NewsNow 来源会暂停' }}</p></div>
            <Badge :variant="runtime?.newsNow?.online ? 'default' : 'destructive'">{{ runtime?.newsNow?.online ? '本机在线' : '本机离线' }}</Badge>
          </div>
          <div class="flex items-center gap-2 rounded-lg border p-3"><LoaderCircle v-if="runtime?.state?.collectionRunning" class="size-4 text-amber-600" /><CheckCircle2 v-else class="size-4 text-emerald-600" /><div><p class="text-xs text-muted-foreground">资讯采集</p><p class="text-sm font-medium">{{ runtime?.state?.collectionRunning ? '正在抓取' : '等待下一轮' }}</p></div></div>
          <div class="flex items-center gap-2 rounded-lg border p-3"><LoaderCircle v-if="runtime?.state?.contentRunning" class="size-4 text-amber-600" /><CheckCircle2 v-else class="size-4 text-emerald-600" /><div><p class="text-xs text-muted-foreground">正文补全</p><p class="text-sm font-medium">{{ runtime?.state?.contentRunning ? '正在解析' : '队列运行正常' }}</p></div></div>
        </div>

        <div class="grid grid-cols-2 gap-2 text-sm">
          <div class="rounded-lg bg-muted/60 p-3"><p class="flex items-center gap-2 text-xs text-muted-foreground"><Database class="size-3.5" />可供 AI</p><p class="mt-1 text-xl font-semibold">{{ runtimeCounts.analyzable }}</p></div>
          <div class="rounded-lg bg-muted/60 p-3"><p class="flex items-center gap-2 text-xs text-muted-foreground"><FileText class="size-3.5" />完整文章</p><p class="mt-1 text-xl font-semibold">{{ runtimeCounts.article }}</p></div>
          <div class="rounded-lg bg-muted/60 p-3"><p class="text-xs text-muted-foreground">完整快讯</p><p class="mt-1 text-xl font-semibold">{{ runtimeCounts.brief }}</p></div>
          <div class="rounded-lg bg-muted/60 p-3"><p class="text-xs text-muted-foreground">仅标题线索</p><p class="mt-1 text-xl font-semibold">{{ runtimeCounts.headlineOnly }}</p></div>
        </div>

        <div>
          <div class="mb-2 flex items-center justify-between text-xs"><span class="text-muted-foreground">有效内容覆盖</span><span>{{ runtimeCounts.total ? Math.round(runtimeCounts.analyzable / runtimeCounts.total * 100) : 0 }}%</span></div>
          <progress class="h-2 w-full" :value="runtimeCounts.analyzable" :max="Math.max(1, runtimeCounts.total)">{{ runtimeCounts.analyzable }}</progress>
          <p class="mt-2 text-xs text-muted-foreground">待补正文 {{ runtime?.queue?.waiting || 0 }} · 摘要待升级 {{ runtime?.queue?.upgrade || 0 }} · 等待重试 {{ runtime?.queue?.retrying || 0 }}</p>
        </div>

        <Alert v-if="runtimeCounts.headlineOnly"><TriangleAlert class="size-4" /><AlertTitle>{{ runtimeCounts.headlineOnly }} 条仅为热度线索</AlertTitle><AlertDescription>雪球热门股票、微博热搜这类条目保留展示，但不会送给 AI 凭标题推断事实。</AlertDescription></Alert>
        <Alert v-if="runtimeError" variant="destructive"><CircleAlert class="size-4" /><AlertTitle>状态面板连接失败</AlertTitle><AlertDescription>{{ runtimeError }}</AlertDescription></Alert>

        <div>
          <div class="mb-2 flex items-center justify-between"><p class="text-sm font-medium">最近活动</p><Button type="button" size="sm" variant="ghost" :disabled="runtimeBusy" @click="loadRuntime"><LoaderCircle v-if="runtimeBusy" class="size-4" /><RefreshCw v-else class="size-4" />刷新</Button></div>
          <div class="max-h-56 space-y-1 overflow-y-auto">
            <div v-for="activity in monitorActivities" :key="activity.id" class="flex items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-muted/60"><ChevronRight class="size-3.5 text-muted-foreground" /><Badge variant="outline">{{ activity.type }}</Badge><span class="min-w-0 flex-1 truncate">{{ activity.detail }}</span><span class="shrink-0 text-muted-foreground">{{ dateTime(activity.at) }}</span></div>
            <p v-if="!monitorActivities.length" class="py-4 text-center text-xs text-muted-foreground">还没有运行记录</p>
          </div>
        </div>
      </CardContent>
    </Card>
    <Card v-else class="min-w-0 shadow-none">
      <CardHeader><div class="flex items-center justify-between gap-3"><div><CardTitle class="flex items-center gap-2"><Activity class="size-5 text-muted-foreground" />运行面板已收起</CardTitle><CardDescription>后台采集与正文补全仍会继续运行。</CardDescription></div><Button type="button" variant="outline" @click="monitorOpen = true"><PanelRightOpen class="size-4" />展开</Button></div></CardHeader>
    </Card>
  </section>

  <Card class="mt-4 shadow-none">
    <CardHeader>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <CardTitle>资讯库</CardTitle>
          <CardDescription>采集与 AI 整理解耦；完整整理后按优先级展示，否则默认按发布时间展示。</CardDescription>
        </div>
        <div class="flex items-center gap-2"><Badge variant="outline">{{ events.length }} 条</Badge><Badge variant="secondary">AI 覆盖 {{ processingCoverage }}%</Badge></div>
      </div>
    </CardHeader>
    <CardContent class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Tabs v-model="viewMode">
          <TabsList>
            <TabsTrigger value="latest"><Clock3 class="mr-1 size-4" />最新资讯</TabsTrigger>
            <TabsTrigger value="smart" :disabled="!processedEvents.length"><Sparkles class="mr-1 size-4" />智能优先</TabsTrigger>
          </TabsList>
        </Tabs>
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative w-44">
            <Input v-model="industryFilter" placeholder="按行业标签筛选" />
            <div v-if="allIndustryTags.length && industryFilter.trim()" class="absolute inset-y-0 right-2 flex items-center">
              <Button size="icon-xs" variant="ghost" @click="industryFilter = ''"><span class="text-xs">✕</span></Button>
            </div>
          </div>
          <div class="relative w-36">
            <Input v-model="assetFilter" placeholder="按证券代码筛选" />
            <div v-if="assetFilter.trim()" class="absolute inset-y-0 right-2 flex items-center">
              <Button size="icon-xs" variant="ghost" @click="assetFilter = ''"><span class="text-xs">✕</span></Button>
            </div>
          </div>
        </div>
        <p class="text-sm text-muted-foreground">
          {{ smartReady ? '本页资讯均已整理；当前持仓相关资讯优先，其余按 AI 阅读优先级排序。' : processedEvents.length ? 'AI 仅完成部分资讯，默认保留时间顺序。' : '尚无 AI 结果，当前完全按时间顺序运行。' }}
        </p>
      </div>
      <DataTable
        v-if="events.length"
        :key="`${viewMode}-${industryFilter}-${assetFilter}`"
        :columns="informationColumns"
        :data="informationRows"
        :page-size="20"
        :search-keys="['summary']"
        search-placeholder="搜索标题、摘要、来源或标签"
        empty-message="没有符合条件的资讯"
      >
        <template #cell-priority="{ row }">
          <Badge :variant="row.priority == null ? 'outline' : Number(row.priority) >= 70 ? 'destructive' : 'secondary'">{{ row.priority == null ? '—' : row.priority }}</Badge>
        </template>
        <template #cell-portfolio="{ row }">
          <div v-if="row.holdingLinks.length" class="flex max-w-44 flex-wrap gap-1">
            <Badge v-for="link in row.holdingLinks" :key="`${link.assetCode}-${link.relation}`" :variant="Number(link.relevanceScore) >= 70 ? 'destructive' : 'secondary'">{{ link.assetName }} · {{ holdingRelationLabel(link.relation) }}</Badge>
          </div>
          <span v-else class="text-muted-foreground">—</span>
        </template>
        <template #cell-title="{ row }">
          <div class="max-w-xl text-left">
            <span class="font-medium">{{ row.title }}</span>
            <span class="mt-1 line-clamp-2 block text-sm leading-5 text-muted-foreground">{{ row.summary }}</span>
          </div>
        </template>
        <template #cell-sourceName="{ row }">
          <div><p>{{ row.sourceName }}</p><p v-if="row.rank" class="mt-1 text-xs text-muted-foreground">榜单 #{{ row.rank }}{{ row.hotValue ? ` · ${row.hotValue}` : '' }}</p></div>
        </template>
        <template #cell-tags="{ row }">
          <span class="block max-w-48 text-sm text-muted-foreground">{{ row.tags || '—' }}</span>
        </template>
        <template #cell-contentState="{ row }">
          <Badge :variant="String(row.contentState).startsWith('完整') ? 'default' : String(row.contentState).includes('失败') || String(row.contentState).includes('受限') ? 'destructive' : row.contentState === '仅标题线索' ? 'secondary' : 'outline'">{{ row.contentState }}</Badge>
        </template>
        <template #cell-aiState="{ row }">
          <div class="flex items-center gap-2"><Bot class="size-4 text-muted-foreground" /><span>{{ row.aiState }}</span></div>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex items-center gap-1">
            <Button size="sm" variant="outline" @click="openEventDetail(row.event)"><Eye class="size-4" />查看</Button>
            <Button size="icon-sm" variant="ghost" title="归档" @click="updateEventStatus(row.event, 'archived')"><Archive class="size-4" /></Button>
          </div>
        </template>
      </DataTable>
      <p v-else class="py-10 text-center text-muted-foreground">还没有资讯事件。采集器取得内容后会自动出现在这里。</p>
    </CardContent>
  </Card>

  <Card class="mt-4 shadow-none">
    <CardHeader><div class="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>AI 持仓影响清单</CardTitle><CardDescription>AI 自动完成影响初评；只有高关联、高影响或证据存疑的项目才需要你确认。</CardDescription></div><Badge variant="outline">高级证据记录 {{ assessments.length }}</Badge></div></CardHeader>
    <CardContent class="space-y-3">
      <div v-for="item in aiHoldingImpacts" :key="`${item.event.id}-${item.impact.assetCode}`" class="grid gap-3 rounded-lg border p-4 lg:grid-cols-[minmax(150px,0.8fr)_minmax(100px,0.5fr)_minmax(140px,0.7fr)_minmax(0,1.8fr)_auto] lg:items-center">
        <div><p class="text-xs text-muted-foreground">当前持仓</p><p class="mt-1 font-medium">{{ item.impact.assetName }} · {{ item.impact.assetCode }}</p></div>
        <div><p class="text-xs text-muted-foreground">影响初评</p><p class="mt-1 font-medium">{{ directionLabel(item.impact.direction) }} · {{ impactScoreLabel(item.impact.impactScore) }}</p></div>
        <div><p class="text-xs text-muted-foreground">证据状态</p><p class="mt-1 text-sm">{{ evidenceStatusLabel(item.impact.assessmentStatus) }} · {{ impactTimeframeLabel(item.impact.impactTimeframe) }}</p></div>
        <div class="min-w-0"><p class="truncate font-medium">{{ item.event.title }}</p><p class="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{{ item.impact.reason }}</p></div>
        <div class="flex flex-wrap items-center gap-2"><Badge v-if="latestImpactConfirmation(item.event, item.impact)?.decision === 'confirmed'" variant="default">你已确认</Badge><Badge v-else-if="latestImpactConfirmation(item.event, item.impact)?.decision === 'rejected'" variant="destructive">你已否定</Badge><Badge v-else-if="item.impact.requiresUserConfirmation" variant="secondary">等待确认</Badge><Badge v-else variant="outline">AI自动完成</Badge><Button type="button" size="sm" variant="outline" @click="openEventDetail(item.event)"><Eye class="size-4" />查看</Button></div>
      </div>
      <p v-if="!aiHoldingImpacts.length" class="py-8 text-center text-muted-foreground">当前还没有新版AI持仓影响结果；完成下一批AI整理后会自动出现在这里，不需要你手工填写。</p>
    </CardContent>
  </Card>

  <Dialog v-model:open="eventDetailOpen">
    <DialogScrollContent class="max-w-4xl">
      <DialogHeader><DialogTitle>{{ selectedDetail?.title }}</DialogTitle><DialogDescription>{{ selectedDetail?.sourceName }} · {{ selectedDetail?.publishedAt }}</DialogDescription></DialogHeader>
      <div v-if="selectedDetail" class="space-y-5">
        <div class="flex flex-wrap gap-2"><Badge variant="outline">{{ sourceLabel(selectedDetail.sourceType) }}</Badge><Badge variant="secondary">{{ statusLabel(selectedDetail.status) }}</Badge><Badge :variant="selectedContent?.status === 'complete' ? 'default' : selectedContent?.status === 'headline_only' ? 'secondary' : 'outline'">内容 {{ localContentLabel(selectedContent?.status || selectedDetail.contentStatus, selectedContent?.content?.contentKind || selectedDetail.contentKind) }}</Badge><Badge :variant="selectedDetail.contentStatus === 'headline_only' ? 'secondary' : selectedDetail.aiProcessingStatus === 'completed' ? 'default' : 'outline'">AI {{ selectedDetail.contentStatus === 'headline_only' ? '不处理' : selectedDetail.aiProcessingStatus === 'completed' ? '已整理' : selectedDetail.aiProcessingStatus === 'failed' ? '失败' : selectedDetail.aiProcessingStatus === 'processing' ? '处理中' : '未整理' }}</Badge></div>
        <Alert v-if="selectedDetail.contentStatus === 'headline_only'"><TriangleAlert class="size-4" /><AlertTitle>这是一条热度线索，不是完整资讯</AlertTitle><AlertDescription>系统保留标题和排名供你观察市场关注度，但不会让 AI 仅凭标题生成事实或影响评分。</AlertDescription></Alert>
        <section class="rounded-lg border p-4">
          <div class="flex items-center justify-between gap-3"><p class="text-sm font-medium">本地保存的资讯内容</p><Button type="button" size="sm" variant="outline" :disabled="contentBusy || selectedDetail.contentStatus === 'headline_only'" @click="retryContent(selectedDetail)"><RefreshCw class="size-4" />{{ contentBusy ? '正在补抓' : '重新抓取' }}</Button></div>
          <div class="mt-3 space-y-3"><p v-for="(paragraph, index) in contentParagraphs" :key="index" class="text-sm leading-7">{{ paragraph }}</p></div>
          <p v-if="!contentBusy && selectedContent?.status !== 'complete'" class="mt-3 text-xs text-muted-foreground">{{ selectedContent?.error || (selectedContent?.status === 'headline_only' ? '此来源本身只提供热度标题，因此不会自动补写正文。' : '当前仅有来源摘要；后台会继续尝试保存公开可访问的完整正文。') }}</p>
        </section>
        <section v-if="selectedDetail.aiProcessingStatus === 'completed' && selectedDetail.aiEnrichment" class="space-y-3 rounded-lg border border-red-100 bg-red-50/40 p-4 dark:border-red-900/40 dark:bg-red-950/10">
          <div class="flex items-center justify-between gap-3"><p class="flex items-center gap-2 font-medium"><Sparkles class="size-4 text-red-600" />AI 整理</p><Badge>{{ selectedDetail.aiEnrichment.attentionPriorityScore }} 分</Badge></div>
          <p class="text-sm leading-7">{{ selectedDetail.aiEnrichment.shortSummary }}</p>
          <div class="flex flex-wrap gap-2"><Badge v-for="tag in [...(selectedDetail.aiEnrichment.topicTags || []), ...(selectedDetail.aiEnrichment.industryTags || [])]" :key="tag" variant="outline">{{ tag }}</Badge></div>
          <div v-if="selectedDetail.aiEnrichment.holdingRelevance?.length" class="space-y-3 rounded-lg border bg-background/70 p-3">
            <div><p class="text-sm font-medium">AI 对当前持仓的影响初评</p><p class="mt-1 text-xs text-muted-foreground">这是证据约束下的辅助判断，不是涨跌概率或买卖指令。</p></div>
            <div v-for="link in selectedDetail.aiEnrichment.holdingRelevance" :key="`${link.assetCode}-${link.relation}`" class="space-y-2 rounded-lg border p-3 text-sm">
              <div class="flex flex-wrap items-center gap-2"><Badge variant="destructive">持仓相关</Badge><span class="font-medium">{{ link.assetName }} · {{ link.assetCode }}</span><Badge variant="outline">{{ holdingRelationLabel(link.relation) }}</Badge><Badge variant="secondary">{{ directionLabel(link.direction) }} · 影响 {{ impactScoreLabel(link.impactScore) }}</Badge><Badge variant="outline">相关度 {{ link.relevanceScore }}</Badge></div>
              <p class="leading-6 text-muted-foreground">{{ link.reason }}</p>
              <div class="grid gap-2 rounded-md bg-muted/60 p-3 sm:grid-cols-3"><div><p class="text-xs text-muted-foreground">证据状态</p><p class="mt-1">{{ evidenceStatusLabel(link.assessmentStatus) }}</p></div><div><p class="text-xs text-muted-foreground">影响时间</p><p class="mt-1">{{ impactTimeframeLabel(link.impactTimeframe) }}</p></div><div><p class="text-xs text-muted-foreground">AI置信度</p><p class="mt-1">{{ Math.round(Number(link.confidence || 0) * 100) }}%</p></div></div>
              <p><span class="text-muted-foreground">传导路径：</span>{{ (link.transmissionPath || []).join(' → ') }}</p>
              <div v-if="link.keyEvidence?.length"><p class="text-xs text-muted-foreground">关键证据</p><div class="mt-1 space-y-1"><p v-for="evidence in link.keyEvidence" :key="evidence">· {{ evidence }}</p></div></div>
              <div v-if="link.missingEvidence?.length"><p class="text-xs text-muted-foreground">尚缺证据</p><div class="mt-1 space-y-1"><p v-for="evidence in link.missingEvidence" :key="evidence">· {{ evidence }}</p></div></div>
              <div v-if="latestImpactConfirmation(selectedDetail, link)" class="flex items-center gap-2"><Badge :variant="latestImpactConfirmation(selectedDetail, link).decision === 'confirmed' ? 'default' : 'destructive'">{{ latestImpactConfirmation(selectedDetail, link).decision === 'confirmed' ? '你已确认合理' : '你已标记不准确' }}</Badge><span class="text-xs text-muted-foreground">{{ dateTime(latestImpactConfirmation(selectedDetail, link).confirmedAt) }}</span></div>
              <div v-else-if="link.requiresUserConfirmation" class="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20"><p class="text-sm">{{ link.confirmationReason }}</p><div class="flex flex-wrap gap-2"><Button type="button" size="sm" :disabled="busy" @click="confirmHoldingImpact(selectedDetail, link, 'confirmed')"><CheckCircle2 class="size-4" />确认合理</Button><Button type="button" size="sm" variant="outline" :disabled="busy" @click="confirmHoldingImpact(selectedDetail, link, 'rejected')"><CircleAlert class="size-4" />标记不准确</Button></div></div>
              <div v-else><Badge variant="outline">AI自动完成，无需你确认</Badge></div>
              <div v-if="link.assessmentStatus !== 'supported' || latestImpactConfirmation(selectedDetail, link)?.decision === 'rejected'" class="flex flex-wrap items-center justify-between gap-2 border-t pt-2"><span class="text-xs text-muted-foreground">只有需要补充专业证据时才使用高级工具</span><Button type="button" size="sm" variant="ghost" @click="eventDetailOpen = false; openAssessment(selectedDetail, link)"><FileSearch class="size-4" />高级九段传导评估</Button></div>
            </div>
          </div>
          <p class="text-sm"><span class="text-muted-foreground">排序理由：</span>{{ selectedDetail.aiEnrichment.rankingReason }}</p>
        </section>
        <p v-if="selectedDetail.aiProcessingError" class="text-sm text-red-600">上次 AI 整理失败：{{ selectedDetail.aiProcessingError }}</p>
      </div>
      <DialogFooter>
        <a :href="selectedDetail?.sourceUrl" target="_blank" rel="noreferrer"><Button type="button" variant="outline"><Link2 class="size-4" />访问原始网页</Button></a>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>

  <Dialog v-model:open="eventDialogOpen">
    <DialogScrollContent class="max-w-3xl">
      <DialogHeader><DialogTitle>录入资讯事件</DialogTitle><DialogDescription>保存原文事实，不在摘要里混入涨跌判断。</DialogDescription></DialogHeader>
      <form class="space-y-4" @submit.prevent="saveEvent">
        <div class="grid gap-4 sm:grid-cols-2"><FieldBlock label="标题"><Input v-model="informationForm.title" required /></FieldBlock><FieldBlock label="来源类别"><Select v-model="informationForm.sourceType"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in sourceTypes" :key="item.value" :value="item.value">{{ item.label }}</SelectItem></SelectContent></Select></FieldBlock><FieldBlock label="来源主体"><Input v-model="informationForm.sourceName" required /></FieldBlock><FieldBlock label="发布时间"><DatePickerControl v-model="informationForm.publishedAt" /></FieldBlock></div>
        <FieldBlock label="原文链接"><Input v-model="informationForm.sourceUrl" type="url" required placeholder="https://" /></FieldBlock>
        <FieldBlock label="原文事实摘要"><Textarea v-model="informationForm.summary" required placeholder="只摘录可核验事实、对象、时间、预算和执行单位" /></FieldBlock>
        <div class="grid gap-4 sm:grid-cols-2"><FieldBlock label="关联公司（可选）"><StockPicker v-model="selectedStock" /></FieldBlock><FieldBlock label="行业标签（可选）"><Input v-model="informationForm.industryTags" placeholder="光纤、算力网络" /></FieldBlock></div>
        <Alert v-if="eventPreview"><component :is="eventPreview.duplicateId ? CircleAlert : ShieldCheck" class="size-4" /><AlertTitle>{{ eventPreview.duplicateId ? '发现相同资讯' : '资讯字段可保存' }}</AlertTitle><AlertDescription>{{ eventPreview.duplicateId ? `现有事件 ${eventPreview.duplicateId}，确认后不会重复写入。` : `原文哈希 ${eventPreview.event.originalHash.slice(0, 12)}…` }}</AlertDescription></Alert>
        <DialogFooter><Button type="button" variant="outline" @click="eventDialogOpen = false">取消</Button><Button type="button" variant="outline" :disabled="busy" @click="previewEvent"><Eye class="size-4" />预览去重</Button><Button type="submit" :disabled="busy"><Save class="size-4" />确认保存</Button></DialogFooter>
      </form>
    </DialogScrollContent>
  </Dialog>

  <Dialog v-model:open="assessmentDialogOpen">
    <DialogScrollContent class="max-w-6xl">
      <DialogHeader><DialogTitle>高级证据评估（通常无需填写）</DialogTitle><DialogDescription>{{ selectedEvent?.title }} · 仅当AI结论不准确或需要补充专业证据时使用；平时只看AI结果即可。</DialogDescription></DialogHeader>
      <form class="space-y-5" @submit.prevent="saveInfluence">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><FieldBlock label="评估公司"><StockPicker v-model="selectedStock" /></FieldBlock><FieldBlock label="方向"><Select v-model="assessmentForm.direction"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">正向</SelectItem><SelectItem value="0">中性 / 未知</SelectItem><SelectItem value="-1">负向</SelectItem></SelectContent></Select></FieldBlock><FieldBlock label="内容可信度（0–5）"><NumberField :model-value="numericValue(assessmentForm.credibility)" :min="0" :max="5" @update:model-value="value => updateFactor('credibility', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="独立印证数量（0–3）"><NumberField :model-value="numericValue(assessmentForm.corroboration)" :min="0" :max="3" @update:model-value="value => updateFactor('corroboration', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock></div>
        <div class="flex items-center gap-3 rounded-lg border p-3 text-sm"><Checkbox v-model="assessmentForm.originalAvailable" /><span>已经取得原文或一手材料，不是搜索摘要</span></div>
        <Card class="shadow-none"><CardHeader><CardTitle class="text-base">事件强度（0–5）</CardTitle><CardDescription>事件强度与公司是否受益分开。</CardDescription></CardHeader><CardContent class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><FieldBlock v-for="field in eventFields" :key="field.key" :label="field.label"><NumberField :model-value="numericValue(assessmentForm[field.key])" :min="0" :max="5" @update:model-value="value => updateFactor(field.key, value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="市场已计价程度（0–5）"><NumberField :model-value="numericValue(assessmentForm.pricedIn)" :min="0" :max="5" @update:model-value="value => updateFactor('pricedIn', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock></CardContent></Card>
        <Card class="shadow-none"><CardHeader><CardTitle class="text-base">公司九段传导链（0–5）</CardTitle><CardDescription>每个分数都要填写原文链接、公告编号或可定位的事实引用；关键节点缺证据时不会生成公司影响分。</CardDescription></CardHeader><CardContent class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><FieldBlock v-for="stage in transmissionStages" :key="stage.key" :label="`${stage.label}${stage.critical ? '（关键）' : ''}`"><div class="space-y-2"><NumberField :model-value="numericValue(stageScores[stage.key])" :min="0" :max="5" @update:model-value="value => updateStage(stage.key, value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField><Input v-model="stageEvidence[stage.key]" placeholder="事实引用 / 原文链接 / 公告编号" /></div></FieldBlock></CardContent></Card>
        <Alert v-if="influencePreview" :variant="influencePreview.status === 'rejected_transmission' ? 'destructive' : 'default'"><component :is="influencePreview.companyImpactScore == null ? CircleAlert : ListChecks" class="size-4" /><AlertTitle>阅读优先级 {{ influencePreview.attentionPriorityScore ?? '未评分' }} · 公司影响 {{ influencePreview.companyImpactScore ?? '待核验' }}</AlertTitle><AlertDescription>{{ influencePreview.scoreMeaning }} {{ influencePreview.nextVerification }}</AlertDescription></Alert>
        <DialogFooter><Button type="button" variant="outline" @click="assessmentDialogOpen = false">取消</Button><Button type="button" variant="outline" :disabled="busy" @click="previewInfluence"><Eye class="size-4" />预览影响</Button><Button type="submit" :disabled="busy"><Save class="size-4" />确认保存评估</Button></DialogFooter>
      </form>
    </DialogScrollContent>
  </Dialog>

  <Dialog v-model:open="sourceDialogOpen">
    <DialogScrollContent class="max-w-3xl">
      <DialogHeader><DialogTitle>配置免费资讯来源</DialogTitle><DialogDescription>支持 RSS/Atom、JSON Feed、NewsNow、SEC EDGAR 和 Federal Register；均不需要购买接口额度。X 已从可选来源中移除。</DialogDescription></DialogHeader>
      <form class="space-y-4" @submit.prevent="saveSource">
        <div><p class="mb-2 text-sm font-medium">官方来源模板</p><div class="flex flex-wrap gap-2"><Button v-for="template in sourceTemplates" :key="template.name" type="button" size="sm" variant="outline" @click="applySourceTemplate(template)">{{ template.name }}</Button></div></div>
        <div class="grid gap-4 sm:grid-cols-2"><FieldBlock label="来源名称"><Input v-model="sourceForm.name" required /></FieldBlock><FieldBlock label="免费适配器"><Select v-model="sourceForm.adapter"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in sourceAdapters" :key="item.value" :value="item.value">{{ item.label }}</SelectItem></SelectContent></Select></FieldBlock><FieldBlock label="证据来源类别"><Select v-model="sourceForm.sourceType"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in sourceTypes" :key="item.value" :value="item.value">{{ item.label }}</SelectItem></SelectContent></Select></FieldBlock></div>
        <FieldBlock v-if="['rss_atom', 'json_feed'].includes(sourceForm.adapter)" :label="sourceForm.adapter === 'rss_atom' ? 'RSS / Atom 地址' : 'JSON Feed 地址'"><Input v-model="sourceForm.url" type="url" required placeholder="https://example.gov.cn/rss.xml" /></FieldBlock>
        <div v-else-if="sourceForm.adapter === 'newsnow'" class="grid gap-4 sm:grid-cols-3"><FieldBlock label="本地 NewsNow 地址"><Input v-model="sourceForm.baseUrl" type="url" required /></FieldBlock><FieldBlock label="来源 ID"><Input v-model="sourceForm.newsnowSourceId" required placeholder="cls-telegraph" /></FieldBlock><FieldBlock label="每次条数"><NumberField :model-value="numericValue(sourceForm.maxItems)" :min="1" :max="30" @update:model-value="value => sourceForm.maxItems = String(value ?? '')"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock></div>
        <div v-else-if="sourceForm.adapter === 'sec_edgar_submissions'" class="grid gap-4 sm:grid-cols-2"><FieldBlock label="公司 CIK"><Input v-model="sourceForm.cik" required placeholder="例如 NVIDIA：1045810" /></FieldBlock><FieldBlock label="访问标识与联系邮箱"><Input v-model="sourceForm.userAgent" required placeholder="TradeDiscipline your@email.com" /></FieldBlock></div>
        <div v-else class="grid gap-4 sm:grid-cols-3"><FieldBlock label="检索关键词"><Input v-model="sourceForm.term" placeholder="artificial intelligence" /></FieldBlock><FieldBlock label="机构标识（可选）"><Input v-model="sourceForm.agency" placeholder="commerce-department" /></FieldBlock><FieldBlock label="每次条数"><NumberField :model-value="numericValue(sourceForm.perPage)" :min="1" :max="100" @update:model-value="value => sourceForm.perPage = String(value ?? '')"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock></div>
        <div class="grid gap-4 sm:grid-cols-2"><FieldBlock label="最短间隔（分钟）"><NumberField :model-value="numericValue(sourceForm.minIntervalMinutes)" :min="5" :max="1440" @update:model-value="value => sourceForm.minIntervalMinutes = String(value ?? '')"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="最长间隔（分钟）"><NumberField :model-value="numericValue(sourceForm.maxIntervalMinutes)" :min="5" :max="1440" @update:model-value="value => sourceForm.maxIntervalMinutes = String(value ?? '')"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock></div>
        <div class="flex items-center gap-3 rounded-lg border p-3 text-sm"><Checkbox v-model="sourceForm.enabled" /><span>保存后启用自动采集</span></div>
        <Alert><ShieldCheck class="size-4" /><AlertTitle>零费用硬约束</AlertTitle><AlertDescription>当前选项不保存登录密码或令牌，也不调用付费接口。NewsNow 属于免费聚合源；SEC 要求填写联系邮箱只是访问规范，不是注册或付费。</AlertDescription></Alert>
        <DialogFooter><Button type="button" variant="outline" @click="sourceDialogOpen = false">取消</Button><Button type="submit" :disabled="busy"><Save class="size-4" />确认保存来源</Button></DialogFooter>
      </form>
    </DialogScrollContent>
  </Dialog>
</template>
