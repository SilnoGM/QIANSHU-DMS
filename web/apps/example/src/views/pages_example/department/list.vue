<script setup lang="ts">
import type { TableColumn } from '@fantastic-admin/components'
import apiDepartment from '@/api/modules/department'
import eventBus from '@/utils/eventBus'
import DetailForm from './components/DetailForm/index.vue'

defineOptions({
  name: 'PagesExampleDepartmentList',
})

interface Department {
  id: number
  title: string
}

const router = useRouter()
const { pagination, getParams, onSizeChange, onCurrentChange } = usePagination()

// 表格是否自适应高度
const tableAutoHeight = ref(false)

/**
 * 详情展示模式
 * router 路由跳转
 * modal 模态框
 * drawer 抽屉
 */
const formMode = ref<'router' | 'modal' | 'drawer'>('router')

// 详情
const formModeProps = ref({
  id: '' as number | string,
})

// 搜索
const searchDefault = {
  title: '',
}
const search = ref({ ...searchDefault })
function searchReset() {
  Object.assign(search.value, searchDefault)
}

// 批量操作
const batch = ref({
  enable: true,
  selectionDataList: [] as Department[],
})

// 列表
const loading = ref(false)
const dataList = ref<Department[]>([])

const tableColumns = computed<TableColumn<Department>[]>(() => [
  ...(batch.value.enable
    ? [{
      type: 'selection',
      fixed: 'left',
      width: 48,
    } satisfies TableColumn<Department>]
    : []),
  {
    accessorKey: 'title',
    header: '部门',
  },
  {
    id: 'operation',
    header: '操作',
    width: 200,
    align: 'center',
    fixed: 'right',
  },
])

onMounted(() => {
  getDataList()
  if (formMode.value === 'router') {
    eventBus.on('get-data-list', () => {
      getDataList()
    })
  }
})

onBeforeUnmount(() => {
  if (formMode.value === 'router') {
    eventBus.off('get-data-list')
  }
})

function getDataList() {
  loading.value = true
  const params = {
    ...getParams(),
    ...(search.value.title && { title: search.value.title }),
  }
  apiDepartment.list(params).then((res: any) => {
    loading.value = false
    dataList.value = res.data.list
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

const formRef = ref<InstanceType<typeof DetailForm>>()

const { open: openModal, update: updateModal } = useFaModal().create({
  destroyOnClose: true,
  closeOnClickOverlay: false,
  closeOnPressEscape: false,
  beforeClose: (action, done) => {
    if (action === 'confirm') {
      // 调用 DetailForm 组件内部 submit 方法
      formRef.value?.submit().then((success) => {
        if (!success) {
          return
        }

        getDataList()
        done()
      })
    }
    else {
      done()
    }
  },
  content: () => h(DetailForm, {
    ref: formRef,
    id: formModeProps.value.id,
  }),
})

const { open: openDrawer, update: updateDrawer } = useFaDrawer().create({
  destroyOnClose: true,
  closeOnClickOverlay: false,
  closeOnPressEscape: false,
  beforeClose: (action, done) => {
    if (action === 'confirm') {
      // 调用 DetailForm 组件内部 submit 方法
      formRef.value?.submit().then((success) => {
        if (!success) {
          return
        }

        getDataList()
        done()
      })
    }
    else {
      done()
    }
  },
  content: () => h(DetailForm, {
    ref: formRef,
    id: formModeProps.value.id,
  }),
})

function onCreate() {
  if (formMode.value === 'router') {
    router.push({
      name: 'pagesExampleGeneralDepartmentCreate',
    })
  }
  else {
    formModeProps.value.id = ''
    if (formMode.value === 'modal') {
      updateModal({
        title: '新增',
      })
      openModal()
    }
    else {
      updateDrawer({
        title: '新增',
      })
      openDrawer()
    }
  }
}

function onEdit(row: Department) {
  if (formMode.value === 'router') {
    router.push({
      name: 'pagesExampleGeneralDepartmentEdit',
      params: {
        id: row.id,
      },
    })
  }
  else {
    formModeProps.value.id = row.id
    if (formMode.value === 'modal') {
      updateModal({
        title: '编辑',
      })
      openModal()
    }
    else {
      updateDrawer({
        title: '编辑',
      })
      openDrawer()
    }
  }
}

function onDel(row: Department) {
  useFaModal().confirm({
    title: '确认信息',
    content: `确认删除「${row.title}」吗？`,
    onConfirm: () => {
      apiDepartment.delete(row.id).then(() => {
        getDataList()
        useFaToast().success('模拟删除成功')
      })
    },
  })
}

function onBatchDel() {
  const rows = batch.value.selectionDataList
  if (!rows.length) {
    return
  }

  useFaModal().confirm({
    title: '确认信息',
    content: `确认删除选中的 ${rows.length} 条数据吗？`,
    onConfirm: () => {
      Promise.all(rows.map(row => apiDepartment.delete(row.id))).then(() => {
        getDataList()
        useFaToast().success('模拟批量删除成功')
      })
    },
  })
}

function onIntoJob(row: Department) {
  router.push({
    name: 'pagesExampleGeneralJobList',
    params: {
      department_id: row.id,
    },
  })
}
</script>

<template>
  <div :class="{ 'absolute flex flex-col size-full': tableAutoHeight }">
    <FaPageHeader title="部门管理" description="页面数据为示例数据，非真实数据。" class="mb-0" />
    <FaPageMain :class="{ 'flex-1 overflow-auto': tableAutoHeight }" :main-class="{ 'flex-1 flex flex-col overflow-auto': tableAutoHeight }">
      <FaSearchBar :show-toggle="false">
        <template #default="{ fold, toggle }">
          <div class="gap-x-8 gap-y-2 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
            <FaLabel label="部门" class="col-span-1">
              <FaInput v-model="search.title" placeholder="请输入部门，支持模糊查询" clearable class="w-full" @keydown.enter="currentChange()" @clear="currentChange()" />
            </FaLabel>
            <div class="flex gap-2 col-end--1 justify-end">
              <FaButton variant="outline" @click="searchReset(); currentChange()">
                重置
              </FaButton>
              <FaButton type="primary" @click="currentChange()">
                <FaIcon name="i-ri:search-line" />
                筛选
              </FaButton>
              <FaButton variant="ghost" @click="toggle">
                {{ fold ? '展开' : '收起' }}
                <FaIcon :name="fold ? 'i-ep:caret-bottom' : 'i-ep:caret-top' " />
              </FaButton>
            </div>
          </div>
        </template>
      </FaSearchBar>
      <div class="mx--4 my-3 border-t border-t-dashed" />
      <FaTable
        v-loading="loading"
        table-root-class="rounded-lg overflow-hidden"
        :class="{ 'min-h-0 flex-1': tableAutoHeight }"
        row-key="id"
        selectable
        multiple
        stripe
        column-visibility
        border
        :columns="tableColumns"
        :data="dataList"
        @selection-change="batch.selectionDataList = $event"
      >
        <template #toolbar>
          <div class="flex flex-1 gap-2 items-center">
            <FaButton @click="onCreate">
              新增
            </FaButton>
            <FaDropdown
              v-if="batch.enable"
              :items="[
                [
                  { label: '批量删除', variant: 'destructive', disabled: !batch.selectionDataList.length, handle: onBatchDel },
                ],
              ]"
            >
              <FaButton variant="outline" :disabled="!batch.selectionDataList.length">
                批量操作
                <FaIcon name="i-ep:arrow-down" />
              </FaButton>
            </FaDropdown>
          </div>
        </template>
        <template #cell-operation="{ row }">
          <div class="flex-center gap-2">
            <FaButton variant="outline" size="sm" @click="onIntoJob(row.original)">
              职位管理
            </FaButton>
            <FaButton variant="outline" size="icon-sm" @click="onEdit(row.original)">
              <FaIcon name="i-ri:edit-line" />
            </FaButton>
            <FaDropdown
              :items="[
                [
                  { label: '删除', variant: 'destructive', handle: () => onDel(row.original) },
                ],
              ]"
            >
              <FaButton variant="outline" size="icon-sm">
                <FaIcon name="i-ri:more-line" />
              </FaButton>
            </FaDropdown>
          </div>
        </template>
      </FaTable>
      <FaPagination :page="pagination.page" :size="pagination.size" :total="pagination.total" class="mt-2" @page-change="currentChange" @size-change="sizeChange" />
    </FaPageMain>
  </div>
</template>
