<script setup lang="ts">
import type { TableColumn, TableSortingState } from '@fantastic-admin/components'
import apiTable from '@/api/modules/table'

const props = withDefaults(
  defineProps<{
    id?: string | number
    info?: any
  }>(),
  {
    id: '',
    info: {},
  },
)

const visible = defineModel<boolean>({
  default: false,
})

const { pagination, getParams, onSizeChange, onCurrentChange, onSortChange } = usePagination()

const data = ref({
  loading: false,
  dataList: [] as any[],
  border: false,
  stripe: false,
  header: true,
  columns: [] as {
    name: string
    field: string
    width: string
    align: string
    sortable: boolean
    fixed: string
    enable: boolean
  }[],
})

const tableColumns = computed<TableColumn[]>(() => {
  return data.value.columns.map(item => ({
    accessorKey: item.field,
    header: item.name,
    align: item.align as 'left' | 'center' | 'right',
    width: item.width ? Number(item.width) : undefined,
    enableSorting: item.sortable,
    fixed: item.fixed === 'left' ? 'left' : item.fixed === 'right' ? 'right' : undefined,
  }))
})

onMounted(() => {
  getDataList()
})

function getDataList() {
  data.value.loading = true
  const params = {
    ...getParams(),
    ...(props.id && { id: props.id }),
    ...(props.info.code && { code: props.info.code }),
  }
  apiTable.preview(params).then((res: any) => {
    data.value.loading = false
    data.value.dataList = res.data.list
    pagination.value.total = res.data.total
    if (props.id) {
      data.value.border = res.data.tableInfo.border
      data.value.stripe = res.data.tableInfo.stripe
      data.value.header = res.data.tableInfo.header
      data.value.columns = res.data.tableInfo.columns.filter((item: any) => item.enable)
    }
    else {
      data.value.border = props.info.border
      data.value.stripe = props.info.stripe
      data.value.header = props.info.header
      data.value.columns = props.info.columns.filter((item: any) => item.enable)
    }
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
</script>

<template>
  <FaModal v-model="visible" title="预览" class="sm:max-w-[80vw]" :footer="false" :close-on-click-modal="false" append-to-body destroy-on-close @closed="visible = false">
    <FaTable
      v-loading="data.loading"
      :border="data.border"
      :stripe="data.stripe"
      :show-header="data.header"
      sortable
      :columns="tableColumns"
      :data="data.dataList"
      @sorting-change="sortingChange"
    />
    <FaPagination :page="pagination.page" :size="pagination.size" :total="pagination.total" layout="total, pager" class="mt-4" @page-change="currentChange" @size-change="sizeChange" />
  </FaModal>
</template>
