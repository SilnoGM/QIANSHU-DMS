<script setup lang="ts">
import purchaseOrderPayablesApi from '@/api/modules/purchase-order-payables'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { getPurchaseOrderMutationFailure } from '../../operations/purchase-orders/purchase-order-create.logic'

const props = defineProps<{ payableId: string, documentId: string, title: string }>()
const { t } = useI18n()
const account = useAppAccountStore()
const { auth } = useAppAuth()
const preview = ref<string | null>(null)
const error = ref('')
const loading = ref(false)
let controller: AbortController | null = null
function clear() {
  controller?.abort()
  controller = null
  if (preview.value) {
    URL.revokeObjectURL(preview.value)
  }
  preview.value = null
  error.value = ''
  loading.value = false
}
async function load() {
  clear()
  if (!auth('purchase-orders:payment')) {
    return
  }
  const request = new AbortController()
  controller = request
  loading.value = true
  try {
    const response = await purchaseOrderPayablesApi.voucherContentBlob(props.payableId, props.documentId, request.signal)
    if (!request.signal.aborted && controller === request) {
      preview.value = URL.createObjectURL(response.data)
    }
  }
  catch (failure) {
    if (!request.signal.aborted && controller === request) {
      error.value = getPurchaseOrderMutationFailure(failure).message
    }
  }
  finally {
    if (controller === request) {
      loading.value = false
    }
  }
}
watch(() => [props.payableId, props.documentId, account.authEpoch, auth('purchase-orders:payment')] as const, load, { immediate: true })
onBeforeUnmount(clear)
</script>

<template>
  <section class="mt-5 space-y-3">
    <h3 class="qs-type-body-medium m-0">
      {{ t('purchasePayment.paymentVoucher') }}
    </h3>
    <p class="qs-type-meta text-muted-foreground m-0">
      {{ title }}
    </p>
    <p v-if="loading" role="status">
      {{ t('purchasePayment.loading') }}
    </p>
    <FaAlert v-else-if="error" :title="error" variant="destructive" />
    <ImageGroup v-else-if="preview" :items="[{ src: preview, previewSrc: preview, alt: title }]" :size="200" :max-count="1" fit="contain" />
    <FaButton v-if="error" variant="outline" type="button" @click="load">
      {{ t('purchasePayment.retry') }}
    </FaButton>
  </section>
</template>
