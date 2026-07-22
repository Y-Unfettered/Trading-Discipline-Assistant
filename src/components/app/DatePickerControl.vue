<script setup lang="ts">
import { computed, ref } from 'vue'
import { getLocalTimeZone, parseDate, type DateValue } from '@internationalized/date'
import { ChevronDown } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const props = withDefaults(defineProps<{ modelValue?: string; placeholder?: string; includeTime?: boolean }>(), {
  modelValue: '',
  placeholder: '选择日期',
  includeTime: false,
})
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const open = ref(false)

const dateValue = computed<DateValue | undefined>({
  get() {
    const raw = props.modelValue.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined
    try { return parseDate(raw) } catch { return undefined }
  },
  set(value) {
    const date = value?.toString() || ''
    const time = props.includeTime ? (props.modelValue.split('T')[1] || '00:00:00') : ''
    emit('update:modelValue', date && time ? `${date}T${time}` : date)
    if (date) open.value = false
  },
})

const timeValue = computed({
  get: () => props.modelValue.split('T')[1] || '',
  set: (time: string) => {
    const date = dateValue.value?.toString() || ''
    emit('update:modelValue', date && time ? `${date}T${time}` : date)
  },
})
</script>

<template>
  <div class="flex gap-4">
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button variant="outline" class="w-32 justify-between font-normal">
          {{ dateValue ? dateValue.toDate(getLocalTimeZone()).toLocaleDateString('zh-CN') : placeholder }}
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-auto overflow-hidden p-0" align="start">
        <Calendar v-model="dateValue" />
      </PopoverContent>
    </Popover>
    <Input
      v-if="includeTime"
      v-model="timeValue"
      type="time"
      step="1"
      class="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
    />
  </div>
</template>
