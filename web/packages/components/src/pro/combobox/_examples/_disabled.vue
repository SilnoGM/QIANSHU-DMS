<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { ComboboxOption } from '../index.vue'
import { shallowRef } from 'vue'
import FaCombobox from '../index.vue'

const value = shallowRef('shanghai')

const options: ComboboxOption[] = [
  { label: '北京', value: 'beijing' },
  { label: '上海', value: 'shanghai' },
  { label: '广州', value: 'guangzhou' },
  { label: '深圳', value: 'shenzhen' },
]
</script>

<template>
  <FaCombobox
    v-model="value"
    disabled
    :options="options"
    placeholder="请选择城市"
  />
</template>
