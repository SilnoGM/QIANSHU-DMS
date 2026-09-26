import type { Ref } from 'vue'
import type { ContainerImportPreviewDto } from '@/api/generated/types.gen'
import { onScopeDispose, ref, shallowRef } from 'vue'
import { stageImportPreview } from './container-import-preview-cache'
import { containerFailure } from './use-container-resource'

interface ImportParseStep {
  text: string
  action?: () => Promise<void>
}
interface ImportParseRun {
  controller: AbortController
  id: string
  epoch: number
  sequence: number
  preview: ContainerImportPreviewDto | null
}

// 解析请求挂在中间步骤：FaMultiStepLoader 按步骤均分最短展示时长，请求耗时算作该步骤的实际耗时，
// 于是总时长是「组件最短时长」与「前序步骤等待 + 解析耗时」中的较大者，解析慢时不会再补满整段时长。
const REQUEST_STEP_INDEX = 1

/** 柜次详情的解析编排：加载器负责展示和推进步骤，解析结果只在加载器完成后交接给解析匹配页。 */
export function useContainerImportParse(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  id: Readonly<Ref<string>>,
  load: (signal: AbortSignal) => Promise<ContainerImportPreviewDto>,
) {
  const parsing = ref(false)
  const error = ref('')
  const steps = shallowRef<ImportParseStep[]>([])
  let sequence = 0
  let run: ImportParseRun | null = null

  function isCurrent(current: ImportParseRun): boolean {
    return !current.controller.signal.aborted
      && current.sequence === sequence
      && current.id === id.value
      && current.epoch === epoch.value
      && enabled.value
  }
  function reset(): void {
    run?.controller.abort()
    run = null
    sequence += 1
    parsing.value = false
    error.value = ''
  }
  function start(labels: readonly string[]): void {
    if (!enabled.value || !id.value || parsing.value) {
      return
    }
    reset()
    const current: ImportParseRun = { controller: new AbortController(), id: id.value, epoch: epoch.value, sequence, preview: null }
    run = current
    // 加载器自己推进步骤；离开页面、换柜次或换身份后，旧步骤不能再写入交接缓存。
    const parseRows = async (): Promise<void> => {
      if (!isCurrent(current)) {
        return
      }
      const preview = await load(current.controller.signal)
      if (isCurrent(current)) {
        current.preview = preview
      }
    }
    steps.value = labels.map((text, index) => (index === REQUEST_STEP_INDEX ? { text, action: parseRows } : { text }))
    error.value = ''
    parsing.value = true
  }
  /** 由加载器的 complete 事件调用；返回本次解析结果供页面跳转，过期或失败返回 null。 */
  function complete(): ContainerImportPreviewDto | null {
    const current = run
    run = null
    parsing.value = false
    if (!current?.preview || !isCurrent(current)) {
      return null
    }
    stageImportPreview(current.id, current.preview)
    return current.preview
  }
  /** 由加载器的 error 事件调用；返回是否把错误提示到当前页面。 */
  function fail(failure: unknown): boolean {
    const current = run
    run = null
    parsing.value = false
    if (!current || !isCurrent(current)) {
      return false
    }
    error.value = containerFailure(failure).message
    return true
  }

  onScopeDispose(reset)
  return { parsing, error, steps, start, complete, fail, reset }
}
