<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import { nextTick, shallowRef } from 'vue'
import FaButton from '../../../basic/button/index.vue'
import FaBlurReveal from '../index.vue'

const show = shallowRef(true)

function handleReset() {
  show.value = false
  nextTick(() => {
    show.value = true
  })
}
</script>

<template>
  <FaBlurReveal
    v-if="show"
    class="p-8"
  >
    <h2 class="text-6xl tracking-tighter font-bold">
      你好呀 👋
    </h2>
    <div class="text-2xl tracking-tighter mt-4 text-pretty">
      最近怎么样？
    </div>
  </FaBlurReveal>
  <FaButton @click="handleReset">
    重新执行
  </FaButton>
</template>
