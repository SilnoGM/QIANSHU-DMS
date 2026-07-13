<script setup lang="ts">
import type { ComboboxViewportProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ComboboxViewport, useForwardProps } from 'reka-ui'
import { cn } from '#utils'

const props = defineProps<ComboboxViewportProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <ComboboxViewport
    data-slot="combobox-viewport"
    v-bind="{ ...$attrs, ...forwardedProps }"
    :class="cn('p-1', props.class)"
  >
    <slot />
  </ComboboxViewport>
</template>
