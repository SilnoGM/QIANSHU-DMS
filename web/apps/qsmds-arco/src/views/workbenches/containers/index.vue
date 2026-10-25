<script setup lang="ts">
import type { ContainerSubmission } from './form.logic'
import type { ContainerBatchDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn, QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'
import containerApi from '@/api/modules/container-batches'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import ContainerFormModal from './container-form-modal.vue'
import ContainerRemark from './container-remark.vue'
import { formatContainerMeasurement } from './display.logic'
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
// 保活标记；当前没有任何路由声明 keepAlive，因此恒为 true，详见下方 onActivated 的说明。
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
const mutation = useContainerMutation(canCreate, epoch, async (payload: ContainerSubmission, key, signal) => {
  if (!payload.sourceFileId) {
    throw new Error(t('containerManagement.sourceRequired'))
  }
  return (await containerApi.create({ ...payload, sourceFileId: payload.sourceFileId }, key, signal)).data
})
const { submitting, retryOnly, error: saveError, fieldErrors } = mutation
const filterDefinitions = computed(() => [{ key: 'warehouseValue', label: t('containerPage.warehouse'), options: (warehouse.catalog.value?.items ?? []).map(item => ({ value: item.value, label: item.label })) }])
function warehouseLabel(value: string) {
  if (warehouse.loading.value) {
    return t('containerPage.warehouseLoading')
  }
  if (warehouse.error.value || warehouse.missing.value) {
    return t('containerPage.warehouseUnavailable')
  }
  const resolved = warehouse.resolve(value)
  return resolved && resolved.status !== 'UNKNOWN' ? resolved.displayLabel : t('containerPage.warehouseUnknown')
}
function measurement(value: string | null, places: 0 | 2, unit: string) {
  const formatted = formatContainerMeasurement(value, places)
  return formatted === null ? t('containerPage.unknown') : `${formatted} ${unit}`
}
function quantities(row: ContainerBatchDto) {
  return [
    { label: 'itemCount', value: row.itemCount },
    { label: 'shipmentCount', value: row.shipmentCount },
  ]
}
function totals(row: ContainerBatchDto) {
  return [
    { label: 'totalWeightLabel', value: measurement(row.grossWeightKgTotal, 0, 'kg') },
    { label: 'totalVolumeLabel', value: measurement(row.volumeCaiTotal, 2, t('containerManagement.volumeUnit')) },
  ]
}
const columns = computed<QsGenericTableColumn<ContainerBatchDto>[]>(() => [
  { id: 'containerBatchNo', title: t('containerPage.number'), accessorKey: 'containerBatchNo', width: 126, minWidth: 126, maxWidth: 126, fixed: 'left', cellClass: 'qs-type-data-emphasis whitespace-nowrap' },
  { id: 'containerBatchName', title: t('containerPage.name'), accessorKey: 'containerBatchName', width: 160, minWidth: 140 },
  { id: 'loadingDate', title: t('containerPage.date'), accessorKey: 'loadingDate', width: 132, minWidth: 132, cellClass: 'qs-type-data' },
  { id: 'warehouse', title: t('containerPage.warehouse'), accessorFn: row => warehouseLabel(row.warehouseValue), width: 275, minWidth: 220 },
  { id: 'quantities', title: t('containerPage.quantityInfo'), accessorFn: row => quantities(row).map(item => item.value).join(' '), width: 150, minWidth: 150 },
  { id: 'totals', title: t('containerPage.loadSummary'), accessorFn: row => totals(row).map(item => item.value).join(' '), width: 190, minWidth: 190 },
  { id: 'remark', title: t('containerPage.remark'), accessorKey: 'remark', width: 220, minWidth: 220, maxWidth: 220 },
])
function viewBatch(id: string) {
  void router.push({ name: 'qsPurchaseTransportContainerDetail', params: { id } })
}
async function create(payload: ContainerSubmission) {
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
// 本页当前没有开启 keepAlive（guards.ts 只在 meta.keepAlive 为真时才把组件加入保活名单），
// 所以这两个钩子不会触发、active 恒为 true，每次进入都是重新挂载，加载由 useContainerResource 的
// immediate watcher 承担。将来为本路由开启保活时须注意：active 翻转已足以让 enabled 变化触发 watcher
// 重新加载，下面这句 reload() 会变成先发一次、随即被 watcher 取消的无效请求，届时应予删除。
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
      <template v-else>
        <div v-if="warehouse.error.value || warehouse.missing.value" class="mb-4 flex flex-wrap gap-2 items-center">
          <FaAlert class="flex-1" variant="destructive" :title="t('containerPage.warehouseCatalogError')" />
          <FaButton size="sm" variant="outline" :disabled="warehouse.loading.value" @click="warehouse.retry">
            {{ t('containerPage.retry') }}
          </FaButton>
        </div>
        <QsGenericTable
          v-model:page="page" v-model:page-size="pageSize" v-model:search="search" v-model:filters="filters"
          row-key="id" :data="data?.items ?? []" :total="data?.total ?? 0" :columns="columns"
          :loading="loading" :error="error" :addable="false" :show-row-number="false"
          :page-size-options="[20, 50, 100]" :filter-definitions="filterDefinitions"
          :search-placeholder="t('containerPage.search')" :empty-title="t('containerPage.empty')"
          :empty-description="t('containerPage.emptyDescription')" :action-column="{ width: 84, minWidth: 84 }"
          table-class="w-max min-w-full" @retry="resource.reload"
        >
          <template #cell-containerBatchName="{ row }">
            <FaButton variant="link" size="sm" class="px-0" @click="viewBatch(row.original.id)">
              {{ row.original.containerBatchName }}
            </FaButton>
          </template>
          <template #cell-warehouse="{ row }">
            <!-- 字典异步回填直接参与单元格渲染，避免行 accessor 缓存早到的仓库稳定值。 -->
            <span class="max-w-64 block whitespace-normal [overflow-wrap:anywhere]" :class="(warehouse.loading.value || warehouse.error.value || warehouse.missing.value) && 'text-muted-foreground'">
              {{ warehouseLabel(row.original.warehouseValue) }}
            </span>
          </template>
          <template #cell-quantities="{ row }">
            <QsTableStackedCell class="w-full">
              <QsTableStackedLine v-for="item in quantities(row.original)" :key="item.label" :label="t(`containerPage.${item.label}`)" label-class="text-muted-foreground" content-class="qs-type-data ml-auto" nowrap>
                {{ item.value }}
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <template #cell-totals="{ row }">
            <QsTableStackedCell class="w-full">
              <QsTableStackedLine v-for="item in totals(row.original)" :key="item.label" :label="t(`containerPage.${item.label}`)" label-class="text-muted-foreground" content-class="qs-type-data ml-auto" nowrap>
                {{ item.value }}
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <template #cell-remark="{ row }">
            <ContainerRemark :text="row.original.remark" />
          </template>
          <template #mobile-row="{ row }">
            <div class="min-w-0 [overflow-wrap:anywhere] space-y-3">
              <QsTableStackedCell class="w-full">
                <QsTableStackedLine content-class="qs-type-data-emphasis">
                  {{ row.containerBatchNo }}
                </QsTableStackedLine>
                <QsTableStackedLine>
                  <FaButton variant="link" size="sm" class="px-0 min-h-11" @click="viewBatch(row.id)">
                    {{ row.containerBatchName }}
                  </FaButton>
                </QsTableStackedLine>
              </QsTableStackedCell>
              <dl class="space-y-2">
                <div class="flex gap-3 items-baseline">
                  <dt class="qs-type-meta text-muted-foreground shrink-0">
                    {{ t('containerPage.date') }}
                  </dt><dd class="qs-type-data">
                    {{ row.loadingDate }}
                  </dd>
                </div>
                <div class="flex gap-3 items-baseline">
                  <dt class="qs-type-meta text-muted-foreground shrink-0">
                    {{ t('containerPage.warehouse') }}
                  </dt><dd>
                    {{ warehouseLabel(row.warehouseValue) }}
                  </dd>
                </div>
              </dl>
              <dl class="pt-3 border-t border-border gap-x-4 gap-y-3 grid grid-cols-2">
                <div v-for="item in [...quantities(row), ...totals(row)]" :key="item.label">
                  <dt class="qs-type-meta text-muted-foreground">
                    {{ t(`containerPage.${item.label}`) }}
                  </dt><dd class="qs-type-data mt-1">
                    {{ item.value }}
                  </dd>
                </div>
              </dl>
              <div class="pt-3 border-t border-border space-y-1">
                <div class="qs-type-meta text-muted-foreground">
                  {{ t('containerPage.remark') }}
                </div>
                <ContainerRemark :text="row.remark" mobile />
              </div>
            </div>
          </template>
          <template #actions="{ row }">
            <FaButton variant="ghost" size="sm" class="min-h-11 sm:min-h-8" @click="viewBatch(row.id)">
              详情
            </FaButton>
          </template>
        </QsGenericTable>
      </template>
    </FaPageMain>
    <ContainerFormModal v-model="open" :submitting="submitting" :retry-only="retryOnly" :error="saveError" :field-errors="fieldErrors" @submit="create" />
  </div>
</template>
