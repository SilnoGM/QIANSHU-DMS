<script setup lang="ts">
import type { LabelProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { Label } from 'reka-ui'
import { cn } from '#utils'
import { useMentionContext } from './context'

const props = defineProps<LabelProps & { class?: HTMLAttributes['class'] }>()

const context = useMentionContext('MentionLabel')
const delegatedProps = reactiveOmit(props, 'class', 'for')
</script>

<template>
  <Label
    :id="context.labelId"
    data-slot="mention-label"
    :for="context.inputId"
    v-bind="delegatedProps"
    :class="cn('flex items-center gap-2 text-sm leading-none font-medium select-none', props.class)"
  >
    <slot />
  </Label>
</template>
