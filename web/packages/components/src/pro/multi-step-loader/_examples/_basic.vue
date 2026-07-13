<script setup lang="ts">
import type { Step, StepContext } from '../index.vue'
import { shallowRef } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaMultiStepLoader from '../index.vue'

const isLoading = shallowRef(false)
const status = shallowRef('等待开始')

const taskSteps: Step[] = [
  {
    text: '获取用户数据',
    afterText: '获取用户数据成功',
    name: 'user',
    action: async () => {
      // 模拟异步请求
      await new Promise(resolve => setTimeout(resolve, 1000))
      return { id: 1, name: '张三' }
    },
  },
  {
    text: '获取用户订单（这一步会模拟随机错误）',
    afterText: '获取用户订单成功',
    name: 'orders',
    action: async (context: StepContext) => {
      await new Promise(resolve => setTimeout(resolve, 1500))
      // 模拟随机错误
      if (Math.random() > 0.5) {
        throw new Error('获取订单数据失败：网络连接超时')
      }
      return [
        { id: 1, userId: context.user.id, product: '商品A' },
        { id: 2, userId: context.user.id, product: '商品B' },
      ]
    },
  },
  {
    text: '处理订单数据',
    action: async (context: StepContext) => {
      // 模拟异步请求
      await new Promise(resolve => setTimeout(resolve, 2000))
      return {
        user: context.user,
        orders: context.orders,
        totalAmount: context.orders.length * 100,
      }
    },
  },
]

function handleStateChange(state: number) {
  status.value = `当前步骤：${state + 1}`
}

function handleComplete() {
  status.value = '所有步骤已完成'
  isLoading.value = false
}

function handleError(error: Error, stepIndex: number) {
  status.value = `步骤 ${stepIndex + 1} 执行失败：${error.message}`
  isLoading.value = false
}
</script>

<template>
  <div class="flex flex-col gap-3 items-start">
    <div class="flex gap-4">
      <FaButton @click="isLoading = !isLoading">
        {{ isLoading ? '停止' : '开始' }}
      </FaButton>
      <FaMultiStepLoader
        :loading="isLoading"
        :steps="taskSteps"
        prevent-close
        @state-change="handleStateChange"
        @complete="handleComplete"
        @error="handleError"
      />
    </div>
    <div class="text-sm text-muted-foreground">
      {{ status }}
    </div>
  </div>
</template>
