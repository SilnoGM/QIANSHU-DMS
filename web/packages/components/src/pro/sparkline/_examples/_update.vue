<script setup lang="ts">
import { ref } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaSparkline from '../index.vue'

const value = ref([12, 16, 19, 23, 26, 29, 33])

function randomizeValue() {
  value.value = value.value.map(item => Math.max(4, item + Math.floor(Math.random() * 9) - 4))
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <FaSparkline :value="value" />
    <FaButton class="self-start" variant="outline" size="sm" @click="randomizeValue">
      随机刷新
    </FaButton>
  </div>
</template>
