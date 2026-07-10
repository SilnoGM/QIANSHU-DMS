<script setup lang="ts">
// 组件实际使用时无需手动导入，框架会自动导入
import type { CascaderOption } from '../index.vue'
import { shallowRef } from 'vue'
import FaCascader from '../index.vue'
import rawData from './pcas-code.json'

interface AreaNode {
  code: string
  name: string
  children?: AreaNode[]
}

const value = shallowRef<string | number>()

function transform(nodes: AreaNode[]): CascaderOption[] {
  return nodes.map(node => ({
    label: node.name,
    value: node.code,
    ...(node.children?.length ? { children: transform(node.children) } : {}),
  }))
}

const options = transform(rawData as AreaNode[])
</script>

<template>
  <FaCascader
    v-model="value"
    :options
    placeholder="请选择地区"
    disabled
  />
</template>
