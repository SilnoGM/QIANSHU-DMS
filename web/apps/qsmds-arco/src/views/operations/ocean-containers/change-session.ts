import type { OceanChangeDraft, OceanChangeInput, OceanChangeKind, OceanChangeLine, OceanChangeResult, OceanChangeValue, OceanUndoInput } from './change-logic'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import { isReceiptResultUnknown } from '../../workbenches/sales-receipts/submission.logic'
import { buildOceanChangeText, normalizeOceanChange, oceanChangeDiff, oceanChangeDraft } from './change-logic'

interface Failure { key?: string, message?: string }
interface ChangeApi {
  item: (containerId: string, lineId: string, signal: AbortSignal) => Promise<{ data: OceanChangeLine }>
  changeItem: (containerId: string, lineId: string, input: OceanChangeInput, signal: AbortSignal) => Promise<{ data: OceanChangeResult }>
  undoChange: (containerId: string, lineId: string, changeId: string, input: OceanUndoInput, signal: AbortSignal) => Promise<{ data: OceanChangeResult }>
}
function failure(error: unknown, key: string): Failure {
  const body = error && typeof error === 'object' && 'body' in error ? error.body as { message?: unknown } : null
  return typeof body?.message === 'string' ? { message: body.message } : { key }
}
function isConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'status' in error && error.status === 409)
}
function scheduleSecond(callback: () => void): () => void {
  const timer = setTimeout(callback, 1000)
  return () => clearTimeout(timer)
}

/** 复制与群内发送确认独立于写入；保存和撤销遇到未知结果时均冻结原请求重试。 */
export function useOceanLineChange(options: {
  containerId: string
  lineId: string
  containerName: string
  kind: OceanChangeKind
  api: ChangeApi
  copyText: (text: string) => Promise<void>
  onClose: (latestLine: OceanChangeLine | null) => void
  createKey?: () => string
  scheduleTick?: (callback: () => void) => () => void
}) {
  const line = shallowRef<OceanChangeLine | null>(null)
  const draft = ref<OceanChangeDraft>({ recipientName: '', recipientPhone: '', recipientAddress: '', remark: '', codAmountTwd: null })
  const step = ref(0)
  const loading = ref(false)
  const loadError = shallowRef<Failure | null>(null)
  const error = shallowRef<Failure | null>(null)
  const intent = shallowRef<OceanChangeValue | null>(null)
  const copying = ref(false)
  const saving = ref(false)
  const pending = ref(false)
  const needsReload = ref(false)
  const result = shallowRef<OceanChangeResult | null>(null)
  const undoing = ref(false)
  const undoPending = ref(false)
  const undoConflict = ref(false)
  const undone = ref(false)
  const countdown = ref<number | null>(null)
  const createKey = options.createKey ?? (() => crypto.randomUUID())
  const scheduleTick = options.scheduleTick ?? scheduleSecond
  let requestKey = createKey()
  let sequence = 0
  let disposed = false
  let closed = false
  let cancelTick: (() => void) | null = null
  let controller: AbortController | null = null
  let frozen: Readonly<OceanChangeInput> | null = null
  let frozenUndo: Readonly<OceanUndoInput> | null = null
  const diff = computed(() => line.value && intent.value ? oceanChangeDiff(line.value, intent.value) : [])
  const busy = computed(() => saving.value || undoing.value)
  const locked = computed(() => busy.value || copying.value || pending.value || needsReload.value || step.value === 3)
  const canSave = computed(() => !disposed && step.value === 2 && Boolean(intent.value && line.value) && !busy.value && !needsReload.value)
  const canUndo = computed(() => !disposed && step.value === 3 && Boolean(result.value) && !busy.value && !undoConflict.value && !undone.value)

  function stopCountdown() {
    cancelTick?.()
    cancelTick = null
    countdown.value = null
  }
  function dispose() {
    disposed = true
    ++sequence
    controller?.abort()
    controller = null
    stopCountdown()
  }
  function close() {
    if (disposed || closed || busy.value || pending.value || undoPending.value) {
      return
    }
    closed = true
    const latest = result.value?.line ?? null
    dispose()
    options.onClose(latest)
  }
  function startCountdown() {
    stopCountdown()
    countdown.value = 5
    const tick = () => {
      cancelTick = null
      if (disposed || countdown.value === null) {
        return
      }
      if (countdown.value <= 1) {
        close()
        return
      }
      countdown.value--
      cancelTick = scheduleTick(tick)
    }
    cancelTick = scheduleTick(tick)
  }
  function current(request: AbortController, version: number) {
    return !disposed && !request.signal.aborted && controller === request && sequence === version
  }
  async function load() {
    if (disposed || busy.value || pending.value || step.value === 3) {
      return
    }
    controller?.abort()
    const request = controller = new AbortController()
    const version = ++sequence
    intent.value = null
    frozen = null
    requestKey = createKey()
    step.value = 0
    line.value = null
    error.value = null
    loadError.value = null
    needsReload.value = false
    copying.value = false
    loading.value = true
    try {
      const response = await options.api.item(options.containerId, options.lineId, request.signal)
      if (current(request, version)) {
        line.value = response.data
        draft.value = oceanChangeDraft(response.data)
      }
    }
    catch (caught) {
      if (current(request, version)) {
        loadError.value = failure(caught, 'loadFailed')
      }
    }
    finally {
      if (current(request, version)) {
        loading.value = false
        controller = null
      }
    }
  }
  function review(): boolean {
    if (disposed || locked.value || loading.value || step.value !== 0 || !line.value) {
      return false
    }
    const normalized = normalizeOceanChange(options.kind, draft.value)
    if (!normalized.value) {
      error.value = { key: normalized.error }
      return false
    }
    if (!oceanChangeDiff(line.value, normalized.value).some(row => row.before !== row.after)) {
      error.value = { key: 'unchanged' }
      return false
    }
    error.value = null
    intent.value = Object.freeze(normalized.value)
    step.value = 1
    return true
  }
  async function copy(): Promise<boolean> {
    if (disposed || locked.value || step.value !== 1 || !line.value || !intent.value) {
      return false
    }
    const version = sequence
    copying.value = true
    error.value = null
    try {
      await options.copyText(buildOceanChangeText(options.containerName, line.value, intent.value))
      if (disposed || sequence !== version) {
        return false
      }
      step.value = 2
      return true
    }
    catch {
      if (!disposed && sequence === version) {
        error.value = { key: 'copyFailed' }
      }
      return false
    }
    finally {
      if (!disposed && sequence === version) {
        copying.value = false
      }
    }
  }
  function edit() {
    if (disposed || locked.value) {
      return
    }
    ++sequence
    controller?.abort()
    controller = null
    requestKey = createKey()
    frozen = null
    intent.value = null
    error.value = null
    step.value = 0
  }
  async function save(): Promise<OceanChangeResult | null> {
    if (!canSave.value || !line.value || !intent.value) {
      return null
    }
    const request = controller = new AbortController()
    const version = sequence
    // 仅第三步“已发送，确认更改”调用；未知结果重试不改变已确认的快照与幂等键。
    frozen ??= Object.freeze({ ...intent.value, requestKey, expectedVersion: line.value.version, notificationConfirmed: true })
    saving.value = true
    error.value = null
    try {
      const response = await options.api.changeItem(options.containerId, options.lineId, frozen, request.signal)
      if (!current(request, version)) {
        return null
      }
      pending.value = false
      result.value = response.data
      step.value = 3
      startCountdown()
      return response.data
    }
    catch (caught) {
      if (current(request, version)) {
        needsReload.value = isConflict(caught)
        pending.value = !needsReload.value && isReceiptResultUnknown(caught)
        error.value = needsReload.value ? { key: 'conflict' } : pending.value ? { key: 'unknownResult' } : failure(caught, 'saveFailed')
        if (!pending.value) {
          frozen = null
        }
      }
      return null
    }
    finally {
      if (current(request, version)) {
        saving.value = false
        controller = null
      }
    }
  }
  async function undo(): Promise<OceanChangeResult | null> {
    if (!canUndo.value || !result.value) {
      return null
    }
    // 用户选择撤销后立即停表；任何失败都保留弹窗，不能自动关闭丢失处理机会。
    stopCountdown()
    const request = controller = new AbortController()
    const version = sequence
    const changeId = result.value.changeId
    frozenUndo ??= Object.freeze({ requestKey: createKey(), expectedVersion: result.value.line.version })
    undoing.value = true
    error.value = null
    try {
      const response = await options.api.undoChange(options.containerId, options.lineId, changeId, frozenUndo, request.signal)
      if (!current(request, version)) {
        return null
      }
      undoPending.value = false
      undone.value = true
      result.value = response.data
      return response.data
    }
    catch (caught) {
      if (current(request, version)) {
        undoConflict.value = isConflict(caught)
        undoPending.value = !undoConflict.value && isReceiptResultUnknown(caught)
        error.value = undoConflict.value ? { key: 'undoConflict' } : undoPending.value ? { key: 'undoUnknown' } : failure(caught, 'undoFailed')
      }
      return null
    }
    finally {
      if (current(request, version)) {
        undoing.value = false
        controller = null
      }
    }
  }
  onScopeDispose(dispose)
  return { line, draft, step, loading, loadError, error, intent, diff, copying, saving, pending, needsReload, result, undoing, undoPending, undoConflict, countdown, busy, locked, canSave, canUndo, load, review, copy, edit, save, undo, close, dispose }
}
