import type { MaybeRefOrGetter, Ref } from 'vue'
import { computed, ref, toValue } from 'vue'

export type FileDropInvalidReason = 'type'

export interface UseFileDropOptions {
  readonly accept?: MaybeRefOrGetter<string | undefined>
  readonly disabled?: MaybeRefOrGetter<boolean>
  readonly multiple?: MaybeRefOrGetter<boolean>
  readonly onFiles: (files: File[]) => void
  readonly onInvalid?: (reason: FileDropInvalidReason) => void
}

export interface FileDropHandlers {
  readonly onDragenter: (event: DragEvent) => void
  readonly onDragleave: (event: DragEvent) => void
  readonly onDragover: (event: DragEvent) => void
  readonly onDrop: (event: DragEvent) => void
}

function hasFilePayload(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes('Files')
}

function matchesAccept(file: File, accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') {
    return true
  }
  const mimeType = file.type.toLocaleLowerCase('en-US')
  const filename = file.name.toLocaleLowerCase('en-US')
  return accept.split(',').map(token => token.trim().toLocaleLowerCase('en-US')).some((token) => {
    if (token === '*/*' || token === mimeType) {
      return true
    }
    if (token.endsWith('/*')) {
      return mimeType.startsWith(token.slice(0, -1))
    }
    return token.startsWith('.') && filename.endsWith(token)
  })
}

/**
 * 为任意容器补充文件拖放能力；点击选择仍由业务 UI 自己提供。
 *
 * dragDepth 让鼠标经过子元素时不会反复触发 leave；页面内部拖拽（不含 Files）
 * 完全不接管，避免和图片/视频排序等交互冲突。
 */
export function useFileDrop(options: UseFileDropOptions): {
  readonly handlers: FileDropHandlers
  readonly isDragging: Ref<boolean>
} {
  const dragDepth = ref(0)
  const isDragging = computed(() => dragDepth.value > 0)
  const disabled = computed(() => toValue(options.disabled ?? false))

  function reset(): void {
    dragDepth.value = 0
  }

  function onDragenter(event: DragEvent): void {
    if (!hasFilePayload(event)) {
      return
    }
    // 即使区域禁用也必须吞掉浏览器默认行为，避免把文件直接导航打开。
    event.preventDefault()
    if (disabled.value) {
      return
    }
    dragDepth.value += 1
  }

  function onDragover(event: DragEvent): void {
    if (!hasFilePayload(event)) {
      return
    }
    event.preventDefault()
    if (disabled.value) {
      return
    }
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  function onDragleave(event: DragEvent): void {
    if (!hasFilePayload(event)) {
      return
    }
    event.preventDefault()
    dragDepth.value = Math.max(0, dragDepth.value - 1)
  }

  function onDrop(event: DragEvent): void {
    if (!hasFilePayload(event)) {
      return
    }
    event.preventDefault()
    reset()
    if (disabled.value) {
      return
    }

    const files = [...(event.dataTransfer?.files ?? [])]
    const accepted = files.filter(file => matchesAccept(file, toValue(options.accept)))
    if (accepted.length === 0) {
      options.onInvalid?.('type')
      return
    }
    options.onFiles(toValue(options.multiple ?? false) ? accepted : accepted.slice(0, 1))
  }

  return {
    handlers: Object.freeze({
      onDragenter,
      onDragleave,
      onDragover,
      onDrop,
    }),
    isDragging,
  }
}
