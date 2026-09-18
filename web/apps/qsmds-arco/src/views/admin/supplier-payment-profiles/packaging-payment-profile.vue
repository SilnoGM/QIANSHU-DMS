<script setup lang="ts">
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
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
const discardVisible = ref(false)
let pendingLeave: ((value: boolean) => void) | undefined
function finishLeave(leave: boolean) {
  discardVisible.value = false
  if (leave) {
    discard()
  }
  pendingLeave?.(leave)
  pendingLeave = undefined
}
async function submit() {
  if (!busy.value && await save()) {
    toast.success(t('packagingPaymentProfile.saved'))
  }
}
watch([busy, dirty, needsRefresh], () => emit('lockedChange', busy.value || dirty.value || needsRefresh.value), { immediate: true })
watch(() => [account.authEpoch, canRead.value, canWrite.value], () => {
  uploading.value = false
  finishLeave(false)
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
  <FaCard :title="t('packagingPaymentProfile.vendor')" :description="t('packagingPaymentProfile.description')" class="max-w-4xl" content-class="space-y-5" footer-class="flex flex-wrap gap-3 justify-end">
    <FaAlert v-if="error" :title="error" variant="destructive" />
    <div v-if="loading && !profile" role="status" class="text-sm text-muted-foreground py-12 flex gap-2 items-center justify-center">
      <FaIcon name="i-lucide:loader-circle" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {{ t('packagingPaymentProfile.loading') }}
    </div>
    <template v-if="profile">
      <div v-if="profile.updatedAt" class="text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 items-center">
        <div class="flex gap-2 items-center">
          <span>{{ t('supplierPaymentProfile.updatedAt') }}</span>
          <DateTimeDisplay :value="profile.updatedAt" />
        </div>
        <div v-if="profile.updatedBy" class="flex gap-2 items-center">
          <span>{{ t('supplierPaymentProfile.updatedBy') }}</span>
          <QsPersonDisplay :display-name="profile.updatedBy.name" size="sm" />
        </div>
      </div>
      <QsPaymentRecipientEditor :key="`packaging-${account.authEpoch}`" v-model="draft" :methods="PACKAGING_RECIPIENT_METHODS" compact :disabled="!canWrite || loading || saving || needsRefresh || discardVisible" @busy-change="uploading = $event" />
    </template>
    <template #footer>
      <FaButton v-if="dirty && !needsRefresh" variant="outline" :disabled="busy" @click="discard">
        {{ t('packagingPaymentProfile.discard') }}
      </FaButton>
      <FaButton variant="outline" :disabled="busy || (dirty && !needsRefresh)" :loading="loading" @click="load">
        {{ t(needsRefresh ? 'supplierPaymentProfile.recheck' : 'paymentRecipient.refresh') }}
      </FaButton>
      <FaButton v-if="canWrite && profile && !needsRefresh" :disabled="busy || !dirty" :loading="saving" @click="submit">
        {{ t('supplierPaymentProfile.save') }}
      </FaButton>
    </template>
  </FaCard>
  <QsGenericModal :model-value="discardVisible" :title="t('supplierPaymentProfile.discardTitle')" :description="t('supplierPaymentProfile.discardHint')" size="sm" @update:model-value="!$event && finishLeave(false)">
    <template #footer>
      <FaButton variant="outline" @click="finishLeave(false)">
        {{ t('supplierPaymentProfile.keepEditing') }}
      </FaButton>
      <FaButton @click="finishLeave(true)">
        {{ t('supplierPaymentProfile.discard') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
