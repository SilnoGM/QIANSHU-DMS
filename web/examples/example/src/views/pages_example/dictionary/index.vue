<script setup lang="ts">
import type { TableColumn } from '@fantastic-admin/components'
import apiDictionary from '@/api/modules/dictionary'
import DictionaryDialog from './components/dictionaryDialog/index.vue'
import DictionaryItemDialog from './components/dictionaryItemDialog/index.vue'
import UsageDialog from './components/usageDialog/index.vue'

defineOptions({
  name: 'PagesExampleDictionary',
})

const faModal = useFaModal()

interface Dict {
  id: string | number
  label: string
  code: string
  children?: Dict[]
}

interface DictionaryItem {
  id: number
  name: string
  value: string
  enable: boolean
  enableLoading?: boolean
}

const dictionary = ref({
  search: '',
  tree: [] as Dict[],
  currentData: undefined as Dict | undefined,
  currentParentId: undefined as Dict['id'] | undefined,
  dialog: {
    visible: false,
    parentId: undefined as Dict['id'] | undefined,
    id: '' as Dict['id'],
  },
})

const { pagination, getParams, onSizeChange, onCurrentChange } = usePagination()
pagination.value.size = 20

const dictionaryItem = ref({
  loading: false,
  // 搜索
  search: {
    dictionaryId: '' as Dict['id'],
    title: '',
  },
  // 列表数据
  dataList: [] as DictionaryItem[],
  selectionDataList: [] as DictionaryItem[],
  dialog: {
    visible: false,
    id: '' as string | number,
  },
})

const dictionaryItemColumns: TableColumn<DictionaryItem>[] = [
  {
    type: 'selection',
    fixed: 'left',
    width: 48,
  },
  {
    accessorKey: 'name',
    header: '名称',
  },
  {
    accessorKey: 'value',
    header: '键值',
    align: 'center',
    width: 150,
  },
  {
    accessorKey: 'enable',
    header: '状态',
    align: 'center',
    width: 100,
  },
  {
    id: 'operation',
    header: '操作',
    align: 'center',
    fixed: 'right',
    width: 150,
  },
]

function getDictionaryList() {
  dictionaryItem.value.search.dictionaryId = ''
  apiDictionary.list().then((res) => {
    dictionary.value.tree = res.data
  })
}
onMounted(() => {
  getDictionaryList()
})
function dictionaryAdd(data?: Dict) {
  dictionary.value.currentData = data
  dictionary.value.dialog.parentId = data?.id
  dictionary.value.dialog.id = ''
  dictionary.value.dialog.visible = true
}
function dictionaryEdit(data: Dict) {
  dictionary.value.currentData = data
  dictionary.value.currentParentId = findParentId(dictionary.value.tree, data.id)
  dictionary.value.dialog.parentId = dictionary.value.currentParentId
  dictionary.value.dialog.id = data.id
  dictionary.value.dialog.visible = true
}
// 在树中查找节点的父级 id
function findParentId(list: Dict[], targetId: Dict['id'], parentId: Dict['id'] = ''): Dict['id'] | undefined {
  for (const item of list) {
    if (item.id === targetId) {
      return parentId || undefined
    }
    if (item.children) {
      const found = findParentId(item.children, targetId, item.id)
      if (found !== undefined) {
        return found
      }
    }
  }
  return undefined
}
// 从树中递归删除指定节点
function removeNodeFromTree(list: Dict[], targetId: Dict['id']): boolean {
  const index = list.findIndex(item => item.id === targetId)
  if (index !== -1) {
    list.splice(index, 1)
    return true
  }
  for (const item of list) {
    if (item.children && removeNodeFromTree(item.children, targetId)) {
      return true
    }
  }
  return false
}
function dictionaryDelete(data: Dict) {
  faModal.confirm({
    title: '确认信息',
    content: `确认删除「${data.label}」吗？`,
    onConfirm: () => {
      apiDictionary.delete(data.id).then(() => {
        useFaToast().success('模拟删除成功')
        removeNodeFromTree(dictionary.value.tree, data.id)
        dictionary.value.tree = [...dictionary.value.tree]
      })
    },
  })
}
// 新增成功后更新树
function dictionaryAddNode(data: Dict) {
  if (dictionary.value.currentData) {
    if (!dictionary.value.currentData.children) {
      dictionary.value.currentData.children = []
    }
    dictionary.value.currentData.children.push({
      id: data.id,
      label: data.label,
      code: data.code,
    })
  }
  else {
    dictionary.value.tree.push({
      id: data.id,
      label: data.label,
      code: data.code,
    })
  }
}
// 编辑成功后更新树
function dictionaryEditNode(data: Dict, parentId: string | number) {
  if (dictionary.value.currentData) {
    if (dictionary.value.currentParentId === parentId) {
      // parentId 一致，节点位置没有变化，直接更新
      dictionary.value.currentData.label = data.label
      dictionary.value.currentData.code = data.code
    }
    else {
      // 找到原节点并保存，然后删除
      const findNode = (list: Dict[], targetId: Dict['id']): Dict | null => {
        for (const item of list) {
          if (item.id === targetId) {
            return item
          }
          if (item.children) {
            const found = findNode(item.children, targetId)
            if (found) {
              return found
            }
          }
        }
        return null
      }
      const originalNode = findNode(dictionary.value.tree, data.id)
      if (originalNode) {
        originalNode.label = data.label
        originalNode.code = data.code
      }
      removeNodeFromTree(dictionary.value.tree, data.id)
      // 移动到新父节点
      if (parentId) {
        const findDictionary = (list: Dict[], targetId: Dict['id']): Dict | null => {
          for (const item of list) {
            if (item.id === targetId) {
              return item
            }
            if (item.children) {
              const found = findDictionary(item.children, targetId)
              if (found) {
                return found
              }
            }
          }
          return null
        }
        const targetNode = findDictionary(dictionary.value.tree, parentId)
        if (targetNode) {
          if (!targetNode.children) {
            targetNode.children = []
          }
          targetNode.children.push(originalNode ?? { id: data.id, label: data.label, code: data.code })
        }
      }
      else {
        dictionary.value.tree.push(originalNode ?? { id: data.id, label: data.label, code: data.code })
      }
      dictionary.value.tree = [...dictionary.value.tree]
    }
  }
}
function dictionaryClick(data: Dict) {
  pagination.value.page = 1
  dictionaryItem.value.search.dictionaryId = data.id
}

watch(() => dictionaryItem.value.search.dictionaryId, () => {
  getDictionaryItemList()
})

function getDictionaryItemList() {
  dictionaryItem.value.loading = true
  const params = {
    ...getParams(),
    dictionary_id: dictionaryItem.value.search.dictionaryId,
    ...(dictionaryItem.value.search.title && { title: dictionaryItem.value.search.title }),
  }
  apiDictionary.itemList(params).then((res: any) => {
    dictionaryItem.value.loading = false
    dictionaryItem.value.dataList = res.data.list
    dictionaryItem.value.dataList.forEach((item: any) => {
      item.enableLoading = false
    })
    pagination.value.total = res.data.total
  })
}

function onChangeEnable(row: DictionaryItem) {
  return new Promise<boolean>((resolve) => {
    faModal.confirm({
      title: '确认信息',
      content: `确认${!row.enable ? '启用' : '禁用'}「${row.name}」吗？`,
      onConfirm: () => {
        row.enableLoading = true
        apiDictionary.itemChangeEnable({
          id: row.id,
          enable: !row.enable,
        }).then(() => {
          row.enableLoading = false
          useFaToast().success(`模拟${!row.enable ? '启用' : '禁用'}成功`)
          return resolve(true)
        }).catch(() => {
          row.enableLoading = false
          return resolve(false)
        })
      },
      onCancel: () => {
        return resolve(false)
      },
    })
  })
}

// 每页数量切换
function sizeChange(size: number) {
  onSizeChange(size).then(() => getDictionaryItemList())
}

// 当前页码切换（翻页）
function currentChange(page = 1) {
  onCurrentChange(page).then(() => getDictionaryItemList())
}

function onCreate() {
  dictionaryItem.value.dialog.id = ''
  dictionaryItem.value.dialog.visible = true
}

function onEdit(row: DictionaryItem) {
  dictionaryItem.value.dialog.id = row.id
  dictionaryItem.value.dialog.visible = true
}

function onDelete(row: DictionaryItem) {
  faModal.confirm({
    title: '确认信息',
    content: `确认删除「${row.name}」吗？`,
    onConfirm: () => {
      apiDictionary.itemDelete(row.id).then(() => {
        getDictionaryItemList()
        useFaToast().success('模拟删除成功')
      })
    },
  })
}

function onDeleteMulti(rows: DictionaryItem[]) {
  if (!rows.length) {
    return
  }

  faModal.confirm({
    title: '确认信息',
    content: `确认删除选中的 ${rows.length} 条数据吗？`,
    onConfirm: () => {
      apiDictionary.itemDelete(rows.map(item => item.id)).then(() => {
        getDictionaryItemList()
        useFaToast().success('模拟删除成功')
      })
    },
  })
}

// 使用示例
const usageExampleVisible = ref(false)
</script>

<template>
  <div class="flex flex-col size-full absolute">
    <FaPageHeader title="字典管理" description="页面数据为示例数据，非真实数据。" class="mb-0">
      <FaButton variant="outline" @click="usageExampleVisible = true">
        使用示例
      </FaButton>
    </FaPageHeader>
    <div class="flex-1 overflow-auto">
      <FaLayoutContainer hide-left-side-toggle class="p-4 h-full" left-side-class="h-full flex flex-col gap-4" default-class="flex flex-col flex-1">
        <template #leftSide>
          <FaButton class="w-full" @click="dictionaryAdd()">
            新增字典
          </FaButton>
          <FaScrollArea :scrollbar="false" mask>
            <FaTree :data="dictionary.tree" node-key="id" default-expand-all @selection-change="(node) => node && dictionaryClick(node as Dict)">
              <template #default="{ node }">
                <div class="group flex-center-between">
                  <div class="flex flex-1 flex-col min-w-0 group-hover:pe-16">
                    <div class="text-sm truncate" :title="(node as Dict).label">
                      {{ (node as Dict).label }}
                    </div>
                    <div class="text-xs text-muted-foreground truncate">
                      {{ (node as Dict).code }}
                    </div>
                  </div>
                  <FaButtonGroup class="end-2 absolute">
                    <FaButton variant="outline" size="icon" class="opacity-0 size-6 transition-opacity group-hover:opacity-100" @click.stop="dictionaryAdd(node as Dict)">
                      <FaIcon name="i-ep:plus" />
                    </FaButton>
                    <FaButton variant="outline" size="icon" class="opacity-0 size-6 transition-opacity group-hover:opacity-100" @click.stop="dictionaryEdit(node as Dict)">
                      <FaIcon name="i-ep:edit" />
                    </FaButton>
                    <FaButton variant="outline" size="icon" class="opacity-0 size-6 transition-opacity group-hover:opacity-100" @click.stop="dictionaryDelete(node as Dict)">
                      <FaIcon name="i-ep:delete" />
                    </FaButton>
                  </FaButtonGroup>
                </div>
              </template>
            </FaTree>
          </FaScrollArea>
        </template>
        <div v-if="dictionaryItem.search.dictionaryId" class="contents">
          <FaTable
            v-loading="dictionaryItem.loading"
            class="flex-1 min-h-0"
            table-root-class="rounded-lg overflow-hidden h-full"
            row-key="id"
            selectable
            multiple
            stripe
            column-visibility
            border
            :columns="dictionaryItemColumns"
            :data="dictionaryItem.dataList"
            @selection-change="dictionaryItem.selectionDataList = $event"
          >
            <template #toolbar>
              <div class="flex flex-1 flex-wrap gap-2 items-center">
                <FaButton @click="onCreate">
                  新增
                </FaButton>
                <FaDropdown
                  :items="[
                    [
                      { label: '批量删除', variant: 'destructive', disabled: !dictionaryItem.selectionDataList.length, handle: () => onDeleteMulti(dictionaryItem.selectionDataList) },
                    ],
                  ]"
                >
                  <FaButton variant="outline" :disabled="!dictionaryItem.selectionDataList.length">
                    批量操作
                    <FaIcon name="i-ep:arrow-down" />
                  </FaButton>
                </FaDropdown>
                <FaInput v-model="dictionaryItem.search.title" placeholder="请输入关键词筛选字典项" class="w-50" />
                <FaButton variant="outline" @click="getDictionaryItemList">
                  <FaIcon name="i-ri:search-line" />
                </FaButton>
              </div>
            </template>
            <template #cell-value="{ value }">
              <span class="text-xs text-secondary-foreground font-medium px-2 py-1 rounded-md bg-secondary inline-flex items-center">
                {{ value }}
              </span>
            </template>

            <template #cell-enable="{ row }">
              <FaSwitch v-model="row.original.enable" :before-change="() => onChangeEnable(row.original)" />
            </template>

            <template #cell-operation="{ row }">
              <div class="flex-center gap-2">
                <FaButton variant="outline" size="icon-sm" @click="onEdit(row.original)">
                  <FaIcon name="i-ep:edit" />
                </FaButton>
                <FaButton variant="destructive" size="icon-sm" @click="onDelete(row.original)">
                  <FaIcon name="i-ep:delete" />
                </FaButton>
              </div>
            </template>
          </FaTable>
          <FaPagination v-model:page="pagination.page" v-model:size="pagination.size" :total="pagination.total" class="mt-2" @page-change="currentChange" @size-change="sizeChange" />
        </div>
        <div v-else class="text-3xl text-primary/50 flex-center flex-1">
          请在左侧新增或选择一个字典
        </div>
      </FaLayoutContainer>
      <DictionaryDialog v-if="dictionary.dialog.visible" :id="dictionary.dialog.id" v-model="dictionary.dialog.visible" :parent-id="dictionary.dialog.parentId" :tree="dictionary.tree" @add-node="dictionaryAddNode" @edit-node="dictionaryEditNode" />
      <DictionaryItemDialog v-if="dictionaryItem.dialog.visible" :id="dictionaryItem.dialog.id" v-model="dictionaryItem.dialog.visible" :dictionary-id="dictionaryItem.search.dictionaryId" :tree="dictionary.tree" @success="getDictionaryItemList" />
      <UsageDialog v-if="usageExampleVisible" v-model="usageExampleVisible" />
    </div>
  </div>
</template>
