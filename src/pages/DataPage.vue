<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Database, FileUp, History, RotateCcw } from 'lucide-vue-next'
import DataTable, { type DataTableColumn } from '@/components/app/DataTable.vue'
import PageHeading from '@/components/app/PageHeading.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, dateTime, money } from '@/lib/trade-api'

const props = defineProps<{ store: Record<string, any> }>()
const emit = defineEmits<{ refresh: [] }>()
const backups = ref<any[]>([])
const selectedBackup = ref<any>(null)
const restoreOpen = ref(false)
const csv = ref('')
const updateHoldings = ref(false)
const busy = ref('')
const message = ref('')
const recentTradeColumns: DataTableColumn[] = [
  { key: 'occurredAt', label: '发生时间' },
  { key: 'stock', label: '股票' },
  { key: 'sideLabel', label: '方向' },
  { key: 'quantityPrice', label: '数量 / 价格', sortable: false },
  { key: 'fee', label: '费用', format: 'money' },
  { key: 'reason', label: '理由', sortable: false },
]
const recentTrades = computed(() => (props.store?.trades || []).map((trade: any) => ({
  id: trade.id,
  occurredAt: `${trade.date} ${trade.time}`,
  stock: `${trade.name} · ${trade.code}`,
  sideLabel: trade.side === 'BUY' ? '买入' : '卖出',
  quantityPrice: `${trade.quantity} 股 @ ${trade.price}`,
  fee: trade.fee,
  reason: trade.reason || '未记录理由',
})))
async function loadBackups() { try { backups.value = (await api<any>('/api/backups')).backups || [] } catch (error) { message.value = error instanceof Error ? error.message : '备份加载失败' } }
async function chooseFile(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; csv.value = file ? await file.text() : '' }
async function importCsv() {
  if (!csv.value) { message.value = '请先选择 CSV 文件'; return }
  busy.value = 'import'; message.value = ''
  try { const preview = await api<any>('/api/trades/import/preview', { method: 'POST', body: JSON.stringify({ csv: csv.value, updateHoldings: updateHoldings.value }) }); if (preview.errors?.length) throw new Error(preview.errors.map((item: any) => item.message || item).join('；')); const result = await api<any>('/api/trades/import', { method: 'POST', body: JSON.stringify({ csv: csv.value, updateHoldings: updateHoldings.value, atomic: true }) }); message.value = `已原子导入 ${result.imported?.length || 0} 笔，跳过 ${result.skipped?.length || 0} 笔重复记录`; emit('refresh'); await loadBackups() }
  catch (error) { message.value = error instanceof Error ? error.message : '导入失败' }
  finally { busy.value = '' }
}
function askRestore(item: any) { selectedBackup.value = item; restoreOpen.value = true }
async function restore() { if (!selectedBackup.value) return; busy.value = 'restore'; try { await api('/api/backups/restore', { method: 'POST', body: JSON.stringify({ name: selectedBackup.value.name }) }); restoreOpen.value = false; message.value = '恢复完成，原当前版本已保留为备份'; emit('refresh'); await loadBackups() } catch (error) { message.value = error instanceof Error ? error.message : '恢复失败' } finally { busy.value = '' } }
onMounted(loadBackups)
</script>

<template>
  <PageHeading eyebrow="Data & recovery" title="数据、导入与恢复" description="每次写入前自动备份；恢复前先比较账户摘要。"><template #actions><Button variant="outline" @click="loadBackups"><RotateCcw class="size-4" />刷新版本</Button></template></PageHeading>
  <Alert v-if="message" class="mb-4"><AlertTitle>数据操作</AlertTitle><AlertDescription>{{ message }}</AlertDescription></Alert>
  <Card class="shadow-none"><CardHeader><div class="flex items-center gap-3"><span class="grid size-9 place-items-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/30"><History class="size-4" /></span><div><CardTitle>最近成交与费用</CardTitle><CardDescription>全部成交记录，默认每页 10 笔</CardDescription></div></div></CardHeader><CardContent><DataTable :columns="recentTradeColumns" :data="recentTrades" search-placeholder="搜索成交、股票或理由" initial-sort-key="occurredAt" /></CardContent></Card>
  <Card class="mt-4 shadow-none"><CardHeader><div class="flex items-center gap-3"><span class="grid size-9 place-items-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/30"><FileUp class="size-4" /></span><div><CardTitle>导入券商成交 CSV</CardTitle><CardDescription>提交前先预览；存在错误时整批取消，不留下半份账</CardDescription></div></div></CardHeader><CardContent class="space-y-4"><Input type="file" accept=".csv,text/csv" @change="chooseFile" /><div class="flex items-center gap-2"><Checkbox id="update-holdings" v-model="updateHoldings" /><Label for="update-holdings">同时更新持仓</Label></div><Button class="bg-red-600 text-white hover:bg-red-700" :disabled="busy === 'import' || !csv" @click="importCsv">导入 CSV</Button></CardContent></Card>
  <Card class="mt-4 shadow-none"><CardHeader><div class="flex items-center gap-3"><span class="grid size-9 place-items-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/30"><Database class="size-4" /></span><div><CardTitle>自动备份与恢复</CardTitle><CardDescription>恢复动作本身也会留下新版本</CardDescription></div></div></CardHeader><CardContent class="space-y-2"><div v-for="item in backups.slice(0,30)" :key="item.name" class="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p class="font-medium">{{ item.name }}</p><p class="mt-1 text-sm text-muted-foreground">{{ dateTime(item.createdAt) }} · {{ item.summary ? `现金 ${money(item.summary.availableCash)} · 持仓 ${money(item.summary.marketValue)} · 总资产 ${money(item.summary.totalAssets)}` : '无法读取摘要' }}</p></div><Button size="sm" variant="outline" @click="askRestore(item)"><RotateCcw class="size-4" />恢复到此版本</Button></div><p v-if="!backups.length" class="py-10 text-center text-muted-foreground">暂无备份</p></CardContent></Card>
  <Dialog v-model:open="restoreOpen"><DialogContent><DialogHeader><DialogTitle>恢复到这个版本？</DialogTitle><DialogDescription>当前数据会先自动备份，然后恢复 {{ selectedBackup?.name }}。此操作会改变当前数据。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" @click="restoreOpen = false">取消</Button><Button variant="destructive" :disabled="busy === 'restore'" @click="restore">确认恢复</Button></DialogFooter></DialogContent></Dialog>
</template>
