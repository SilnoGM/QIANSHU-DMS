<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaTextShiny from '../index.vue'
</script>

<template>
  <div>
    适合做
    <FaTextShiny class="text-rose-600 font-bold dark:text-rose-400">
      行内重点强调
    </FaTextShiny>
    ，也可以通过文字颜色类控制成
    <FaTextShiny class="text-emerald-600 font-bold dark:text-emerald-400">
      品牌高亮
    </FaTextShiny>
    。
  </div>
</template>
