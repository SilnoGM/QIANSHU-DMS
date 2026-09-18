<script setup lang="ts">
import type { SupplierPaymentProfileDto } from '@/api/modules/payment-recipients'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPaymentRecipientEditor from '@/components/business/QsPaymentRecipientEditor/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import PackagingPaymentProfile from './packaging-payment-profile.vue'
import { useSupplierPaymentProfiles } from './use-supplier-payment-profiles'

defineOptions({ name: 'AdminSupplierPaymentProfiles' })
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const canRead = computed(() => account.isLogin && auth('supplier-payment-profiles:read'))
const canWrite = computed(() => canRead.value && auth('supplier-payment-profiles:update'))
const { rows, page, pageSize, total, search, loading, error, selected, draft, saving, refreshing, editError, needsRefresh, dirty, resetEditor, load, query, open, save, recheck, clear } = useSupplierPaymentProfiles(canRead, canWrite, computed(() => account.authEpoch), undefined, t)
const uploading = ref(false)
const discardVisible = ref(false)
const busy = computed(() => saving.value || refreshing.value || uploading.value)
const activeTab = ref('suppliers')
const packagingLocked = ref(false)
const packagingProfile = useTemplateRef<InstanceType<typeof PackagingPaymentProfile>>('packagingProfile')
const switchLocked = computed(() => busy.value || Boolean(selected.value) || packagingLocked.value)
const tabs = computed(() => [
  { value: 'suppliers', label: t('supplierPaymentProfile.tabs.suppliers'), disabled: switchLocked.value },
  { value: 'packaging', label: t('supplierPaymentProfile.tabs.packaging'), disabled: switchLocked.value },
])
function selectTab(value: string) {
  if (!switchLocked.value && (value === 'suppliers' || value === 'packaging')) {
    activeTab.value = value
  }
}
async function refresh() {
  if (switchLocked.value) {
    return
  }
  if (activeTab.value === 'packaging') {
    await packagingProfile.value?.reload()
  }
  else {
    await load()
  }
}
let pendingLeave: ((value: boolean) => void) | undefined
const columns = computed<QsGenericTableColumn<SupplierPaymentProfileDto>[]>(() => [
  { id: 'supplier', accessorKey: 'supplierName', title: t('supplierPaymentProfile.supplier'), minWidth: 180 },
  { id: 'methods', accessorFn: row => row.accounts.map(item => t(`paymentRecipient.methods.${item.paymentMethod}`)).join(' / '), title: t('supplierPaymentProfile.methods'), minWidth: 240 },
  { id: 'updatedBy', accessorFn: row => row.updatedBy?.name ?? '—', title: t('supplierPaymentProfile.updatedBy'), minWidth: 160 },
  { id: 'updatedAt', accessorKey: 'updatedAt', title: t('supplierPaymentProfile.updatedAt'), minWidth: 180 },
])
function closeGuard() {
  if (busy.value) {
    return false
  }
  if (dirty.value) {
    discardVisible.value = true
    return false
  }
  return true
}
function close() {
  if (closeGuard()) {
    resetEditor()
  }
}
function discard() {
  discardVisible.value = false
  resetEditor()
  pendingLeave?.(true)
  pendingLeave = undefined
}
function keepEditing() {
  discardVisible.value = false
  pendingLeave?.(false)
  pendingLeave = undefined
}
async function submit() {
  if (!busy.value && await save()) {
    toast.success(t('supplierPaymentProfile.saved'))
  }
}
watch(() => [account.authEpoch, canRead.value, canWrite.value], () => {
  keepEditing()
  uploading.value = false
}, { flush: 'sync' })
onBeforeRouteLeave(() => {
  if (busy.value) {
    return false
  }
  if (!dirty.value) {
    return true
  }
  discardVisible.value = true
  return new Promise<boolean>((resolve) => {
    pendingLeave = resolve
  })
})
onDeactivated(() => {
  clear()
  keepEditing()
})
onActivated(() => {
  void load()
})
onBeforeUnmount(keepEditing)
</script>

<template>
  <div class="min-w-0" data-testid="supplier-payment-profiles-page">
    <FaPageHeader :description="t('supplierPaymentProfile.description')">
      <template #title>
        <h1 class="m-0">
          {{ t('supplierPaymentProfile.title') }}
        </h1>
      </template>
      <FaButton v-if="canRead" variant="outline" :disabled="switchLocked || (activeTab === 'suppliers' && loading)" @click="refresh">
        <FaIcon name="i-lucide:refresh-cw" />{{ t('paymentRecipient.refresh') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain>
      <FaEmpty v-if="!canRead" icon="i-lucide:shield-alert" :title="t('supplierPaymentProfile.noPermission')" class="min-h-64" />
      <template v-else>
        <QsStatusSwitchToolbar :model-value="activeTab" :items="tabs" :aria-label="t('supplierPaymentProfile.title')" class="mb-4" @update:model-value="selectTab" />
        <PackagingPaymentProfile v-if="activeTab === 'packaging'" ref="packagingProfile" @locked-change="packagingLocked = $event" />
        <QsGenericTable
          v-else v-model:page="page" v-model:page-size="pageSize" v-model:search="search"
          row-key="supplierValue" :columns="columns" :data="rows" :total="total" :loading="loading" :error="error || undefined"
          :addable="false" :show-column-settings="false" :action-column="{ width: 120, align: 'right' }"
          :search-placeholder="t('supplierPaymentProfile.search')" :empty-title="t('supplierPaymentProfile.empty')" :empty-description="t('supplierPaymentProfile.emptyHint')"
          @search="query" @pagination-change="load" @retry="load"
        >
          <template #cell-supplier="{ row }">
            <span class="font-medium">{{ row.original.supplierName }}</span>
            <span v-if="!row.original.supplierEnabled" class="text-xs text-muted-foreground ml-2">{{ t('supplierPaymentProfile.disabled') }}</span>
          </template>
          <template #cell-methods="{ row }">
            <div class="flex flex-wrap gap-2">
              <FaTag v-for="item in row.original.accounts" :key="item.paymentMethod" class="text-primary border-primary/20 bg-primary/5">
                {{ t(`paymentRecipient.methods.${item.paymentMethod}`) }}
              </FaTag>
              <span v-if="!row.original.accounts.length" class="text-sm text-muted-foreground">{{ t('supplierPaymentProfile.unconfigured') }}</span>
            </div>
          </template>
          <template #cell-updatedBy="{ row }">
            <QsPersonDisplay v-if="row.original.updatedBy" :display-name="row.original.updatedBy.name" size="sm" /><span v-else class="text-muted-foreground">—</span>
          </template>
          <template #cell-updatedAt="{ row }">
            <DateTimeDisplay v-if="row.original.updatedAt" :value="row.original.updatedAt" /><span v-else class="text-muted-foreground">—</span>
          </template>
          <template #actions="{ row }">
            <FaButton variant="outline" size="sm" @click="open(row)">
              {{ t(canWrite && row.supplierEnabled ? 'supplierPaymentProfile.configure' : 'supplierPaymentProfile.view') }}
            </FaButton>
          </template>
        </QsGenericTable>
      </template>
    </FaPageMain>
    <QsGenericModal :model-value="Boolean(selected)" :title="t('supplierPaymentProfile.configureTitle')" :description="selected?.supplierName" size="lg" :submitting="busy" :before-close="closeGuard" @update:model-value="!$event && resetEditor()">
      <template #header-leading>
        <FaIcon name="i-lucide:landmark" class="size-5" aria-hidden="true" />
      </template>
      <div v-if="selected" class="space-y-4">
        <FaAlert v-if="discardVisible" :title="t('supplierPaymentProfile.discardTitle')" :description="t('supplierPaymentProfile.discardHint')" />
        <FaAlert v-if="editError" :title="editError" variant="destructive" />
        <FaAlert v-if="!selected.supplierEnabled" :title="t('supplierPaymentProfile.disabledHint')" />
        <QsPaymentRecipientEditor :key="`${selected.supplierValue}-${account.authEpoch}`" v-model="draft" :disabled="!canWrite || !selected.supplierEnabled || saving || refreshing || needsRefresh || discardVisible" @busy-change="uploading = $event" />
      </div>
      <template #footer>
        <template v-if="discardVisible">
          <FaButton type="button" variant="outline" @click="keepEditing">
            {{ t('supplierPaymentProfile.keepEditing') }}
          </FaButton>
          <FaButton type="button" @click="discard">
            {{ t('supplierPaymentProfile.discard') }}
          </FaButton>
        </template>
        <template v-else>
          <FaButton type="button" variant="outline" :disabled="busy" @click="close">
            {{ t('supplierPaymentProfile.close') }}
          </FaButton>
          <FaButton v-if="needsRefresh" type="button" :disabled="busy" :loading="refreshing" @click="recheck">
            {{ t('supplierPaymentProfile.recheck') }}
          </FaButton>
          <FaButton v-else-if="canWrite && selected?.supplierEnabled" type="button" :disabled="busy" :loading="saving" @click="submit">
            {{ t('supplierPaymentProfile.save') }}
          </FaButton>
        </template>
      </template>
    </QsGenericModal>
  </div>
</template>
