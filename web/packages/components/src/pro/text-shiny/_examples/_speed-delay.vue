<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaTextShiny from '../index.vue'
</script>

<template>
  <div>
    <FaTextShiny
      :duration="1.1"
      :delay="0"
      class="text-4xl text-amber-600 tracking-tight font-black dark:text-amber-400"
    >
      快速扫光
    </FaTextShiny>
    <FaTextShiny
      :duration="2.4"
      :delay="0.4"
      class="text-4xl text-violet-600 tracking-tight font-black dark:text-violet-400"
    >
      更慢一点的节奏
    </FaTextShiny>
  </div>
</template>
