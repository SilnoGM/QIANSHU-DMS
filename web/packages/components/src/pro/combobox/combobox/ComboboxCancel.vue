<script setup lang="ts">
import type { ComboboxCancelProps } from 'reka-ui'
import { ComboboxCancel } from 'reka-ui'

const props = withDefaults(defineProps<ComboboxCancelProps>(), {
  as: 'button',
})
</script>

<template>
  <ComboboxCancel
    data-slot="combobox-cancel"
    v-bind="props"
  >
    <slot />
  </ComboboxCancel>
</template>
