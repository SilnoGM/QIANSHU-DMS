<script setup lang="ts">
import type { CreateMachineViewingDto, MachineViewingDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { getApiClientFailureMessage } from '@/api/errors'
import machineViewingsApi from '@/api/modules/machine-viewings'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { formatMachineViewingTime } from '@/utils/machine-viewing-schedule'
import MachineViewingFormModal from './machine-viewing-form-modal.vue'

defineOptions({ name: 'QsOperationsMachineViewings' })

const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()

const enabled = computed(() => auth('machine-viewings:read'))
const canCreate = computed(() => enabled.value && auth('machine-viewings:create'))
const page = ref(1)
const pageSize = ref(20)
const items = ref<MachineViewingDto[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

const open = ref(false)
const createKey = ref('')
const creating = ref(false)
const createError = ref('')
const fieldErrors = ref<Record<string, string>>({})

let controller: AbortController | null = null

const columns = computed<QsGenericTableColumn<MachineViewingDto>[]>(() => [
  {
    id: 'appointmentTime',
    accessorFn: row => formatMachineViewingTime(t, row),
    title: t('machineViewing.column.appointmentTime'),
    minWidth: 168,
    cellClass: 'qs-type-data-emphasis',
    mobileCellClass: 'qs-type-data-emphasis',
  },
  { id: 'customerName', accessorKey: 'customerName', title: t('machineViewing.column.customerName'), minWidth: 132 },
  {
    id: 'customerPhone',
    accessorFn: row => row.customerPhone ?? t('machineViewing.noPhone'),
    title: t('machineViewing.column.customerPhone'),
    minWidth: 148,
    cellClass: 'qs-type-data',
  },
  {
    id: 'site',
    accessorFn: row => t(`machineViewing.site.${row.site}`),
    title: t('machineViewing.column.site'),
    minWidth: 116,
  },
  {
    id: 'machineType',
    accessorFn: row => t(`machineViewing.machineType.${row.machineType}`),
    title: t('machineViewing.column.machineType'),
    minWidth: 116,
  },
  { id: 'contactPerson', accessorKey: 'contactPerson', title: t('machineViewing.column.contactPerson'), minWidth: 120 },
  {
    id: 'createdBy',
    accessorFn: row => row.createdBy.name,
    title: t('machineViewing.column.createdBy'),
    minWidth: 132,
  },
  {
    id: 'createdAt',
    accessorKey: 'createdAt',
    title: t('machineViewing.column.createdAt'),
    minWidth: 168,
  },
])

async function load(): Promise<void> {
  controller?.abort()
  if (!enabled.value) {
    return
  }
  const request = new AbortController()
  controller = request
  loading.value = true
  loadError.value = ''
  try {
    const response = await machineViewingsApi.list(
      { page: page.value, pageSize: pageSize.value },
      request.signal,
    )
    if (!request.signal.aborted && controller === request) {
      items.value = response.data.items
      total.value = response.data.total
    }
  }
  catch (failure) {
    if (!request.signal.aborted && controller === request) {
      loadError.value = getApiClientFailureMessage(failure, t('machineViewing.loadFailed'))
    }
  }
  finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

function openCreate(): void {
  if (!canCreate.value) {
    return
  }
  createKey.value = crypto.randomUUID()
  creating.value = false
  createError.value = ''
  fieldErrors.value = {}
  open.value = true
}

/** 服务端返回的逐字段错误取首条，交给弹窗挂到对应控件上。 */
function readFieldErrors(failure: unknown): Record<string, string> {
  const body = (failure as { body?: { fieldErrors?: Record<string, string[]> } } | null)?.body
  return Object.fromEntries(
    Object.entries(body?.fieldErrors ?? {}).map(([field, messages]) => [field, messages[0] ?? '']),
  )
}

function unknownResult(failure: unknown): boolean {
  const candidate = failure as { kind?: string, status?: number } | null
  return candidate?.kind === 'network'
    || candidate?.status === undefined
    || candidate.status >= 500
}

async function submitCreate(payload: CreateMachineViewingDto): Promise<void> {
  if (creating.value) {
    return
  }
  creating.value = true
  createError.value = ''
  fieldErrors.value = {}
  const request = new AbortController()
  try {
    await machineViewingsApi.create(payload, createKey.value, request.signal)
    toast.success(t('machineViewing.created'))
    open.value = false
    page.value = 1
    await load()
  }
  catch (failure) {
    createError.value = getApiClientFailureMessage(failure, t('machineViewing.saveFailed'))
    fieldErrors.value = readFieldErrors(failure)
    // 结果未知时保留同一把钥匙供人工重试；已知失败换新钥匙，改完内容可立即重提。
    if (!unknownResult(failure)) {
      createKey.value = crypto.randomUUID()
    }
  }
  finally {
    creating.value = false
  }
}

watch(() => account.authEpoch, () => {
  controller?.abort()
  controller = null
  loading.value = false
  items.value = []
  total.value = 0
  open.value = false
})

watch([enabled, page, pageSize, () => account.authEpoch], () => {
  if (enabled.value) {
    void load()
  }
}, { immediate: true })

watch(open, (value) => {
  if (!value) {
    createError.value = ''
    fieldErrors.value = {}
  }
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('machineViewing.title')" :description="t('machineViewing.description')">
      <FaButton v-if="canCreate" @click="openCreate">
        <FaIcon name="i-lucide:plus" aria-hidden="true" />
        {{ t('machineViewing.create') }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain class="min-w-0">
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        row-key="id"
        :columns="columns"
        :data="items"
        :total="total"
        :loading="loading"
        :error="loadError || undefined"
        :addable="false"
        :page-size-options="[20, 50, 100]"
        :empty-title="t('machineViewing.empty')"
        :empty-description="t('machineViewing.emptyDescription')"
        table-class="w-max min-w-full"
        :aria-label="t('machineViewing.title')"
        @pagination-change="load"
        @retry="load"
      >
        <template #cell-createdAt="{ row }">
          <DateTimeDisplay :value="row.original.createdAt" />
        </template>
        <template #mobile-row="{ row }">
          <div class="min-w-0 [overflow-wrap:anywhere] space-y-3">
            <div class="flex gap-3 items-baseline justify-between">
              <span class="qs-type-data-emphasis">{{ formatMachineViewingTime(t, row) }}</span>
              <span class="text-primary qs-type-tag">{{ t(`machineViewing.machineType.${row.machineType}`) }}</span>
            </div>
            <dl class="space-y-2">
              <div class="flex gap-3 items-baseline">
                <dt class="qs-type-meta text-muted-foreground shrink-0">
                  {{ t('machineViewing.column.customerName') }}
                </dt>
                <dd>{{ row.customerName }}</dd>
              </div>
              <div class="flex gap-3 items-baseline">
                <dt class="qs-type-meta text-muted-foreground shrink-0">
                  {{ t('machineViewing.column.customerPhone') }}
                </dt>
                <dd class="qs-type-data">
                  {{ row.customerPhone ?? t('machineViewing.noPhone') }}
                </dd>
              </div>
              <div class="flex gap-3 items-baseline">
                <dt class="qs-type-meta text-muted-foreground shrink-0">
                  {{ t('machineViewing.column.site') }}
                </dt>
                <dd>{{ t(`machineViewing.site.${row.site}`) }}</dd>
              </div>
              <div class="flex gap-3 items-baseline">
                <dt class="qs-type-meta text-muted-foreground shrink-0">
                  {{ t('machineViewing.column.contactPerson') }}
                </dt>
                <dd>{{ row.contactPerson }}</dd>
              </div>
            </dl>
            <div class="qs-type-meta text-muted-foreground pt-3 border-t border-border flex gap-2 items-center justify-between">
              <span>{{ row.createdBy.name }}</span>
              <DateTimeDisplay :value="row.createdAt" />
            </div>
          </div>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <MachineViewingFormModal
      v-model="open"
      :submitting="creating"
      :error="createError || null"
      :field-errors="fieldErrors"
      @submit="submitCreate"
    />
  </div>
</template>
