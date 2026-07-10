<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaGradientButton from '../index.vue'
</script>

<template>
  <div class="flex flex-wrap gap-4">
    <FaGradientButton :colors="['#06b6d4', '#2563eb', '#7c3aed', '#06b6d4']">
      冷色配色
    </FaGradientButton>
    <FaGradientButton :colors="['#facc15', '#f97316', '#dc2626', '#7f1d1d', '#facc15']">
      火焰配色
    </FaGradientButton>
  </div>
</template>
