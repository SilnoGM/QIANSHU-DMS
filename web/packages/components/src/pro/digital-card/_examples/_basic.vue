<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaDigitalCard from '../index.vue'

const stats = [
  {
    title: '总收入',
    icon: 'i-carbon:currency-yen',
    digital: '￥45,231.89',
    description: '较上周上升19%',
    trend: 'up' as const,
  },
  {
    title: '订阅数',
    icon: 'i-mynaui:users',
    digital: '+50',
    description: '较上周下降3%',
    trend: 'down' as const,
  },
  {
    title: '销售额',
    icon: 'i-bytesize:creditcard',
    digital: '+12,234',
    description: '较上周上升55%',
    trend: 'stable' as const,
  },
  {
    title: '活跃用户',
    titleTips: '仅统计近一小时的活跃用户数量',
    icon: 'i-carbon:activity',
    digital: '+573',
    description: '较近一小时上升10%',
  },
]
</script>

<template>
  <div class="gap-4 grid sm:grid-cols-2 xl:grid-cols-4">
    <FaDigitalCard
      v-for="stat in stats"
      :key="stat.title"
      :title="stat.title"
      :title-tips="stat.titleTips"
      :icon="stat.icon"
      :digital="stat.digital"
      :description="stat.description"
      :trend="stat.trend"
    />
  </div>
</template>
