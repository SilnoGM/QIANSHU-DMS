<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '#utils'
import Card from '../../basic/card/index.vue'
import Icon from '../../basic/icon/index.vue'
import Tooltip from '../../basic/tooltip/index.vue'

defineOptions({
  name: 'BuiltInDigitalCard',
})

const props = defineProps<{
  title: string
  titleTips?: string
  icon?: string
  digital: string | number
  description?: string
  trend?: 'up' | 'stable' | 'down'
  class?: HTMLAttributes['class']
}>()

const trendIcon = computed(() => {
  switch (props.trend) {
    case 'up':
      return 'i-material-symbols:trending-up'
    case 'stable':
      return 'i-material-symbols:trending-flat'
    case 'down':
      return 'i-material-symbols:trending-down'
    default:
      return ''
  }
})
</script>

<template>
  <Card :class="cn('flex flex-col gap-y-2 w-full items-start', props.class)" class="" header-class="w-full gap-0">
    <template #header>
      <div class="flex flex-row gap-y-1.5 items-center justify-between space-y-0">
        <h3 class="text-sm tracking-tight font-medium flex-center-start gap-x-1">
          {{ title }}
          <Tooltip v-if="!!titleTips" :text="titleTips">
            <Icon name="i-material-symbols:help-rounded" class="text-muted-foreground size-4" />
          </Tooltip>
        </h3>
        <Icon v-if="!!icon" :name="icon" class="text-muted-foreground size-6" />
      </div>
    </template>
    <div class="text-2xl font-bold flex-center-start gap-x-1">
      {{ digital }}
      <Icon v-if="!!trendIcon" :name="trendIcon" />
    </div>
    <p v-if="!!description" class="text-sm text-gray-500">
      {{ description }}
    </p>
  </Card>
</template>
