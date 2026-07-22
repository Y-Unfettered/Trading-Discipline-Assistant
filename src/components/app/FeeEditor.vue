<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { NumberField, NumberFieldContent, NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'

defineProps<{ busy?: boolean }>()
const emit = defineEmits<{ save: [value: string] }>()
const value = ref<number | undefined>()
function save() { if (value.value != null) emit('save', String(value.value)) }
</script>

<template><div class="flex gap-2"><NumberField v-model="value" :min="0" :step="0.01"><NumberFieldContent><NumberFieldDecrement /><NumberFieldInput placeholder="实际费用" /><NumberFieldIncrement /></NumberFieldContent></NumberField><Button size="sm" variant="outline" :disabled="busy" @click="save">补录</Button></div></template>
