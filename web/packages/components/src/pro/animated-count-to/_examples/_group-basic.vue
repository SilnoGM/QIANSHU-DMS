<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import { onScopeDispose, shallowRef } from 'vue'
import FaAnimatedCountToGroup from '../AnimatedCountToGroup.vue'
import FaAnimatedCountTo from '../index.vue'

const value1 = shallowRef(0)
const value2 = shallowRef(0)

const timer = setInterval(() => {
  value1.value += Math.floor(Math.random() * 1000) * (Math.random() > 0.5 ? 1 : -1)
  value2.value += Math.random() * (Math.random() > 0.5 ? 1 : -1)
}, 2000)

onScopeDispose(() => {
  clearInterval(timer)
})
</script>

<template>
  <div class="flex-center-start gap-2">
    <FaAnimatedCountToGroup>
      <FaAnimatedCountTo :value="value1" locales="zh-CN" :format="{ style: 'currency', currency: 'CNY' }" will-change class="text-4xl font-bold" />
      <FaAnimatedCountTo :value="value2" locales="zh-CN" :format="{ style: 'percent', maximumFractionDigits: 2, signDisplay: 'always' }" will-change class="text-2xl text-green-500 font-bold" :class="{ 'text-red-500': value2 < 0 }" />
    </FaAnimatedCountToGroup>
  </div>
</template>
