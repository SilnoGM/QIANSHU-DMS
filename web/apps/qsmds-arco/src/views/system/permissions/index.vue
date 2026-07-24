<script setup lang="ts">
import type { PermissionDto } from '@/api/generated/types.gen'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import managementApi from '@/api/modules/management'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import {
  filterPermissionTableRows,
  hasVisibleTableColumn,
  permissionResourceOptions,
} from '@/views/system/shared/table-query'
import { permissionResource, permissionResourceLabel } from './catalog'

defineOptions({ name: 'SystemPermissions' })

const { auth } = useAppAuth()
const permissions = ref<PermissionDto[]>([])
const loading = ref(false)
const pageError = ref('')
const tableSearch = ref('')
const tableFilters = ref<QsGenericTableFilterValues>({})

const canRead = computed(() => auth('roles:read'))
const columns: QsGenericTableColumn<PermissionDto>[] = [
  {
    id: 'resource',
    accessorFn: permission => permissionResource(permission.code),
    title: '资源',
    width: 160,
  },
  { id: 'code', accessorKey: 'code', title: '权限码', width: 240 },
  { id: 'name', accessorKey: 'name', title: '名称', width: 180 },
  { id: 'description', accessorKey: 'description', title: '说明' },
  { id: 'systemOnly', accessorKey: 'systemOnly', title: '范围', width: 120 },
]
const filterDefinitions = computed<QsGenericTableFilterDefinition[]>(() => [
  {
    key: 'resource',
    label: '资源',
    options: permissionResourceOptions(permissions.value),
  },
  {
    key: 'permissionScope',
    label: '权限范围',
    options: [
      { label: '系统专用', value: 'system' },
      { label: '普通权限', value: 'business' },
    ],
  },
])
const filteredPermissionRows = computed(() =>
  filterPermissionTableRows(permissions.value, tableSearch.value, tableFilters.value))

function safeErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return '权限目录加载失败，请稍后重试'
  }
  const candidate = error as {
    body?: { message?: unknown, requestId?: unknown }
    message?: unknown
    requestId?: unknown
  }
  const message = typeof candidate.body?.message === 'string'
    ? candidate.body.message
    : typeof candidate.message === 'string'
      ? candidate.message
      : '权限目录加载失败，请稍后重试'
  const requestId = typeof candidate.body?.requestId === 'string'
    ? candidate.body.requestId
    : typeof candidate.requestId === 'string'
      ? candidate.requestId
      : undefined
  return requestId === undefined ? message : `${message}（requestId: ${requestId}）`
}

async function loadPermissions(): Promise<void> {
  if (loading.value || !canRead.value) {
    return
  }
  loading.value = true
  pageError.value = ''
  try {
    const response = await managementApi.permissions.list()
    permissions.value = response.data
  }
  catch (error) {
    pageError.value = safeErrorMessage(error)
  }
  finally {
    loading.value = false
  }
}

onMounted(loadPermissions)
</script>

<template>
  <div>
    <FaPageHeader description="只读查看系统当前可用权限，可按资源和权限范围快速检索。">
      <template #title>
        权限目录
      </template>
      <FaButton v-if="canRead" variant="outline" :loading="loading" @click="loadPermissions">
        <FaIcon name="i-mdi:refresh" />
        刷新
      </FaButton>
    </FaPageHeader>

    <FaPageMain>
      <FaEmpty
        v-if="!canRead"
        icon="i-lucide:shield-x"
        title="没有权限"
        description="当前账号不能查看权限目录。"
        class="min-h-64"
      />
      <template v-else>
        <FaAlert
          v-if="pageError"
          variant="destructive"
          icon="i-lucide:circle-alert"
          title="权限目录加载失败"
          class="mb-4"
        >
          <template #description>
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <span>{{ pageError }}</span>
              <FaButton variant="outline" size="sm" @click="loadPermissions">
                重试
              </FaButton>
            </div>
          </template>
        </FaAlert>

        <QsGenericTable
          v-model:search="tableSearch"
          v-model:filters="tableFilters"
          data-testid="permission-table"
          class="text-card-foreground"
          row-key="id"
          aria-label="权限目录列表"
          :columns="columns"
          :data="filteredPermissionRows"
          :filter-definitions="filterDefinitions"
          :loading="loading"
          :searchable="true"
          :addable="false"
          :show-column-settings="true"
          :show-pagination="false"
          empty-title="暂无权限"
          empty-description="当前权限目录没有可展示的数据。"
          search-placeholder="搜索权限码、名称、说明或资源"
          table-class="min-w-[880px]"
        >
          <template #cell-resource="{ row }">
            <div class="gap-0.5 grid">
              <span class="qs-type-body-medium">
                {{ permissionResourceLabel(permissionResource(row.original.code)) }}
              </span>
              <code class="qs-type-meta">{{ permissionResource(row.original.code) }}</code>
            </div>
          </template>
          <template #cell-code="{ row }">
            <code class="qs-type-data-emphasis">{{ row.original.code }}</code>
          </template>
          <template #cell-description="{ row }">
            <span class="qs-type-description">{{ row.original.description || '—' }}</span>
          </template>
          <template #cell-systemOnly="{ row }">
            <FaTag
              :variant="row.original.systemOnly ? 'secondary' : 'outline'"
              class="qs-type-status-tag"
            >
              {{ row.original.systemOnly ? '系统专用' : '普通权限' }}
            </FaTag>
          </template>

          <!-- 自定义卡片使用 visibleColumns，同步响应列设置中的字段显隐。 -->
          <template #mobile-row="{ columns: visibleColumns, row: permission, rowNumber }">
            <div data-testid="permission-card" class="gap-2 grid">
              <div class="flex gap-3 items-start justify-between">
                <strong
                  v-if="hasVisibleTableColumn(visibleColumns, 'name')"
                  class="qs-type-compact-title min-w-0 break-words"
                >
                  {{ permission.name }}
                </strong>
                <div class="flex shrink-0 flex-col gap-1 items-end">
                  <FaTag
                    v-if="hasVisibleTableColumn(visibleColumns, 'systemOnly')"
                    :variant="permission.systemOnly ? 'secondary' : 'outline'"
                    class="qs-type-status-tag"
                  >
                    {{ permission.systemOnly ? '系统专用' : '普通权限' }}
                  </FaTag>
                  <span class="qs-type-meta tabular-nums">#{{ rowNumber }}</span>
                </div>
              </div>
              <div
                v-if="hasVisibleTableColumn(visibleColumns, 'resource')"
                class="gap-2 grid [grid-template-columns:72px_minmax(0,1fr)]"
              >
                <span class="qs-type-compact-label">资源</span>
                <span class="qs-type-body">
                  {{ permissionResourceLabel(permissionResource(permission.code)) }}
                  <code class="qs-type-meta ms-1">{{ permissionResource(permission.code) }}</code>
                </span>
              </div>
              <code
                v-if="hasVisibleTableColumn(visibleColumns, 'code')"
                class="qs-type-data-emphasis break-all"
              >
                {{ permission.code }}
              </code>
              <p
                v-if="hasVisibleTableColumn(visibleColumns, 'description')"
                class="qs-type-description m-0"
              >
                {{ permission.description || '暂无补充说明' }}
              </p>
            </div>
          </template>
        </QsGenericTable>
      </template>
    </FaPageMain>
  </div>
</template>
