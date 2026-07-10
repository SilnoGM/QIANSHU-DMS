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
        children: [
          { id: '1-1-1', label: '文件1.txt' },
          { id: '1-1-2', label: '文件2.txt' },
          { id: '1-1-3', label: '文件3.txt' },
        ],
      },
      {
        id: '1-2',
        label: '文件夹2',
        children: [
          { id: '1-2-1', label: '文件3.txt' },
        ],
      },
    ],
  },
])

const checkedNodes = ref<TreeNode[]>([])

function handleCheckChange(nodes: TreeNode[]) {
  checkedNodes.value = nodes
}
</script>

<template>
  <FaTree :data checkable @check-change="handleCheckChange" />
  <div class="text-sm text-gray-500 mt-4">
    <div>
      当前选中节点：
    </div>
    <div v-for="node in checkedNodes" :key="node.id">
      {{ node.label }}
    </div>
  </div>
</template>
