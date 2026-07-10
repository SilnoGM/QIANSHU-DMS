<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import FaIcon from '../../../basic/icon/index.vue'
import FaSpotlightCard from '../index.vue'
</script>

<template>
  <FaSpotlightCard :gradient-opacity="0.35">
    <div class="p-6 rounded flex flex-col gap-2 lg:p-8">
      <FaIcon name="i-ri:magic-line" class="h-8 w-8" />
      <h1 class="text-2xl font-medium">
        Soft spotlight
      </h1>
    </div>
  </FaSpotlightCard>
</template>
