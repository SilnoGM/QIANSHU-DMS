<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { ComboboxOption } from '../index.vue'
import { shallowRef } from 'vue'
import FaCombobox from '../index.vue'

const value = shallowRef('city-0100')

const options: ComboboxOption[] = Array.from({ length: 10000 }, (_, index) => ({
  label: `城市 ${String(index + 1).padStart(5, '0')}`,
  value: `city-${String(index + 1).padStart(4, '0')}`,
}))
</script>

<template>
  <FaCombobox
    v-model="value"
    virtual-list
    :options="options"
    placeholder="请选择城市"
  />
</template>
