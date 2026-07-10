<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaGradientButton from '../index.vue'
</script>

<template>
  <div class="flex flex-wrap gap-4">
    <FaGradientButton :duration="500">
      速度更快
    </FaGradientButton>
    <FaGradientButton :duration="4000">
      速度更慢
    </FaGradientButton>
  </div>
</template>
