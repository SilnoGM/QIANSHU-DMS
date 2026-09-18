<script setup lang="ts">
import packagingCostsApi from '@/api/modules/packaging-costs'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { getPurchaseOrderApiFailure } from '../../operations/purchase-orders/purchase-order-list.logic'

const props = defineProps<{ requestId: string, kind: 'PACKAGING' | 'QUOTATION' | 'PAYMENT', title: string, enabled: boolean }>()
const { t } = useI18n()
const account = useAppAccountStore()
const preview = ref('')
const error = ref('')
const loading = ref(false)
let controller: AbortController | null = null
function clear() {
  controller?.abort()
  controller = null
  if (preview.value) {
    URL.revokeObjectURL(preview.value)
  }
  preview.value = ''
  error.value = ''
  loading.value = false
}
async function load() {
  clear()
  if (!props.enabled) {
    return
  }
  const request = new AbortController()
  const epoch = account.authEpoch
  controller = request
  loading.value = true
  const current = () => !request.signal.aborted && controller === request && props.enabled && account.authEpoch === epoch
  try {
    const response = await packagingCostsApi.imageBlob(props.requestId, props.kind, request.signal)
    if (current()) {
      preview.value = URL.createObjectURL(response.data)
    }
  }
  catch (failure) {
    if (current()) {
      error.value = getPurchaseOrderApiFailure(failure).message
    }
  }
  finally {
    if (current()) {
      loading.value = false
    }
  }
}
watch(() => [props.requestId, props.kind, props.enabled, account.authEpoch], load, { immediate: true, flush: 'sync' })
onBeforeUnmount(clear)
</script>

<template>
  <div class="gap-2 grid min-w-0 content-start">
    <p class="qs-type-meta text-muted-foreground m-0">
      {{ title }}
    </p>
    <div v-if="loading" role="status" class="text-muted-foreground border border-border rounded-lg flex size-20 items-center justify-center">
      <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" aria-hidden="true" /><span class="sr-only">{{ t('packagingPayment.loading') }}</span>
    </div>
    <ImageGroup v-else-if="preview" :items="[{ src: preview, previewSrc: preview, alt: title }]" :size="80" :max-count="1" :tooltip="false" fit="contain" class="[&_img]:size-19.5!" />
    <template v-else-if="error">
      <p role="alert" class="qs-type-meta text-destructive m-0 break-words">
        {{ error }}
      </p>
      <FaButton variant="outline" size="sm" class="w-fit" @click="load">
        {{ t('packagingPayment.retry') }}
      </FaButton>
    </template>
  </div>
</template>
