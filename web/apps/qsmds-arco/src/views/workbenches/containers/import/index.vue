<script setup lang="ts">
import type { ImportDisplayRow, ImportFilter } from './use-container-import'
import containerImportApi from '@/api/modules/container-import'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { takeImportPreview } from '../container-import-preview-cache'
import ImportTable from './import-table.vue'
import ShipmentMatchDrawer from './shipment-match-drawer.vue'
import { useContainerImport } from './use-container-import'

defineOptions({ name: 'QsPurchaseTransportContainerImport' })
const { t } = useI18n()
const retainUnmatchedId = useId()
const route = useRoute()
const router = useRouter()
const account = useAppAccountStore()
const { auth } = useAppAuth()
const toast = useQsToast()
const active = ref(true)
const id = computed(() => String(route.params.id ?? ''))
const canAccess = computed(() => auth('container-batches:read') && auth('container-batches:update') && auth('purchase-orders:read'))
const enabled = computed(() => active.value && account.authState === 'authenticated' && route.name === 'qsPurchaseTransportContainerImport' && canAccess.value && Boolean(id.value))
// 柜次详情刚解析完就跳转过来时直接复用那次结果，避免同一份表格解析两次；读取即消费，重载走真实请求。
async function loadPreview(signal: AbortSignal) {
  const staged = takeImportPreview(id.value)
  return staged ?? (await containerImportApi.preview(id.value, signal)).data
}
const state = useContainerImport(enabled, computed(() => account.authEpoch), id, loadPreview, async (body, key, signal) => (await containerImportApi.confirm(id.value, body, key, signal)).data)
const { preview, loading, loadError, rows, counts, importCount, unmatchedCount, allowUnmatched, locked, canSubmit, retryOnly, submitting, error, conflict, fieldErrors } = state
const status = ref<ImportFilter>('ALL')
const statuses = computed(() => (['ALL', 'MATCHED', 'AMBIGUOUS', 'UNMATCHED', 'INVALID', 'SKIPPED'] as const).map(value => ({ value, label: t(`containerImport.status.${value}`), count: counts.value[value] })))
const summaryItems = computed(() => [
  { key: 'ALL', label: t('containerImport.summary.parsed'), count: counts.value.ALL },
  { key: 'SKIPPED', label: t('containerImport.status.SKIPPED'), count: counts.value.SKIPPED },
  { key: 'MATCHED', label: t('containerImport.status.MATCHED'), count: counts.value.MATCHED },
])
const drawerOpen = ref(false)
const selectedRowKey = ref('')
const selectedRow = computed(() => rows.value.find(row => row.rowKey === selectedRowKey.value) ?? null)
const fieldMessages = computed(() => [...new Set(Object.values(fieldErrors.value))])
const leaveOpen = ref(false)
let resolveLeave: ((allowed: boolean) => void) | null = null
let pendingLeave: Promise<boolean> | null = null
watch([enabled, () => account.authEpoch], () => {
  drawerOpen.value = false
  selectedRowKey.value = ''
  status.value = 'ALL'
  finishLeave(false)
})
function choose(row: ImportDisplayRow) {
  if (!locked.value && row.displayStatus !== 'INVALID' && row.displayStatus !== 'SKIPPED') {
    selectedRowKey.value = row.rowKey
    drawerOpen.value = true
  }
}
function back() {
  return router.push({ name: 'qsPurchaseTransportContainerDetail', params: { id: id.value } })
}
async function submit() {
  const result = await state.submit()
  if (result) {
    toast.success(t('containerImport.success', { count: result.importedCount, skipped: result.skippedCount }))
    await back()
  }
}
function finishLeave(allowed: boolean) {
  const resolve = resolveLeave
  resolveLeave = null
  pendingLeave = null
  leaveOpen.value = false
  resolve?.(allowed)
}
function canLeave() {
  if (!enabled.value) {
    return true
  }
  if (locked.value) {
    toast.info(t('containerImport.waitBeforeLeave'))
    return false
  }
  if (!state.hasUncommitted.value) {
    return true
  }
  if (!pendingLeave) {
    pendingLeave = new Promise<boolean>((resolve) => {
      resolveLeave = resolve
      leaveOpen.value = true
    })
  }
  return pendingLeave
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (enabled.value && (locked.value || state.hasUncommitted.value)) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onBeforeRouteLeave(canLeave)
onBeforeRouteUpdate(canLeave)
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onActivated(() => active.value = true)
onDeactivated(() => active.value = false)
onBeforeUnmount(() => {
  active.value = false
  finishLeave(false)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('containerImport.title')" :description="t('containerImport.description')">
      <FaButton variant="outline" :disabled="locked" @click="back">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('containerImport.back') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain v-if="!canAccess">
      <FaEmpty icon="i-lucide:shield-alert" :title="t('containerImport.permission')" class="py-12" />
    </FaPageMain>
    <FaPageMain v-else-if="loading">
      <div role="status" class="text-muted-foreground py-16 flex gap-3 items-center justify-center">
        <FaIcon name="i-lucide:loader-circle" class="animate-spin" aria-hidden="true" />{{ t('containerPage.loading') }}
      </div>
    </FaPageMain>
    <FaPageMain v-else-if="loadError">
      <FaAlert variant="destructive" :title="loadError" /><FaButton variant="outline" class="mt-4" @click="state.reload">
        {{ t('containerImport.retry') }}
      </FaButton>
    </FaPageMain>
    <template v-else-if="preview">
      <FaPageMain>
        <div class="flex flex-wrap gap-4 items-start justify-between">
          <div class="min-w-0 space-y-2">
            <p class="qs-type-section-title m-0 [overflow-wrap:anywhere]">
              {{ preview.containerBatchName }}
            </p><p class="qs-type-data text-muted-foreground m-0">
              {{ preview.containerBatchNo }}
            </p>
          </div>
          <div class="px-4 py-3 border border-border rounded-lg bg-muted/20 flex gap-3 min-w-0 items-center">
            <FaIcon name="i-lucide:file-spreadsheet" class="text-primary shrink-0 size-5" aria-hidden="true" /><div class="min-w-0">
              <p class="qs-type-meta text-muted-foreground m-0">
                {{ t('containerImport.sourceFile') }}
              </p><p class="qs-type-body-medium m-0 mt-1 [overflow-wrap:anywhere]">
                {{ preview.sourceFilename }}
              </p>
            </div>
          </div>
        </div>
        <FaAlert v-for="(warning, index) in preview.warnings" :key="index" class="mt-4" :title="warning" />
      </FaPageMain>
      <FaPageMain v-if="preview.alreadyImported">
        <FaAlert :title="t('containerImport.alreadyImported')" :description="t('containerImport.alreadyImportedHint')" />
      </FaPageMain>
      <FaPageMain v-if="!rows.length">
        <FaEmpty :title="t('containerImport.empty')" :description="t('containerImport.emptyHint')" class="py-12" />
      </FaPageMain>
      <template v-else>
        <QsStatusSwitchToolbar v-model="status" :items="statuses" class="mx-4" />
        <FaPageMain>
          <FaAlert v-if="counts.INVALID" variant="destructive" class="mb-4" :title="t('containerImport.invalidHint', { count: counts.INVALID })" />
          <ImportTable :rows="rows" :status="status" :disabled="locked" @choose="choose" @clear="state.select($event.rowKey, null)" />
        </FaPageMain>
        <FaFixedBar position="bottom" class="pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border">
          <div class="space-y-3">
            <FaAlert v-if="retryOnly" :title="t('containerImport.unknown')" />
            <FaAlert v-else-if="error" variant="destructive" :title="error">
              <template #description>
                <p v-for="message in fieldMessages" :key="message" class="m-0 mt-1">
                  {{ message }}
                </p><div v-if="conflict" class="mt-3 flex flex-wrap gap-3 items-center">
                  <span>{{ t('containerImport.conflict') }}</span><FaButton size="sm" variant="outline" :disabled="locked" @click="state.reload">
                    {{ t('containerImport.reload') }}
                  </FaButton>
                </div>
              </template>
            </FaAlert>
            <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div class="flex flex-1 flex-wrap gap-x-5 gap-y-3 min-w-0 items-center">
                <div v-if="unmatchedCount" class="flex shrink-0 gap-2 items-center">
                  <FaSwitch :id="retainUnmatchedId" v-model="allowUnmatched" :disabled="locked" :aria-describedby="`${retainUnmatchedId}-hint`" />
                  <FaLabel :for="retainUnmatchedId" class="qs-type-body-medium" :class="locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'">
                    {{ t('containerImport.retainUnmatched') }}
                  </FaLabel>
                  <span :id="`${retainUnmatchedId}-hint`" class="sr-only">{{ t('containerImport.unmatchedHint', { count: unmatchedCount }) }}</span>
                </div>
                <dl class="contents" aria-live="polite">
                  <div class="text-primary px-3 py-1.5 rounded-md bg-primary/8 flex gap-2 items-baseline">
                    <dt class="qs-type-body-medium">
                      {{ t('containerImport.summary.toImport') }}
                    </dt>
                    <dd class="m-0 flex gap-1 items-baseline">
                      <span class="qs-type-data-emphasis">{{ importCount }}</span>
                      <span class="qs-type-meta">{{ t('containerImport.summary.unit') }}</span>
                    </dd>
                  </div>
                  <div v-for="item in summaryItems" :key="item.key" class="flex gap-2 items-baseline">
                    <dt class="qs-type-meta text-muted-foreground">
                      {{ item.label }}
                    </dt>
                    <dd class="qs-type-data m-0">
                      {{ item.count }}
                    </dd>
                  </div>
                </dl>
              </div>
              <div class="gap-3 grid grid-cols-2 md:flex md:shrink-0">
                <FaButton variant="outline" :disabled="locked" @click="back">
                  {{ t('containerImport.cancel') }}
                </FaButton><FaButton :loading="submitting" :disabled="submitting || (!canSubmit && !retryOnly)" @click="submit">
                  {{ t(retryOnly ? 'containerImport.retryConfirm' : 'containerImport.confirm') }}
                </FaButton>
              </div>
            </div>
          </div>
        </FaFixedBar>
      </template>
      <ShipmentMatchDrawer v-model="drawerOpen" :row="selectedRow" :warehouse-value="preview.warehouseValue" :batch-id="preview.containerBatchId" :enabled="enabled" :disabled="locked" @select="state.select" />
    </template>
    <QsGenericModal :model-value="leaveOpen" size="sm" :title="t('containerImport.leaveTitle')" :description="t('containerImport.leaveHint')" @update:model-value="!$event && finishLeave(false)">
      <template #footer>
        <FaButton variant="outline" @click="finishLeave(false)">
          {{ t('containerImport.stay') }}
        </FaButton><FaButton @click="finishLeave(true)">
          {{ t('containerImport.leave') }}
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
