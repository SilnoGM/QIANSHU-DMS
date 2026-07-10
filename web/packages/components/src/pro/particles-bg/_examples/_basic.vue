<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaParticlesBg from '../index.vue'

const particleColor = '#64748B'
</script>

<template>
  <div class="p-2 bg-background flex flex-col h-50 w-full items-center justify-center relative overflow-hidden">
    <FaParticlesBg
      class="inset-0 absolute"
      :color="particleColor"
    />
  </div>
</template>
