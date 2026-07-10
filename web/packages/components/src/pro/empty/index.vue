<script setup lang="ts">
import type { HTMLAttributes, VNode } from 'vue'
import Icon from '../../basic/icon/index.vue'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './empty'

defineOptions({
  name: 'BuiltInEmpty',
})

const props = defineProps<{
  icon?: string
  title?: string
  description?: string
  class?: HTMLAttributes['class']
}>()

const slots = defineSlots<{
  icon?: () => VNode
  title?: () => VNode
  description?: () => VNode
  default?: () => VNode
}>()
</script>

<template>
  <Empty :class="props.class">
    <EmptyHeader>
      <EmptyMedia :variant="!!slots.icon ? 'default' : 'icon'">
        <slot name="icon">
          <Icon v-if="props.icon" :name="props.icon" class="size-6" />
        </slot>
      </EmptyMedia>
      <EmptyTitle v-if="!!slots.title || !!props.title">
        <slot name="title">
          {{ props.title }}
        </slot>
      </EmptyTitle>
      <EmptyDescription v-if="!!slots.description || !!props.description">
        <slot name="description">
          {{ props.description }}
        </slot>
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent v-if="!!slots.default">
      <slot name="default" />
    </EmptyContent>
  </Empty>
</template>
