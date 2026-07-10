<script setup lang="ts">
import type { ComboboxTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { ComboboxTrigger } from 'reka-ui'
import { cn } from '#utils'

const props = withDefaults(
  defineProps<ComboboxTriggerProps & { class?: HTMLAttributes['class'] }>(),
  {
    as: 'button',
  },
)
</script>

<template>
  <ComboboxTrigger
    data-slot="combobox-trigger"
    :type="as === 'button' ? 'button' : undefined"
    :class="cn(
      'inline-flex size-4 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none',
      props.class,
    )"
    v-bind="props"
  >
    <slot>
      <ChevronDown class="opacity-50 size-4" />
    </slot>
  </ComboboxTrigger>
</template>
