<script setup lang="ts">
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'

defineProps<{ label: string; forId?: string; hint?: string }>()
</script>

<template>
  <Field>
    <FieldLabel :for="forId">{{ label }}</FieldLabel>
    <slot />
    <FieldDescription v-if="hint">{{ hint }}</FieldDescription>
  </Field>
</template>
