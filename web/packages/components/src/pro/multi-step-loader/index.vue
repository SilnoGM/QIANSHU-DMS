<script setup lang="ts">
import { ref, watch } from 'vue'
import Icon from '../../basic/icon/index.vue'

defineOptions({
  name: 'BuiltInMultiStepLoader',
})

const props = withDefaults(defineProps<{
  loading?: boolean
  steps: Step[]
  preventClose?: boolean
}>(), {
  loading: false,
  preventClose: false,
})

const emit = defineEmits<{
  stateChange: [number]
  complete: []
  close: []
  error: [Error, number]
}>()

export interface Step {
  text: string // 步骤文本
  afterText?: string // 步骤完成后的文本
  name?: string // 步骤返回数据对象名称
  action?: (context: StepContext) => Promise<any> // 步骤执行的函数
}

export type StepContext = Record<string, any>

const currentState = ref(0)
const isLastStepComplete = ref(false)
const stepResults = ref<StepContext>({}) // 存储每个步骤的返回值

async function executeStepAction(step: Step) {
  if (typeof step.action === 'function') {
    try {
      const result = await step.action(stepResults.value)
      if (step.name) {
        stepResults.value[step.name] = result
      }
      return true
    }
    catch (error) {
      emit('error', error as Error, currentState.value)
      return false
    }
  }
  return true
}

async function proceedToNextStep() {
  const currentStep = props.steps[currentState.value]
  if (!currentStep) {
    return
  }

  // Execute the current step's action
  const success = await executeStepAction(currentStep)
  if (!success) {
    return // 如果执行失败，终止流程
  }

  if (currentState.value < props.steps.length - 1) {
    currentState.value++
    emit('stateChange', currentState.value)
    processCurrentStep()
  }
  else {
    isLastStepComplete.value = true
    emit('complete')
  }
}

async function processCurrentStep() {
  const currentStep = props.steps[currentState.value]
  if (!currentStep) {
    return
  }

  await proceedToNextStep()
}

function close() {
  emit('close')
}

watch(
  () => props.loading,
  (newLoading) => {
    if (newLoading) {
      currentState.value = 0
      isLastStepComplete.value = false
      stepResults.value = {} // 重置步骤结果
      processCurrentStep()
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-300"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="loading && steps.length > 0"
        class="flex size-full items-center inset-0 justify-center fixed z-5000 backdrop-blur-2xl"
      >
        <button
          v-show="!preventClose"
          class="text-sm text-primary-foreground font-medium px-3 rounded-md bg-primary inline-flex h-9 whitespace-nowrap ring-offset-background transition-colors items-center right-4 top-4 justify-center absolute z-5001 focus-visible:outline-none hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          size="sm"
          @click="close"
        >
          <Icon name="i-heroicons:x-mark" class="size-6" />
        </button>
        <div class="h-96 relative">
          <div class="mx-auto mt-40 flex flex-col max-w-xl justify-start relative">
            <div
              v-for="(step, index) in steps"
              :key="index"
            >
              <div
                v-if="step"
                class="mb-4 text-left flex gap-2 transition-all duration-300 ease-in-out items-center"
                :style="{
                  opacity:
                    index === currentState
                      ? 1
                      : Math.max(1 - Math.abs(index - currentState) * 0.2, 0),
                  transform: `translateY(${
                    index === currentState ? -(currentState * 40) : -(currentState * 40)
                  }px)`,
                }"
              >
                <Icon v-if="index < currentState || (index === steps.length - 1 && index === currentState && isLastStepComplete)" name="i-heroicons:check-circle-solid" class="text-primary size-6" />
                <Icon v-else-if="index === currentState && (!isLastStepComplete || index !== steps.length - 1)" name="i-heroicons:arrow-path" class="text-primary size-6 animate-spin" />
                <Icon v-else name="i-heroicons:check-circle" class="text-black opacity-50 size-6 dark:text-white" />
                <div class="flex flex-col">
                  <span
                    class="text-lg text-black dark:text-white" :class="[
                      index > currentState && 'opacity-50',
                    ]"
                  >
                    {{ step.text }}
                  </span>
                  <Transition
                    enter-active-class="transition-all duration-300"
                    enter-from-class="opacity-0 -translate-y-1"
                    enter-to-class="opacity-100 translate-y-0"
                  >
                    <span
                      v-if="
                        step.afterText
                          && (index < currentState
                            || (index === steps.length - 1
                              && index === currentState
                              && isLastStepComplete))
                      "
                      class="text-sm text-gray-500 mt-1 dark:text-gray-400"
                    >
                      {{ step.afterText }}
                    </span>
                  </Transition>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          class="bg-white h-full [mask-image:radial-gradient(900px_at_center,oklch(var(--primary))_30%,transparent)] inset-x-0 bottom-0 absolute z--1 bg-gradient-to-t dark:bg-black"
        />
      </div>
    </Transition>
  </Teleport>
</template>
