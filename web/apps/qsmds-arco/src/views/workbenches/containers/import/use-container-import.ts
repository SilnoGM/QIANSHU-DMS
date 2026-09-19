import type { Ref } from 'vue'
import type { ContainerImportCandidateDto, ContainerImportConfirmDto, ContainerImportPreviewDto, ContainerImportResultDto, ContainerImportRowDto } from '@/api/generated/types.gen'
import { computed, ref, shallowRef, watch } from 'vue'
import { useContainerMutation } from '../use-container-mutation'
import { useContainerResource } from '../use-container-resource'

export type ImportStatus = ContainerImportRowDto['matchStatus']
export type ImportFilter = ImportStatus | 'ALL'
export type ImportDisplayRow = ContainerImportRowDto & {
  selectedShipment: ContainerImportCandidateDto | null
  displayStatus: ImportStatus
  manuallySelected: boolean
}

/** 解析结果只作为待确认草稿；提交完整原表行集合，筛选和分页不会改变导入范围。 */
export function useContainerImport(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  id: Readonly<Ref<string>>,
  load: (signal: AbortSignal) => Promise<ContainerImportPreviewDto>,
  send: (body: ContainerImportConfirmDto, key: string, signal: AbortSignal) => Promise<ContainerImportResultDto>,
) {
  const resource = useContainerResource(enabled, epoch, id, load)
  const selection = shallowRef<Record<string, ContainerImportCandidateDto | null>>({})
  const allowUnmatched = ref(false)
  const completed = ref(false)
  const mutation = useContainerMutation(enabled, epoch, send)
  const locked = computed(() => mutation.submitting.value || mutation.retryOnly.value)
  const rows = computed<ImportDisplayRow[]>(() => (resource.data.value?.rows ?? []).map((row) => {
    const manual = Object.hasOwn(selection.value, row.rowKey)
    const selectedShipment = manual ? selection.value[row.rowKey] : row.candidates.find(item => item.id === row.matchedShipmentId && item.eligible) ?? null
    const invalid = row.errors.length > 0 || row.matchStatus === 'INVALID'
    const displayStatus: ImportStatus = invalid ? 'INVALID' : selectedShipment ? 'MATCHED' : manual ? 'UNMATCHED' : row.matchStatus === 'MATCHED' ? 'UNMATCHED' : row.matchStatus
    return { ...row, selectedShipment, displayStatus, manuallySelected: manual }
  }))
  const counts = computed(() => {
    const result = { ALL: rows.value.length, MATCHED: 0, AMBIGUOUS: 0, UNMATCHED: 0, INVALID: 0 }
    rows.value.forEach(row => result[row.displayStatus]++)
    return result
  })
  const unmatchedCount = computed(() => counts.value.AMBIGUOUS + counts.value.UNMATCHED)
  const hasUncommitted = computed(() => enabled.value && !completed.value && !resource.data.value?.alreadyImported && rows.value.length > 0)
  const canSubmit = computed(() => hasUncommitted.value && !resource.loading.value && !resource.error.value && !locked.value && counts.value.INVALID === 0 && (unmatchedCount.value === 0 || allowUnmatched.value))
  function resetSelection() {
    selection.value = {}
    allowUnmatched.value = false
    completed.value = false
  }
  watch([resource.data, epoch], resetSelection, { flush: 'sync' })
  function select(rowKey: string, shipment: ContainerImportCandidateDto | null) {
    const row = rows.value.find(item => item.rowKey === rowKey)
    if (!hasUncommitted.value || locked.value || !row || row.displayStatus === 'INVALID' || (shipment && !shipment.eligible)) {
      return false
    }
    selection.value = { ...selection.value, [rowKey]: shipment }
    mutation.resetFeedback()
    return true
  }
  async function submit() {
    const preview = resource.data.value
    if (!preview || (!canSubmit.value && !mutation.retryOnly.value)) {
      return
    }
    const result = await mutation.submit({
      expectedVersion: preview.expectedVersion,
      sourceFileId: preview.sourceFileId,
      sourceHash: preview.sourceHash,
      allowUnmatched: allowUnmatched.value,
      rows: rows.value.map(row => ({ rowKey: row.rowKey, shipmentId: row.selectedShipment?.id ?? null })),
    })
    if (result) {
      completed.value = true
    }
    return result
  }
  async function reload() {
    if (locked.value) {
      return
    }
    mutation.resetFeedback()
    await resource.reload()
  }
  return { preview: resource.data, loading: resource.loading, loadError: resource.error, reload, rows, counts, unmatchedCount, allowUnmatched, completed, locked, canSubmit, hasUncommitted, select, submit, submitting: mutation.submitting, retryOnly: mutation.retryOnly, error: mutation.error, conflict: mutation.conflict, fieldErrors: mutation.fieldErrors }
}
