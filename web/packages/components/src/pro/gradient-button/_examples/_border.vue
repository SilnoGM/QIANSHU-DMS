<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaGradientButton from '../index.vue'
</script>

<template>
  <div class="flex flex-wrap gap-4">
    <FaGradientButton>
      默认边框
    </FaGradientButton>
    <FaGradientButton class="p-2">
      加粗边框
    </FaGradientButton>
  </div>
</template>
