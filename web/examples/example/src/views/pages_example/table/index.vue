<script setup lang="ts">
import type { TableColumn, TableSortingState } from '@fantastic-admin/components'
import apiTable from '@/api/modules/table'
import TableForm from './components/tableForm/index.vue'
import TablePreviewDialog from './components/tablePreviewDialog/index.vue'

defineOptions({
  name: 'PagesExampleTable',
})

interface TableItem {
  id: number | string
  name: string
  code: string
}

const { pagination, getParams, onSizeChange, onCurrentChange, onSortChange } = usePagination()
pagination.value.size = 20

const data = ref({
  loading: false,
  search: {
    name: '',
  },
  dataList: [] as TableItem[],
  selectionDataList: [] as TableItem[],
  form: {
    visible: false,
    id: '' as string | number,
  },
  dialog: {
    visible: false,
    id: '' as string | number,
    info: {} as any,
  },
})

const tableColumns: TableColumn<TableItem>[] = [
  {
    type: 'selection',
    fixed: 'left',
    width: 48,
  },
  {
    accessorKey: 'name',
    header: '名称',
    enableSorting: true,
  },
  {
    accessorKey: 'code',
    header: '标识',
    width: 150,
    align: 'center',
  },
  {
    id: 'operation',
    header: '操作',
    width: 120,
    align: 'center',
    fixed: 'right',
  },
]

onMounted(() => {
  getDataList()
})

function getDataList() {
  data.value.loading = true
  const params = {
    ...getParams(),
    ...(data.value.search.name && { name: data.value.search.name }),
  }
  apiTable.list(params).then((res: any) => {
    data.value.loading = false
    data.value.dataList = res.data.list
    pagination.value.total = res.data.total
  })
}

// 每页数量切换
function sizeChange(size: number) {
  onSizeChange(size).then(() => getDataList())
}
// 当前页码切换（翻页）
function currentChange(page = 1) {
  onCurrentChange(page).then(() => getDataList())
}
// 字段排序
function sortingChange(sorting: TableSortingState) {
  if (sorting.length) {
    const { id, desc } = sorting[0]
    onSortChange(id, desc ? 'descending' : 'ascending').then(() => getDataList())
  }
  else {
    onSortChange('', '').then(() => getDataList())
  }
}

function onCreate() {
  data.value.form.visible = false
  nextTick(() => {
    data.value.form.visible = true
    data.value.form.id = ''
  })
}
function onEdit(row: any) {
  data.value.form.visible = false
  nextTick(() => {
    data.value.form.visible = true
    data.value.form.id = row.id
  })
}
function onDelete(row: TableItem) {
  useFaModal().confirm({
    title: '确认信息',
    content: `确认删除「${row.name}」表格吗？`,
    onConfirm: () => {
      apiTable.delete(row.id).then(() => {
        getDataList()
        useFaToast().success('模拟删除成功')
      })
    },
  })
}
function onDeleteMulti() {
  const rows = data.value.selectionDataList
  if (!rows.length) {
    return
  }

  useFaModal().confirm({
    title: '确认信息',
    content: `确认删除选中的 ${rows.length} 条数据吗？`,
    onConfirm: () => {
      Promise.all(rows.map(row => apiTable.delete(row.id))).then(() => {
        getDataList()
        useFaToast().success('模拟批量删除成功')
      })
    },
  })
}
function onPreview(row: any) {
  data.value.dialog.visible = true
  data.value.dialog.id = row.id
  data.value.dialog.info = {}
}
function onPreviewTemporary(info: any) {
  data.value.dialog.visible = true
  data.value.dialog.id = ''
  data.value.dialog.info = info
}

function onTableFormSuccess() {
  data.value.form.visible = false
  getDataList()
}
function onTableFormCancel() {
  data.value.form.visible = false
}
</script>

<template>
  <div class="flex flex-col size-full absolute">
    <FaPageHeader title="表格管理" description="页面数据为示例数据，非真实数据。" class="mb-0" />
    <div class="flex-1 overflow-auto">
      <FaLayoutContainer left-side-width="520px" hide-left-side-toggle class="p-4 h-full" left-side-class="h-full flex flex-col" default-class="flex flex-col flex-1 gap-4">
        <template #leftSide>
          <FaTable
            v-loading="data.loading"
            class="flex-1 min-h-0"
            table-root-class="rounded-lg overflow-hidden h-full"
            row-key="id"
            selectable
            multiple
            stripe
            sortable
            column-visibility
            border
            :columns="tableColumns"
            :data="data.dataList"
            @sorting-change="sortingChange"
            @selection-change="data.selectionDataList = $event"
          >
            <template #toolbar>
              <div class="flex flex-1 gap-2 items-center">
                <FaButton @click="onCreate">
                  新增
                </FaButton>
                <FaDropdown
                  :items="[
                    [
                      { label: '批量删除', variant: 'destructive', disabled: !data.selectionDataList.length, handle: onDeleteMulti },
                    ],
                  ]"
                >
                  <FaButton variant="outline" :disabled="!data.selectionDataList.length">
                    批量操作
                    <FaIcon name="i-ep:arrow-down" />
                  </FaButton>
                </FaDropdown>
              </div>
            </template>
            <template #cell-operation="{ row }">
              <div class="flex-center gap-2">
                <FaButtonGroup>
                  <FaButton variant="outline" size="icon-sm" @click="onEdit(row.original)">
                    <FaIcon name="i-ep:edit" />
                  </FaButton>
                  <FaButton variant="outline" size="icon-sm" @click="onPreview(row.original)">
                    <FaIcon name="i-ep:view" />
                  </FaButton>
                  <FaButton variant="destructive" size="icon-sm" @click="onDelete(row.original)">
                    <FaIcon name="i-ep:delete" />
                  </FaButton>
                </FaButtonGroup>
              </div>
            </template>
          </FaTable>
          <FaPagination :page="pagination.page" :size="pagination.size" :total="pagination.total" layout="total, ->, pager" class="mt-2" @page-change="currentChange" @size-change="sizeChange" />
        </template>
        <TableForm v-if="data.form.visible" :id="data.form.id" @success="onTableFormSuccess" @cancel="onTableFormCancel" @preview="onPreviewTemporary" />
        <div v-else class="text-3xl text-primary/50 flex-center flex-1">
          请在左侧新增或编辑一个表格
        </div>
      </FaLayoutContainer>
      <TablePreviewDialog v-if="data.dialog.visible" :id="data.dialog.id" v-model="data.dialog.visible" :info="data.dialog.info" />
    </div>
  </div>
</template>
