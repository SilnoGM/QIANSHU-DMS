import type { Ref } from 'vue'
import type { ApiClientError } from '../../../../api/errors'
import type { FundWithdrawalDto, FundWithdrawalProofUploadDto } from '../../../../api/generated/types.gen'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { getApiClientErrorMessage } from '../../../../api/errors'
import fundWithdrawalsApi from '../../../../api/modules/fund-withdrawals'
import { UPLOAD_POLICIES, validateUploadFile } from '../../../../utils/upload-policy'

export type WithdrawalReviewApi = Pick<
  typeof fundWithdrawalsApi,
  'get' | 'approve' | 'reject' | 'uploadProof' | 'proofReview'
>

export type WithdrawalReviewField = 'proof' | 'reason'

function statusOf(failure: unknown): number | undefined {
  return typeof failure === 'object' && failure !== null && 'status' in failure
    ? (failure as { status?: number }).status
    : undefined
}

/** 只读取已归一化的客户端错误文案，不把 Axios message 或响应体原样透出。 */
function messageOf(failure: unknown): string {
  if (typeof failure === 'object' && failure !== null && 'kind' in failure) {
    return getApiClientErrorMessage(failure as ApiClientError) || ''
  }
  return failure instanceof Error ? failure.message : ''
}

/**
 * 提款审批页的状态机。
 *
 * 与弹窗相比多了三件事：版本号只能来自详情响应；提交中冻结整页避免重复通过；
 * 409/404 视为记录已变化（stale），必须刷新核对后才能继续，而不是允许带旧版本重试。
 * 付款截图上传与通过是两个请求：上传只暂存媒体资产，通过才真正扣款与生成资金批次。
 */
export function useWithdrawalReview(
  enabled: Readonly<Ref<boolean>>,
  canReview: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  requestId: Readonly<Ref<string | null>>,
  api: WithdrawalReviewApi = fundWithdrawalsApi,
) {
  const detail = shallowRef<FundWithdrawalDto | null>(null)
  const loading = ref(false)
  const busy = ref(false)
  const uploading = ref(false)
  const stale = ref(false)
  const invalid = ref(false)
  const loadError = ref('')
  const actionError = ref('')
  const proofUrl = ref<string | null>(null)
  const proofLoading = ref(false)
  const proofError = ref(false)
  const previewUrl = ref<string | null>(null)
  const previewFileName = ref('')
  const upload = shallowRef<FundWithdrawalProofUploadDto | null>(null)
  const rejectReason = ref('')
  const fieldError = ref<WithdrawalReviewField | null>(null)
  let controller: AbortController | null = null
  let command: AbortController | null = null
  let proofController: AbortController | null = null
  let uploadController: AbortController | null = null

  const pending = computed(() => detail.value?.status === 'PENDING')
  const locked = computed(() => busy.value || uploading.value)
  const actionable = computed(() => (
    enabled.value
    && canReview.value
    && pending.value
    && !loading.value
    && !locked.value
    && !stale.value
  ))

  function releasePreview(): void {
    if (previewUrl.value !== null) {
      URL.revokeObjectURL(previewUrl.value)
      previewUrl.value = null
    }
    previewFileName.value = ''
    upload.value = null
  }

  function releaseProof(): void {
    if (proofUrl.value !== null) {
      URL.revokeObjectURL(proofUrl.value)
      proofUrl.value = null
    }
    proofController?.abort()
    proofController = null
    proofLoading.value = false
    proofError.value = false
  }

  function clearDraft(): void {
    releasePreview()
    rejectReason.value = ''
    fieldError.value = null
    actionError.value = ''
  }

  /**
   * 记录已变化的统一出口：状态冲突与记录消失都要求重新读取。
   * 只有审批写操作会走到这里，避免把网络抖动误判成并发冲突。
   */
  function applyFailure(failure: unknown): void {
    const status = statusOf(failure)
    if (status === 409 || status === 404) {
      stale.value = true
      actionError.value = ''
      return
    }
    actionError.value = messageOf(failure)
  }

  async function loadProof(): Promise<void> {
    const record = detail.value
    if (record === null || record.paymentProof === null) {
      return
    }
    proofController?.abort()
    const request = new AbortController()
    proofController = request
    proofLoading.value = true
    proofError.value = false
    try {
      const response = await api.proofReview(record.id, request.signal)
      if (!request.signal.aborted && proofController === request) {
        if (proofUrl.value !== null) {
          URL.revokeObjectURL(proofUrl.value)
        }
        proofUrl.value = URL.createObjectURL(response.data)
      }
    }
    catch {
      if (!request.signal.aborted && proofController === request) {
        proofError.value = true
      }
    }
    finally {
      if (proofController === request) {
        proofLoading.value = false
        proofController = null
      }
    }
  }

  async function load(): Promise<void> {
    // 审批提交中不刷新：详情版本被替换后再提交会变成另一次资金请求。
    if (busy.value) {
      return
    }
    controller?.abort()
    clearDraft()
    releaseProof()
    stale.value = false
    invalid.value = false
    loadError.value = ''
    if (!enabled.value || requestId.value === null) {
      detail.value = null
      loading.value = false
      return
    }
    const request = new AbortController()
    const id = requestId.value
    const requestEpoch = epoch.value
    controller = request
    loading.value = true
    const current = () => (
      controller === request
      && !request.signal.aborted
      && enabled.value
      && requestId.value === id
      && epoch.value === requestEpoch
    )
    try {
      const result = await api.get(id, request.signal)
      if (current()) {
        detail.value = result.data
        if (result.data.paymentProof !== null) {
          void loadProof()
        }
      }
    }
    catch (failure) {
      if (current()) {
        detail.value = null
        // 记录不存在与数据范围不可见都按不存在处理，避免泄露他人的提款单。
        if (statusOf(failure) === 404) {
          invalid.value = true
        }
        else {
          loadError.value = messageOf(failure)
        }
      }
    }
    finally {
      if (current()) {
        loading.value = false
      }
    }
  }

  async function uploadProof(file: File): Promise<boolean> {
    const record = detail.value
    if (!actionable.value || record === null) {
      return false
    }
    if (validateUploadFile(file, UPLOAD_POLICIES.IMAGE_ONLY) !== null) {
      fieldError.value = 'proof'
      actionError.value = ''
      return false
    }
    releasePreview()
    previewUrl.value = URL.createObjectURL(file)
    previewFileName.value = file.name
    uploadController?.abort()
    const request = new AbortController()
    uploadController = request
    uploading.value = true
    fieldError.value = null
    actionError.value = ''
    const requestEpoch = epoch.value
    const current = () => (
      uploadController === request
      && !request.signal.aborted
      && enabled.value
      && canReview.value
      && epoch.value === requestEpoch
      && requestId.value === record.id
    )
    try {
      const response = await api.uploadProof(record.id, file, request.signal)
      if (!current()) {
        return false
      }
      upload.value = response.data
      return true
    }
    catch (failure) {
      if (current()) {
        actionError.value = messageOf(failure)
        releasePreview()
      }
      return false
    }
    finally {
      if (uploadController === request) {
        uploading.value = false
        uploadController = null
      }
    }
  }

  async function approve(): Promise<boolean> {
    const record = detail.value
    if (!actionable.value || record === null) {
      return false
    }
    const selected = upload.value
    if (selected === null) {
      fieldError.value = 'proof'
      return false
    }
    command?.abort()
    const request = new AbortController()
    command = request
    busy.value = true
    fieldError.value = null
    actionError.value = ''
    const requestEpoch = epoch.value
    const current = () => (
      command === request
      && !request.signal.aborted
      && enabled.value
      && canReview.value
      && epoch.value === requestEpoch
      && requestId.value === record.id
    )
    try {
      const result = await api.approve(record.id, {
        expectedVersion: record.version,
        paymentProofMediaAssetId: selected.mediaAssetId,
      }, request.signal)
      if (!current()) {
        return false
      }
      detail.value = result.data
      clearDraft()
      if (result.data.paymentProof !== null) {
        void loadProof()
      }
      return true
    }
    catch (failure) {
      if (current()) {
        applyFailure(failure)
      }
      return false
    }
    finally {
      if (command === request) {
        busy.value = false
        command = null
      }
    }
  }

  async function reject(): Promise<boolean> {
    const record = detail.value
    if (!actionable.value || record === null) {
      return false
    }
    const reason = rejectReason.value.trim()
    if (reason === '') {
      fieldError.value = 'reason'
      return false
    }
    command?.abort()
    const request = new AbortController()
    command = request
    busy.value = true
    fieldError.value = null
    actionError.value = ''
    const requestEpoch = epoch.value
    const current = () => (
      command === request
      && !request.signal.aborted
      && enabled.value
      && canReview.value
      && epoch.value === requestEpoch
      && requestId.value === record.id
    )
    try {
      const result = await api.reject(record.id, {
        expectedVersion: record.version,
        reason,
      }, request.signal)
      if (!current()) {
        return false
      }
      detail.value = result.data
      clearDraft()
      return true
    }
    catch (failure) {
      if (current()) {
        applyFailure(failure)
      }
      return false
    }
    finally {
      if (command === request) {
        busy.value = false
        command = null
      }
    }
  }

  function reset(): void {
    controller?.abort()
    command?.abort()
    uploadController?.abort()
    controller = null
    command = null
    uploadController = null
    detail.value = null
    loading.value = false
    busy.value = false
    uploading.value = false
    stale.value = false
    invalid.value = false
    loadError.value = ''
    clearDraft()
    releaseProof()
  }

  watch([enabled, epoch, requestId], () => {
    reset()
    void load()
  }, { immediate: true, flush: 'sync' })
  watch(canReview, (value) => {
    if (!value) {
      reset()
    }
  }, { flush: 'sync' })
  onScopeDispose(reset)

  return {
    detail,
    loading,
    busy,
    uploading,
    stale,
    invalid,
    loadError,
    actionError,
    proofUrl,
    proofLoading,
    proofError,
    previewUrl,
    previewFileName,
    upload,
    rejectReason,
    fieldError,
    pending,
    locked,
    actionable,
    load,
    loadProof,
    uploadProof,
    approve,
    reject,
    reset,
  }
}
