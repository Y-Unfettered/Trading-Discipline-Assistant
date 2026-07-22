<script setup lang="ts">
import type { Component } from 'vue'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

defineProps<{ label: string; value: string | number; detail?: string; icon?: Component; tone?: 'default' | 'success' | 'warning' }>()
</script>

<template>
  <Card class="relative overflow-hidden shadow-none after:absolute after:inset-x-0 after:bottom-0 after:h-1 after:bg-red-600 after:content-['']">
    <CardHeader>
      <div class="flex items-center justify-between gap-4">
        <CardDescription>{{ label }}</CardDescription>
        <span v-if="icon" class="grid size-9 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/30">
          <component :is="icon" class="size-4" />
        </span>
      </div>
      <CardTitle class="text-3xl tracking-tight">{{ value }}</CardTitle>
      <CardDescription v-if="detail">{{ detail }}</CardDescription>
    </CardHeader>
  </Card>
</template>
