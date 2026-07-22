<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useVueTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/vue-table'
import { ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateTime, decimal, money } from '@/lib/trade-api'

export type DataTableColumn = {
  key: string
  label: string
  sortable?: boolean
  format?: 'money' | 'decimal' | 'datetime' | 'percent'
  digits?: number
}

type DataRow = Record<string, any>
const props = withDefaults(defineProps<{
  columns: DataTableColumn[]
  data: DataRow[]
  rowKey?: string
  searchPlaceholder?: string
  emptyMessage?: string
  initialSortKey?: string
  initialSortDesc?: boolean
  pageSize?: number
}>(), {
  rowKey: 'id',
  searchPlaceholder: '搜索表格内容',
  emptyMessage: '没有符合条件的记录',
  initialSortKey: '',
  initialSortDesc: true,
  pageSize: 10,
})

const query = ref('')
const sorting = ref<SortingState>(props.initialSortKey ? [{ id: props.initialSortKey, desc: props.initialSortDesc }] : [])
const filteredData = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase('zh-CN')
  if (!keyword) return props.data
  return props.data.filter(row => props.columns.some(column => String(row[column.key] ?? '').toLocaleLowerCase('zh-CN').includes(keyword)))
})
const tableColumns: ColumnDef<DataRow>[] = props.columns.map(column => ({
  accessorKey: column.key,
  header: column.label,
  enableSorting: column.sortable !== false,
  meta: column,
}))
const table = useVueTable({
  get data() { return filteredData.value },
  columns: tableColumns,
  getRowId: (row, index) => String(row[props.rowKey] ?? index),
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
    pagination: { pageIndex: 0, pageSize: props.pageSize },
  },
})

function columnMeta(cell: any) {
  return cell.column.columnDef.meta as DataTableColumn
}

function formatValue(row: DataRow, column: DataTableColumn) {
  const value = row[column.key]
  if (value == null || value === '') return '—'
  if (column.format === 'money') return money(value)
  if (column.format === 'decimal') return decimal(value, column.digits ?? 2)
  if (column.format === 'datetime') return dateTime(value)
  if (column.format === 'percent') return `${Number(value).toFixed(column.digits ?? 2)}%`
  return String(value)
}

watch(query, () => table.setPageIndex(0))
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <Input v-model="query" class="max-w-sm" :placeholder="searchPlaceholder" :aria-label="searchPlaceholder" />
      <p class="text-sm text-muted-foreground">共 {{ filteredData.length }} 条</p>
    </div>
    <div class="overflow-auto">
      <Table>
        <TableHeader>
          <TableRow v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
            <TableHead v-for="header in headerGroup.headers" :key="header.id">
              <Button v-if="header.column.getCanSort()" variant="ghost" size="sm" @click="header.column.toggleSorting(header.column.getIsSorted() === 'asc')">
                {{ header.column.columnDef.header }}<ArrowUpDown class="size-4" />
              </Button>
              <span v-else>{{ header.column.columnDef.header }}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="row in table.getRowModel().rows" :key="row.id">
            <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">{{ formatValue(row.original, columnMeta(cell)) }}</TableCell>
          </TableRow>
          <TableRow v-if="!table.getRowModel().rows.length"><TableCell :colspan="columns.length" class="h-24 text-center text-muted-foreground">{{ emptyMessage }}</TableCell></TableRow>
        </TableBody>
      </Table>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted-foreground">第 {{ table.getState().pagination.pageIndex + 1 }} / {{ Math.max(table.getPageCount(), 1) }} 页</p>
      <div class="flex items-center gap-2">
        <Select :model-value="String(table.getState().pagination.pageSize)" @update:model-value="value => table.setPageSize(Number(value))">
          <SelectTrigger class="w-32" aria-label="每页条数"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="10">每页 10 条</SelectItem><SelectItem value="20">每页 20 条</SelectItem><SelectItem value="50">每页 50 条</SelectItem></SelectContent>
        </Select>
        <Button variant="outline" size="icon-sm" aria-label="上一页" :disabled="!table.getCanPreviousPage()" @click="table.previousPage()"><ChevronLeft class="size-4" /></Button>
        <Button variant="outline" size="icon-sm" aria-label="下一页" :disabled="!table.getCanNextPage()" @click="table.nextPage()"><ChevronRight class="size-4" /></Button>
      </div>
    </div>
  </div>
</template>
