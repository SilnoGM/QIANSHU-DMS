<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '#utils'
import Icon from '../../basic/icon/index.vue'
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from './stepper'

export type StepsStatus = 'error' | 'process' | 'wait' | 'finish'

export interface StepsItem {
  id: string
  title: string
  description?: string
}

defineOptions({
  name: 'BuiltInSteps',
})

const props = withDefaults(defineProps<{
  steps: StepsItem[]
  status?: StepsStatus
  class?: HTMLAttributes['class']
}>(), {
  status: 'process',
})

defineSlots<Record<string, (props: {
  step: StepsItem
  index: number
  status: StepsStatus
  active: boolean
  finished: boolean
}) => any>>()

const currentStep = defineModel<number>({
  default: 0,
})

const normalizedCurrentStep = computed(() => {
  if (props.steps.length === 0) {
    return 0
  }
  return Math.min(Math.max(currentStep.value, 0), props.steps.length - 1)
})

const stepperValue = computed({
  get: () => normalizedCurrentStep.value + 1,
  set: (value: number | undefined) => {
    if (typeof value === 'number') {
      currentStep.value = Math.min(Math.max(value - 1, 0), Math.max(props.steps.length - 1, 0))
    }
  },
})

function isCurrentStep(index: number) {
  return index === normalizedCurrentStep.value
}

function isStepFinished(index: number) {
  return index < normalizedCurrentStep.value || (isCurrentStep(index) && props.status === 'finish')
}

function getStepStatus(index: number): StepsStatus {
  if (isStepFinished(index)) {
    return 'finish'
  }
  if (isCurrentStep(index)) {
    return props.status
  }
  return 'wait'
}
</script>

<template>
  <Stepper
    v-model="stepperValue"
    :class="cn('flex items-start gap-2', props.class)"
  >
    <StepperItem
      v-for="(step, index) in steps"
      :key="step.id"
      :step="index + 1"
      class="flex flex-col w-full items-center justify-center relative"
    >
      <StepperTrigger disabled>
        <StepperIndicator
          class="relative"
          :class="{
            'bg-destructive text-white group-data-[state=active]:bg-destructive group-data-[state=active]:text-white': getStepStatus(index) === 'error' && isCurrentStep(index),
            'bg-green-500 text-white group-data-[state=active]:bg-green-500 group-data-[state=active]:text-white group-data-[state=completed]:bg-green-500 group-data-[state=completed]:text-white': getStepStatus(index) === 'finish',
            'bg-muted before:(absolute inline-flex size-full rounded-full bg-primary/30 content-empty animate-ping)': getStepStatus(index) === 'wait' && isCurrentStep(index),
            'bg-muted': getStepStatus(index) === 'wait' && !isCurrentStep(index),
          }"
        >
          <Icon v-if="getStepStatus(index) === 'finish'" name="i-heroicons:check" class="size-5" />
          <Icon v-else-if="getStepStatus(index) === 'error'" name="i-heroicons:x-mark" class="size-5" />
          <Icon v-else-if="getStepStatus(index) === 'wait' && isCurrentStep(index)" name="i-heroicons:arrow-path" class="size-5 animate-spin" />
          <span v-else>{{ index + 1 }}</span>
        </StepperIndicator>
      </StepperTrigger>
      <StepperSeparator
        v-if="index !== steps.length - 1"
        class="rounded-full bg-muted shrink-0 h-0.5 block left-[calc(50%+20px)] right-[calc(-50%+10px)] top-5 absolute group-data-[state=completed]:bg-green-500"
      />
      <div class="flex flex-col items-center">
        <StepperTitle
          :class="{
            'text-destructive group-data-[state=active]:text-destructive': getStepStatus(index) === 'error',
            'text-green-500 group-data-[state=active]:text-green-500 group-data-[state=completed]:text-green-500': getStepStatus(index) === 'finish',
          }"
        >
          {{ step.title }}
        </StepperTitle>
        <StepperDescription
          v-if="step.description"
          :class="{
            'text-destructive group-data-[state=active]:text-destructive': getStepStatus(index) === 'error',
            'text-green-500 group-data-[state=active]:text-green-500 group-data-[state=completed]:text-green-500': getStepStatus(index) === 'finish',
          }"
        >
          {{ step.description }}
        </StepperDescription>
      </div>
      <div v-if="$slots[step.id]" class="mt-3 px-2 min-w-0 w-full">
        <slot
          :name="step.id"
          :step="step"
          :index="index"
          :status="getStepStatus(index)"
          :active="isCurrentStep(index)"
          :finished="isStepFinished(index)"
        />
      </div>
    </StepperItem>
  </Stepper>
</template>
