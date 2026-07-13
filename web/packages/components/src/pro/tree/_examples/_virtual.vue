<script setup lang="ts">
import type { TreeNode } from '../index.vue'
import { ref } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaTree from '../index.vue'

function buildData() {
  return Array.from({ length: 10 }, (_, level1Index) => ({
    id: `folder-${level1Index + 1}`,
    label: `一级节点 ${level1Index + 1}`,
    children: Array.from({ length: 20 }, (_, level2Index) => ({
      id: `folder-${level1Index + 1}-group-${level2Index + 1}`,
      label: `二级节点 ${level1Index + 1}-${level2Index + 1}`,
      children: Array.from({ length: 50 }, (_, level3Index) => ({
        id: `folder-${level1Index + 1}-group-${level2Index + 1}-item-${level3Index + 1}`,
        label: `三级节点 ${level1Index + 1}-${level2Index + 1}-${level3Index + 1}`,
      })),
    })),
  }))
}

const data = ref<TreeNode[]>(buildData())
</script>

<template>
  <FaTree :data="data" node-key="id" default-expand-all virtual-list />
</template>
