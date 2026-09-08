<script setup lang="ts">
import type { ShippingMarkBindingDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn, QsGenericTableFilterDefinition } from '@/components/business/QsGenericTable/logic'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import ShippingMarkBindingEditor from './shipping-mark-binding-editor.vue'
import { useShippingMarkBindings } from './use-shipping-mark-bindings'

defineOptions({ name: 'SystemBasicDataShippingMarkBindings' })
const { t } = useI18n()
const { auth } = useAppAuth()
const router = useRouter()
const { canRead, canWrite, rows, total, customRule, page, pageSize, search, filters, loading, error, edit, selection, saving, refreshing, editError, needsRefresh, discardVisible, load, query, startEdit, cancelEdit, save, refreshEdit, discard, cancelDiscard } = useShippingMarkBindings()
const columns = computed<QsGenericTableColumn<ShippingMarkBindingDto>[]>(() => [
  { id: 'supplier', accessorKey: 'supplierLabel', title: t('shippingMarkBinding.supplier'), minWidth: 180 },
  { id: 'rule', accessorFn: row => row.rule?.name ?? t('shippingMarkBinding.unbound'), title: t('shippingMarkBinding.rule'), minWidth: 380 },
  { id: 'availability', accessorKey: 'availability', title: t('shippingMarkBinding.availability'), minWidth: 150 },
  { id: 'updatedAt', accessorKey: 'updatedAt', title: t('shippingMarkBinding.updatedAt'), minWidth: 180 },
])
const filterDefinitions = computed<QsGenericTableFilterDefinition[]>(() => edit.value ? [] : [{ key: 'bindingStatus', label: t('shippingMarkBinding.bindingStatus'), options: [{ value: 'BOUND', label: t('shippingMarkBinding.bound') }, { value: 'UNBOUND', label: t('shippingMarkBinding.unbound') }] }])
function statusClass(status: string) {
  return status === 'AVAILABLE'
    ? 'border-primary/25 bg-primary/5 text-primary'
    : status === 'UNBOUND' ? 'border-border bg-muted text-muted-foreground' : 'border-destructive/25 bg-destructive/5 text-destructive'
}
function closeDiscard(open: boolean) {
  if (!open) {
    cancelDiscard()
  }
}
</script>

<template>
  <div class="min-w-0" data-testid="shipping-mark-bindings-page">
    <FaPageHeader :description="t('shippingMarkBinding.description')">
      <template #title>
        <h1 class="m-0">
          {{ t('shippingMarkBinding.title') }}
        </h1>
      </template>
      <FaButton v-if="auth('numbering-rules:read')" variant="outline" @click="router.push({ name: 'systemBasicDataNumbering' })">
        <FaIcon name="i-lucide:arrow-left" />{{ t('shippingMarkBinding.back') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain>
      <FaEmpty v-if="!canRead" icon="i-lucide:shield-alert" :title="t('shippingMarkBinding.noPermission')" class="min-h-64" />
      <section v-else class="space-y-6">
        <div class="p-4 border border-border rounded-lg bg-muted/30 flex flex-wrap gap-4 items-start justify-between" data-testid="shipping-mark-custom-rule">
          <div class="min-w-0 space-y-2">
            <h2 class="text-base font-semibold m-0 flex gap-2 items-center">
              <span class="rounded bg-primary h-4 w-1" aria-hidden="true" />{{ t('shippingMarkBinding.customTitle') }}
            </h2>
            <div class="flex flex-wrap gap-2 items-center">
              <code class="qs-type-data-emphasis">CUSTOM_MARK</code>
              <span v-if="customRule" class="text-xs px-2 py-0.5 border rounded" :class="statusClass(customRule.availability)">{{ t(`shippingMarkBinding.status.${customRule.availability}`) }}</span>
              <span v-if="customRule?.rule" class="text-sm text-muted-foreground">{{ customRule.rule.name }}<template v-if="customRule.rule.activeRevision"> · R{{ customRule.rule.activeRevision }}</template></span>
              <span v-else-if="loading" class="rounded bg-muted h-4 w-24 animate-pulse" />
            </div>
            <p class="text-sm text-muted-foreground m-0">
              {{ t('shippingMarkBinding.customDescription') }}
            </p>
          </div>
          <FaButton v-if="auth('numbering-rules:read')" variant="outline" size="sm" @click="router.push({ name: 'systemBasicDataNumbering', query: { purpose: 'SHIPPING_MARK' } })">
            {{ t('shippingMarkBinding.manageRules') }}
          </FaButton>
        </div>
        <div class="space-y-4">
          <div>
            <h2 class="text-base font-semibold m-0 mb-2 flex gap-2 items-center">
              <span class="rounded bg-primary h-4 w-1" aria-hidden="true" />{{ t('shippingMarkBinding.supplierTitle') }}
            </h2>
            <p class="text-sm text-muted-foreground m-0">
              {{ t('shippingMarkBinding.supplierHint') }}
            </p>
          </div>
          <QsGenericTable
            v-model:page="page"
            v-model:page-size="pageSize" v-model:search="search" v-model:filters="filters" class="shipping-mark-bindings-table"
            row-key="supplierValue" :columns="columns" :data="rows" :total="total" :loading="loading" :error="error || undefined"
            :addable="false" :show-column-settings="false" :searchable="!edit" :show-pagination="!edit"
            :action-column="{ title: t('shippingMarkBinding.actions'), width: 130, align: 'right' }"
            :filter-definitions="filterDefinitions" :page-size-options="[20, 50, 100]"
            :search-placeholder="t('shippingMarkBinding.search')" :empty-title="t('shippingMarkBinding.noSuppliers')" :empty-description="t('shippingMarkBinding.noSuppliersHint')"
            @search="query" @filter-change="query" @pagination-change="load" @retry="load"
          >
            <template #cell-supplier="{ row }">
              <div class="space-y-1">
                <span class="font-medium">{{ row.original.supplierLabel }}</span><code class="qs-type-meta block">{{ row.original.supplierValue }}</code>
              </div>
            </template>
            <template #cell-rule="{ row }">
              <div class="space-y-1">
                <span>{{ row.original.rule?.name ?? t('shippingMarkBinding.unbound') }}</span><code v-if="row.original.rule" class="qs-type-meta block">{{ row.original.rule.ruleCode }}<template v-if="row.original.rule.activeRevision"> · R{{ row.original.rule.activeRevision }}</template></code>
              </div>
              <ShippingMarkBindingEditor v-if="edit?.supplierValue === row.original.supplierValue" :key="row.original.supplierValue" v-model="selection" :saving="saving" :refreshing="refreshing" :needs-refresh="needsRefresh" :error="editError" @save="save" @cancel="cancelEdit" @refresh="refreshEdit" />
            </template>
            <template #cell-availability="{ row }">
              <span class="text-xs px-2 py-1 border rounded" :class="statusClass(row.original.availability)">{{ t(`shippingMarkBinding.status.${row.original.availability}`) }}</span>
            </template>
            <template #cell-updatedAt="{ row }">
              <DateTimeDisplay v-if="row.original.updatedAt" :value="row.original.updatedAt" /><span v-else class="text-muted-foreground">—</span>
            </template>
            <template #actions="{ row }">
              <FaButton v-if="canWrite" variant="outline" size="sm" :disabled="!row.supplierEnabled || saving || refreshing || edit?.supplierValue === row.supplierValue" @click="startEdit(row)">
                {{ t(row.version ? 'shippingMarkBinding.change' : 'shippingMarkBinding.set') }}
              </FaButton>
              <span v-else class="text-xs text-muted-foreground">{{ t('shippingMarkBinding.readOnly') }}</span>
            </template>
            <template #mobile-row="{ row }">
              <div class="min-w-0 [overflow-wrap:anywhere] space-y-3">
                <div class="flex gap-2 items-start justify-between">
                  <span class="font-medium">{{ row.supplierLabel }}</span><span class="text-xs px-2 py-0.5 border rounded" :class="statusClass(row.availability)">{{ t(`shippingMarkBinding.status.${row.availability}`) }}</span>
                </div>
                <code class="qs-type-meta block">{{ row.supplierValue }}</code>
                <div class="text-sm">
                  {{ row.rule?.name ?? t('shippingMarkBinding.unbound') }}<code v-if="row.rule" class="qs-type-meta block">{{ row.rule.ruleCode }}<template v-if="row.rule.activeRevision"> · R{{ row.rule.activeRevision }}</template></code>
                </div>
                <DateTimeDisplay v-if="row.updatedAt" :value="row.updatedAt" />
                <ShippingMarkBindingEditor v-if="edit?.supplierValue === row.supplierValue" :key="row.supplierValue" v-model="selection" :saving="saving" :refreshing="refreshing" :needs-refresh="needsRefresh" :error="editError" @save="save" @cancel="cancelEdit" @refresh="refreshEdit" />
              </div>
            </template>
          </QsGenericTable>
        </div>
        <div class="text-xs text-muted-foreground pt-4 border-t border-border space-y-1">
          <p class="m-0">
            {{ t('shippingMarkBinding.configOnly') }}
          </p><p class="m-0">
            {{ t('shippingMarkBinding.availabilityNote') }}
          </p>
        </div>
      </section>
    </FaPageMain>
    <QsGenericModal :model-value="discardVisible" size="sm" :title="t('shippingMarkBinding.discardTitle')" :description="t('shippingMarkBinding.discardDescription')" @update:model-value="closeDiscard">
      <template #footer>
        <FaButton variant="outline" @click="cancelDiscard">
          {{ t('shippingMarkBinding.keepEditing') }}
        </FaButton><FaButton @click="discard">
          {{ t('shippingMarkBinding.discard') }}
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>

<style scoped>
/* 长规则编码不能成为窄屏 Grid 的最小宽度，否则外层面板裁剪会隐藏编辑按钮。 */
@media (width < 768px) {
  [data-testid="shipping-mark-bindings-page"] :deep(button) {
    min-height: 44px;
  }

  [data-testid="shipping-mark-bindings-page"] :deep(.arco-select-view) {
    min-height: 44px;
  }

  .shipping-mark-bindings-table :deep(.grid[aria-busy]) {
    grid-template-columns: minmax(0, 1fr);
  }

  .shipping-mark-bindings-table :deep(.grid[aria-busy] > div) {
    min-width: 0;
  }
}
</style>
