<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaFlipWords from '../index.vue'
</script>

<template>
  <div class="flex h-100 items-center justify-center">
    <div class="text-4xl text-neutral-600 font-semibold mx-auto dark:text-neutral-400">
      Vue.js 是一款
      <FaFlipWords
        :words="['渐进式', '易上手的', '高性能', '多功能']"
        :duration="3000"
        class="text-4xl !text-primary"
      />
      JavaScript 框架
      <div class="mt-4">
        用于构建现代 Web 应用
      </div>
    </div>
  </div>
</template>
