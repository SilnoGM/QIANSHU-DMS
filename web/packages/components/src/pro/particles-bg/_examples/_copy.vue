<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaParticlesBg from '../index.vue'

const particleColor = '#64748B'
</script>

<template>
  <div class="p-2 bg-background flex flex-col h-50 w-full items-center justify-center relative overflow-hidden">
    <span class="text-8xl text-transparent leading-none font-semibold text-center pointer-events-none whitespace-pre-wrap from-black to-gray-300/80 bg-gradient-to-b bg-clip-text dark:from-white dark:to-slate-900/10">
      Fantastic-admin
    </span>
    <FaParticlesBg
      class="inset-0 absolute"
      :color="particleColor"
      :quantity="100"
      :ease="100"
      :staticity="10"
    />
  </div>
</template>
