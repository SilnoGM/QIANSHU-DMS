<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { ComboboxGroupOption } from '../index.vue'
import { shallowRef } from 'vue'
import FaCombobox from '../index.vue'

const value = shallowRef('beijing')

const options: ComboboxGroupOption[] = [
  {
    label: '热门城市',
    options: [
      { label: '北京', value: 'beijing' },
      { label: '上海', value: 'shanghai' },
    ],
  },
  {
    label: '其他城市',
    options: [
      { label: '广州', value: 'guangzhou' },
      { label: '深圳', value: 'shenzhen' },
      { label: '杭州', value: 'hangzhou' },
    ],
  },
]
</script>

<template>
  <FaCombobox
    v-model="value"
    :options="options"
    placeholder="分组选择"
  />
</template>
