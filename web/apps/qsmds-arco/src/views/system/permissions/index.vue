<script setup lang="ts">
import type { PermissionDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'

import managementApi from '@/api/modules/management'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { groupPermissions } from './catalog'

defineOptions({ name: 'SystemPermissions' })

const { auth } = useAppAuth()
const permissions = ref<PermissionDto[]>([])
const loading = ref(false)
const pageError = ref('')

const canRead = computed(() => auth('roles:read'))
const groups = computed(() => groupPermissions(permissions.value))
const columns: QsGenericTableColumn<PermissionDto>[] = [
  { id: 'code', accessorKey: 'code', title: '权限码', width: 240 },
  { id: 'name', accessorKey: 'name', title: '名称', width: 180 },
  { id: 'description', accessorKey: 'description', title: '说明' },
  { id: 'systemOnly', accessorKey: 'systemOnly', title: '范围', width: 120 },
]

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
    <FaPageHeader description="只读查看系统当前可用权限。权限按资源分组并按权限码稳定排序。">
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

        <div
          v-if="loading && groups.length === 0"
          class="text-muted-foreground flex-col-center gap-3 min-h-40"
          role="status"
        >
          <FaIcon name="i-svg-spinners:90-ring-with-bg" class="text-primary size-7" />
          <span class="qs-type-body">正在加载权限目录…</span>
        </div>

        <FaEmpty
          v-else-if="groups.length === 0"
          icon="i-lucide:list-checks"
          title="暂无权限"
          description="当前权限目录没有可展示的数据。"
          class="min-h-40"
        />

        <div v-else class="gap-4 grid" :aria-busy="loading">
          <section
            v-for="group in groups"
            :key="group.key"
            data-testid="permission-section"
            class="text-card-foreground border border-border rounded-lg bg-card overflow-hidden"
          >
            <header class="px-4 py-3 border-b border-border bg-muted/30 flex gap-4 items-center justify-between">
              <div class="min-w-0">
                <h2 class="qs-type-component-title m-0">
                  {{ group.label }}
                </h2>
                <code class="qs-type-meta break-all">{{ group.key }}</code>
              </div>
              <FaTag variant="secondary" class="shrink-0">
                {{ group.permissions.length }} 项
              </FaTag>
            </header>

            <QsGenericTable
              data-testid="permission-table"
              row-key="id"
              class="p-3 md:p-0"
              :aria-label="`${group.label}权限列表`"
              :columns="columns"
              :data="group.permissions"
              :loading="loading"
              :searchable="false"
              :addable="false"
              :show-column-settings="false"
              :show-pagination="false"
              table-class="min-w-[720px]"
            >
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

              <!-- 通用表格负责每个权限分组的响应式卡片；这里不再嵌套第二层 FaCard。 -->
              <template #mobile-row="{ row: permission, rowNumber }">
                <div data-testid="permission-card" class="gap-2 grid">
                  <div class="flex gap-3 items-start justify-between">
                    <strong class="qs-type-compact-title min-w-0 break-words">{{ permission.name }}</strong>
                    <div class="flex shrink-0 flex-col gap-1 items-end">
                      <FaTag
                        :variant="permission.systemOnly ? 'secondary' : 'outline'"
                        class="qs-type-status-tag"
                      >
                        {{ permission.systemOnly ? '系统专用' : '普通权限' }}
                      </FaTag>
                      <span class="qs-type-meta tabular-nums">#{{ rowNumber }}</span>
                    </div>
                  </div>
                  <code class="qs-type-data-emphasis break-all">{{ permission.code }}</code>
                  <p class="qs-type-description m-0">
                    {{ permission.description || '暂无补充说明' }}
                  </p>
                </div>
              </template>
            </QsGenericTable>
          </section>
        </div>
      </template>
    </FaPageMain>
  </div>
</template>
