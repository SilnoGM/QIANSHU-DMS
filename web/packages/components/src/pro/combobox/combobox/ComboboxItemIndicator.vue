<script setup lang="ts">
import type { ComboboxItemIndicatorProps } from 'reka-ui'
import { ComboboxItemIndicator } from 'reka-ui'

const props = withDefaults(defineProps<ComboboxItemIndicatorProps>(), {
  as: 'span',
})
</script>

<template>
  <ComboboxItemIndicator
    data-slot="combobox-item-indicator"
    v-bind="props"
  >
    <slot />
  </ComboboxItemIndicator>
</template>
