<script setup lang="ts">
import type { ContainerBatchCreateDto, ContainerBatchDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn, QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'
import containerApi from '@/api/modules/container-batches'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import ContainerFormModal from './container-form-modal.vue'
import { useContainerMutation } from './use-container-mutation'
import { useContainerResource } from './use-container-resource'

defineOptions({ name: 'QsPurchaseTransportContainers' })
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const warehouse = useDictionaryCatalog('mainland.warehouse')
const active = ref(true)
const enabled = computed(() => active.value && route.name === 'qsPurchaseTransportContainers' && auth('container-batches:read'))
const epoch = computed(() => account.authEpoch)
const canCreate = computed(() => enabled.value && auth('container-batches:create'))
const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const query = computed(() => ({ page: page.value, pageSize: pageSize.value, search: search.value || undefined, warehouseValue: typeof filters.value.warehouseValue === 'string' ? filters.value.warehouseValue : undefined }))
const resource = useContainerResource(enabled, epoch, query, async signal => (await containerApi.list(query.value, signal)).data)
const { data, loading, error } = resource
const open = ref(false)
const mutation = useContainerMutation(canCreate, epoch, async (payload: ContainerBatchCreateDto, key, signal) => (await containerApi.create(payload, key, signal)).data)
const { submitting, retryOnly, error: saveError, fieldErrors } = mutation
const filterDefinitions = computed(() => [{ key: 'warehouseValue', label: t('containerPage.warehouse'), options: (warehouse.catalog.value?.items ?? []).map(item => ({ value: item.value, label: item.label })) }])
const label = (value: string) => warehouse.resolve(value)?.label ?? value
const columns = computed<QsGenericTableColumn<ContainerBatchDto>[]>(() => {
  const labels = new Map((warehouse.catalog.value?.items ?? []).map(item => [item.value, item.label]))
  return [
    { id: 'containerBatchName', title: t('containerPage.name'), accessorKey: 'containerBatchName', minWidth: 160, fixed: 'left' },
    { id: 'containerBatchNo', title: t('containerPage.number'), accessorKey: 'containerBatchNo', minWidth: 245, copyable: true, cellClass: 'qs-type-data-emphasis' },
    { id: 'loadingDate', title: t('containerPage.date'), accessorKey: 'loadingDate', minWidth: 140, cellClass: 'qs-type-data' },
    { id: 'warehouse', title: t('containerPage.warehouse'), accessorFn: row => labels.get(row.warehouseValue) ?? row.warehouseValue, minWidth: 280 },
    { id: 'itemCount', title: t('containerPage.itemCount'), accessorKey: 'itemCount', minWidth: 100, cellClass: 'qs-type-data', align: 'right' },
    { id: 'shipmentCount', title: t('containerPage.shipmentCount'), accessorKey: 'shipmentCount', minWidth: 100, cellClass: 'qs-type-data', align: 'right' },
    { id: 'packageCountTotal', title: t('containerPage.packageCount'), accessorKey: 'packageCountTotal', minWidth: 100, cellClass: 'qs-type-data', align: 'right' },
    { id: 'grossWeightKgTotal', title: t('containerPage.totalWeight'), accessorFn: row => row.grossWeightKgTotal ?? t('containerPage.unknown'), minWidth: 160, defaultVisible: false, cellClass: 'qs-type-data', align: 'right' },
    { id: 'volumeCaiTotal', title: t('containerPage.totalVolume'), accessorFn: row => row.volumeCaiTotal ?? t('containerPage.unknown'), minWidth: 180, defaultVisible: false, cellClass: 'qs-type-data', align: 'right' },
    { id: 'chargeableVolumeCaiTotal', title: t('containerPage.totalChargeable'), accessorFn: row => row.chargeableVolumeCaiTotal ?? t('containerPage.unknown'), minWidth: 140, defaultVisible: false, cellClass: 'qs-type-data', align: 'right' },
    { id: 'remark', title: t('containerPage.remark'), accessorKey: 'remark', minWidth: 220, defaultVisible: false },
  ]
})
async function create(payload: ContainerBatchCreateDto) {
  const created = await mutation.submit(payload)
  if (!created) {
    return
  }
  open.value = false
  toast.success(t('containerPage.created'))
  await router.push({ name: 'qsPurchaseTransportContainerDetail', params: { id: created.id } })
}
watch([enabled, epoch], () => {
  open.value = false
})
watch(data, (result) => {
  if (result && !result.items.length && page.value > 1) {
    page.value = Math.max(1, Math.ceil(result.total / pageSize.value))
  }
})
onActivated(() => {
  active.value = true
  void resource.reload()
})
onDeactivated(() => {
  active.value = false
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('containerPage.title')" :description="t('containerPage.description')">
      <FaButton v-if="canCreate" @click="mutation.resetFeedback(); open = true">
        <FaIcon name="i-lucide:plus" aria-hidden="true" />{{ t('containerPage.create') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain>
      <FaEmpty v-if="!enabled" :title="t('containerPage.noAccess')" />
      <QsGenericTable v-else v-model:page="page" v-model:page-size="pageSize" v-model:search="search" v-model:filters="filters" row-key="id" :data="data?.items ?? []" :total="data?.total ?? 0" :columns="columns" :loading="loading" :error="error" :addable="false" :show-row-number="false" :page-size-options="[20, 50, 100]" :filter-definitions="filterDefinitions" :search-placeholder="t('containerPage.search')" :empty-title="t('containerPage.empty')" :empty-description="t('containerPage.emptyDescription')" @retry="resource.reload">
        <template #cell-containerBatchName="{ row }">
          <FaButton variant="link" class="px-0" @click="router.push({ name: 'qsPurchaseTransportContainerDetail', params: { id: row.original.id } })">
            {{ row.original.containerBatchName }}
          </FaButton>
        </template>
        <template #mobile-row="{ row }">
          <div class="min-w-0 [overflow-wrap:anywhere] space-y-2">
            <div class="flex gap-3 items-center justify-between">
              <strong>{{ row.containerBatchName }}</strong><span class="qs-type-data">{{ row.loadingDate }}</span>
            </div>
            <div class="qs-type-data-emphasis">
              {{ row.containerBatchNo }}
            </div><p class="text-muted-foreground">
              {{ label(row.warehouseValue) }}
            </p>
            <div class="text-muted-foreground flex flex-wrap gap-4">
              <span>{{ t('containerPage.itemCount') }} {{ row.itemCount }}</span><span>{{ t('containerPage.packageCount') }} {{ row.packageCountTotal }}</span>
            </div>
          </div>
        </template>
        <template #actions="{ row }">
          <FaButton variant="outline" size="sm" @click="router.push({ name: 'qsPurchaseTransportContainerDetail', params: { id: row.id } })">
            {{ t('containerPage.view') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </FaPageMain>
    <ContainerFormModal v-model="open" :submitting="submitting" :retry-only="retryOnly" :error="saveError" :field-errors="fieldErrors" @submit="create" />
  </div>
</template>
