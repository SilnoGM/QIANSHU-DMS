<script setup lang="ts">
import type { LoadingItemSubmission } from './form.logic'
import type { ContainerBatchCreateDto, ContainerBatchDto, ContainerLoadingItemDto, PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import containerApi from '@/api/modules/container-batches'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import ContainerFormModal from './container-form-modal.vue'
import ContainerItemTable from './container-item-table.vue'
import ContainerRelatedDrawers from './container-related-drawers.vue'
import ContainerSourceFile from './container-source-file.vue'
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
const warehouseLabel = computed(() => batch.value ? warehouse.resolve(batch.value.warehouseValue)?.label ?? batch.value.warehouseValue : '')
const summary = computed(() => batch.value
  ? [
      ['itemCount', batch.value.itemCount],
      ['shipmentCount', batch.value.shipmentCount],
      ['packageCount', batch.value.packageCountTotal],
      ['totalWeight', batch.value.grossWeightKgTotal],
      ['totalVolume', batch.value.volumeCaiTotal],
      ['totalChargeable', batch.value.chargeableVolumeCaiTotal],
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
      <div class="flex flex-wrap gap-2">
        <FaButton variant="outline" @click="router.push({ name: 'qsPurchaseTransportContainers' })">
          <FaIcon name="i-lucide:arrow-left" />{{ t('containerPage.back') }}
        </FaButton>
        <FaButton v-if="canEdit && batch" variant="outline" :disabled="sourceSaving || sourceUploading" @click="openBatch">
          {{ t('containerPage.edit') }}
        </FaButton>
        <FaButton v-if="canEdit && batch" :disabled="sourceSaving || sourceUploading" @click="openItem()">
          <FaIcon name="i-lucide:plus" />{{ t('containerPage.addItem') }}
        </FaButton>
      </div>
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
        <dl class="gap-5 grid sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('containerPage.name') }}
            </dt><dd class="font-medium mt-2 [overflow-wrap:anywhere]">
              {{ batch.containerBatchName }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('containerPage.date') }}
            </dt><dd class="qs-type-data mt-2">
              {{ batch.loadingDate }}
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('containerPage.warehouse') }}
            </dt><dd class="mt-2 [overflow-wrap:anywhere]">
              {{ warehouseLabel }}
            </dd>
          </div>
        </dl>
        <div class="mt-5 pt-5 border-t border-border gap-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <div v-for="[label, amount] in summary" :key="label">
            <div class="qs-type-meta text-muted-foreground">
              {{ t(`containerPage.${label}`) }}
            </div><div class="qs-type-data-emphasis mt-2 [overflow-wrap:anywhere]">
              {{ amount ?? t('containerPage.unknown') }}
            </div>
          </div>
        </div>
        <p class="qs-type-meta text-muted-foreground mt-3">
          {{ t('containerPage.totalHint') }}
        </p>
        <p v-if="batch.remark" class="mt-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {{ batch.remark }}
        </p>
        <div class="mt-5 pt-5 border-t border-border">
          <ContainerSourceFile :batch-id="instanceId" :source-file-id="batch.sourceFileId" :can-edit="canEdit" :loading="sourceSaving" :disabled="batchMutation.submitting.value || itemMutation.submitting.value" @uploaded="attachSource" @busy-change="sourceUploading = $event" /><FaAlert v-if="sourceError" class="mt-3" variant="destructive" :title="sourceError" />
        </div>
      </FaPageMain>
      <FaPageMain v-if="batch">
        <div class="mb-5">
          <h2 class="qs-type-section-title">
            {{ t('containerPage.items') }}
          </h2><p class="qs-type-description text-muted-foreground mt-2">
            {{ t('containerPage.shipmentHint') }}
          </p>
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
