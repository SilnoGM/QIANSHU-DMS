<script setup lang="ts">
import type { TreeNode } from '../index.vue'
import { ref } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaTree from '../index.vue'

const data = ref<TreeNode[]>([
  {
    id: '1',
    label: '根目录',
    children: [
      {
        id: '1-1',
        label: '文件夹1',
        type: 'folder',
        children: [
          { id: '1-1-1', label: '文件1.txt', type: 'file' },
          { id: '1-1-2', label: '文件2.txt', type: 'file' },
          { id: '1-1-3', label: '文件3.txt', type: 'file' },
        ],
      },
      {
        id: '1-2',
        label: '文件夹2',
        type: 'folder',
        children: [
          { id: '1-2-1', label: '文件3.txt', type: 'file' },
        ],
      },
    ],
  },
])

function customFilter(query: string, node: TreeNode) {
  // 按类型过滤
  if (query === 'file' && node.type === 'file') {
    return true
  }
  if (query === 'folder' && node.type === 'folder') {
    return true
  }
  // 按名称过滤
  return node.label.toLowerCase().includes(query.toLowerCase())
}
</script>

<template>
  <FaTree :data filterable filter-placeholder="搜索...(输入 folder 或 file 可过滤节点类型)" :filter-method="customFilter" />
</template>
