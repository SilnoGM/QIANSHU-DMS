<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '#utils'

defineOptions({
  name: 'BuiltInInteractiveButton',
})

const props = defineProps<{
  text?: string
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <button
    :class="cn(
      'group relative w-auto cursor-pointer overflow-hidden rounded-full border bg-background p-2 px-6 text-center font-semibold',
      props.class,
    )"
  >
    <div class="flex gap-2 items-center">
      <div class="rounded-lg bg-primary size-2 scale-100 transition-all duration-300 group-hover:scale-[100.8]" />
      <span class="inline-block whitespace-nowrap transition-all duration-300 group-hover:opacity-0 group-hover:translate-x-12 rtl:group-hover:-translate-x-12">
        {{ text }}
      </span>
    </div>
    <div class="text-primary-foreground opacity-0 flex gap-2 size-full translate-x-12 transition-all duration-300 items-center top-0 justify-center absolute z-10 group-hover:opacity-100 group-hover:-translate-x-5 rtl:-translate-x-12 rtl:group-hover:translate-x-5">
      <span class="whitespace-nowrap">{{ text }}</span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="lucide lucide-arrow-right rtl:rotate-180"
      >
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    </div>
  </button>
</template>
