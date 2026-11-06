<script setup lang="ts">
import type { CreateMachineViewingDto, MachineViewingDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { getApiClientFailureMessage } from '@/api/errors'
import machineViewingsApi from '@/api/modules/machine-viewings'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { formatMachineViewingTime } from '@/utils/machine-viewing-schedule'
import { machineViewingStatusMeta } from '@/utils/machine-viewing-status'
import { resolveStatusTagToneClass } from '@/utils/status-tag-tone'
import MachineViewingDetailDrawer from './machine-viewing-detail-drawer.vue'
import MachineViewingFeedbackModal from './machine-viewing-feedback-modal.vue'
import MachineViewingFormModal from './machine-viewing-form-modal.vue'

defineOptions({ name: 'QsPurchaseTransportMachineViewings' })

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
const feedbackOpen = ref(false)
const feedbackRecord = ref<MachineViewingDto | null>(null)
const detailOpen = ref(false)
const detailRecord = ref<MachineViewingDto | null>(null)

let controller: AbortController | null = null

const columns = computed<QsGenericTableColumn<MachineViewingDto>[]>(() => [
  {
    id: 'appointmentNo',
    accessorKey: 'appointmentNo',
    title: t('machineViewing.column.appointmentNo'),
    width: 168,
    minWidth: 168,
    fixed: 'left',
    copyable: true,
    copyMode: 'text',
    cellClass: 'qs-type-data-emphasis',
    mobileCellClass: 'qs-type-data-emphasis',
  },
  {
    id: 'appointmentTime',
    accessorFn: row => formatMachineViewingTime(t, row),
    title: t('machineViewing.column.appointmentTime'),
    minWidth: 168,
    cellClass: 'qs-type-data-emphasis',
    mobileCellClass: 'qs-type-data-emphasis',
  },
  {
    id: 'status',
    accessorFn: row => t(machineViewingStatusMeta(row.status).labelKey),
    title: t('machineViewing.column.status'),
    minWidth: 104,
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
    id: 'feedback',
    accessorFn: row => row.feedback ?? '',
    title: t('machineViewing.column.feedback'),
    width: 112,
    minWidth: 112,
    align: 'center',
  },
  {
    id: 'submitted',
    accessorFn: row => `${row.createdBy.name} ${row.createdAt}`,
    title: t('machineViewing.column.submitted'),
    minWidth: 176,
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
    // QsGenericModal 在 submitting 期间会拒绝受控关闭并回写 true；先释放 busy 再关。
    creating.value = false
    await nextTick()
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

function openFeedback(row: MachineViewingDto): void {
  feedbackRecord.value = row
  feedbackOpen.value = true
}

function openDetail(row: MachineViewingDto): void {
  detailRecord.value = row
  detailOpen.value = true
}
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
        :action-column="{ width: 104, minWidth: 104 }"
        table-class="w-max min-w-full"
        :aria-label="t('machineViewing.title')"
        @pagination-change="load"
        @retry="load"
      >
        <template #cell-status="{ row }">
          <span
            class="qs-type-tag px-2 py-0.5 border rounded-md whitespace-nowrap"
            :class="resolveStatusTagToneClass(machineViewingStatusMeta(row.original.status).tone)"
          >
            {{ t(machineViewingStatusMeta(row.original.status).labelKey) }}
          </span>
        </template>
        <template #cell-submitted="{ row }">
          <QsTableStackedCell>
            <QsPersonDisplay :display-name="row.original.createdBy.name" size="sm" :avatar-url="row.original.createdBy.avatarUrl" />
            <QsTableStackedLine tone="muted">
              <DateTimeDisplay :value="row.original.createdAt" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-feedback="{ row }">
          <FaButton
            v-if="row.original.feedback"
            variant="link"
            size="sm"
            class="px-0 min-h-11 sm:min-h-8"
            @click="openFeedback(row.original)"
          >
            {{ t('machineViewing.feedback.view') }}
          </FaButton>
          <span v-else class="text-muted-foreground">
            {{ t('machineViewing.feedback.none') }}
          </span>
        </template>
        <template #mobile-row="{ row }">
          <div class="min-w-0 [overflow-wrap:anywhere] space-y-3">
            <div class="qs-type-data-emphasis">
              {{ row.appointmentNo }}
            </div>
            <div class="flex gap-3 items-baseline justify-between">
              <span class="qs-type-data">{{ formatMachineViewingTime(t, row) }}</span>
              <span
                class="qs-type-tag px-2 py-0.5 border rounded-md whitespace-nowrap"
                :class="resolveStatusTagToneClass(machineViewingStatusMeta(row.status).tone)"
              >
                {{ t(machineViewingStatusMeta(row.status).labelKey) }}
              </span>
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
                  {{ t('machineViewing.column.machineType') }}
                </dt>
                <dd>{{ t(`machineViewing.machineType.${row.machineType}`) }}</dd>
              </div>
              <div class="flex gap-3 items-baseline">
                <dt class="qs-type-meta text-muted-foreground shrink-0">
                  {{ t('machineViewing.column.contactPerson') }}
                </dt>
                <dd>{{ row.contactPerson }}</dd>
              </div>
            </dl>
            <div class="qs-type-meta text-muted-foreground pt-3 border-t border-border flex gap-2 items-center justify-between">
              <QsPersonDisplay :display-name="row.createdBy.name" size="sm" :avatar-url="row.createdBy.avatarUrl" />
              <DateTimeDisplay :value="row.createdAt" />
            </div>
            <div class="pt-3 border-t border-border flex gap-2 items-center justify-between">
              <span class="qs-type-meta text-muted-foreground">
                {{ t('machineViewing.column.feedback') }}
              </span>
              <FaButton
                v-if="row.feedback"
                variant="link"
                size="sm"
                class="px-0 min-h-11"
                @click="openFeedback(row)"
              >
                {{ t('machineViewing.feedback.view') }}
              </FaButton>
              <span v-else class="qs-type-meta text-muted-foreground">
                {{ t('machineViewing.feedback.none') }}
              </span>
            </div>
          </div>
        </template>
        <template #actions="{ row }">
          <FaButton
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :aria-label="`${row.appointmentNo}：${t('machineViewing.action.detail')}`"
            @click="openDetail(row)"
          >
            {{ t('machineViewing.action.detail') }}
          </FaButton>
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
    <MachineViewingFeedbackModal v-model="feedbackOpen" :record="feedbackRecord" />
    <MachineViewingDetailDrawer v-model="detailOpen" :record="detailRecord" />
  </div>
</template>
