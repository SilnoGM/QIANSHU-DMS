<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { Format } from '@number-flow/vue'
import { onScopeDispose, shallowRef } from 'vue'
import FaAnimatedCountTo from '../index.vue'

const index = shallowRef(0)
const value = shallowRef(0)

const LOCALES = ['en-US', 'en-US', 'fr-FR', 'en-US', 'en-US', 'zh-CN', 'en-US', 'en-US', 'fr-FR']
const FORMATS: Format[] = [
  {},
  {
    minimumFractionDigits: 2,
  },
  {
    style: 'currency',
    currency: 'USD',
    currencySign: 'accounting',
    signDisplay: 'always',
  },
  {
    style: 'percent',
    signDisplay: 'always',
  },
  {
    style: 'unit',
    unit: 'meter',
    notation: 'compact',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'never',
  },
  {
    style: 'currency',
    currency: 'CNY',
  },
  {
    signDisplay: 'always',
  },
]

const timer = setInterval(() => {
  value.value += Math.floor(Math.random() * 1000) * (Math.random() > 0.5 ? 1 : -1)
  index.value += 1
}, 2000)

onScopeDispose(() => {
  clearInterval(timer)
})
</script>

<template>
  <FaAnimatedCountTo
    :value
    :format="FORMATS[index % FORMATS.length]"
    :locales="LOCALES[index % LOCALES.length]"
    will-change
    class="text-4xl font-bold"
  />
</template>
