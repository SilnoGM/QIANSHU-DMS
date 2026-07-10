<script setup lang="ts">
import type { TreeNode } from '@fantastic-admin/components'
import apiMenu from '@/api/modules/menu'
import DetailForm from './components/DetailForm/index.vue'

const menu = ref([])
const treeRef = ref()
const form = ref({
  visible: false,
  id: '',
  parentId: '',
})

function getMenuList() {
  apiMenu.list().then((res) => {
    menu.value = res.data
    nextTick(() => {
      treeRef.value?.expand()
    })
  })
}
onMounted(() => {
  getMenuList()
})

function menuAdd(node: TreeNode) {
  form.value = {
    visible: false,
    id: '',
    parentId: '',
  }
  nextTick(() => {
    form.value = {
      visible: true,
      id: '',
      parentId: node.id,
    }
  })
}
function menuEdit(node?: TreeNode) {
  form.value = {
    visible: false,
    id: '',
    parentId: '',
  }
  nextTick(() => {
    form.value = {
      visible: true,
      id: node?.id ?? '',
      parentId: node?.parentId ?? '',
    }
  })
}
function menuDelete(node: TreeNode) {
  useFaModal().confirm({
    title: '确认信息',
    content: `确认删除「${node.data.meta.title}」吗？`,
    onConfirm: () => {
      apiMenu.delete(node.data.id).then(() => {
        useFaToast().success('模拟删除成功')
        const parent = node.parent
        const children = parent?.data.children || parent?.data
        const index = children.findIndex((d: any) => d.id === node.data.id)
        children.splice(index, 1)
        menu.value = [...menu.value]
      })
    },
  })
}
function menuSubmit() {
  form.value = {
    visible: false,
    id: '',
    parentId: '',
  }
  getMenuList()
}
</script>

<template>
  <div class="flex flex-col size-full absolute">
    <FaPageHeader title="导航管理" description="页面数据为示例数据，非真实数据。" class="mb-0" />
    <div class="flex-1 overflow-auto">
      <FaLayoutContainer hide-left-side-toggle class="p-4 h-full" left-side-class="h-full flex flex-col gap-4" default-class="flex-col-center p-0 size-full">
        <template #leftSide>
          <FaButton class="w-full" @click="menuEdit()">
            新增主导航
          </FaButton>
          <FaScrollArea :scrollbar="false" mask>
            <FaTree ref="treeRef" :data="menu" @selection-change="(node) => node && menuEdit(node)">
              <template #default="{ node }">
                <div class="group flex-center-between">
                  <div class="flex gap-2 truncate items-center group-hover:pe-12">
                    <FaIcon v-if="node.meta.icon[0]" :name="node.meta.icon[0]" class="size-4" />
                    <div class="text-sm flex-1 truncate">
                      {{ node.meta.title }}
                    </div>
                  </div>
                  <FaButtonGroup class="end-2 absolute">
                    <FaButton variant="outline" size="icon" class="opacity-0 size-6 transition-opacity group-hover:opacity-100" @click.stop="menuAdd(node)">
                      <FaIcon name="i-ep:plus" />
                    </FaButton>
                    <FaButton variant="outline" size="icon" class="opacity-0 size-6 transition-opacity group-hover:opacity-100" @click.stop="menuDelete(node)">
                      <FaIcon name="i-ep:delete" />
                    </FaButton>
                  </FaButtonGroup>
                </div>
              </template>
            </FaTree>
          </FaScrollArea>
        </template>
        <DetailForm v-if="form.visible" :id="form.id" :parent-id="form.parentId" @on-submit="menuSubmit" />
        <div v-else class="text-3xl text-foreground/50 flex-center flex-1">
          新增或编辑一个导航
        </div>
      </FaLayoutContainer>
    </div>
  </div>
</template>
