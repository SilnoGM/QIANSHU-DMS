<script setup lang="ts">
import type { TableColumn } from '@fantastic-admin/components'
import apiMenu from '@/api/modules/menu'

defineOptions({
  name: 'PagesExampleMenuList',
})

interface MenuItem {
  id: number | string
  path: string
  component: string
  meta: {
    title: string
    icon: string[]
    menu: boolean
    breadcrumb: boolean
  }
  children?: MenuItem[]
}

const router = useRouter()

// 表格是否自适应高度
const tableAutoHeight = ref(false)

// 列表
const loading = ref(false)
const dataList = ref<MenuItem[]>([])

// 展开所有行
const expanded = ref<Record<string, boolean>>({})

function expandAll(data: MenuItem[]) {
  data.forEach((item) => {
    if (item.children?.length) {
      expanded.value[item.id] = true
      expandAll(item.children)
    }
  })
}

const tableColumns: TableColumn<MenuItem>[] = [
  {
    accessorKey: 'meta.title',
    header: '标题',
    minWidth: 200,
    fixed: 'left',
  },
  {
    accessorKey: 'path',
    header: '路由',
    width: 200,
  },
  {
    id: 'component',
    header: '页面组件',
    width: 200,
  },
  {
    id: 'icon',
    header: '图标',
    width: 80,
    align: 'center',
  },
  {
    id: 'activeIcon',
    header: '激活图标',
    width: 80,
    align: 'center',
  },
  {
    id: 'menu',
    header: '菜单',
    width: 80,
    align: 'center',
  },
  {
    id: 'breadcrumb',
    header: '面包屑',
    width: 80,
    align: 'center',
  },
  {
    id: 'operation',
    header: '操作',
    width: 250,
    align: 'center',
    fixed: 'right',
  },
]

onMounted(() => {
  getDataList()
})

function getDataList() {
  loading.value = true
  apiMenu.list().then((res: any) => {
    loading.value = false
    dataList.value = res.data
    expandAll(dataList.value)
  })
}

function onCreate(row?: MenuItem) {
  router.push({
    name: 'pagesExampleGeneralMenuCreate',
    query: {
      parentId: row?.id,
    },
  })
}

function onEdit(row: MenuItem) {
  router.push({
    name: 'pagesExampleGeneralMenuEdit',
    params: {
      id: row.id,
    },
  })
}

function onDel(row: MenuItem) {
  useFaModal().confirm({
    title: '确认信息',
    content: `确认删除「${row.meta.title}」吗？`,
    onConfirm: () => {
      apiMenu.delete(row.id).then(() => {
        getDataList()
        useFaToast().success('模拟删除成功')
      })
    },
  })
}
</script>

<template>
  <div :class="{ 'absolute flex flex-col size-full': tableAutoHeight }">
    <FaPageHeader title="导航管理" description="页面数据为示例数据，非真实数据。" class="mb-0" />
    <FaPageMain :class="{ 'flex-1 overflow-auto': tableAutoHeight }" :main-class="{ 'flex-1 flex flex-col overflow-auto': tableAutoHeight }">
      <FaTable
        v-model:expanded="expanded"
        v-loading="loading"
        table-root-class="rounded-lg overflow-hidden"
        :class="{ 'min-h-0 flex-1': tableAutoHeight }"
        tree
        row-key="id"
        stripe
        border
        :columns="tableColumns"
        :data="dataList"
      >
        <template #toolbar>
          <div class="flex-center-between flex-1 gap-2">
            <FaButton @click="onCreate()">
              <FaIcon name="i-ri:add-line" />
              新增主导航
            </FaButton>
          </div>
        </template>
        <template #cell-component="{ row }">
          <FaTag v-if="row.original.component === 'Layout'">
            Layout
          </FaTag>
          <span v-else :title="row.original.component">{{ row.original.component }}</span>
        </template>
        <template #cell-icon="{ row }">
          <div class="flex-center">
            <FaIcon v-if="row.original.meta.icon[0]" :name="row.original.meta.icon[0]" class="size-6" />
          </div>
        </template>
        <template #cell-activeIcon="{ row }">
          <FaIcon v-if="row.original.meta.icon" :name="row.original.meta.icon[1]" class="size-6" />
        </template>
        <template #cell-menu="{ row }">
          <FaTag v-if="typeof row.original.meta.menu === 'boolean'" :variant="row.original.meta.menu ? 'default' : 'destructive'">
            {{ row.original.meta.menu ? '显示' : '隐藏' }}
          </FaTag>
        </template>
        <template #cell-breadcrumb="{ row }">
          <FaTag v-if="typeof row.original.meta.breadcrumb === 'boolean'" :variant="row.original.meta.breadcrumb ? 'default' : 'destructive'">
            {{ row.original.meta.breadcrumb ? '显示' : '隐藏' }}
          </FaTag>
        </template>
        <template #cell-operation="{ row }">
          <div class="flex-center gap-2">
            <FaButton variant="outline" size="sm" @click="onCreate(row.original)">
              新增导航
            </FaButton>
            <FaButton variant="outline" size="sm" @click="onEdit(row.original)">
              编辑
            </FaButton>
            <FaButton variant="destructive" size="sm" @click="onDel(row.original)">
              删除
            </FaButton>
          </div>
        </template>
      </FaTable>
    </FaPageMain>
  </div>
</template>
