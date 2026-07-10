<script setup lang="ts">
import type { TreeNode } from '../index.vue'
import { ref } from 'vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaIcon from '../../../basic/icon/index.vue'
import FaTree from '../index.vue'

const data = ref<TreeNode[]>([
  {
    id: '1',
    label: '根目录',
    icon: 'i-lucide:folder',
    expandedIcon: 'i-lucide:folder-open',
    children: [
      {
        id: '1-1',
        label: '文件夹1',
        icon: 'i-lucide:folder',
        expandedIcon: 'i-lucide:folder-open',
        children: [
          { id: '1-1-1', label: '文件1.txt', icon: 'i-lucide:file' },
          { id: '1-1-2', label: '文件2.txt', icon: 'i-lucide:file' },
          { id: '1-1-3', label: '文件3.txt', icon: 'i-lucide:file' },
        ],
      },
      {
        id: '1-2',
        label: '文件夹2',
        icon: 'i-lucide:folder',
        expandedIcon: 'i-lucide:folder-open',
        children: [
          { id: '1-2-1', label: '文件3.txt', icon: 'i-lucide:file' },
        ],
      },
    ],
  },
])
</script>

<template>
  <FaTree :data>
    <template #default="{ node, expanded }">
      <div class="group flex-center-between">
        <div class="flex gap-2 items-center">
          <FaIcon :name="expanded ? node.expandedIcon : node.icon" />
          <div class="text-sm">
            {{ node.label }}
          </div>
        </div>
        <FaButton variant="outline" size="icon" class="opacity-0 size-6 transition-opacity group-hover:opacity-100" @click.stop>
          <FaIcon name="i-ep:edit" />
        </FaButton>
      </div>
    </template>
  </FaTree>
</template>
