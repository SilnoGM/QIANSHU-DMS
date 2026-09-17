<script setup lang="ts">
import api from '@/api/modules/payment-recipients'
import { paymentRecipientErrorMessage } from './logic'

const props = defineProps<{ mediaAssetId: string }>()
const { t } = useI18n()
const account = useAppAccountStore()
const url = ref('')
const loading = ref(false)
const error = ref('')
let controller: AbortController | undefined
let disposed = false
function reset() {
  controller?.abort()
  controller = undefined
  if (url.value) {
    URL.revokeObjectURL(url.value)
  }
  url.value = ''
  error.value = ''
  loading.value = false
}
async function load() {
  reset()
  if (disposed || !account.isLogin || !props.mediaAssetId) {
    return
  }
  const request = controller = new AbortController()
  const epoch = account.authEpoch
  const id = props.mediaAssetId
  const current = () => !disposed && !request.signal.aborted && account.isLogin && epoch === account.authEpoch && props.mediaAssetId === id
  loading.value = true
  try {
    const response = await api.contentBlob(id, request.signal)
    if (current()) {
      url.value = URL.createObjectURL(response.data)
    }
  }
  catch (failure) {
    if (current()) {
      error.value = paymentRecipientErrorMessage(failure, t('paymentRecipient.errors.imageLoad'))
    }
  }
  finally {
    if (current()) {
      loading.value = false
    }
  }
}
watch(() => [props.mediaAssetId, account.authEpoch, account.isLogin], load, { immediate: true })
onDeactivated(() => {
  disposed = true
  reset()
})
onActivated(() => {
  disposed = false
  void load()
})
onBeforeUnmount(() => {
  disposed = true
  reset()
})
</script>

<template>
  <div class="min-w-0 space-y-2">
    <div v-if="loading" role="status" class="text-muted-foreground rounded-lg bg-muted/30 flex h-48 items-center justify-center">
      <FaIcon name="i-lucide:loader-circle" class="mr-2 animate-spin" />{{ t('paymentRecipient.imageLoading') }}
    </div>
    <div v-else-if="error" role="alert" class="text-sm text-destructive p-3 border border-destructive/20 rounded-lg space-y-2">
      <p>{{ error }}</p>
      <FaButton variant="outline" size="sm" type="button" @click="load">
        {{ t('paymentRecipient.retry') }}
      </FaButton>
    </div>
    <template v-else-if="url">
      <FaImagePreview :src="url" :aria-label="t('paymentRecipient.qrCode')" class="recipient-qr mx-auto p-3 border border-border rounded-lg bg-white max-w-full w-64 aspect-square" />
      <div class="flex justify-center">
        <FaButton variant="outline" size="sm" as-child>
          <a :href="url" download="payment-recipient-qr.png">{{ t('paymentRecipient.downloadQr') }}</a>
        </FaButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 收款码完整展示；白底是扫码内容画布，避免深色主题改变二维码识别对比。 */
.recipient-qr :deep(img) {
  object-fit: contain;
}
</style>
