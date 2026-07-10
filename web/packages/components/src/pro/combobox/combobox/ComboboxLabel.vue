<script setup lang="ts">
import type { ComboboxLabelProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ComboboxLabel } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<ComboboxLabelProps & { class?: HTMLAttributes['class'] }>()
</script>

<template>
  <ComboboxLabel
    data-slot="combobox-label"
    :class="cn('text-muted-foreground px-2 py-1.5 text-xs', props.class)"
    v-bind="props"
  >
    <slot />
  </ComboboxLabel>
</template>
