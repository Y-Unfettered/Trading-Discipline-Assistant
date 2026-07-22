<script setup lang="ts">
defineProps<{ eyebrow: string; title: string; description: string }>()
</script>

<template>
  <section class="relative mb-4 flex w-full min-w-0 flex-col items-stretch justify-between gap-6 overflow-hidden rounded-xl border border-red-200 bg-gradient-to-br from-red-50 to-card p-6 md:flex-row md:items-end dark:border-red-900/50 dark:from-red-950/20">
    <div v-if="$slots.meta" class="absolute right-4 top-4"><slot name="meta" /></div>
    <div class="max-w-3xl">
      <p class="mb-2 text-xs font-bold uppercase tracking-widest text-red-600">{{ eyebrow }}</p>
      <h1 class="text-4xl font-bold tracking-tight">{{ title }}</h1>
      <p class="mt-2 leading-6 text-muted-foreground">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex w-full min-w-0 flex-wrap items-end justify-start gap-2 md:w-auto md:shrink-0 md:justify-end">
      <slot name="actions" />
    </div>
  </section>
</template>
