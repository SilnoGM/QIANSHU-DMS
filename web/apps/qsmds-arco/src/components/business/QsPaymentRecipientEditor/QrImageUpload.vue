<script setup lang="ts">
import api from '@/api/modules/payment-recipients'
import { IMAGE_ONLY_ACCEPT } from '@/utils/upload-policy'
import { paymentRecipientErrorMessage, validateRecipientImage } from './logic'
import RecipientImage from './RecipientImage.vue'

const props = defineProps<{ mediaAssetId?: string | null, disabled?: boolean, compact?: boolean }>()
const emit = defineEmits<{
  'update:mediaAssetId': [value: string | null]
  'busyChange': [value: boolean]
}>()
const { t } = useI18n()
const account = useAppAccountStore()
const { auth } = useAppAuth()
const busy = ref(false)
const error = ref('')
const images = ref<string[]>([])
const uploadAllowed = computed(() => account.isLogin && (auth('supplier-payment-profiles:update') || auth('purchase-orders:create') || auth('packaging-costs:create')))
let controller: AbortController | undefined
let disposed = false
function reset() {
  controller?.abort()
  controller = undefined
  busy.value = false
  error.value = ''
  images.value = []
  emit('busyChange', false)
}
function beforeUpload(file: File) {
  if (props.disabled || busy.value || (!props.compact && props.mediaAssetId) || !uploadAllowed.value) {
    return false
  }
  const failure = validateRecipientImage(file)
  error.value = failure ? t(failure) : ''
  return !failure
}
async function upload({ file }: { file: File }) {
  if (!beforeUpload(file)) {
    return null
  }
  const request = controller = new AbortController()
  const epoch = account.authEpoch
  const previousId = props.mediaAssetId
  busy.value = true
  emit('busyChange', true)
  // 替换成功前保留原二维码；取消、失败或调用方切换目标均不能覆盖当前资料。
  const current = () => !disposed && !request.signal.aborted && epoch === account.authEpoch && uploadAllowed.value && props.mediaAssetId === previousId
  try {
    const response = await api.upload(file, request.signal)
    if (current()) {
      emit('update:mediaAssetId', response.data.mediaAssetId)
    }
  }
  catch (failure) {
    // FaImageUpload 不捕获 request 异常。就地显示失败，不能把失败文件计为已上传。
    if (current()) {
      error.value = paymentRecipientErrorMessage(failure, t('paymentRecipient.errors.upload'))
    }
  }
  finally {
    if (controller === request) {
      controller = undefined
      busy.value = false
      emit('busyChange', false)
    }
  }
  return null
}
watch(() => [account.authEpoch, uploadAllowed.value], reset)
onBeforeUnmount(() => {
  disposed = true
  reset()
})
</script>

<template>
  <div class="space-y-2">
    <div v-if="mediaAssetId && compact" class="flex flex-wrap gap-3 items-center">
      <RecipientImage :media-asset-id="mediaAssetId" thumbnail :thumbnail-size="96" />
      <div class="flex flex-col gap-2 items-start">
        <FaImageUpload v-model="images" :accept="IMAGE_ONLY_ACCEPT" :disabled="disabled || busy || !uploadAllowed" :max="1" :width="120" :height="32" :before-upload="beforeUpload" :http-request="upload">
          <span class="text-sm px-3 border border-border rounded-md flex gap-2 size-full items-center justify-center">
            <FaIcon v-if="busy" name="i-lucide:loader-circle" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ t(busy ? 'paymentRecipient.uploading' : 'paymentRecipient.replaceQr') }}
          </span>
        </FaImageUpload>
        <FaButton type="button" variant="ghost" size="sm" :disabled="disabled || busy || !uploadAllowed" @click="emit('update:mediaAssetId', null)">
          {{ t('paymentRecipient.removeQr') }}
        </FaButton>
      </div>
    </div>
    <template v-else-if="mediaAssetId">
      <RecipientImage :media-asset-id="mediaAssetId" />
      <FaButton type="button" variant="outline" size="sm" :disabled="disabled || busy" @click="emit('update:mediaAssetId', null)">
        {{ t('paymentRecipient.replaceQr') }}
      </FaButton>
    </template>
    <FaImageUpload v-else v-model="images" :accept="IMAGE_ONLY_ACCEPT" :disabled="disabled || busy || !uploadAllowed" :max="1" :width="compact ? 96 : 112" :height="compact ? 96 : 112" :before-upload="beforeUpload" :http-request="upload">
      <span class="text-sm text-muted-foreground border-2 border-border rounded-lg border-dashed flex flex-col gap-2 size-full items-center justify-center">
        <FaIcon :name="busy ? 'i-lucide:loader-circle' : 'i-lucide:image-plus'" :class="{ 'animate-spin': busy }" class="size-6" aria-hidden="true" />
        {{ t(busy ? 'paymentRecipient.uploading' : 'paymentRecipient.uploadQr') }}
      </span>
    </FaImageUpload>
    <p class="text-xs text-muted-foreground" :class="{ 'max-w-64': compact }">
      {{ t('paymentRecipient.imageHint') }}
    </p>
    <p v-if="error" role="alert" class="text-sm text-destructive">
      {{ error }}
    </p>
  </div>
</template>
