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
  <FaAnimatedCountTo
    :value
    :transform-timing="{ duration: 750, easing: 'ease-out' }"
    :spin-timing="{ duration: 750, easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' }"
    :opacity-timing="{ duration: 350, easing: 'ease-out' }"
    will-change
    class="text-4xl font-bold"
  />
</template>
