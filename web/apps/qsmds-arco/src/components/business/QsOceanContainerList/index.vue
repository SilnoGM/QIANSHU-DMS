<script setup lang="ts">
import type { OceanContainerItemsRequest, OceanContainerLine, OceanContainerListProps } from './types'
import OceanContainerCard from './OceanContainerCard.vue'
import { useOceanContainerList } from './use-ocean-container-list'

defineOptions({ name: 'QsOceanContainerList' })
const props = withDefaults(defineProps<OceanContainerListProps>(), { page: 1, pageSize: 10, loading: false, error: null })
const emit = defineEmits<{
  requestItems: [request: OceanContainerItemsRequest]
  pageChange: [page: { page: number, pageSize: number }]
  retry: []
  viewLine: [value: { containerId: string, line: OceanContainerLine }]
}>()
const expandedIds = defineModel<string[]>('expandedIds', { default: () => [] })
const { t } = useI18n()
const state = useOceanContainerList(computed(() => props.items), computed(() => props.details), expandedIds, computed(() => props.loading || Boolean(props.error)), value => emit('requestItems', value))
function changePage(page: number, pageSize = props.pageSize) {
  if (!props.loading && !props.error && (page !== props.page || pageSize !== props.pageSize)) {
    emit('pageChange', { page, pageSize })
  }
}
</script>

<template>
  <section :aria-label="t('qsOceanContainer.list')" :aria-busy="loading" class="min-w-0">
    <div v-if="loading" role="status" class="flex flex-col gap-4">
      <span class="qs-type-description text-muted-foreground">{{ t('qsOceanContainer.loading') }}</span>
      <div v-for="index in 3" :key="index" aria-hidden="true" class="p-5 border border-border rounded-xl bg-card flex flex-col gap-4 motion-safe:animate-pulse">
        <div class="rounded bg-muted h-5 w-36" />
        <div class="rounded bg-muted h-4 max-w-full w-96" />
        <div class="rounded bg-muted h-4 w-2/3" />
      </div>
    </div>
    <div v-else-if="error" class="py-10 flex flex-col gap-4 items-center">
      <FaEmpty icon="i-lucide:circle-alert" :title="t('qsOceanContainer.error')" :description="error" />
      <FaButton variant="outline" @click="emit('retry')">
        {{ t('qsOceanContainer.retry') }}
      </FaButton>
    </div>
    <FaEmpty v-else-if="!items.length" icon="i-lucide:container" :title="t('qsOceanContainer.empty')" :description="t('qsOceanContainer.emptyHint')" class="py-12" />
    <template v-else>
      <div class="flex flex-col gap-4">
        <OceanContainerCard
          v-for="item in items" :key="item.id"
          :item="item" :detail="details[item.id]" :currencies="currencies"
          :expanded="expandedIds.includes(item.id)"
          @toggle="state.toggle(item.id, $event)" @retry="state.retry(item.id)" @page-change="state.paginate(item.id, $event)"
          @view-line="emit('viewLine', { containerId: item.id, line: $event })"
        />
      </div>
      <nav v-if="total > 0" :aria-label="t('qsOceanContainer.pagination')" class="mt-5 overflow-x-auto">
        <FaPagination
          :page="page" :size="pageSize" :total="total" :sizes="[10, 20, 50]" layout="total, sizes, ->, pager"
          :text-templates="{ total: value => t('qsOceanContainer.totalContainers', { count: value }), sizes: value => t('qsOceanContainer.containerPageSize', { count: value }) }"
          @update:page="changePage($event)" @update:size="changePage(1, $event)"
        />
      </nav>
    </template>
  </section>
</template>
