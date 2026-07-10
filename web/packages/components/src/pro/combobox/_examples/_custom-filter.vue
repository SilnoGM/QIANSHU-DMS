<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { ComboboxOption } from '../index.vue'
import { shallowRef } from 'vue'
import FaCombobox from '../index.vue'

const value = shallowRef('')

const options: ComboboxOption[] = [
  { label: '北京朝阳', value: 'beijing' },
  { label: '上海浦东', value: 'shanghai' },
  { label: '广州天河', value: 'guangzhou' },
  { label: '深圳南山', value: 'shenzhen' },
]

function filter(searchValue: string, option: ComboboxOption) {
  const keywords = searchValue
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  return keywords.every(keyword => option.label.toLocaleLowerCase().includes(keyword))
}
</script>

<template>
  <FaCombobox
    v-model="value"
    :options="options"
    :filter="filter"
    placeholder="支持多关键词搜索，用空格隔开"
    empty-text="没有匹配结果"
    class="w-100"
  />
</template>
