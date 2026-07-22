<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { CalendarCheck2, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, History, Pencil, Save, ShieldAlert, Sparkles } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import PageHeading from '@/components/app/PageHeading.vue'
import FieldBlock from '@/components/app/FieldBlock.vue'
import DatePickerControl from '@/components/app/DatePickerControl.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { NumberField, NumberFieldContent, NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Stepper, StepperDescription, StepperIndicator, StepperItem, StepperSeparator, StepperTitle, StepperTrigger } from '@/components/ui/stepper'
import { Textarea } from '@/components/ui/textarea'
import { api, dateTime, planLabel, planStatusLabel } from '@/lib/trade-api'

const props = defineProps<{ store: Record<string, any>; dashboard: Record<string, any> }>()
const emit = defineEmits<{ refresh: [] }>()
const activeStep = ref(1)
const busy = ref(false)
const planDialogOpen = ref(false)
const versionsOpen = ref(false)
const saveReasonDialogOpen = ref(false)
const confirmDialogOpen = ref(false)
const invalidateDialogOpen = ref(false)
const aiDraftDialogOpen = ref(false)
const aiDraftBusy = ref(false)
const aiWriteMode = ref('fill-empty')
const aiDraftJob = ref<any>(null)
const aiDraftError = ref('')
const aiDraftWrittenCount = ref(0)
const planAiPromptBusy = ref(false)
const planAiPromptMessage = ref('')
const confirmationReason = ref('')
const confirmError = ref('')
const confirmErrorLines = computed(() => confirmError.value.split('\n').filter(Boolean))
const invalidationReason = ref('')

const actionOptions = ['买入', '持有', '减仓', '卖出', '仅观察']

const steps = [
  { step: 1, title: '日期与总原则', description: '时间边界和账户约束' },
  { step: 2, title: '动作与风险', description: '逐个标的定义动作' },
  { step: 3, title: '三种情景', description: '基准、乐观与悲观' },
  { step: 4, title: '边界与确认', description: '失效条件和最终确认' },
]

const blankPlan = () => ({ id: '', planForDate: '', sourceReviewDate: '', status: 'draft', version: 1, validFrom: '', validUntil: '', expectedReturn: '', userMarketView: '', systemMarketView: '', previousAdvice: '', accountRules: '', trainingFocus: '', marketObservation: '', changeReason: '', rules: [] as any[] })
const form = reactive(blankPlan())
const universe = computed(() => {
  const map = new Map<string, any>()
  for (const holding of props.store?.holdings || []) map.set(String(holding.code), { ...holding, holding: true })
  for (const candidate of (props.store?.plannedAssets || []).filter((item: any) => item.status !== 'archived')) {
    const existing = map.get(String(candidate.code))
    map.set(String(candidate.code), { ...(existing || {}), ...candidate, holding: Boolean(existing) })
  }
  return [...map.values()]
})
const versions = computed(() => [...(props.store?.planVersions || [])].filter((item: any) => item.id === form.id).sort((a: any, b: any) => Number(b.version) - Number(a.version)))
const hasPlan = computed(() => Boolean(form.id))
const selectedResearch = computed(() => {
  const snapshots = [...(props.store?.researchSnapshots || [])]
  const exact = form.sourceReviewDate ? snapshots.find((item: any) => item.reviewDate === form.sourceReviewDate) : null
  return exact || snapshots.sort((a: any, b: any) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))[0] || null
})
const relevantEvidenceCount = computed(() => {
  const codes = new Set(form.rules.map((rule: any) => String(rule.code)))
  return (props.store?.evidenceRecords || []).filter((item: any) => codes.has(String(item.assetCode || item.code))).length
})
const aiDraftActiveStep = computed(() => {
  const steps = aiDraftJob.value?.steps || []
  const activeIndex = steps.findIndex((step: any) => ['running', 'failed'].includes(step.status))
  return activeIndex >= 0 ? activeIndex + 1 : Math.max(1, steps.filter((step: any) => step.status === 'completed').length)
})
const aiDraftProgress = computed(() => {
  const steps = aiDraftJob.value?.steps || []
  if (!steps.length) return 0
  const completed = steps.filter((step: any) => step.status === 'completed').length
  const running = steps.some((step: any) => step.status === 'running') ? 0.35 : 0
  return Math.min(100, ((completed + running) / steps.length) * 100)
})
let aiDraftPollTimer: ReturnType<typeof setTimeout> | undefined

function normalizedRule(asset: any, saved: any = {}) {
  return { code: String(asset.code), name: asset.name, direction: saved.direction || '__none__', allowedActions: saved.allowedActions || '', maxPositionPct: saved.maxPositionPct ?? '', maxRiskPct: saved.maxRiskPct ?? '', stopPrice: saved.stopPrice ?? '', triggerCondition: saved.triggerCondition || saved.wait || '', reduceCondition: saved.reduceCondition || saved.sell || '', exitCondition: saved.exitCondition || saved.stop || '', baseScenario: saved.baseScenario || '', bullScenario: saved.bullScenario || '', bearScenario: saved.bearScenario || '', forbidden: saved.forbidden || '不做计划外加仓', invalidationCondition: saved.invalidationCondition || '', defaultAction: saved.defaultAction || '不新增风险，等待确认', flexibleRange: saved.flexibleRange || '' }
}

function numericValue(value: unknown) {
  if (value === '' || value == null) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function updateNumeric(rule: Record<string, any>, key: string, value: number | undefined) {
  rule[key] = value == null ? '' : String(value)
}

function selectedActions(value: unknown) {
  const raw = String(value || '')
  return actionOptions.filter(action => {
    if (action === '卖出') return /卖出|退出/.test(raw)
    if (action === '仅观察') return /仅?观察/.test(raw)
    return raw.includes(action)
  })
}

function isActionSelected(rule: Record<string, any>, action: string) {
  return selectedActions(rule.allowedActions).includes(action)
}

function toggleAllowedAction(rule: Record<string, any>, action: string, selected: boolean) {
  const values = new Set(selectedActions(rule.allowedActions))
  if (selected && action === '仅观察') {
    values.clear()
    values.add(action)
  } else if (selected) {
    values.delete('仅观察')
    values.add(action)
  }
  else values.delete(action)
  rule.allowedActions = actionOptions.filter(item => values.has(item)).join('、')
}

function withDefaultTime(value: unknown, fallbackDate: string, fallbackTime: string) {
  const raw = String(value || fallbackDate || '')
  if (!raw) return ''
  return raw.includes('T') ? raw : `${raw.slice(0, 10)}T${fallbackTime}`
}

function hydrate(plan: any) {
  const planDate = plan?.planForDate || props.dashboard?.nextTradingDate || ''
  Object.assign(form, blankPlan(), plan || {}, {
    planForDate: planDate,
    sourceReviewDate: plan?.sourceReviewDate || '',
    validFrom: withDefaultTime(plan?.validFrom, planDate, '09:15:00'),
    validUntil: withDefaultTime(plan?.validUntil, planDate, '15:30:00'),
    changeReason: '',
    rules: universe.value.map(asset => normalizedRule(asset, (plan?.rules || []).find((item: any) => String(item.code) === String(asset.code)))),
  })
  confirmationReason.value = ''
  confirmError.value = ''
  invalidationReason.value = ''
}

watch(() => [props.dashboard?.plan, universe.value.map(item => item.code).join(',')], () => hydrate(props.dashboard?.plan), { immediate: true })

function openPlanDialog() {
  activeStep.value = 1
  planDialogOpen.value = true
}

function requestSave() {
  form.changeReason = ''
  saveReasonDialogOpen.value = true
}

function requestConfirm() {
  if (!form.id) {
    toast.error('请先保存计划版本')
    return
  }
  confirmationReason.value = ''
  confirmError.value = ''
  confirmDialogOpen.value = true
}

function requestInvalidate() {
  if (!form.id) {
    toast.error('还没有可以标记失效的计划')
    return
  }
  invalidationReason.value = ''
  invalidateDialogOpen.value = true
}

function requestAiDraft() {
  aiWriteMode.value = 'fill-empty'
  aiDraftJob.value = null
  aiDraftError.value = ''
  aiDraftWrittenCount.value = 0
  planAiPromptMessage.value = ''
  aiDraftDialogOpen.value = true
}

function handleAiDraftDialogOpen(open: boolean) {
  if (!open && aiDraftBusy.value) {
    toast.info('AI 任务仍在运行', { description: '完成或失败后才能关闭，这样不会丢失生成结果。' })
    return
  }
  aiDraftDialogOpen.value = open
}

function shouldWriteAiField(current: unknown) {
  return aiWriteMode.value === 'replace-ai' || !String(current || '').trim()
}

function applyAiDraftResult(result: any) {
  const draft = result?.draft || {}
  const planFields = ['systemMarketView', 'previousAdvice', 'accountRules', 'trainingFocus', 'marketObservation']
  const ruleFields = ['triggerCondition', 'reduceCondition', 'exitCondition', 'baseScenario', 'bullScenario', 'bearScenario']
  let written = 0
  let returned = 0
  let matchedRules = 0
  for (const field of planFields) {
    if (draft[field]) returned += 1
    if (draft[field] && shouldWriteAiField((form as any)[field])) {
      ;(form as any)[field] = draft[field]
      written += 1
    }
  }
  for (const generatedRule of draft.rules || []) {
    for (const field of ruleFields) if (generatedRule[field]) returned += 1
    const rule = form.rules.find(item => String(item.code) === String(generatedRule.code))
    if (!rule) continue
    matchedRules += 1
    for (const field of ruleFields) {
      if (generatedRule[field] && shouldWriteAiField(rule[field])) {
        rule[field] = generatedRule[field]
        written += 1
      }
    }
  }
  aiDraftWrittenCount.value = written
  const writeStep = aiDraftJob.value?.steps?.find((step: any) => step.id === 'write')
  if (!written) {
    const reason = !returned
      ? 'AI 返回的草稿没有包含任何可写入字段。'
      : !matchedRules && Array.isArray(draft.rules) && draft.rules.length
        ? 'AI 返回的标的代码与当前计划不匹配。'
        : aiWriteMode.value === 'fill-empty'
          ? `AI 返回了 ${returned} 个字段，但当前选择“仅补全空白”，这些字段都已有内容。`
          : 'AI 返回了字段，但没有任何内容发生变化。'
    if (writeStep) Object.assign(writeStep, { status: 'failed', detail: reason })
    if (aiDraftJob.value) aiDraftJob.value.status = 'failed'
    aiDraftError.value = `没有写入任何字段：${reason}`
    toast.error('AI 草稿未写入', { description: aiDraftError.value, duration: 10000 })
    return false
  }
  if (writeStep) Object.assign(writeStep, { status: 'completed', detail: `已写入 ${written} 个字段，等待你审核并保存` })
  aiDraftJob.value.status = 'applied'
  toast.success('AI 辅助草稿已写入表单', { description: `已写入 ${written} 个字段；请逐项审核后保存计划版本。` })
  if (draft.warnings?.length) toast.warning('部分资料需要复核', { description: draft.warnings.slice(0, 2).join('；'), duration: 10000 })
  return true
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

async function copyPlanAiPrompt(kind: 'generate' | 'write') {
  if (!form.id) {
    toast.error('请先保存当前计划版本', { description: '保存后才能生成带有稳定计划编号的 AI 接口提示词。' })
    return
  }
  planAiPromptBusy.value = true
  planAiPromptMessage.value = ''
  try {
    const payload = await api<any>('/api/plan-ai-import/prompts', {
      method: 'POST',
      body: JSON.stringify({ plan: form }),
    })
    const label = kind === 'generate' ? '生成提示词' : '写入应用提示词'
    await writeClipboard(kind === 'generate' ? payload.generatePrompt : payload.writePrompt)
    planAiPromptMessage.value = `${label}已复制（${(kind === 'generate' ? payload.generatePrompt : payload.writePrompt).length} 字）。${kind === 'generate' ? '本机 AI 可按位置读取；网页 AI 请同时上传资料包。' : '把它交给能访问本机文件和命令行的 AI。'}`
    toast.success(`${label}已复制`)
  } catch (error) {
    planAiPromptMessage.value = error instanceof Error ? error.message : '复制失败，请稍后重试。'
    toast.error('提示词复制失败', { description: planAiPromptMessage.value })
  } finally {
    planAiPromptBusy.value = false
  }
}

async function downloadPlanAiContext() {
  if (!form.id) {
    toast.error('请先保存当前计划版本')
    return
  }
  planAiPromptBusy.value = true
  try {
    const payload = await api<any>('/api/plan-ai-import/prompts', {
      method: 'POST',
      body: JSON.stringify({ plan: form }),
    })
    const link = document.createElement('a')
    link.href = payload.contextDownloadUrl
    link.download = payload.contextFileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    planAiPromptMessage.value = `资料包 ${payload.contextFileName} 已开始下载；使用网页 AI 时，把这个文件作为附件上传。`
    toast.success('AI 资料包已下载')
  } catch (error) {
    planAiPromptMessage.value = error instanceof Error ? error.message : '资料包下载失败。'
    toast.error('资料包下载失败', { description: planAiPromptMessage.value })
  } finally {
    planAiPromptBusy.value = false
  }
}

async function refreshAiImportedPlan() {
  await loadDate()
  emit('refresh')
  planAiPromptMessage.value = '已重新加载当前日期的计划；如果 AI 完成写入，这里会显示新的计划版本。'
}

function scheduleAiDraftPoll() {
  if (aiDraftPollTimer) clearTimeout(aiDraftPollTimer)
  aiDraftPollTimer = setTimeout(pollAiDraftJob, 1200)
}

function retryAiDraftProgress() {
  aiDraftError.value = ''
  aiDraftBusy.value = true
  pollAiDraftJob()
}

async function pollAiDraftJob() {
  const jobId = aiDraftJob.value?.id
  if (!jobId) return
  try {
    const payload = await api<any>(`/api/plans/ai-draft/${encodeURIComponent(jobId)}`)
    aiDraftJob.value = payload.job
    if (payload.job.status === 'completed') {
      applyAiDraftResult(payload.job.result)
      aiDraftBusy.value = false
      return
    }
    if (payload.job.status === 'failed') {
      aiDraftError.value = payload.job.error || 'AI 草稿生成失败'
      aiDraftBusy.value = false
      toast.error('AI 草稿生成失败', { description: aiDraftError.value, duration: 10000 })
      return
    }
    scheduleAiDraftPoll()
  } catch (error) {
    aiDraftError.value = error instanceof Error ? `进度查询失败：${error.message}` : '进度查询失败'
    aiDraftBusy.value = false
    toast.error('无法查询 AI 任务进度', { description: aiDraftError.value, duration: 10000 })
  }
}

async function generateAiDraft() {
  if (!form.rules.length) {
    toast.error('暂时不能生成', { description: '请先加入至少一个交易标的。' })
    return
  }
  aiDraftBusy.value = true
  aiDraftError.value = ''
  aiDraftWrittenCount.value = 0
  aiDraftJob.value = null
  try {
    const payload = await api<any>('/api/plans/ai-draft', {
      method: 'POST',
      body: JSON.stringify({ plan: form, sourceReviewDate: form.sourceReviewDate || null }),
    })
    aiDraftJob.value = payload.job
    scheduleAiDraftPoll()
  } catch (error) {
    aiDraftError.value = error instanceof Error ? error.message : '请稍后重试'
    aiDraftBusy.value = false
    toast.error('AI 任务启动失败', { description: aiDraftError.value, duration: 10000 })
  }
}

onBeforeUnmount(() => {
  if (aiDraftPollTimer) clearTimeout(aiDraftPollTimer)
})

async function loadDate() {
  busy.value = true
  try {
    const result = await api<any>(`/api/plans?date=${encodeURIComponent(form.planForDate)}`)
    const selected = result.selected || { planForDate: form.planForDate, status: 'draft', version: 1, rules: [] }
    hydrate(selected)
    if (result.selected) toast.success(`已加载 ${form.planForDate} 的计划`, { description: `当前为 V${form.version} · ${planStatusLabel(form.status)}` })
    else toast.info(`${form.planForDate} 暂无计划`, { description: '页面已准备好空白计划，点击“制定计划”开始填写。' })
  } catch (error) {
    toast.error('计划加载失败', { description: error instanceof Error ? error.message : '请稍后重试' })
  } finally {
    busy.value = false
  }
}

async function savePlan() {
  if (!form.planForDate || !form.validFrom || !form.validUntil) {
    activeStep.value = 1
    saveReasonDialogOpen.value = false
    toast.error('计划还不能保存', { description: '请先填写交易日、生效时间和失效时间。' })
    return
  }
  busy.value = true
  const rules = form.rules.map(rule => ({ ...rule, direction: rule.direction === '__none__' ? '' : rule.direction, maxPositionPct: rule.maxPositionPct === '' ? null : Number(rule.maxPositionPct), maxRiskPct: rule.maxRiskPct === '' ? null : Number(rule.maxRiskPct), stopPrice: rule.stopPrice === '' ? null : Number(rule.stopPrice) }))
  try {
    const result = await api<any>('/api/plans', { method: 'PUT', body: JSON.stringify({ ...form, id: form.id || undefined, changeReason: form.changeReason.trim() || (form.id ? '手动保存计划版本' : '首次创建计划'), planFormat: 'v0.3', sourceReviewDate: form.sourceReviewDate || null, rules }) })
    hydrate(result.plan)
    saveReasonDialogOpen.value = false
    planDialogOpen.value = false
    toast.success(`计划 V${result.plan.version} 已保存`, { description: `当前状态：${planStatusLabel(result.plan.status)}` })
    emit('refresh')
  } catch (error) {
    toast.error('计划保存失败', { description: error instanceof Error ? error.message : '请检查输入后重试' })
  } finally {
    busy.value = false
  }
}

async function confirmPlan() {
  if (!form.id) {
    confirmError.value = '请先保存计划版本。'
    toast.error('暂时不能确认', { description: confirmError.value, duration: 8000 })
    return
  }
  confirmError.value = ''
  busy.value = true
  try {
    const result = await api<any>(`/api/plans/${encodeURIComponent(form.id)}/confirm`, { method: 'POST', body: JSON.stringify({ reason: confirmationReason.value.trim() || '用户确认计划生效' }) })
    hydrate(result.plan)
    confirmDialogOpen.value = false
    planDialogOpen.value = false
    toast.success(`V${result.plan.version} 已确认并生效`, { description: '已返回下一交易日计划。' })
    emit('refresh')
  } catch (error) {
    const message = error instanceof Error ? error.message : '请检查计划完整性'
    confirmError.value = message.replace(/；/g, '；\n')
    toast.error('计划确认失败', { description: '计划仍为待确认，请查看确认窗口里的缺失项目。', duration: 8000 })
  } finally {
    busy.value = false
  }
}

async function invalidatePlan() {
  if (!form.id || !invalidationReason.value.trim()) {
    toast.error('请填写失效原因')
    return
  }
  busy.value = true
  try {
    const result = await api<any>(`/api/plans/${encodeURIComponent(form.id)}/invalidate`, { method: 'POST', body: JSON.stringify({ reason: invalidationReason.value }) })
    hydrate(result.plan)
    invalidateDialogOpen.value = false
    planDialogOpen.value = false
    toast.success('计划已标记失效', { description: '该版本不能再作为执行依据。' })
    emit('refresh')
  } catch (error) {
    toast.error('标记失效失败', { description: error instanceof Error ? error.message : '请稍后重试' })
  } finally {
    busy.value = false
  }
}

function previewVersion(item: any) {
  hydrate(item)
  versionsOpen.value = false
  toast.info(`已切换查看 V${item.version}`, { description: '这只会替换当前页面的展示内容，不会改写已保存记录。' })
}
</script>

<template>
  <PageHeading eyebrow="Plan for a trading day" title="下一交易日计划" description="默认展示当前计划；需要制定或调整时，再进入四步编辑表单。">
    <template #actions>
      <FieldBlock label="查看日期">
        <div class="flex gap-2"><DatePickerControl v-model="form.planForDate" /><Button variant="outline" :disabled="busy" @click="loadDate">加载</Button></div>
      </FieldBlock>
    </template>
  </PageHeading>

  <div class="grid gap-4 xl:grid-cols-3">
    <Card class="shadow-none xl:col-span-2">
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardDescription>{{ form.planForDate || '尚未选择交易日' }}</CardDescription>
            <CardTitle class="mt-1">{{ hasPlan ? planLabel(form) : '尚未制定下一交易日计划' }}</CardTitle>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Badge v-if="hasPlan" variant="secondary">V{{ form.version }}</Badge>
            <Badge v-if="hasPlan" variant="outline">{{ planStatusLabel(form.status) }}</Badge>
            <Button @click="openPlanDialog"><Pencil class="size-4" />{{ hasPlan ? '编辑计划' : '制定计划' }}</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div v-if="hasPlan" class="grid gap-3 sm:grid-cols-2">
          <div class="rounded-lg border bg-muted/40 p-4">
            <div class="flex items-center gap-2"><CalendarCheck2 class="size-4 text-red-600" /><h3 class="font-semibold">日期与总原则</h3></div>
            <p class="mt-2 text-sm text-muted-foreground">{{ dateTime(form.validFrom) }} — {{ dateTime(form.validUntil) }}</p>
            <p class="mt-2 line-clamp-3 text-sm leading-6">{{ form.accountRules || '尚未填写账户级限制' }}</p>
          </div>
          <div class="rounded-lg border bg-muted/40 p-4">
            <div class="flex items-center gap-2"><ShieldAlert class="size-4 text-red-600" /><h3 class="font-semibold">动作与风险</h3></div>
            <p class="mt-2 text-sm text-muted-foreground">共 {{ form.rules.length }} 个交易标的</p>
            <div class="mt-2 flex flex-wrap gap-2"><Badge v-for="rule in form.rules.slice(0, 5)" :key="rule.code" variant="outline">{{ rule.name }} · {{ rule.allowedActions || '待定义' }}</Badge></div>
          </div>
          <div class="rounded-lg border bg-muted/40 p-4">
            <div class="flex items-center gap-2"><CheckCircle2 class="size-4 text-red-600" /><h3 class="font-semibold">三种情景</h3></div>
            <p class="mt-2 text-sm text-muted-foreground">已为 {{ form.rules.filter(rule => rule.baseScenario || rule.bullScenario || rule.bearScenario).length }} 个标的填写情景</p>
            <p class="mt-2 line-clamp-3 text-sm leading-6">{{ form.rules.find(rule => rule.baseScenario)?.baseScenario || '尚未填写基准情景' }}</p>
          </div>
          <div class="rounded-lg border bg-muted/40 p-4">
            <div class="flex items-center gap-2"><ShieldAlert class="size-4 text-red-600" /><h3 class="font-semibold">边界与确认</h3></div>
            <p class="mt-2 text-sm text-muted-foreground">训练目标：{{ form.trainingFocus || '未填写' }}</p>
            <p class="mt-2 line-clamp-3 text-sm leading-6">收益要求：{{ form.expectedReturn || '未填写' }}</p>
          </div>
        </div>
        <Empty v-else>
          <EmptyHeader><EmptyTitle>这一天还没有计划</EmptyTitle><EmptyDescription>点击“制定计划”，按四个步骤完成交易日边界、标的动作、三种情景与确认规则。</EmptyDescription></EmptyHeader>
        </Empty>
      </CardContent>
    </Card>

    <Card class="shadow-none">
      <CardHeader>
        <div class="flex items-start justify-between gap-3">
          <div><CardDescription>计划版本</CardDescription><CardTitle class="mt-1">{{ hasPlan ? `V${form.version}` : '暂无版本' }}</CardTitle></div>
          <History class="size-5 text-red-600" />
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="rounded-lg border bg-muted/40 p-4">
          <p class="text-sm text-muted-foreground">当前显示</p>
          <p class="mt-1 font-semibold">{{ hasPlan ? `${form.planForDate} · ${planStatusLabel(form.status)}` : '尚未保存计划' }}</p>
          <p v-if="hasPlan" class="mt-2 text-sm text-muted-foreground">{{ form.changeReason || '首次创建或当前保存版本' }}</p>
        </div>
        <Popover v-model:open="versionsOpen">
          <PopoverTrigger as-child><Button class="w-full" variant="outline" :disabled="!versions.length"><History class="size-4" />查看历史版本（{{ versions.length }}）</Button></PopoverTrigger>
          <PopoverContent align="end" class="w-80">
            <div class="mb-3"><p class="font-semibold">计划版本记录</p><p class="mt-1 text-sm text-muted-foreground">点击任一版本替换当前页面展示</p></div>
            <ScrollArea class="h-72 pr-3">
              <div class="space-y-2">
                <Button v-for="item in versions" :key="item.snapshotKey || `${item.id}-${item.version}`" class="h-auto w-full justify-start" variant="ghost" @click="previewVersion(item)">
                  <span class="grid gap-1 text-left"><span class="font-semibold">V{{ item.version }} · {{ planStatusLabel(item.status) }}</span><span class="text-xs text-muted-foreground">{{ dateTime(item.savedAt || item.updatedAt) }}</span><span class="line-clamp-2 text-xs text-muted-foreground">{{ item.changeReason || '首次创建' }}</span></span>
                </Button>
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
        <p class="text-sm leading-6 text-muted-foreground">历史版本只用于切换查看；重新保存才会形成新的不可覆盖版本。</p>
      </CardContent>
    </Card>
  </div>

  <Dialog v-model:open="planDialogOpen">
    <DialogScrollContent class="max-w-6xl">
      <DialogHeader>
        <DialogTitle>{{ hasPlan ? `编辑 ${form.planForDate} 交易计划` : '制定下一交易日计划' }}</DialogTitle>
        <DialogDescription>四个步骤可以随时切换；保存按钮始终位于弹窗底部。</DialogDescription>
      </DialogHeader>

      <Alert>
        <Sparkles class="size-4" />
        <AlertTitle>AI 辅助生成</AlertTitle>
        <AlertDescription>根据盘后复盘、标的研究、证据卡和当前表单上下文补全 AI 字段；生成结果先写入表单，不会自动保存或生效。</AlertDescription>
        <Button type="button" class="mt-3" variant="outline" :disabled="aiDraftBusy" @click="requestAiDraft"><Sparkles class="size-4" />生成 / 补全 AI 草稿</Button>
      </Alert>

      <form class="space-y-4" @submit.prevent="requestSave">
        <Stepper v-model="activeStep" class="w-full items-start" :linear="false">
          <StepperItem v-for="step in steps" :key="step.step" class="relative flex-1 flex-col" :step="step.step">
            <StepperTrigger class="w-full">
              <StepperIndicator>{{ step.step }}</StepperIndicator>
              <StepperTitle>{{ step.title }}</StepperTitle>
              <StepperDescription class="hidden lg:block">{{ step.description }}</StepperDescription>
            </StepperTrigger>
            <StepperSeparator v-if="step.step < steps.length" class="absolute left-[calc(50%+2rem)] right-[calc(-50%+1rem)] top-4 h-0.5" />
          </StepperItem>
        </Stepper>

        <ScrollArea class="h-[55vh] pr-4">
          <div v-if="activeStep === 1" class="space-y-4">
            <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <FieldBlock label="适用交易日（必填）"><DatePickerControl v-model="form.planForDate" /></FieldBlock>
              <FieldBlock label="来源复盘日期（选填）"><DatePickerControl v-model="form.sourceReviewDate" /></FieldBlock>
              <FieldBlock label="状态"><Select v-model="form.status"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">草稿</SelectItem><SelectItem value="pending_confirmation">待确认</SelectItem><SelectItem value="active" disabled>已确认生效</SelectItem><SelectItem value="invalidated" disabled>已失效</SelectItem><SelectItem value="completed" disabled>已完成</SelectItem></SelectContent></Select></FieldBlock>
              <FieldBlock label="版本"><Input :model-value="String(form.version)" disabled /></FieldBlock>
              <FieldBlock label="生效时间（必填）"><DatePickerControl v-model="form.validFrom" include-time /></FieldBlock>
              <FieldBlock label="失效时间（必填）"><DatePickerControl v-model="form.validUntil" include-time /></FieldBlock>
            </div>
            <FieldBlock label="预期收益 · 我填写（选填）" hint="这是你对本次计划的收益要求，不是系统承诺；留空不影响确认。"><Input v-model="form.expectedReturn" placeholder="例如：只在风险收益比不低于 1:2 时执行" /></FieldBlock>
            <div class="grid gap-4 lg:grid-cols-2"><FieldBlock label="我的市场判断 · 我填写（选填）" hint="保留你的原始观点，AI 不覆盖；留空不影响确认。"><Textarea v-model="form.userMarketView" /></FieldBlock><FieldBlock label="系统市场整理 · AI 辅助（选填）" hint="AI 根据市场资料整理，你负责审核。"><Textarea v-model="form.systemMarketView" /></FieldBlock><FieldBlock label="上一轮复盘核心提醒 · AI 辅助（选填）" hint="AI 从上一轮复盘中提取最需要遵守的提醒。"><Textarea v-model="form.previousAdvice" /></FieldBlock><FieldBlock label="账户级限制 · AI 辅助（选填）" hint="AI 根据账户配置、当前仓位和风险上限生成建议，你负责确认。"><Textarea v-model="form.accountRules" /></FieldBlock></div>
            <div class="grid gap-4 lg:grid-cols-2"><FieldBlock label="唯一训练目标 · AI 辅助（选填）" hint="AI 根据近期纪律问题建议本次只训练一个目标。"><Input v-model="form.trainingFocus" /></FieldBlock><FieldBlock label="盘前环境核验 · AI 辅助（选填）" hint="AI 根据盘前信息完成环境检查，你负责最终确认。"><Textarea v-model="form.marketObservation" /></FieldBlock></div>
          </div>

          <div v-else-if="activeStep === 2" class="space-y-4">
            <Card v-for="rule in form.rules" :key="rule.code" class="shadow-none">
              <CardHeader><div class="flex items-start justify-between"><div><CardTitle>{{ rule.name }}</CardTitle><CardDescription>{{ rule.code }}</CardDescription></div><Badge variant="secondary">{{ universe.find(item => String(item.code) === rule.code)?.holding ? '持仓' : '候选' }}</Badge></div></CardHeader>
              <CardContent class="space-y-4">
                <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><FieldBlock label="方向 · 我选择（选填）"><Select v-model="rule.direction"><SelectTrigger><SelectValue placeholder="请选择" /></SelectTrigger><SelectContent><SelectItem value="__none__">请选择</SelectItem><SelectItem value="long">做多 / 持有</SelectItem><SelectItem value="reduce">减仓 / 退出</SelectItem><SelectItem value="observe">仅观察</SelectItem></SelectContent></Select></FieldBlock><FieldBlock label="最大持仓占比 · 我填写（选填）" hint="指这只股票的市值最多占整个账户总资产的比例，不是卖出比例。"><NumberField :model-value="numericValue(rule.maxPositionPct)" :min="0" :max="100" @update:model-value="value => updateNumeric(rule, 'maxPositionPct', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="单笔最大风险 · 我填写（选填）" hint="按止损价计算，这笔交易最多允许亏损占账户总资产的比例。"><NumberField :model-value="numericValue(rule.maxRiskPct)" :min="0" :max="100" @update:model-value="value => updateNumeric(rule, 'maxRiskPct', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="止损价格 · 我填写（选填）"><NumberField :model-value="numericValue(rule.stopPrice)" :step="0.001" @update:model-value="value => updateNumeric(rule, 'stopPrice', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock></div>
                <FieldBlock label="允许动作 · 我勾选（选填）" hint="可以多选；填写后系统会据此判断实际成交是否偏离计划。"><div class="flex flex-wrap gap-3"><div v-for="action in actionOptions" :key="action" class="flex items-center gap-2 rounded-lg border p-3"><Checkbox :model-value="isActionSelected(rule, action)" :aria-label="`${rule.name}允许${action}`" @update:model-value="value => toggleAllowedAction(rule, action, value === true)" /><span class="text-sm font-medium">{{ action }}</span></div></div></FieldBlock>
                <div class="grid gap-4 lg:grid-cols-3"><FieldBlock label="触发条件 · AI 辅助（选填）"><Textarea v-model="rule.triggerCondition" /></FieldBlock><FieldBlock label="减仓条件 · AI 辅助（选填）"><Textarea v-model="rule.reduceCondition" /></FieldBlock><FieldBlock label="止损 / 退出条件 · AI 辅助（选填）"><Textarea v-model="rule.exitCondition" /></FieldBlock></div>
              </CardContent>
            </Card>
            <Empty v-if="!form.rules.length"><EmptyHeader><EmptyTitle>没有可计划标的</EmptyTitle><EmptyDescription>请先维护当前持仓或添加候选标的。</EmptyDescription></EmptyHeader></Empty>
          </div>

          <div v-else-if="activeStep === 3" class="space-y-4">
            <Card v-for="rule in form.rules" :key="rule.code" class="shadow-none"><CardHeader><CardTitle>{{ rule.name }} · 三种情景</CardTitle><CardDescription>由 AI 结合你的判断、风险边界和外部研究资料生成，你负责审核与调整；未生成完整也可以确认计划。</CardDescription></CardHeader><CardContent class="grid gap-4 lg:grid-cols-3"><FieldBlock label="基准情景 · AI 辅助（选填）"><Textarea v-model="rule.baseScenario" class="min-h-32" /></FieldBlock><FieldBlock label="乐观情景 · AI 辅助（选填）"><Textarea v-model="rule.bullScenario" class="min-h-32" /></FieldBlock><FieldBlock label="悲观情景 · AI 辅助（选填）"><Textarea v-model="rule.bearScenario" class="min-h-32" /></FieldBlock></CardContent></Card>
          </div>

          <div v-else class="space-y-4">
            <Alert><CheckCircle2 class="size-4" /><AlertTitle>这一页全部选填</AlertTitle><AlertDescription>未填写不会阻止保存或确认生效；填写后，系统才会在盘中按对应边界进行提醒和核对。</AlertDescription></Alert>
            <Card v-for="rule in form.rules" :key="rule.code" class="shadow-none"><CardHeader><CardTitle>{{ rule.name }} · 执行边界</CardTitle><CardDescription>这一部分由你决定，AI 只提供参考；所有项目均为选填。</CardDescription></CardHeader><CardContent class="grid gap-4 sm:grid-cols-2"><FieldBlock label="当日禁止事项 · 我填写（选填）"><Textarea v-model="rule.forbidden" /></FieldBlock><FieldBlock label="计划失效条件 · 我填写（选填）"><Textarea v-model="rule.invalidationCondition" /></FieldBlock><FieldBlock label="信息不足默认动作 · 我填写（选填）"><Textarea v-model="rule.defaultAction" /></FieldBlock><FieldBlock label="允许微调范围 · 我填写（选填）"><Input v-model="rule.flexibleRange" placeholder="价格 ±0.5%，数量 ±100 股" /></FieldBlock></CardContent></Card>
          </div>
        </ScrollArea>

        <DialogFooter class="items-center justify-between border-t pt-4">
          <div class="flex gap-2"><Button type="button" variant="outline" :disabled="activeStep === 1" @click="activeStep -= 1"><ChevronLeft class="size-4" />上一步</Button><Button v-if="activeStep < 4" type="button" variant="outline" @click="activeStep += 1">下一步<ChevronRight class="size-4" /></Button></div>
          <div class="flex flex-wrap gap-2"><Button type="button" variant="outline" :disabled="busy || !form.id || form.status === 'active'" @click="requestConfirm">确认生效</Button><Button type="button" variant="destructive" :disabled="busy || !form.id || ['invalidated','completed'].includes(form.status)" @click="requestInvalidate">标记失效</Button><Button type="submit" :disabled="busy"><Save class="size-4" />保存计划版本</Button></div>
        </DialogFooter>
      </form>
    </DialogScrollContent>
  </Dialog>

  <Dialog :open="aiDraftDialogOpen" @update:open="handleAiDraftDialogOpen">
    <DialogScrollContent class="max-w-3xl">
      <DialogHeader>
        <DialogTitle>生成 AI 辅助草稿</DialogTitle>
        <DialogDescription>可以复制完整资料给任意 AI，也可以让本机 Codex 自动生成；两种方式都只处理 AI 辅助字段。</DialogDescription>
      </DialogHeader>
      <div class="flex flex-wrap gap-2">
        <Badge variant="outline">复盘 {{ selectedResearch?.reviewDate || form.sourceReviewDate || '未找到' }}</Badge>
        <Badge variant="outline">研究 {{ selectedResearch?.status === 'ready' ? '资料完整' : '资料可能不完整' }}</Badge>
        <Badge variant="outline">相关证据 {{ relevantEvidenceCount }} 条</Badge>
      </div>
      <Alert>
        <ShieldAlert class="size-4" />
        <AlertTitle>不会改动你负责的字段</AlertTitle>
        <AlertDescription>预期收益、你的市场判断、方向、允许动作、仓位与风险、止损价格、禁止事项、失效条件和微调边界均保持原样。</AlertDescription>
      </Alert>

      <Card class="shadow-none">
        <CardHeader>
          <CardTitle class="text-base">方式一：复制提示词给外部 AI（推荐）</CardTitle>
          <CardDescription>两段提示词都只保留资料位置和操作规则，不再复制整份数据。本机 AI 可直接读取文件或接口；豆包、Kimi 等网页 AI 请同时上传下载的 JSON 资料包。</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert v-if="planAiPromptMessage">
            <CheckCircle2 class="size-4" />
            <AlertTitle>接口提示</AlertTitle>
            <AlertDescription>{{ planAiPromptMessage }}</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter class="flex flex-wrap gap-2">
          <Button type="button" :disabled="planAiPromptBusy || !form.id" @click="copyPlanAiPrompt('generate')"><Copy class="size-4" />复制生成提示词</Button>
          <Button type="button" variant="outline" :disabled="planAiPromptBusy || !form.id" @click="downloadPlanAiContext"><Download class="size-4" />下载 AI 资料包</Button>
          <Button type="button" variant="outline" :disabled="planAiPromptBusy || !form.id" @click="copyPlanAiPrompt('write')"><Copy class="size-4" />复制写入应用提示词</Button>
          <Button type="button" variant="ghost" :disabled="busy || !form.id" @click="refreshAiImportedPlan">刷新写入结果</Button>
        </CardFooter>
      </Card>

      <div class="space-y-1">
        <p class="text-sm font-semibold">方式二：本机 Codex 自动生成</p>
        <p class="text-sm text-muted-foreground">应用会持续显示资料整理、Codex 生成、结果校验和表单写入状态；每一步都会显示进度和失败原因。</p>
      </div>
      <FieldBlock v-if="!aiDraftJob" label="写入方式" hint="推荐先补空白项；需要依据最新资料整体重写时，再选择重新生成。">
        <Select v-model="aiWriteMode">
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fill-empty">仅补全空白 AI 字段（推荐）</SelectItem>
            <SelectItem value="replace-ai">重新生成全部 AI 字段</SelectItem>
          </SelectContent>
        </Select>
      </FieldBlock>

      <div v-if="aiDraftJob" class="space-y-4">
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-3"><span class="text-sm font-medium">任务进度</span><span class="text-sm text-muted-foreground">{{ Math.round(aiDraftProgress) }}%</span></div>
          <Progress :model-value="aiDraftProgress" />
        </div>
        <Stepper :model-value="aiDraftActiveStep" class="w-full items-start" :linear="false">
          <StepperItem v-for="(step, index) in aiDraftJob.steps" :key="step.id" class="relative flex-1 flex-col" :step="index + 1">
            <StepperIndicator><Spinner v-if="step.status === 'running'" /><CheckCircle2 v-else-if="step.status === 'completed'" class="size-4" /><ShieldAlert v-else-if="step.status === 'failed'" class="size-4" /><span v-else>{{ index + 1 }}</span></StepperIndicator>
            <StepperTitle class="text-center">{{ step.label }}</StepperTitle>
            <StepperDescription class="text-center leading-5">{{ step.detail }}</StepperDescription>
            <StepperSeparator v-if="index < aiDraftJob.steps.length - 1" class="absolute left-[calc(50%+2rem)] right-[calc(-50%+1rem)] top-4 h-0.5" />
          </StepperItem>
        </Stepper>
      </div>

      <Alert v-if="aiDraftError" variant="destructive">
        <ShieldAlert class="size-4" />
        <AlertTitle>生成没有完成</AlertTitle>
        <AlertDescription>{{ aiDraftError }}</AlertDescription>
      </Alert>
      <Alert v-if="aiDraftJob?.status === 'applied'">
        <CheckCircle2 class="size-4" />
        <AlertTitle>AI 草稿已写入表单</AlertTitle>
        <AlertDescription>本次写入 {{ aiDraftWrittenCount }} 个字段。关闭窗口后请检查四个步骤，并保存新的计划版本。</AlertDescription>
      </Alert>

      <DialogFooter v-if="!aiDraftJob">
        <Button type="button" variant="outline" @click="aiDraftDialogOpen = false">取消</Button>
        <Button type="button" @click="generateAiDraft"><Sparkles class="size-4" />开始生成</Button>
      </DialogFooter>
      <DialogFooter v-else-if="aiDraftJob.status === 'failed'">
        <Button type="button" variant="outline" @click="aiDraftDialogOpen = false">关闭</Button>
        <Button type="button" @click="generateAiDraft"><Sparkles class="size-4" />重新生成</Button>
      </DialogFooter>
      <DialogFooter v-else-if="aiDraftJob.status === 'applied'">
        <Button type="button" @click="aiDraftDialogOpen = false"><CheckCircle2 class="size-4" />完成，返回计划</Button>
      </DialogFooter>
      <DialogFooter v-else-if="aiDraftError">
        <Button type="button" variant="outline" @click="aiDraftDialogOpen = false">关闭</Button>
        <Button type="button" @click="retryAiDraftProgress">重新查询进度</Button>
      </DialogFooter>
      <DialogFooter v-else>
        <Button type="button" disabled><Spinner />AI 任务进行中</Button>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>

  <Dialog v-model:open="saveReasonDialogOpen">
    <DialogContent>
      <DialogHeader><DialogTitle>保存计划版本</DialogTitle><DialogDescription>保存后会形成不可覆盖的历史记录；修改原因可以留空。</DialogDescription></DialogHeader>
      <form class="space-y-4" @submit.prevent="savePlan">
        <FieldBlock label="本次保存原因（选填）" hint="例如：首次制定；根据新公告调整止损；修正仓位上限。留空时系统会记录为手动保存。"><Textarea v-model="form.changeReason" placeholder="可以留空" /></FieldBlock>
        <DialogFooter><Button type="button" variant="outline" @click="saveReasonDialogOpen = false">取消</Button><Button type="submit" :disabled="busy"><Save class="size-4" />确认保存</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="confirmDialogOpen">
    <DialogContent>
      <DialogHeader><DialogTitle>确认计划生效</DialogTitle><DialogDescription>确认后，这个版本将成为盘中执行依据。选填项缺失不会阻止确认，只会跳过对应的纪律检查。</DialogDescription></DialogHeader>
      <form class="space-y-4" @submit.prevent="confirmPlan">
        <Alert v-if="confirmError" variant="destructive">
          <ShieldAlert class="size-4" />
          <AlertTitle>暂时不能确认</AlertTitle>
          <AlertDescription><span v-for="line in confirmErrorLines" :key="line" class="block leading-6">{{ line }}</span></AlertDescription>
        </Alert>
        <FieldBlock label="确认说明（选填）" hint="需要时可以记录本次确认重点；留空也能直接生效。"><Textarea v-model="confirmationReason" placeholder="可以留空" /></FieldBlock>
        <DialogFooter><Button type="button" variant="outline" @click="confirmDialogOpen = false">取消</Button><Button type="submit" :disabled="busy"><CheckCircle2 class="size-4" />确认并生效</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="invalidateDialogOpen">
    <DialogContent>
      <DialogHeader><DialogTitle>标记计划失效</DialogTitle><DialogDescription>失效后，这个计划不能再作为执行依据，但历史记录仍会保留。</DialogDescription></DialogHeader>
      <form class="space-y-4" @submit.prevent="invalidatePlan">
        <FieldBlock label="失效原因" hint="例如：重大新事实出现；市场环境改变；原交易逻辑被证伪。"><Textarea v-model="invalidationReason" required placeholder="请填写计划失效的具体原因" /></FieldBlock>
        <DialogFooter><Button type="button" variant="outline" @click="invalidateDialogOpen = false">取消</Button><Button type="submit" variant="destructive" :disabled="busy">确认标记失效</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
