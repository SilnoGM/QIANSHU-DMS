<script setup lang="ts">
import type { ComboboxGroupProps } from 'reka-ui'
import { ComboboxGroup } from 'reka-ui'

const props = defineProps<ComboboxGroupProps>()
</script>

<template>
  <ComboboxGroup
    data-slot="combobox-group"
    v-bind="props"
  >
    <slot />
  </ComboboxGroup>
</template>
