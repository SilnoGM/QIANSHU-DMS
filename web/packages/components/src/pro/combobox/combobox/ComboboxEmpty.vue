<script setup lang="ts">
import type { ComboboxEmptyProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { ComboboxEmpty } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<ComboboxEmptyProps & { class?: HTMLAttributes['class'] }>()
</script>

<template>
  <ComboboxEmpty
    data-slot="combobox-empty"
    v-bind="props"
    :class="cn('text-muted-foreground px-2 py-6 text-center text-sm', props.class)"
  >
    <slot />
  </ComboboxEmpty>
</template>
