<script setup lang="ts">
import type { LoadingItemSubmission } from './form.logic'
import type { ContainerBatchCreateDto, ContainerBatchDto, ContainerLoadingItemDto, PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import containerApi from '@/api/modules/container-batches'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import ContainerFormModal from './container-form-modal.vue'
import ContainerItemTable from './container-item-table.vue'
import ContainerRelatedDrawers from './container-related-drawers.vue'
import ContainerRemark from './container-remark.vue'
import ContainerSourceFile from './container-source-file.vue'
import { formatContainerMeasurement } from './display.logic'
import LoadingItemFormModal from './loading-item-form-modal.vue'
import ShipmentPicker from './shipment-picker.vue'
import { useContainerMutation } from './use-container-mutation'
import { containerFailure, useContainerResource } from './use-container-resource'

defineOptions({ name: 'QsPurchaseTransportContainerDetail' })
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const warehouse = useDictionaryCatalog('mainland.warehouse')
const instanceId = String(route.params.id)
const active = ref(true)
onActivated(() => {
  active.value = true
  void reload()
})
onDeactivated(() => {
  active.value = false
})
const enabled = computed(() => active.value && route.name === 'qsPurchaseTransportContainerDetail' && String(route.params.id) === instanceId && auth('container-batches:read'))
const canEdit = computed(() => enabled.value && auth('container-batches:update'))
const epoch = computed(() => account.authEpoch)
const resource = useContainerResource(enabled, epoch, ref(instanceId), async signal => (await containerApi.get(instanceId, signal)).data)
const { data: batch, loading, error } = resource
const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const query = computed(() => ({ page: page.value, pageSize: pageSize.value, search: search.value || undefined }))
const itemResource = useContainerResource(enabled, epoch, query, async signal => (await containerApi.items(instanceId, query.value, signal)).data)
const { data: itemData, loading: itemsLoading, error: itemsError } = itemResource
const batchOpen = ref(false)
const itemOpen = ref(false)
const pickerOpen = ref(false)
const editingBatch = shallowRef<ContainerBatchDto | null>(null)
const editingItem = shallowRef<ContainerLoadingItemDto | null>(null)
const selectedShipment = shallowRef<PurchaseShipmentListItemDto | null>(null)
const batchMutation = useContainerMutation(canEdit, epoch, async (payload: {
  body: ContainerBatchCreateDto
  version: number
}, _key, signal) => (await containerApi.update(instanceId, { ...payload.body, expectedVersion: payload.version }, signal)).data)
const itemMutation = useContainerMutation(canEdit, epoch, async (payload: {
  body: LoadingItemSubmission
  version: number
  itemId: string | null
  itemVersion: number | null
}, key, signal) => {
  const data = { ...payload.body, expectedVersion: payload.version }
  return (payload.itemId
    ? await containerApi.updateItem(instanceId, payload.itemId, { ...data, itemExpectedVersion: payload.itemVersion! }, signal)
    : await containerApi.createItem(instanceId, data, key, signal)).data
})
const sourceUploading = ref(false)
const sourceSaving = ref(false)
const sourceError = ref('')
let sourceController: AbortController | null = null
const referenceKind = ref<'shipment' | 'purchase' | 'sales' | null>(null)
const referenceId = ref('')
const warehouseLabel = computed(() => {
  if (warehouse.loading.value) {
    return t('containerPage.warehouseLoading')
  }
  if (warehouse.error.value || warehouse.missing.value) {
    return t('containerPage.warehouseUnavailable')
  }
  const resolved = batch.value ? warehouse.resolve(batch.value.warehouseValue) : null
  return resolved && resolved.status !== 'UNKNOWN' ? resolved.displayLabel : t('containerPage.warehouseUnknown')
})
const summary = computed(() => batch.value
  ? [
      { label: 'itemCount', amount: batch.value.itemCount, unit: '' },
      { label: 'shipmentCount', amount: batch.value.shipmentCount, unit: '' },
      { label: 'totalWeightLabel', amount: formatContainerMeasurement(batch.value.grossWeightKgTotal, 0), unit: 'kg' },
      { label: 'totalVolumeLabel', amount: formatContainerMeasurement(batch.value.volumeCaiTotal, 2), unit: t('containerManagement.volumeUnit') },
    ] as const
  : [])
async function reload() {
  await Promise.all([resource.reload(), itemResource.reload()])
}
function openBatch() {
  if (!canEdit.value || !batch.value || sourceUploading.value || sourceSaving.value) {
    return
  }
  if (!batchMutation.retryOnly.value) {
    editingBatch.value = { ...batch.value }
  }
  batchMutation.resetFeedback()
  batchOpen.value = true
}
function openItem(item: ContainerLoadingItemDto | null = null) {
  if (!canEdit.value || !batch.value || sourceUploading.value || sourceSaving.value || item?.isBilled) {
    return
  }
  if (!itemMutation.retryOnly.value) {
    editingItem.value = item ? { ...item } : null
    selectedShipment.value = null
  }
  pickerOpen.value = false
  itemMutation.resetFeedback()
  itemOpen.value = true
}
function chooseShipment(shipment: PurchaseShipmentListItemDto) {
  selectedShipment.value = { ...shipment }
  pickerOpen.value = false
}
async function saveBatch(body: ContainerBatchCreateDto) {
  if (!editingBatch.value) {
    return
  }
  const saved = await batchMutation.submit({ body, version: editingBatch.value.version })
  if (saved) {
    batchOpen.value = false
    toast.success(t('containerPage.saved'))
    await reload()
  }
  else if (batchMutation.conflict.value) {
    batchMutation.error.value = `${batchMutation.error.value} ${t('containerPage.conflict')}`
    await reload()
  }
}
async function saveItem(body: LoadingItemSubmission) {
  if (!batch.value) {
    return
  }
  const saved = await itemMutation.submit({ body, version: batch.value.version, itemId: editingItem.value?.id ?? null, itemVersion: editingItem.value?.version ?? null })
  if (saved) {
    itemOpen.value = false
    toast.success(t(editingItem.value ? 'containerPage.saved' : 'containerPage.added'))
    await reload()
  }
  else if (itemMutation.conflict.value) {
    itemMutation.error.value = `${itemMutation.error.value} ${t('containerPage.conflict')}`
    await reload()
  }
}
async function attachSource(mediaAssetId: string) {
  if (!canEdit.value || !batch.value || sourceSaving.value) {
    return
  }
  sourceSaving.value = true
  sourceError.value = ''
  const identity = epoch.value
  const controller = new AbortController()
  sourceController = controller
  try {
    const current = (await containerApi.get(instanceId, controller.signal)).data
    if (current.sourceFileId !== mediaAssetId) {
      await containerApi.update(instanceId, { containerBatchName: current.containerBatchName, warehouseValue: current.warehouseValue, remark: current.remark, sourceFileId: mediaAssetId, expectedVersion: current.version }, controller.signal)
    }
    if (enabled.value && identity === epoch.value) {
      toast.success(t('containerPage.sourceSaved'))
      await resource.reload()
    }
  }
  catch (failure) {
    if (!controller.signal.aborted && identity === epoch.value) {
      sourceError.value = containerFailure(failure).message
    }
  }
  finally {
    if (sourceController === controller) {
      sourceSaving.value = false
    }
  }
}
function reference(kind: 'shipment' | 'purchase' | 'sales', id: string) {
  referenceId.value = id
  referenceKind.value = kind
}
watch([enabled, epoch], () => {
  batchOpen.value = false
  itemOpen.value = false
  referenceKind.value = null
  sourceController?.abort()
  sourceSaving.value = false
  sourceError.value = ''
})
onScopeDispose(() => sourceController?.abort())
watch(itemData, (result) => {
  if (result && !result.items.length && page.value > 1) {
    page.value = Math.max(1, Math.ceil(result.total / pageSize.value))
  }
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader main-class="min-w-0" default-class="w-full min-w-0 sm:w-auto" :title="batch ? `${batch.containerBatchName} · ${t('containerPage.detail')}` : t('containerPage.detail')" :description="batch?.containerBatchNo ?? t('containerPage.shipmentHint')">
      <template #description>
        <span :class="batch ? 'qs-type-data' : 'qs-type-description'">{{ batch?.containerBatchNo ?? t('containerPage.shipmentHint') }}</span>
      </template>
      <FaButton variant="outline" class="w-full sm:w-auto" @click="router.push({ name: 'qsPurchaseTransportContainers' })">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('containerPage.back') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain v-if="!enabled">
      <FaEmpty :title="t('containerPage.noAccess')" />
    </FaPageMain>
    <template v-else>
      <FaPageMain v-if="error">
        <FaAlert variant="destructive" :title="error" /><FaButton variant="outline" class="mt-4" @click="reload">
          {{ t('containerPage.retry') }}
        </FaButton>
      </FaPageMain>
      <FaPageMain v-else-if="loading && !batch">
        <div role="status" class="space-y-4">
          <span class="sr-only">{{ t('containerPage.loading') }}</span><div v-for="n in 3" :key="n" class="rounded-lg bg-muted h-10 animate-pulse motion-reduce:animate-none" />
        </div>
      </FaPageMain>
      <FaPageMain v-else-if="batch">
        <div class="gap-5 grid xl:gap-8 lg:grid-cols-2">
          <section class="min-w-0" :aria-label="t('containerPage.basicInfo')">
            <div class="mb-4 flex flex-wrap gap-3 min-h-8 items-center justify-between">
              <h2 class="qs-type-component-title m-0 flex gap-2 items-center">
                <FaIcon name="i-lucide:container" class="text-muted-foreground size-4" aria-hidden="true" />
                {{ t('containerPage.basicInfo') }}
              </h2>
              <FaButton v-if="canEdit" variant="ghost" size="sm" :disabled="sourceSaving || sourceUploading" @click="openBatch">
                <FaIcon name="i-lucide:pencil" class="size-3.5" aria-hidden="true" />{{ t('containerPage.edit') }}
              </FaButton>
            </div>
            <dl class="m-0 gap-4 grid sm:grid-cols-[8rem_minmax(0,1fr)]">
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('containerPage.date') }}
                </dt>
                <dd class="qs-type-data m-0 mt-1.5">
                  {{ batch.loadingDate }}
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('containerPage.warehouse') }}
                </dt>
                <dd class="qs-type-body m-0 mt-1.5 [overflow-wrap:anywhere]">
                  {{ warehouseLabel }}
                </dd>
              </div>
            </dl>
            <div v-if="warehouse.error.value || warehouse.missing.value" class="qs-type-meta text-destructive mt-3 flex flex-wrap gap-2 items-center" role="alert">
              <span>{{ t('containerPage.warehouseCatalogError') }}</span>
              <FaButton variant="ghost" size="sm" :disabled="warehouse.loading.value" @click="warehouse.retry">
                {{ t('containerPage.retry') }}
              </FaButton>
            </div>
            <div v-if="batch.remark" class="mt-4 flex gap-3 items-baseline">
              <span class="qs-type-meta text-muted-foreground shrink-0">{{ t('containerPage.remark') }}</span>
              <ContainerRemark :text="batch.remark" mobile class="flex-1" />
            </div>
          </section>
          <section class="pt-4 border-t border-border min-w-0 lg:pl-6 lg:pt-0 xl:pl-8 lg:border-l lg:border-t-0" :aria-label="t('containerPage.loadSummary')">
            <h2 class="qs-type-component-title m-0 mb-4 flex gap-2 min-h-8 items-center">
              <FaIcon name="i-lucide:weight" class="text-muted-foreground size-4" aria-hidden="true" />
              {{ t('containerPage.loadSummary') }}
            </h2>
            <dl class="m-0 gap-x-5 gap-y-4 grid grid-cols-2 xl:grid-cols-4">
              <div v-for="item in summary" :key="item.label" class="min-w-0">
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t(`containerPage.${item.label}`) }}
                </dt>
                <dd class="qs-type-data-emphasis m-0 mt-1.5 [overflow-wrap:anywhere]">
                  {{ item.amount ?? t('containerPage.unknown') }}<span v-if="item.amount !== null && item.unit" class="qs-type-meta text-muted-foreground ml-1">{{ item.unit }}</span>
                </dd>
              </div>
            </dl>
            <p class="qs-type-meta text-muted-foreground m-0 mt-3">
              {{ t('containerPage.totalHint') }}
            </p>
          </section>
        </div>
        <div class="mt-4 pt-4 border-t border-border">
          <ContainerSourceFile :batch-id="instanceId" :source-file-id="batch.sourceFileId" :can-edit="canEdit" :loading="sourceSaving" :disabled="batchMutation.submitting.value || itemMutation.submitting.value" @uploaded="attachSource" @busy-change="sourceUploading = $event" />
          <FaAlert v-if="sourceError" class="mt-3" variant="destructive" :title="sourceError" />
        </div>
      </FaPageMain>
      <FaPageMain v-if="batch">
        <div class="mb-5 flex flex-wrap gap-3 items-center justify-between">
          <div class="min-w-0">
            <h2 class="qs-type-section-title m-0 flex flex-wrap gap-2 items-center">
              {{ t('containerPage.items') }}
            </h2>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1.5">
              {{ t('containerPage.shipmentHint') }}
            </p>
          </div>
          <FaButton v-if="canEdit" class="w-full sm:w-auto" :disabled="sourceSaving || sourceUploading" @click="openItem()">
            <FaIcon name="i-lucide:plus" aria-hidden="true" />{{ t('containerPage.addItem') }}
          </FaButton>
        </div>
        <ContainerItemTable v-model:page="page" v-model:page-size="pageSize" v-model:search="search" :rows="itemData?.items ?? []" :total="itemData?.total ?? 0" :loading="itemsLoading" :error="itemsError" :can-edit="canEdit && !sourceUploading && !sourceSaving" @edit="openItem" @reference="reference" @retry="itemResource.reload" />
      </FaPageMain>
    </template>
    <ContainerFormModal v-model="batchOpen" :batch="editingBatch" :submitting="batchMutation.submitting.value" :retry-only="batchMutation.retryOnly.value" :error="batchMutation.error.value" :field-errors="batchMutation.fieldErrors.value" @submit="saveBatch" />
    <LoadingItemFormModal v-model="itemOpen" :item="editingItem" :shipment="selectedShipment" :submitting="itemMutation.submitting.value" :retry-only="itemMutation.retryOnly.value" :error="itemMutation.error.value" :field-errors="itemMutation.fieldErrors.value" @submit="saveItem" @select-shipment="pickerOpen = true">
      <template #shipment-picker>
        <ShipmentPicker v-if="pickerOpen && batch" :warehouse-value="batch.warehouseValue" :disabled="itemMutation.submitting.value || itemMutation.retryOnly.value" @select="chooseShipment" @close="pickerOpen = false" />
      </template>
    </LoadingItemFormModal>
    <ContainerRelatedDrawers :id="referenceId" :enabled="enabled" :kind="referenceKind" @close="referenceKind = null" @purchase="reference('purchase', $event)" />
  </div>
</template>
