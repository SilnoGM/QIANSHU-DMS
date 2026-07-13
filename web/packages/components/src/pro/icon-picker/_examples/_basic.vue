<script setup lang="ts">
import { shallowRef } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaIconPicker from '../index.vue'
import { icons } from './icons'

const icon1 = shallowRef('')
const icon2 = shallowRef('ep:success-filled')
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <FaIconPicker v-model="icon1" :icons />
    <FaIconPicker v-model="icon2" :icons />
  </div>
</template>
