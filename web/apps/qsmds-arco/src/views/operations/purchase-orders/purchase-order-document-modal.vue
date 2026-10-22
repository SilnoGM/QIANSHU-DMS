<script setup lang="ts">
import type { PurchaseOrderDetailDto, PurchaseOrderDocumentAttachRequestDto, PurchaseOrderTemporaryDocumentDto } from '@/api/generated/types.gen'
import { useFileDrop } from '@fantastic-admin/components'
import purchaseOrdersApi from '@/api/modules/purchase-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  IMAGE_ONLY_ACCEPT,
  UPLOAD_POLICIES,
  validateUploadFile,
} from '@/utils/upload-policy'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'

const props = defineProps<{ detail: PurchaseOrderDetailDto, modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'busyChange': [value: boolean]
  'detailUpdated': [detail: PurchaseOrderDetailDto]
}>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const documentType = ref<PurchaseOrderDocumentAttachRequestDto['documentType']>('DELIVERY_RECEIPT')
const remark = ref('')
const uploaded = shallowRef<PurchaseOrderTemporaryDocumentDto | null>(null)
const previewUrl = ref<string | null>(null)
const busy = ref(false)
const uploading = ref(false)
const error = ref('')
const errorHint = ref<string | null>(null)
let controller: AbortController | null = null
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const hasIssuance = computed(() => props.detail.documents.some(item => item.documentType === 'ORDER_ISSUANCE_VOUCHER' && item.detachedAt === null))
const options = computed(() => [
  ...hasIssuance.value ? [] : [{ value: 'ORDER_ISSUANCE_VOUCHER', label: t('purchaseOrderDrawer.documentTypes.ORDER_ISSUANCE_VOUCHER') }],
  { value: 'DELIVERY_RECEIPT', label: t('purchaseOrderDrawer.documentTypes.DELIVERY_RECEIPT') },
])

function clearPreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
  previewUrl.value = null
}
function reset() {
  controller?.abort()
  controller = null
  busy.value = false
  uploading.value = false
  emit('busyChange', false)
  clearPreview()
  uploaded.value = null
  remark.value = ''
  error.value = ''
  errorHint.value = null
  documentType.value = 'DELIVERY_RECEIPT'
}

/** 每次操作绑定订单与登录世代；关闭、换单或退出登录后的响应不得污染新抽屉。 */
async function run(action: (signal: AbortSignal, orderId: string) => Promise<void>) {
  if (busy.value || !visible.value || props.detail.orderStatus === 'PENDING_REVIEW') {
    return
  }
  if (!auth('purchase-orders:document')) {
    toast.warning(t('purchaseOrderDrawer.permissionRequired'))
    return
  }
  const orderId = props.detail.id
  const epoch = account.authEpoch
  const request = new AbortController()
  controller = request
  busy.value = true
  error.value = ''
  errorHint.value = null
  emit('busyChange', true)
  try {
    await action(request.signal, orderId)
  }
  catch (failure) {
    if (!request.signal.aborted && !isPurchaseOrderAbortError(failure) && epoch === account.authEpoch && orderId === props.detail.id && visible.value) {
      const mapped = getPurchaseOrderApiFailure(failure)
      error.value = mapped.message
      // 已知业务错误已有明确 message；只有结果不明确时才提示重新加载核对。
      errorHint.value = mapped.requestId === undefined
        ? t('purchaseOrderDrawer.refreshBeforeRetry')
        : null
    }
  }
  finally {
    if (controller === request) {
      controller = null
      busy.value = false
      uploading.value = false
      emit('busyChange', false)
    }
  }
}

async function handleFile(file: File) {
  const failure = validateUploadFile(file, UPLOAD_POLICIES.IMAGE_ONLY)
  if (failure !== null) {
    error.value = failure === 'too-large'
      ? '凭证图片不能超过 10 MiB'
      : failure === 'empty'
        ? '凭证图片为空'
        : '仅支持 JPG/PNG/WebP 图片'
    errorHint.value = null
    return
  }
  await run(async (signal, orderId) => {
    uploading.value = true
    uploaded.value = null
    clearPreview()
    const epoch = account.authEpoch
    const response = await purchaseOrdersApi.uploadTemporaryDocument(file, signal)
    if (signal.aborted || !visible.value || props.detail.id !== orderId || account.authEpoch !== epoch) {
      return
    }
    uploaded.value = response.data
    previewUrl.value = URL.createObjectURL(file)
  })
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file !== undefined) {
    void handleFile(file)
  }
}

const {
  handlers: fileDropHandlers,
  isDragging: fileDragging,
} = useFileDrop({
  accept: IMAGE_ONLY_ACCEPT,
  disabled: computed(() => (
    busy.value
    || !visible.value
    || props.detail.orderStatus === 'PENDING_REVIEW'
  )),
  onFiles: (files) => {
    const file = files[0]
    if (file !== undefined) {
      void handleFile(file)
    }
  },
  onInvalid: () => {
    error.value = '仅支持 JPG/PNG/WebP 图片'
    errorHint.value = null
  },
})

async function save() {
  const asset = uploaded.value
  if (!asset) {
    toast.warning(t('purchaseOrderDrawer.fileRequired'))
    return
  }
  await run(async (signal, orderId) => {
    const epoch = account.authEpoch
    const response = await purchaseOrdersApi.attachDocument(orderId, {
      documentType: documentType.value,
      mediaAssetId: asset.mediaAssetId,
      remark: remark.value.trim() || null,
    }, signal)
    if (signal.aborted || !visible.value || props.detail.id !== orderId || account.authEpoch !== epoch) {
      return
    }
    emit('detailUpdated', response.data)
    toast.success(t('purchaseOrderDrawer.documentSaved'))
    visible.value = false
  })
}

watch(() => [props.modelValue, props.detail.id, account.authEpoch] as const, reset)
onBeforeUnmount(reset)
</script>

<template>
  <QsGenericModal v-model="visible" size="md" :title="t('purchaseOrderDrawer.attachDocument')" :description="detail.orderNo" :submitting="busy">
    <div class="space-y-5">
      <FaAlert v-if="error" :title="error" :description="errorHint ?? undefined" variant="destructive" />
      <p class="qs-type-description m-0">
        {{ t('purchaseOrderDrawer.attachDocumentNotice') }}
      </p>
      <label class="flex flex-col gap-2">
        <span class="qs-type-body-medium">{{ t('purchaseOrderDrawer.documentType') }}</span>
        <FaSelect v-model="documentType" :options="options" :disabled="busy" class="w-full" />
      </label>
      <div
        v-bind="fileDropHandlers"
        class="p-3 rounded-lg transition-shadow duration-150 space-y-2"
        :class="fileDragging ? 'ring-2 ring-primary/40 ring-offset-2 bg-primary/5' : ''"
      >
        <label class="qs-type-body-medium flex flex-col gap-2">
          {{ t('purchaseOrderDrawer.documentFile') }}
          <input type="file" :accept="IMAGE_ONLY_ACCEPT" :disabled="busy" class="text-sm p-3 border border-border rounded-lg w-full" @change="onFileChange">
        </label>
        <p class="qs-type-meta m-0">
          可拖入图片，或点击选择。
        </p>
        <p v-if="uploading" role="status" class="qs-type-meta">
          {{ t('purchaseOrderDrawer.uploading') }}
        </p>
        <div v-if="uploaded" class="p-3 border border-border rounded-lg flex gap-3 min-w-0 items-center">
          <img v-if="previewUrl" :src="previewUrl" :alt="uploaded.originalFilename" class="rounded-lg shrink-0 size-16 object-cover">
          <FaIcon v-else name="i-lucide:file-text" class="text-muted-foreground shrink-0 size-8" aria-hidden="true" />
          <span class="text-sm [overflow-wrap:anywhere]">{{ uploaded.originalFilename }}</span>
        </div>
      </div>
      <label class="flex flex-col gap-2">
        <span class="qs-type-body-medium">{{ t('purchaseOrderDrawer.documentRemark') }}</span>
        <FaTextarea v-model="remark" :maxlength="500" :disabled="busy" :rows="3" />
      </label>
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="busy" @click="visible = false">
        {{ t('purchaseOrderDrawer.cancel') }}
      </FaButton>
      <FaButton type="button" :loading="busy" :disabled="busy || !uploaded" @click="save">
        {{ t('purchaseOrderDrawer.saveDocument') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
