<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { CheckCircle2, FlaskConical, Plus, Save, Scale, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import FieldBlock from '@/components/app/FieldBlock.vue'
import PageHeading from '@/components/app/PageHeading.vue'
import StockPicker, { type StockOption } from '@/components/app/StockPicker.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NumberField, NumberFieldContent, NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, dateTime } from '@/lib/trade-api'

type SignalRow = { id: string; name: string; direction: string; reliability: string; weight: string; evidenceRefs: string; correlationGroup: string }
const props = defineProps<{ store: Record<string, any>; dashboard: Record<string, any> }>()
const emit = defineEmits<{ refresh: [] }>()
const selectedStock = ref<StockOption | null>(null)
const busy = ref('')
const preview = ref<any>(null)
const resolveDialogOpen = ref(false)
const selectedReport = ref<any>(null)
const calibration = ref<any>(null)
const resolution = reactive({ actualOutcome: 'base', actualData: '' })
let signalSequence = 0
const blankSignal = (): SignalRow => ({ id: `signal-${++signalSequence}`, name: '', direction: '0', reliability: '0.5', weight: '1', evidenceRefs: '', correlationGroup: '' })
const signals = ref<SignalRow[]>([blankSignal()])
const form = reactive({ horizon: '5d', benchmark: '000300', bullThreshold: '2', bearThreshold: '-2' })

const reports = computed(() => [...(props.store?.probabilityReports || [])].sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))))
const resolutions = computed(() => props.store?.forecastResolutions || [])
const selectedAsset = computed(() => [...(props.store?.holdings || []), ...(props.store?.plannedAssets || [])].find((item: any) => item.code === selectedStock.value?.code))
function numeric(value: string) { const number = Number(value); return value === '' || !Number.isFinite(number) ? undefined : number }
function updateSignal(signal: SignalRow, key: 'direction' | 'reliability' | 'weight', value: number | undefined) { signal[key] = value == null ? '' : String(value) }
function updateForm(key: keyof typeof form, value: number | undefined) { form[key] = value == null ? '' : String(value) }
function addSignal() { signals.value.push(blankSignal()) }
function removeSignal(id: string) { if (signals.value.length > 1) signals.value = signals.value.filter(item => item.id !== id) }
function evidenceRefs(value: string) { return value.split(/[、,，\n]/).map(item => item.trim()).filter(Boolean) }
function importInfluenceSignals(silent = false) {
  if (!selectedStock.value?.code) { if (!silent) toast.error('请先选择标的'); return }
  const eventById = new Map<string, any>((props.store?.informationEvents || []).map((item: any) => [String(item.id), item]))
  const promoted = (props.store?.informationEvidencePromotions || []).filter((item: any) => item.assetCode === selectedStock.value?.code).slice(-10).map((item: any) => {
    const event: any = eventById.get(item.eventId)
    const impact = (event?.aiEnrichment?.holdingRelevance || []).find((link: any) => link.assetCode === selectedStock.value?.code)
    const confidence = impact?.confidence === 'high' ? 0.85 : impact?.confidence === 'low' ? 0.45 : 0.65
    return {
      id: `signal-${++signalSequence}`,
      name: `已确认资讯：${event?.title || item.eventId}`,
      direction: String(Math.max(-1, Math.min(1, Number(impact?.impactScore || 0) / 100))),
      reliability: String(confidence),
      weight: '1',
      evidenceRefs: item.analysisEvidenceId || item.factEvidenceId,
      correlationGroup: item.clusterId || item.eventId,
    }
  })
  const advanced = (props.store?.influenceAssessments || []).filter((item: any) => item.assetCode === selectedStock.value?.code && item.result?.companyImpactScore != null).slice(-5).map((item: any) => ({
    id: `signal-${++signalSequence}`,
    name: `资讯影响：${item.input?.eventMeta?.title || item.eventId}`,
    direction: String(Math.max(-1, Math.min(1, Number(item.result.companyImpactScore) / 100))),
    reliability: String(Math.max(0, Math.min(1, Number(item.result.source?.score || 0) / 100))),
    weight: '1',
    evidenceRefs: item.id,
    correlationGroup: eventById.get(item.eventId)?.clusterId || item.eventId || item.id,
  }))
  const imported = [...promoted, ...advanced]
  if (!imported.length) { signals.value = [blankSignal()]; if (!silent) toast.info('该标的还没有已确认的持仓证据'); return }
  signals.value = imported
  if (!silent) toast.success(`已导入 ${imported.length} 个持仓证据`)
}
function reportInput() {
  return {
    asOf: new Date().toISOString(),
    asset: { code: selectedStock.value?.code, name: selectedStock.value?.name },
    horizon: form.horizon,
    outcomeDefinition: { benchmark: form.benchmark, bull: `相对${form.benchmark}收益 >= ${form.bullThreshold}%`, base: `相对${form.benchmark}收益介于 ${form.bearThreshold}% 与 ${form.bullThreshold}%`, bear: `相对${form.benchmark}收益 <= ${form.bearThreshold}%` },
    signals: signals.value.map(item => ({ name: item.name, direction: Number(item.direction), reliability: Number(item.reliability), weight: Number(item.weight), evidenceRefs: evidenceRefs(item.evidenceRefs), correlationGroup: item.correlationGroup || item.id })),
    prior: { bull: 1 / 3, base: 1 / 3, bear: 1 / 3 },
  }
}
async function loadCalibration() {
  try { calibration.value = await api<any>(`/api/probability-calibration?horizon=${encodeURIComponent(form.horizon)}`) }
  catch { calibration.value = null }
}
async function previewReport() {
  busy.value = 'preview'
  try { preview.value = await api('/api/probability-reports/preview', { method: 'POST', body: JSON.stringify({ input: reportInput() }) }); return preview.value }
  catch (error) { toast.error('研报预览失败', { description: error instanceof Error ? error.message : '请检查输入' }); return null }
  finally { busy.value = '' }
}
async function saveReport() {
  const result = await previewReport()
  if (!result) return
  busy.value = 'save'
  try {
    const saved = await api<any>('/api/probability-reports', { method: 'POST', body: JSON.stringify({ input: reportInput(), confirmed: true }) })
    toast.success(saved.duplicate ? '相同口径研报已经存在' : '概率研报已冻结保存')
    emit('refresh')
    await loadCalibration()
  } catch (error) { toast.error('研报保存失败', { description: error instanceof Error ? error.message : '请检查证据引用与结果口径' }) }
  finally { busy.value = '' }
}
function openResolve(report: any) { selectedReport.value = report; resolution.actualOutcome = 'base'; resolution.actualData = ''; resolveDialogOpen.value = true }
async function resolveReport() {
  if (!selectedReport.value) return
  busy.value = 'resolve'
  try {
    await api(`/api/probability-reports/${encodeURIComponent(selectedReport.value.id)}/resolve`, { method: 'POST', body: JSON.stringify({ confirmed: true, resolution: { actualOutcome: resolution.actualOutcome, actualData: resolution.actualData, resolvedAt: new Date().toISOString() } }) })
    toast.success('预测结果已结算并计入校准样本')
    resolveDialogOpen.value = false
    emit('refresh')
    await loadCalibration()
  } catch (error) { toast.error('结算失败', { description: error instanceof Error ? error.message : '请检查结果' }) }
  finally { busy.value = '' }
}
function percent(value: unknown) { return `${(Number(value || 0) * 100).toFixed(1)}%` }
function isResolved(report: any) { return resolutions.value.some((item: any) => item.forecastId === report.id) }
function frozenProbabilities(report: any) { return report.probabilities || report.experimentalProbabilities || report.bayesian?.posterior }
watch(() => form.horizon, loadCalibration)
watch(() => selectedStock.value?.code, code => { if (code) importInfluenceSignals(true) })
onMounted(loadCalibration)
</script>

<template>
  <PageHeading eyebrow="Calibrated, not certain" title="概率研报" description="冻结口径、证据和校准状态；没有足够历史样本时只展示相对证据权重。">
    <template #actions><Button variant="outline" @click="importInfluenceSignals(false)"><FlaskConical class="size-4" />重新导入持仓证据</Button><Button @click="addSignal"><Plus class="size-4" />增加信号</Button></template>
  </PageHeading>

  <Card class="shadow-none">
    <CardHeader><CardTitle>研报口径</CardTitle><CardDescription>结果定义保存后不可回写修改，避免事后改变判断标准。</CardDescription></CardHeader>
    <CardContent class="space-y-5">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><FieldBlock label="标的"><StockPicker v-model="selectedStock" /></FieldBlock><FieldBlock label="预测周期"><Select v-model="form.horizon"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1d">1 个交易日</SelectItem><SelectItem value="5d">5 个交易日</SelectItem><SelectItem value="20d">20 个交易日</SelectItem><SelectItem value="60d">60 个交易日</SelectItem></SelectContent></Select></FieldBlock><FieldBlock label="比较基准"><Input v-model="form.benchmark" maxlength="6" /></FieldBlock><FieldBlock label="研究资料截至"><Input :model-value="selectedAsset?.researchAsOf || '未记录'" disabled /></FieldBlock></div>
      <div class="grid gap-4 sm:grid-cols-2"><FieldBlock label="多头情景阈值（相对收益 %）"><NumberField :model-value="numeric(form.bullThreshold)" @update:model-value="value => updateForm('bullThreshold', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="空头情景阈值（相对收益 %）"><NumberField :model-value="numeric(form.bearThreshold)" @update:model-value="value => updateForm('bearThreshold', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock></div>
    </CardContent>
  </Card>

  <Card class="mt-4 shadow-none">
    <CardHeader><CardTitle>可核验信号</CardTitle><CardDescription>方向范围 -1 到 1，可靠度范围 0 到 1；每个信号都必须绑定证据编号、影响评估编号或行情快照编号。</CardDescription></CardHeader>
    <CardContent class="space-y-3">
      <div v-for="signal in signals" :key="signal.id" class="grid gap-3 rounded-lg border p-4 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_minmax(0,2fr)_auto] lg:items-end"><FieldBlock label="信号名称"><Input v-model="signal.name" placeholder="例如：20 日相对强度" /></FieldBlock><FieldBlock label="方向"><NumberField :model-value="numeric(signal.direction)" :min="-1" :max="1" :step="0.1" @update:model-value="value => updateSignal(signal, 'direction', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="可靠度"><NumberField :model-value="numeric(signal.reliability)" :min="0" :max="1" :step="0.1" @update:model-value="value => updateSignal(signal, 'reliability', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="权重"><NumberField :model-value="numeric(signal.weight)" :min="0" :max="10" :step="0.1" @update:model-value="value => updateSignal(signal, 'weight', value)"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput /><NumberFieldIncrement /></NumberFieldContent></NumberField></FieldBlock><FieldBlock label="证据引用"><Input v-model="signal.evidenceRefs" placeholder="F1，行情快照编号" /></FieldBlock><Button size="icon" variant="ghost" title="移除信号" :disabled="signals.length === 1" @click="removeSignal(signal.id)"><Trash2 class="size-4" /></Button></div>
    </CardContent>
  </Card>

  <Card class="mt-4 shadow-none">
    <CardHeader><CardTitle>实验贝叶斯与自动校准</CardTitle><CardDescription>系统自动计算，不需要手填模型分数。至少 30 个已结算同口径样本、Brier 分优于基线且校准误差达标后，才升级为正式概率。</CardDescription></CardHeader>
    <CardContent class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">当前状态</p><p class="mt-1 font-medium">{{ calibration?.eligible ? '已通过校准' : '样本积累中' }}</p></div>
        <div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">已结算样本</p><p class="mt-1 font-medium">{{ calibration?.resolvedSampleSize || 0 }} / 30</p></div>
        <div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">模型 / 基线 Brier</p><p class="mt-1 font-medium">{{ calibration?.brierScore ?? '—' }} / {{ calibration?.baselineBrierScore ?? '—' }}</p></div>
        <div class="rounded-lg border p-3"><p class="text-xs text-muted-foreground">校准误差</p><p class="mt-1 font-medium">{{ calibration?.expectedCalibrationError ?? '—' }}</p></div>
      </div>
      <Alert v-if="preview"><Scale class="size-4" /><AlertTitle>{{ preview.calibrationStatus === 'validated' ? '已满足正式概率门槛' : '实验概率：尚未通过历史校准' }}</AlertTitle><AlertDescription>贝叶斯更新后：多头 {{ percent(preview.experimentalProbabilities?.bull) }} · 中性 {{ percent(preview.experimentalProbabilities?.base) }} · 空头 {{ percent(preview.experimentalProbabilities?.bear) }}。{{ preview.statement }}</AlertDescription></Alert>
      <div class="flex flex-wrap justify-end gap-2"><Button variant="outline" :disabled="busy" @click="previewReport"><FlaskConical class="size-4" />预览研报</Button><Button :disabled="busy" @click="saveReport"><Save class="size-4" />冻结并保存</Button></div>
    </CardContent>
  </Card>

  <Card class="mt-4 shadow-none">
    <CardHeader><CardTitle>历史研报与结算</CardTitle><CardDescription>预测生成时的口径和信号保持不变；到期后按原定义结算。</CardDescription></CardHeader>
    <CardContent class="space-y-3"><div v-for="report in reports" :key="report.id" class="grid gap-3 rounded-lg border p-4 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] lg:items-center"><div><div class="flex flex-wrap gap-2"><Badge variant="outline">{{ report.assetCode }}</Badge><Badge :variant="report.calibrationStatus === 'validated' ? 'default' : 'secondary'">{{ report.calibrationStatus === 'validated' ? '已校准概率' : '实验贝叶斯' }}</Badge><Badge v-if="isResolved(report)" variant="outline">已结算</Badge></div><p class="mt-2 font-medium">{{ report.horizon }} · 相对 {{ report.outcomeDefinition?.benchmark }}</p><p class="mt-1 text-sm text-muted-foreground">冻结于 {{ dateTime(report.asOf) }}</p></div><div><p class="text-xs text-muted-foreground">证据权重</p><p class="mt-1 text-sm">多 {{ percent(report.evidenceWeights?.bull) }} · 中 {{ percent(report.evidenceWeights?.base) }} · 空 {{ percent(report.evidenceWeights?.bear) }}</p></div><div><p class="text-xs text-muted-foreground">{{ report.probabilities ? '正式概率' : '实验概率' }}</p><p class="mt-1 text-sm">多 {{ percent(frozenProbabilities(report)?.bull) }} · 中 {{ percent(frozenProbabilities(report)?.base) }} · 空 {{ percent(frozenProbabilities(report)?.bear) }}</p></div><Button v-if="frozenProbabilities(report) && !isResolved(report)" size="sm" variant="outline" @click="openResolve(report)"><CheckCircle2 class="size-4" />到期结算</Button></div><p v-if="!reports.length" class="py-8 text-center text-muted-foreground">尚无冻结研报。</p></CardContent>
  </Card>

  <Dialog v-model:open="resolveDialogOpen">
    <DialogScrollContent class="max-w-xl"><DialogHeader><DialogTitle>结算概率研报</DialogTitle><DialogDescription>严格按预测生成时冻结的基准和阈值选择实际情景。</DialogDescription></DialogHeader><div class="space-y-4"><FieldBlock label="实际情景"><Select v-model="resolution.actualOutcome"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bull">多头情景</SelectItem><SelectItem value="base">中性情景</SelectItem><SelectItem value="bear">空头情景</SelectItem></SelectContent></Select></FieldBlock><FieldBlock label="实际数据与计算说明"><Input v-model="resolution.actualData" placeholder="标的收益、基准收益、相对收益及数据来源" /></FieldBlock></div><DialogFooter><Button variant="outline" @click="resolveDialogOpen = false">取消</Button><Button :disabled="busy" @click="resolveReport">确认结算</Button></DialogFooter></DialogScrollContent>
  </Dialog>
</template>
