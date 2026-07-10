<script setup lang="ts">
import { shallowRef } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaScrollingText from '../index.vue'

const items = [
  '点击查看：Vue 3 最佳实践指南',
  '点击查看：TypeScript 进阶教程',
  '点击查看：Vite 构建优化技巧',
  '点击查看：Pinia 状态管理详解',
  '点击查看：Fantasic Admin 最新功能介绍',
]
const clickedText = shallowRef('等待点击')

function handleClick(text: string, index: number) {
  clickedText.value = `点击了第 ${index + 1} 条：${text}`
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <FaScrollingText
      :items="items"
      direction="down"
      :duration="2000"
      class="text-sm text-primary h-8 cursor-pointer"
      @item-click="handleClick"
    />
    <div class="text-sm text-muted-foreground">
      {{ clickedText }}
    </div>
  </div>
</template>
