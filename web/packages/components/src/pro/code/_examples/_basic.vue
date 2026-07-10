<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaCode from '../index.vue'

const code = `<FaCard title="卡片标题" description="卡片描述" class="w-80">
  卡片内容
  <template #footer>
    卡片底部
  </template>
</FaCard>`
</script>

<template>
  <FaCode :code class="flex-1" />
</template>
