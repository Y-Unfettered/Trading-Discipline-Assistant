<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  FlexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useVueTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/vue-table'
import { ArrowUpDown, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { money } from '@/lib/trade-api'

type LedgerRow = {
  kind: 'trade' | 'funding'
  id: string
  raw: Record<string, any>
  date: string
  time: string
  name: string
  operation: string
  side?: 'BUY' | 'SELL'
  quantity: number
  price: number | null
  amount: number
  fee: number | null
  cashEffect: number
}

const props = defineProps<{ data: LedgerRow[] }>()
const emit = defineEmits<{ edit: [row: LedgerRow]; delete: [row: LedgerRow] }>()
const query = ref('')
const kindFilter = ref('all')
const sorting = ref<SortingState>([{ id: 'occurredAt', desc: true }])

const filteredData = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase('zh-CN')
  return props.data.filter(row => {
    const matchesType = kindFilter.value === 'all'
      || kindFilter.value === row.kind
      || kindFilter.value === row.side
    if (!matchesType) return false
    if (!keyword) return true
    return [row.date, row.time, row.name, row.operation, row.raw?.code, row.raw?.note, row.raw?.reason]
      .some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword))
  })
})

const columns: ColumnDef<LedgerRow>[] = [
  {
    id: 'occurredAt',
    accessorFn: row => `${row.date} ${row.time}`,
    header: '发生时间',
    cell: context => `${context.row.original.date} ${context.row.original.time}`,
  },
  {
    accessorKey: 'name',
    header: '名称',
  },
  {
    accessorKey: 'operation',
    header: '业务类型',
  },
  {
    id: 'priceQuantity',
    accessorFn: row => row.price,
    header: '单价 / 数量',
    enableSorting: false,
    cell: context => {
      const row = context.row.original
      return row.price == null ? '—' : `${Number(row.price).toFixed(4)} 元 / ${row.quantity} 股`
    },
  },
  {
    accessorKey: 'amount',
    header: '发生金额',
    cell: context => money(context.row.original.amount),
  },
  {
    accessorKey: 'fee',
    header: '费用',
    cell: context => {
      const row = context.row.original
      if (row.kind === 'funding') return '—'
      return row.fee == null ? '待补录' : money(row.fee)
    },
  },
  {
    accessorKey: 'cashEffect',
    header: '现金变化',
    cell: context => {
      const value = Number(context.row.original.cashEffect)
      return `${value >= 0 ? '+' : ''}${money(value)}`
    },
  },
]

const table = useVueTable({
  get data() { return filteredData.value },
  columns,
  getCoreRowModel: getCoreRowModel(),
  getPaginationRowModel: getPaginationRowModel(),
  getSortedRowModel: getSortedRowModel(),
  onSortingChange: updater => {
    sorting.value = typeof updater === 'function' ? updater(sorting.value) : updater
  },
  state: {
    get sorting() { return sorting.value },
  },
  initialState: {
    pagination: { pageIndex: 0, pageSize: 10 },
  },
})

watch([query, kindFilter], () => table.setPageIndex(0))
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-1 flex-wrap gap-2">
        <Input v-model="query" class="max-w-sm" placeholder="搜索日期、证券、代码或备注" aria-label="搜索年度资金明细" />
        <Select v-model="kindFilter">
          <SelectTrigger class="w-40" aria-label="筛选业务类型"><SelectValue placeholder="全部业务" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部业务</SelectItem>
            <SelectItem value="BUY">证券买入</SelectItem>
            <SelectItem value="SELL">证券卖出</SelectItem>
            <SelectItem value="funding">资金流水</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p class="text-sm text-muted-foreground">共 {{ filteredData.length }} 条</p>
    </div>

    <div class="overflow-auto">
      <Table>
        <TableHeader>
          <TableRow v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
            <TableHead v-for="header in headerGroup.headers" :key="header.id">
              <Button
                v-if="!header.isPlaceholder && header.column.getCanSort()"
                variant="ghost"
                size="sm"
                @click="header.column.toggleSorting(header.column.getIsSorted() === 'asc')"
              >
                {{ header.column.columnDef.header }}
                <ArrowUpDown class="size-4" />
              </Button>
              <span v-else-if="!header.isPlaceholder">{{ header.column.columnDef.header }}</span>
            </TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="row in table.getRowModel().rows"
            :key="`${row.original.kind}-${row.original.id}`"
            role="button"
            tabindex="0"
            @click="emit('edit', row.original)"
            @keydown.enter="emit('edit', row.original)"
          >
            <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
              <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
            </TableCell>
            <TableCell>
              <div class="flex gap-1">
                <Button size="icon-sm" variant="ghost" aria-label="修改" @click.stop="emit('edit', row.original)"><Pencil class="size-4" /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="删除" @click.stop="emit('delete', row.original)"><Trash2 class="size-4" /></Button>
              </div>
            </TableCell>
          </TableRow>
          <TableRow v-if="!table.getRowModel().rows.length">
            <TableCell :colspan="8" class="h-24 text-center text-muted-foreground">没有符合条件的账本记录</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted-foreground">第 {{ table.getState().pagination.pageIndex + 1 }} / {{ Math.max(table.getPageCount(), 1) }} 页</p>
      <div class="flex items-center gap-2">
        <Select :model-value="String(table.getState().pagination.pageSize)" @update:model-value="value => table.setPageSize(Number(value))">
          <SelectTrigger class="w-32" aria-label="每页条数"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="10">每页 10 条</SelectItem>
            <SelectItem value="20">每页 20 条</SelectItem>
            <SelectItem value="50">每页 50 条</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon-sm" aria-label="上一页" :disabled="!table.getCanPreviousPage()" @click="table.previousPage()"><ChevronLeft class="size-4" /></Button>
        <Button variant="outline" size="icon-sm" aria-label="下一页" :disabled="!table.getCanNextPage()" @click="table.nextPage()"><ChevronRight class="size-4" /></Button>
      </div>
    </div>
  </div>
</template>
