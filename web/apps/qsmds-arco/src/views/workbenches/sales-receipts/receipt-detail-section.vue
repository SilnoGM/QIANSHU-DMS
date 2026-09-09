<script setup lang="ts">
defineProps<{ title: string, icon: string }>()
</script>

<template>
  <section class="p-4 border border-border rounded-xl bg-background min-w-0 space-y-4 sm:p-5">
    <header class="flex gap-2.5 items-center">
      <span class="text-muted-foreground rounded-lg bg-muted/60 flex shrink-0 size-8 items-center justify-center"><FaIcon :name="icon" class="size-4" aria-hidden="true" /></span>
      <h3 class="qs-type-component-title m-0 min-w-0 break-words">
        {{ title }}
      </h3>
    </header>
    <slot />
  </section>
</template>
