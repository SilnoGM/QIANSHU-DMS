<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaBorderBeam from '../index.vue'
</script>

<template>
  <div class="border rounded-lg flex-center h-100 relative overflow-hidden">
    <span class="text-8xl text-transparent leading-none font-semibold text-center pointer-events-none whitespace-pre-wrap from-black to-gray-300/80 bg-gradient-to-b bg-clip-text dark:from-white dark:to-slate-900/10">
      Fantastic-admin
    </span>
    <FaBorderBeam
      :size="250"
      :duration="12000"
      :delay="1000"
      :border-width="2"
    />
  </div>
</template>
