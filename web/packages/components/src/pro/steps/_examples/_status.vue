<script setup lang="ts">
import type { StepsItem, StepsStatus } from '../index.vue'
import { ref } from 'vue'
import FaButtonGroup from '../../../basic/button/ButtonGroup.vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaSteps from '../index.vue'

const currentStep = ref(1)
const status = ref<StepsStatus>('process')

const steps: StepsItem[] = [
  { id: 'create', title: '创建订单', description: '录入客户和商品' },
  { id: 'payment', title: '支付确认', description: '等待支付结果' },
  { id: 'delivery', title: '安排发货', description: '选择物流渠道' },
  { id: 'finish', title: '订单完成', description: '归档交易记录' },
]

const statusOptions: { label: string, value: StepsStatus }[] = [
  { label: '进行中', value: 'process' },
  { label: '等待中', value: 'wait' },
  { label: '已完成', value: 'finish' },
  { label: '异常', value: 'error' },
]

function prevStep() {
  currentStep.value = Math.max(currentStep.value - 1, 0)
}

function nextStep() {
  currentStep.value = Math.min(currentStep.value + 1, steps.length - 1)
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <FaSteps v-model="currentStep" :steps="steps" :status="status" />

    <div class="flex flex-wrap gap-3 justify-center">
      <FaButtonGroup>
        <FaButton
          variant="outline"
          :disabled="currentStep === 0"
          @click="prevStep"
        >
          上一步
        </FaButton>
        <FaButton
          variant="outline"
          :disabled="currentStep === steps.length - 1"
          @click="nextStep"
        >
          下一步
        </FaButton>
      </FaButtonGroup>

      <FaButtonGroup>
        <FaButton
          v-for="item in statusOptions"
          :key="item.value"
          :variant="status === item.value ? 'default' : 'outline'"
          @click="status = item.value"
        >
          {{ item.label }}
        </FaButton>
      </FaButtonGroup>
    </div>
  </div>
</template>
