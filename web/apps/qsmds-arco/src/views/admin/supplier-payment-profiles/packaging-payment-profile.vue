<script setup lang="ts">
import type { PackagingPaymentProfileDto } from '@/api/modules/payment-recipients'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPaymentRecipientEditor from '@/components/business/QsPaymentRecipientEditor/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { PACKAGING_RECIPIENT_METHODS, usePackagingPaymentProfile } from './use-packaging-payment-profile'

const emit = defineEmits<{ lockedChange: [value: boolean] }>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const canRead = computed(() => account.isLogin && auth('supplier-payment-profiles:read'))
const canWrite = computed(() => canRead.value && auth('supplier-payment-profiles:update'))
const { profile, draft, loading, saving, error, needsRefresh, dirty, load, save, discard, clear } = usePackagingPaymentProfile(canRead, canWrite, computed(() => account.authEpoch), undefined, t)
const uploading = ref(false)
const busy = computed(() => loading.value || saving.value || uploading.value)
const editorVisible = ref(false)
const discardVisible = ref(false)
const search = ref('')
const rows = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase()
  return profile.value && `${profile.value.vendorName} ${profile.value.vendor}`.toLocaleLowerCase().includes(keyword) ? [profile.value] : []
})
const columns = computed<QsGenericTableColumn<PackagingPaymentProfileDto>[]>(() => [
  { id: 'vendor', accessorKey: 'vendorName', title: t('packagingPaymentProfile.vendorLabel'), minWidth: 180 },
  { id: 'methods', accessorFn: row => row.accounts.map(item => t(`paymentRecipient.methods.${item.paymentMethod}`)).join(' / '), title: t('supplierPaymentProfile.methods'), minWidth: 240 },
  { id: 'updatedBy', accessorFn: row => row.updatedBy?.name ?? '—', title: t('supplierPaymentProfile.updatedBy'), minWidth: 160 },
  { id: 'updatedAt', accessorKey: 'updatedAt', title: t('supplierPaymentProfile.updatedAt'), minWidth: 180 },
])
let pendingLeave: ((value: boolean) => void) | undefined
function open() {
  if (canRead.value && profile.value && !busy.value && !editorVisible.value) {
    discard()
    editorVisible.value = true
  }
}
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
    finishLeave(true)
  }
}
function finishLeave(leave: boolean) {
  discardVisible.value = false
  if (leave) {
    discard()
    editorVisible.value = false
  }
  pendingLeave?.(leave)
  pendingLeave = undefined
}
async function submit() {
  if (editorVisible.value && canWrite.value && !busy.value && await save()) {
    editorVisible.value = false
    toast.success(t('packagingPaymentProfile.saved'))
  }
}
async function reload() {
  if (!busy.value && !editorVisible.value) {
    await load()
  }
}
defineExpose({ reload })
watch([busy, editorVisible], () => emit('lockedChange', busy.value || editorVisible.value), { immediate: true, flush: 'sync' })
watch(() => [account.authEpoch, canRead.value, canWrite.value], () => {
  uploading.value = false
  editorVisible.value = false
  finishLeave(false)
}, { flush: 'sync' })
onBeforeRouteLeave(() => {
  if (busy.value) {
    return false
  }
  if (!editorVisible.value || !dirty.value) {
    return true
  }
  discardVisible.value = true
  return new Promise<boolean>((resolve) => {
    pendingLeave = resolve
  })
})
onDeactivated(() => {
  clear()
  editorVisible.value = false
  finishLeave(false)
})
onActivated(() => {
  void load()
})
onBeforeUnmount(() => {
  finishLeave(false)
  emit('lockedChange', false)
})
</script>

<template>
  <QsGenericTable
    v-model:search="search" row-key="vendor" :columns="columns" :data="rows" :total="rows.length"
    :loading="loading" :error="!editorVisible && error ? error : undefined"
    :addable="false" :show-column-settings="false" :action-column="{ width: 120, align: 'right' }"
    :search-placeholder="t('packagingPaymentProfile.search')" :empty-title="t('packagingPaymentProfile.empty')" :empty-description="t('packagingPaymentProfile.emptyHint')"
    @retry="reload"
  >
    <template #cell-vendor="{ row }">
      <span class="font-medium">{{ row.original.vendorName }}</span>
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
    <template #actions>
      <FaButton variant="outline" size="sm" :disabled="busy" @click="open">
        {{ t(canWrite ? 'supplierPaymentProfile.configure' : 'supplierPaymentProfile.view') }}
      </FaButton>
    </template>
  </QsGenericTable>
  <QsGenericModal :model-value="editorVisible" :title="t('packagingPaymentProfile.configureTitle')" :description="profile?.vendorName" size="lg" :submitting="busy" :before-close="closeGuard" @update:model-value="!$event && finishLeave(true)">
    <template #header-leading>
      <FaIcon name="i-lucide:landmark" class="size-5" aria-hidden="true" />
    </template>
    <div v-if="editorVisible && profile" class="space-y-4">
      <FaAlert v-if="discardVisible" :title="t('supplierPaymentProfile.discardTitle')" :description="t('supplierPaymentProfile.discardHint')" />
      <FaAlert v-if="error" :title="error" variant="destructive" />
      <QsPaymentRecipientEditor :key="`packaging-${account.authEpoch}`" v-model="draft" :methods="PACKAGING_RECIPIENT_METHODS" compact :disabled="!canWrite || loading || saving || needsRefresh || discardVisible" @busy-change="uploading = $event" />
    </div>
    <template #footer>
      <template v-if="discardVisible">
        <FaButton type="button" variant="outline" @click="finishLeave(false)">
          {{ t('supplierPaymentProfile.keepEditing') }}
        </FaButton>
        <FaButton type="button" @click="finishLeave(true)">
          {{ t('supplierPaymentProfile.discard') }}
        </FaButton>
      </template>
      <template v-else>
        <FaButton type="button" variant="outline" :disabled="busy" @click="close">
          {{ t('supplierPaymentProfile.close') }}
        </FaButton>
        <FaButton v-if="needsRefresh" type="button" :disabled="busy" :loading="loading" @click="load">
          {{ t('supplierPaymentProfile.recheck') }}
        </FaButton>
        <FaButton v-else-if="canWrite && profile" type="button" :disabled="busy" :loading="saving" @click="submit">
          {{ t('supplierPaymentProfile.save') }}
        </FaButton>
      </template>
    </template>
  </QsGenericModal>
</template>
