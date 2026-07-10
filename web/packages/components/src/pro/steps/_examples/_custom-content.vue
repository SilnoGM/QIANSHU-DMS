<script setup lang="ts">
import type { StepsItem } from '../index.vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaSteps from '../index.vue'

const steps: StepsItem[] = [
  { id: 'prepare', title: '准备', description: '校验订单信息' },
  { id: 'ship', title: '发货', description: '同步物流单号' },
  { id: 'receive', title: '签收', description: '确认客户收货' },
]
</script>

<template>
  <FaSteps :model-value="1" :steps="steps" status="process">
    <template #prepare="{ finished }">
      <div v-if="finished" class="flex justify-center">
        <div class="text-xs text-emerald-600">
          商品库存已锁定
        </div>
      </div>
    </template>
    <template #ship="{ active, status }">
      <div v-if="active" class="flex justify-center">
        <div class="text-xs text-muted-foreground px-3 py-2 rounded-md bg-muted">
          当前节点：{{ status }}，物流单待生成
        </div>
      </div>
    </template>
    <template #receive="{ active }">
      <div v-if="!active" class="flex justify-center">
        <div class="text-xs text-muted-foreground">
          等待发货完成后处理
        </div>
      </div>
    </template>
  </FaSteps>
</template>
