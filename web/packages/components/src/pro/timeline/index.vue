<script setup lang="ts" generic="T extends { datetime: string | number | Date }">
import type { HTMLAttributes } from 'vue'
import dayjs from 'dayjs'
import { computed, ref, useTemplateRef } from 'vue'
import { cn } from '#utils'
import ScrollArea from '../../basic/scroll-area/index.vue'
import AnimatedCountToGroup from '../animated-count-to/AnimatedCountToGroup.vue'
import AnimatedCountTo from '../animated-count-to/index.vue'

defineOptions({
  name: 'BuiltInTimeline',
})

const props = withDefaults(defineProps<{
  data?: T[]
  merge?: boolean
  class?: HTMLAttributes['class']
}>(), {
  data: () => [],
  merge: false,
})

const timelineItems = useTemplateRef('timelineItems')
const scrollTop = ref(0)
const activeIndex = computed(() => {
  const items = timelineItems.value?.map(item => item.offsetTop - 60)
  return Math.max(0, (items?.findIndex(item => item > scrollTop.value) ?? 1) - 1)
})

function handleScroll(event: Event) {
  scrollTop.value = (event.target as HTMLElement).scrollTop
}

function getYear(datetime: T['datetime']) {
  return dayjs(datetime).format('YYYY')
}

function getMonth(datetime: T['datetime']) {
  return dayjs(datetime).format('MM')
}

function getDay(datetime: T['datetime']) {
  return dayjs(datetime).format('DD')
}
</script>

<template>
  <ScrollArea :content-class="cn('relative w-full', props.class)" @on-scroll="handleScroll">
    <div v-if="!!data.length" class="p-2 flex-col-center-start w-40 start-0 top-0 absolute z-1 backdrop-blur">
      <AnimatedCountTo :value="Number(getYear(data[activeIndex].datetime))" will-change :format="{ notation: 'compact' }" class="text-2xl font-bold opacity-20" />
      <div class="flex items-center">
        <AnimatedCountToGroup>
          <AnimatedCountTo :value="Number(getMonth(data[activeIndex].datetime))" will-change :format="{ minimumIntegerDigits: 2, notation: 'compact' }" class="text-4xl font-bold" />
          <span class="text-xl text-muted-foreground/60 font-normal px-2"> / </span>
          <AnimatedCountTo :value="Number(getDay(data[activeIndex].datetime))" will-change :format="{ minimumIntegerDigits: 2, notation: 'compact' }" class="text-4xl font-bold" />
        </AnimatedCountToGroup>
      </div>
    </div>
    <div class="flex flex-col gap-8 w-full">
      <div v-for="(item, index) in data" :key="index" ref="timelineItems" class="flex gap-4">
        <div
          class="p-2 flex-col-center-start w-40 transition-all" :class="{
            'opacity-0 -translate-y-10': index <= activeIndex,
            'opacity-0': props.merge && index > 0 && item.datetime === data[index - 1].datetime,
          }"
        >
          <AnimatedCountTo :value="Number(getYear(item.datetime))" :format="{ notation: 'compact' }" class="text-2xl font-bold opacity-20" />
          <div class="flex items-center">
            <AnimatedCountTo :value="Number(getMonth(item.datetime))" :format="{ minimumIntegerDigits: 2, notation: 'compact' }" class="text-4xl font-bold" />
            <span class="text-xl text-muted-foreground/60 font-normal px-2"> / </span>
            <AnimatedCountTo :value="Number(getDay(item.datetime))" :format="{ minimumIntegerDigits: 2, notation: 'compact' }" class="text-4xl font-bold" />
          </div>
        </div>
        <div class="flex-1">
          <slot :item="item" />
        </div>
      </div>
    </div>
  </ScrollArea>
</template>
