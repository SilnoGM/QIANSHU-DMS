<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import { onScopeDispose, shallowRef } from 'vue'
import FaAnimatedCountTo from '../index.vue'

const value = shallowRef(0)

const timer = setInterval(() => {
  value.value += Math.floor(Math.random() * 1000) * (Math.random() > 0.5 ? 1 : -1)
}, 2000)

onScopeDispose(() => {
  clearInterval(timer)
})
</script>

<template>
  <FaAnimatedCountTo :value prefix="￥" suffix="元" will-change class="text-4xl font-bold" />
</template>
