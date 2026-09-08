import type { NumberingRuleFormModel } from './numbering-management.logic'
import type { PreviewNumberingRuleResponseDto } from '@/api/generated/types.gen'
import type { NumberingPurpose } from '@/api/modules/numbering-purpose'
import numberingApi from '@/api/modules/numbering'
import { isNumberingAbortError } from './numbering-list.logic'
import {
  buildCreateNumberingRuleRequest,
  buildPreviewNumberingRuleRequest,
  createNumberingRuleFormModel,
  getNumberingMutationFailure,
  validateNumberingRuleForm,
  validateNumberingRulePreview,
} from './numbering-management.logic'
import { NUMBERING_PREVIEW_DEBOUNCE_MS } from './numbering-page.logic'

/** 新增页只需要预览与创建，不初始化列表、历史版本或派发记录请求。 */
export function useNumberingCreate(authorized: ComputedRef<boolean>, purpose: ComputedRef<NumberingPurpose | null>) {
  const account = useAppAccountStore()
  const model = ref(createNumberingRuleFormModel(null))
  const preview = ref<PreviewNumberingRuleResponseDto | null>(null)
  const previewLoading = ref(false)
  const previewError = ref<string | null>(null)
  const previewRequestId = ref<string | null>(null)
  const error = ref<string | null>(null)
  const requestId = ref<string | null>(null)
  const fieldErrors = ref<Readonly<Record<string, string>>>({})
  const submitting = ref(false)
  const unknownResult = ref(false)
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let previewGeneration = 0
  let generation = 0

  function clearPreview(): void {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    timer = undefined
    controller?.abort()
    controller = null
    previewGeneration += 1
    preview.value = null
    previewLoading.value = false
    previewError.value = null
    previewRequestId.value = null
  }

  function reset(): void {
    generation += 1
    clearPreview()
    model.value = createNumberingRuleFormModel(null)
    error.value = null
    requestId.value = null
    fieldErrors.value = {}
    submitting.value = false
    unknownResult.value = false
  }

  function requestPreview(input: NumberingRuleFormModel): void {
    clearPreview()
    if (!authorized.value || purpose.value === null) {
      return
    }
    const errors = validateNumberingRulePreview(input)
    if (Object.keys(errors).length) {
      previewError.value = Object.values(errors)[0] ?? null
      return
    }
    const payload = buildPreviewNumberingRuleRequest(input)
    const epoch = account.authEpoch
    const version = previewGeneration
    const context = generation
    const selected = purpose.value
    const current = () => authorized.value && account.authEpoch === epoch && context === generation
      && version === previewGeneration && selected === purpose.value
    previewLoading.value = true
    timer = setTimeout(async () => {
      timer = undefined
      if (!current()) {
        return
      }
      controller = new AbortController()
      try {
        const response = await numberingApi.rules.preview(payload, controller.signal)
        if (current()) {
          preview.value = response.data
        }
      }
      catch (cause) {
        if (!current() || isNumberingAbortError(cause)) {
          return
        }
        const failure = getNumberingMutationFailure(cause)
        previewError.value = failure.message
        previewRequestId.value = failure.requestId ?? null
      }
      finally {
        if (current()) {
          previewLoading.value = false
        }
      }
    }, NUMBERING_PREVIEW_DEBOUNCE_MS)
  }

  async function submit(input: NumberingRuleFormModel): Promise<boolean> {
    const selected = purpose.value
    if (!authorized.value || selected === null || submitting.value || unknownResult.value) {
      return false
    }
    fieldErrors.value = validateNumberingRuleForm(input)
    if (Object.keys(fieldErrors.value).length) {
      return false
    }
    const epoch = account.authEpoch
    const context = generation
    const current = () => authorized.value && epoch === account.authEpoch && context === generation && selected === purpose.value
    submitting.value = true
    error.value = null
    requestId.value = null
    try {
      await numberingApi.rules.create(buildCreateNumberingRuleRequest(input, selected))
      return current()
    }
    catch (cause) {
      if (!current()) {
        return false
      }
      const failure = getNumberingMutationFailure(cause)
      fieldErrors.value = failure.fieldErrors
      requestId.value = failure.requestId ?? null
      unknownResult.value = failure.unknownResult
      error.value = failure.unknownResult
        ? '创建结果未知，已停止重复提交。请返回编号列表核对该规则，当前输入仍保留。'
        : failure.message
      return false
    }
    finally {
      if (current()) {
        submitting.value = false
      }
    }
  }
  onBeforeUnmount(() => {
    generation += 1
    clearPreview()
  })
  return { model, preview, previewLoading, previewError, previewRequestId, error, requestId, fieldErrors, submitting, unknownResult, reset, requestPreview, submit }
}
