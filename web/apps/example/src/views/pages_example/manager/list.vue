<script setup lang="ts">
import type { TableColumn, TableSortingState } from '@fantastic-admin/components'
import apiManager from '@/api/modules/manager'
import eventBus from '@/utils/eventBus'
import DetailForm from './components/DetailForm/index.vue'

defineOptions({
  name: 'PagesExampleManagerList',
})

const router = useRouter()
const { pagination, getParams, onSizeChange, onCurrentChange, onSortChange } = usePagination()

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
  id: '',
})

// 搜索
const searchDefault = {
  account: '',
  name: '',
  mobile: '',
  sex: null,
}
const search = ref({ ...searchDefault })
function searchReset() {
  Object.assign(search.value, searchDefault)
}

// 批量操作
const batch = ref({
  enable: true,
  selectionDataList: [] as any[],
})

// 列表
const loading = ref(false)
const dataList = ref<any[]>([])

const tableColumns = computed<TableColumn[]>(() => [
  ...(batch.value.enable
    ? [{
      type: 'selection',
      fixed: 'left',
      width: 50,
    } satisfies TableColumn]
    : []),
  {
    accessorKey: 'account',
    header: '帐号',
    enableSorting: true,
  },
  {
    accessorKey: 'name',
    header: '姓名',
    width: 100,
    align: 'center',
  },
  {
    accessorKey: 'sex',
    header: '性别',
    width: 100,
    align: 'center',
  },
  {
    accessorKey: 'mobile',
    header: '手机号',
    width: 150,
    align: 'center',
  },
  {
    accessorKey: 'status',
    header: '状态',
    width: 100,
    align: 'center',
  },
  {
    id: 'actions',
    header: '操作',
    width: 150,
    align: 'center',
    fixed: 'right',
    enableHiding: false,
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
    ...(search.value.account && { account: search.value.account }),
    ...(search.value.name && { name: search.value.name }),
    ...(search.value.mobile && { mobile: search.value.mobile }),
    ...(search.value.sex !== null && { sex: search.value.sex }),
  }
  apiManager.list(params).then((res: any) => {
    loading.value = false
    dataList.value = res.data.list
    dataList.value.forEach((item: any) => {
      item.statusLoading = false
    })
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
      name: 'pagesExampleGeneralManagerCreate',
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

function onEdit(row: any) {
  if (formMode.value === 'router') {
    router.push({
      name: 'pagesExampleGeneralManagerEdit',
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

function onChangeStatus(row: any) {
  return new Promise<boolean>((resolve) => {
    useFaModal().confirm({
      title: '确认信息',
      content: `确认${!row.status ? '启用' : '禁用'}「${row.account}」吗？`,
      onConfirm: () => {
        row.statusLoading = true
        apiManager.changeStatus({
          id: row.id,
          status: !row.status,
        }).then(() => {
          row.statusLoading = false
          useFaToast().success(`模拟${!row.status ? '启用' : '禁用'}成功`)
          return resolve(true)
        }).catch(() => {
          row.statusLoading = false
          return resolve(false)
        })
      },
    })
  })
}

function onResetPassword(row: any) {
  useFaModal().confirm({
    title: '确认信息',
    content: `确认将「${row.account}」的密码重置为 “123456” 吗？`,
    onConfirm: () => {
      apiManager.passwordReset(row.id).then(() => {
        useFaToast().success('模拟重置成功')
      })
    },
  })
}

function onDel(row: any) {
  useFaModal().confirm({
    title: '确认信息',
    content: `确认删除「${row.account}」管理员吗？`,
    onConfirm: () => {
      apiManager.delete(row.id).then(() => {
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
      Promise.all(rows.map(row => apiManager.delete(row.id))).then(() => {
        getDataList()
        useFaToast().success('模拟批量删除成功')
      })
    },
  })
}
</script>

<template>
  <div :class="{ 'absolute flex flex-col size-full': tableAutoHeight }">
    <FaPageHeader title="管理员管理" description="页面数据为示例数据，非真实数据。" class="mb-0" />
    <FaPageMain :class="{ 'flex-1 overflow-auto': tableAutoHeight }" :main-class="{ 'flex-1 flex flex-col overflow-auto': tableAutoHeight }">
      <FaSearchBar :show-toggle="false">
        <template #default="{ fold, toggle }">
          <div class="gap-x-8 gap-y-2 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
            <FaLabel label="账号" class="col-span-1">
              <FaInput v-model="search.account" placeholder="请输入帐号，支持模糊查询" clearable class="w-full" @keydown.enter="currentChange()" @clear="currentChange()" />
            </FaLabel>
            <FaLabel label="姓名" class="col-span-1">
              <FaInput v-model="search.name" placeholder="请输入姓名，支持模糊查询" clearable class="w-full" @keydown.enter="currentChange()" @clear="currentChange()" />
            </FaLabel>
            <FaLabel v-show="!fold" label="手机号" class="col-span-1">
              <FaInput v-model="search.mobile" placeholder="请输入手机号" clearable class="w-full" @keydown.enter="currentChange()" @clear="currentChange()" />
            </FaLabel>
            <FaLabel v-show="!fold" label="性别" class="col-span-1">
              <FaSelect
                v-model="search.sex" :options="[
                  { value: null, label: '全部' },
                  { value: 1, label: '男' },
                  { value: 0, label: '女' },
                  { value: 2, label: '保密' },
                ]" class="w-full" @change="currentChange()"
              />
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
        stripe
        sortable
        column-visibility
        selectable
        multiple
        border
        row-key="id"
        :columns="tableColumns"
        :data="dataList"
        @sorting-change="sortingChange"
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
        <template #cell-sex="{ value }">
          <FaTag v-if="value === 1">
            男
          </FaTag>
          <FaTag v-else-if="value === 0">
            女
          </FaTag>
          <FaTag v-else variant="outline">
            保密
          </FaTag>
        </template>
        <template #cell-status="{ row }">
          <FaSwitch v-model="row.original.status" :loading="row.original.statusLoading" :before-change="() => onChangeStatus(row.original)" />
        </template>
        <template #cell-actions="{ row }">
          <div class="flex-center gap-2">
            <FaButton variant="outline" size="icon-sm" @click="onEdit(row.original)">
              <FaIcon name="i-ri:edit-line" />
            </FaButton>
            <FaDropdown
              :items="[
                [
                  { label: '重置密码', handle: () => onResetPassword(row.original) },
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
