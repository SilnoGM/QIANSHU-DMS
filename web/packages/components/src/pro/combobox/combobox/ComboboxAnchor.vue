<script setup lang="ts">
import type { ComboboxAnchorProps } from 'reka-ui'
import { ComboboxAnchor } from 'reka-ui'

defineProps<ComboboxAnchorProps>()
</script>

<template>
  <ComboboxAnchor
    data-slot="combobox-anchor"
    v-bind="$props"
  >
    <slot />
  </ComboboxAnchor>
</template>
