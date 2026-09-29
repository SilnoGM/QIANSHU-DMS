import type { Ref } from 'vue'
import type { SlhBillImportPreviewDto, SlhBillStagedFileDto } from '@/api/generated/types.gen'
import { onScopeDispose, ref, shallowRef } from 'vue'
import { containerFailure } from '../containers/use-container-resource'

/** 每步文案与它真正在做的事一致：请求就挂在该步骤的 action 里。 */
export interface SlhBillImportRunStep {
  text: string
  name?: string
  action?: (context: Record<string, unknown>) => Promise<unknown>
}

export interface SlhBillImportRunLabels {
  upload: string
  parse: string
  review: string
}

interface SlhBillImportRun {
  controller: AbortController
  epoch: number
  sequence: number
  preview: SlhBillImportPreviewDto | null
}

/**
 * 账单导入的加载器编排。
 *
 * 解析依赖上传返回的原件标识，两个请求必须串行，所以各自挂在文案对应的步骤上。
 * `FaMultiStepLoader` 自己按步骤均分最短展示时长，这里不额外补固定延时：
 * 总时长是「组件最短时长」与「两步请求实际耗时」中的较大者。
 */
export function useSlhBillImportRun(deps: {
  epoch: Readonly<Ref<number>>
  upload: (file: File, signal: AbortSignal) => Promise<SlhBillStagedFileDto>
  parse: (mediaAssetId: string, signal: AbortSignal) => Promise<SlhBillImportPreviewDto>
}) {
  const loading = ref(false)
  const steps = shallowRef<SlhBillImportRunStep[]>([])
  const staged = shallowRef<SlhBillStagedFileDto | null>(null)
  let sequence = 0
  let run: SlhBillImportRun | null = null

  /** 过期判据：被取消、被新一次运行取代、或换了身份，旧运行都不能再写状态。 */
  function isCurrent(current: SlhBillImportRun): boolean {
    return !current.controller.signal.aborted
      && current.sequence === sequence
      && current.epoch === deps.epoch.value
  }

  function begin(current: SlhBillImportRun, list: SlhBillImportRunStep[]): void {
    run = current
    // steps 必须与 loading 同时就位：组件在 steps 为空时不会推进，也就永远不会完成。
    steps.value = list
    loading.value = true
  }

  /** 完整导入：上传原件 → 解析账单 → 复核。上传结果按 name 交给解析步骤使用。 */
  function start(input: { file: File, labels: SlhBillImportRunLabels }): void {
    reset()
    const current: SlhBillImportRun = { controller: new AbortController(), epoch: deps.epoch.value, preview: null, sequence }
    const uploadStep = async (): Promise<SlhBillStagedFileDto> => {
      const result = await deps.upload(input.file, current.controller.signal)
      if (isCurrent(current)) {
        staged.value = result
      }
      return result
    }
    const parseStep = async (context: Record<string, unknown>): Promise<void> => {
      const uploaded = context.staged as SlhBillStagedFileDto | undefined
      if (!uploaded || !isCurrent(current)) {
        return
      }
      const result = await deps.parse(uploaded.mediaAssetId, current.controller.signal)
      if (isCurrent(current)) {
        current.preview = result
      }
    }
    begin(current, [
      { action: uploadStep, name: 'staged', text: input.labels.upload },
      { action: parseStep, text: input.labels.parse },
      { text: input.labels.review },
    ])
  }

  /**
   * 只重跑解析：原件已暂存时不再上传。
   * 重复上传会给同一份原件多留一份媒体资产，也会让「重试」变成实际的重新导入。
   */
  function startParseOnly(input: { mediaAssetId: string, labels: SlhBillImportRunLabels }): void {
    reset()
    const current: SlhBillImportRun = { controller: new AbortController(), epoch: deps.epoch.value, preview: null, sequence }
    const parseStep = async (): Promise<void> => {
      const result = await deps.parse(input.mediaAssetId, current.controller.signal)
      if (isCurrent(current)) {
        current.preview = result
      }
    }
    begin(current, [
      { action: parseStep, text: input.labels.parse },
      { text: input.labels.review },
    ])
  }

  /** 由加载器的 complete 事件调用；返回预览结果，过期或未拿到结果时返回 null。 */
  function complete(): SlhBillImportPreviewDto | null {
    const current = run
    run = null
    loading.value = false
    if (!current?.preview || !isCurrent(current)) {
      return null
    }
    return current.preview
  }

  /** 由加载器的 error 事件调用；返回要展示的错误文案，过期运行返回 null。 */
  function fail(failure: unknown): string | null {
    const current = run
    run = null
    loading.value = false
    // 组件只负责 emit error，遮罩的关闭必须由这里完成，否则会永久停留。
    if (!current || !isCurrent(current)) {
      return null
    }
    return containerFailure(failure).message
  }

  /** 取消当前运行并复位展示状态；staged 由调用方按自己的流程决定是否保留。 */
  function reset(): void {
    run?.controller.abort()
    run = null
    sequence += 1
    loading.value = false
  }

  onScopeDispose(reset)
  return { complete, fail, loading, reset, staged, start, startParseOnly, steps }
}
