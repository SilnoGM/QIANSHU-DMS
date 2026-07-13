<script setup lang="ts">
import type { TreeNode } from '../index.vue'
import { ref, useTemplateRef } from 'vue'
import FaButtonGroup from '../../../basic/button/ButtonGroup.vue'
// 组件实际使用时无需手动导入，框架会自动导入
import FaButton from '../../../basic/button/index.vue'
import FaSwitch from '../../../basic/switch/index.vue'
import FaTree from '../index.vue'

const checkable = ref(false)

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

const treeRef = useTemplateRef('treeRef')

function handleExpand(ids?: string[]) {
  treeRef.value?.expand(ids)
}

function handleCollapse(ids?: string[]) {
  treeRef.value?.collapse(ids)
}

function handleSetSelection(id: string) {
  treeRef.value?.setSelection(id)
}

function handleClearSelection() {
  treeRef.value?.clearSelection()
}

function handleCheckAll(bool: boolean) {
  treeRef.value?.checkAll(bool)
}
</script>

<template>
  <div class="mb-4 flex gap-2 items-center">
    开启复选框
    <FaSwitch v-model="checkable" />
  </div>
  <div class="mb-4 flex gap-2">
    <FaButton variant="outline" @click="handleExpand()">
      展开所有
    </FaButton>
    <FaButton variant="outline" @click="handleExpand(['1'])">
      展开根目录
    </FaButton>
    <FaButton variant="outline" @click="handleCollapse()">
      收起所有
    </FaButton>
    <FaButton variant="outline" @click="handleCollapse(['1'])">
      收起根目录
    </FaButton>
    <FaButtonGroup>
      <FaButton variant="outline" :disabled="checkable" @click="handleSetSelection('1-1-1')">
        选中 1-1-1
      </FaButton>
      <FaButton variant="outline" :disabled="checkable" @click="handleClearSelection">
        取消选中
      </FaButton>
    </FaButtonGroup>
    <FaButtonGroup>
      <FaButton variant="outline" :disabled="!checkable" @click="handleCheckAll(true)">
        全选
      </FaButton>
      <FaButton variant="outline" :disabled="!checkable" @click="handleCheckAll(false)">
        取消全选
      </FaButton>
    </FaButtonGroup>
  </div>
  <FaTree ref="treeRef" :data node-key="id" :checkable />
</template>
