<script setup lang="ts">
import type { PermissionDto } from '@/api/generated/types.gen'
import managementApi from '@/api/modules/management'
import { groupPermissions } from './catalog'

defineOptions({ name: 'SystemPermissions' })

const { auth } = useAppAuth()
const permissions = ref<PermissionDto[]>([])
const loading = ref(false)
const pageError = ref('')

const canRead = computed(() => auth('roles:read'))
const groups = computed(() => groupPermissions(permissions.value))
const columns = [
  { title: '权限码', dataIndex: 'code', slotName: 'code', width: 240 },
  { title: '名称', dataIndex: 'name', width: 180 },
  { title: '说明', dataIndex: 'description', slotName: 'description' },
  { title: '范围', dataIndex: 'systemOnly', slotName: 'scope', width: 120 },
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
      <AButton v-if="canRead" :loading="loading" @click="loadPermissions">
        <template #icon>
          <FaIcon name="i-mdi:refresh" />
        </template>
        刷新
      </AButton>
    </FaPageHeader>

    <FaPageMain>
      <AResult v-if="!canRead" status="403" title="没有权限" subtitle="当前账号不能查看权限目录。" />
      <template v-else>
        <AAlert v-if="pageError" type="error" class="mb-4">
          {{ pageError }}
          <AButton type="text" size="small" @click="loadPermissions">
            重试
          </AButton>
        </AAlert>

        <ASpin :loading="loading" class="catalog-loading">
          <AEmpty v-if="!loading && groups.length === 0" description="暂无权限" />
          <div v-else class="permission-sections">
            <section v-for="group in groups" :key="group.key" class="permission-section">
              <header>
                <div>
                  <h2>{{ group.label }}</h2>
                  <code>{{ group.key }}</code>
                </div>
                <ATag>{{ group.permissions.length }} 项</ATag>
              </header>

              <div class="desktop-list">
                <ATable
                  row-key="id"
                  :columns="columns"
                  :data="group.permissions"
                  :pagination="false"
                  :bordered="false"
                >
                  <template #code="{ record }">
                    <code>{{ record.code }}</code>
                  </template>
                  <template #description="{ record }">
                    <span class="secondary-text">{{ record.description || '—' }}</span>
                  </template>
                  <template #scope="{ record }">
                    <ATag v-if="record.systemOnly" color="orangered">
                      系统专用
                    </ATag>
                    <ATag v-else color="green">
                      普通权限
                    </ATag>
                  </template>
                </ATable>
              </div>

              <div class="mobile-list">
                <ACard
                  v-for="permission in group.permissions"
                  :key="permission.id"
                  class="permission-card"
                  :bordered="true"
                >
                  <template #title>
                    {{ permission.name }}
                  </template>
                  <template #extra>
                    <ATag v-if="permission.systemOnly" size="small" color="orangered">
                      系统专用
                    </ATag>
                    <ATag v-else size="small" color="green">
                      普通权限
                    </ATag>
                  </template>
                  <code>{{ permission.code }}</code>
                  <p>{{ permission.description || '暂无补充说明' }}</p>
                </ACard>
              </div>
            </section>
          </div>
        </ASpin>
      </template>
    </FaPageMain>
  </div>
</template>

<style scoped>
.catalog-loading {
  display: block;
  width: 100%;
  min-height: 160px;
}

.permission-sections {
  display: grid;
  gap: 18px;
}

.permission-section {
  overflow: hidden;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border-2);
  border-radius: 10px;
}

.permission-section > header {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--color-border-2);
}

.permission-section h2 {
  margin: 0 0 3px;
  font-size: 16px;
}

.permission-section header code,
.secondary-text {
  color: var(--color-text-3);
}

.mobile-list {
  display: none;
}

.permission-card code {
  overflow-wrap: anywhere;
}

.permission-card p {
  margin: 10px 0 0;
  color: var(--color-text-3);
}

@media (width <= 767px) {
  .desktop-list {
    display: none;
  }

  .mobile-list {
    display: grid;
    gap: 10px;
    padding: 12px;
  }
}
</style>
