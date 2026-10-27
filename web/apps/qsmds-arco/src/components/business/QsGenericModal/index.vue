<script setup lang="ts">
import type { VNode } from 'vue'
import type {
  QsGenericModalCloseReason,
  QsGenericModalProps,
} from './logic'
import {
  canCloseGenericModal,
  createGenericModalContentClass,
  QS_GENERIC_MODAL_DEFAULT_SIZE,
  QS_GENERIC_MODAL_DEFAULT_Z_INDEX,
  resolveFaModalCloseReason,
} from './logic'

defineOptions({ name: 'QsGenericModal' })

const props = withDefaults(defineProps<QsGenericModalProps>(), {
  beforeClose: undefined,
  closable: true,
  description: undefined,
  destroyOnClose: true,
  dismissOnEscape: true,
  dismissOnOverlay: true,
  error: null,
  errorTitle: '加载失败',
  fillHeight: false,
  loading: false,
  modelValue: false,
  size: QS_GENERIC_MODAL_DEFAULT_SIZE,
  submitting: false,
  zIndex: QS_GENERIC_MODAL_DEFAULT_Z_INDEX,
})

const emit = defineEmits<{
  'closed': []
  'opened': []
  'update:modelValue': [value: boolean]
}>()

const slots = defineSlots<{
  'default'?: () => VNode[]
  'description'?: () => VNode[]
  'error-actions'?: () => VNode[]
  'footer'?: () => VNode[]
  'header-extra'?: () => VNode[]
  'header-leading'?: () => VNode[]
  'loading'?: () => VNode[]
}>()

const localOpen = ref(props.modelValue)
const closePending = ref(false)
const lastEscapeKeyAt = ref<null | number>(null)
let escapeReasonResetTimer: ReturnType<typeof setTimeout> | undefined

const contentClass = computed(() => createGenericModalContentClass(props.size))
const hasFooter = computed(() => Boolean(slots.footer))

function clearEscapeReason() {
  lastEscapeKeyAt.value = null
  if (escapeReasonResetTimer) {
    clearTimeout(escapeReasonResetTimer)
    escapeReasonResetTimer = undefined
  }
}

/**
 * 在捕获阶段记录真实 Escape 事件，使后续 FaModal 的 close 能与遮罩点击区分。
 * 提交期间底层关闭入口已禁用，因此此处也不记录会被拒绝的键盘动作。
 */
function handleDocumentKeydown(event: KeyboardEvent) {
  if (
    event.key !== 'Escape'
    || !localOpen.value
    || !props.dismissOnEscape
    || props.submitting
  ) {
    return
  }

  clearEscapeReason()
  lastEscapeKeyAt.value = Date.now()
  escapeReasonResetTimer = setTimeout(clearEscapeReason, 200)
}

/**
 * 自定义按钮、底层原生关闭和受控关闭共享一把 pending 锁。
 * finally 保证调用方守卫异常后仍能继续发起新的关闭请求。
 */
async function runCloseGuard(reason: QsGenericModalCloseReason): Promise<boolean> {
  if (props.submitting || closePending.value) {
    return false
  }

  closePending.value = true
  try {
    return await canCloseGenericModal(props.beforeClose, reason)
  }
  finally {
    closePending.value = false
  }
}

async function closeFromButton() {
  if (!await runCloseGuard('close-button')) {
    return
  }

  localOpen.value = false
  emit('update:modelValue', false)
}

/**
 * 关闭按钮由本组件自行管理，因此 FaModal 的原生 close 只来自遮罩或 Escape。
 */
async function handleFaBeforeClose(
  _action: 'cancel' | 'close' | 'confirm',
  done: () => void,
) {
  const reason = resolveFaModalCloseReason(lastEscapeKeyAt.value, Date.now())
  clearEscapeReason()

  if (await runCloseGuard(reason)) {
    done()
  }
}

function handleFaModelValue(value: boolean) {
  // FaModal 在接收受控值后会回发同值；短路避免父级收到重复 v-model 通知。
  if (value === localOpen.value) {
    return
  }

  localOpen.value = value
  emit('update:modelValue', value)
}

function handleOpened() {
  emit('opened')
}

function handleClosed() {
  // 焦点恢复由已加固的 FaModal / Reka Dialog 统一处理，包装层不重复抢焦点。
  emit('closed')
}

watch(
  () => props.modelValue,
  async (value) => {
    if (value) {
      localOpen.value = true
      return
    }

    if (!localOpen.value) {
      return
    }

    if (await runCloseGuard('programmatic')) {
      localOpen.value = false
    }
    else {
      // 受控关闭被拒绝时回写 true，防止父组件状态与可见状态永久分叉。
      emit('update:modelValue', true)
    }
  },
)

watch(localOpen, (value) => {
  if (typeof document === 'undefined') {
    return
  }

  if (value) {
    document.addEventListener('keydown', handleDocumentKeydown, true)
  }
  else {
    document.removeEventListener('keydown', handleDocumentKeydown, true)
    clearEscapeReason()
  }
})

onMounted(() => {
  if (localOpen.value) {
    document.addEventListener('keydown', handleDocumentKeydown, true)
  }
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', handleDocumentKeydown, true)
  }
  clearEscapeReason()
})
</script>

<template>
  <FaModal
    :model-value="localOpen"
    :title="title"
    :description="description"
    :class="contentClass"
    :content-class="fillHeight
      ? 'min-h-0 p-0 overflow-hidden flex flex-col'
      : 'min-h-auto p-0 overflow-y-auto'"
    header-class="p-0 border-b border-border/70"
    footer-class="p-0 border-t border-border/70 bg-muted/25"
    :footer="hasFooter"
    :closable="false"
    :loading="false"
    :show-confirm-button="false"
    :border="false"
    align-center
    open-auto-focus
    :z-index="zIndex"
    :destroy-on-close="destroyOnClose"
    :close-on-click-overlay="dismissOnOverlay && !submitting"
    :close-on-press-escape="dismissOnEscape && !submitting"
    :before-close="handleFaBeforeClose"
    @update:model-value="handleFaModelValue"
    @opened="handleOpened"
    @closed="handleClosed"
  >
    <template #header>
      <div
        data-slot="qs-generic-modal-header"
        class="px-4 py-4 flex gap-3 min-w-0 items-start sm:px-6 sm:py-5"
      >
        <div
          v-if="slots['header-leading']"
          class="text-primary rounded-lg bg-primary/10 flex shrink-0 size-9 items-center justify-center"
        >
          <slot name="header-leading" />
        </div>

        <div class="pt-0.5 flex-1 min-w-0">
          <h2 data-slot="dialog-title" class="m-0 break-words" aria-hidden="true">
            {{ title }}
          </h2>
          <p
            v-if="description || slots.description"
            data-slot="dialog-description"
            class="m-0 mt-1 break-words"
            aria-hidden="true"
          >
            <slot name="description">
              {{ description }}
            </slot>
          </p>
        </div>

        <div
          v-if="slots['header-extra']"
          class="flex shrink-0 min-h-9 items-center"
        >
          <slot name="header-extra" />
        </div>

        <FaButton
          v-if="closable"
          variant="ghost"
          size="icon"
          class="rounded-lg shrink-0 size-11 -m-1 sm:m-0 sm:size-9"
          aria-label="关闭模态框"
          :disabled="submitting || closePending"
          @click="closeFromButton"
        >
          <FaIcon name="i-lucide:x" class="size-4" />
        </FaButton>
      </div>
    </template>

    <div
      data-slot="qs-generic-modal"
      class="p-4 sm:p-6"
      :class="fillHeight ? 'flex-1 min-h-0 flex flex-col' : ''"
      :aria-busy="loading || submitting"
    >
      <div
        v-if="loading"
        data-slot="qs-generic-modal-loading"
        class="gap-4 grid"
        role="status"
        aria-live="polite"
      >
        <slot name="loading">
          <div class="gap-3 grid" aria-hidden="true">
            <div class="rounded-md bg-muted h-5 w-2/5 animate-pulse" />
            <div class="rounded-md bg-muted h-10 w-full animate-pulse" />
            <div class="rounded-md bg-muted h-24 w-full animate-pulse" />
            <div class="rounded-md bg-muted h-10 w-3/4 animate-pulse" />
          </div>
          <span class="sr-only">正在加载模态框内容</span>
        </slot>
      </div>

      <template v-else>
        <div
          v-if="error"
          data-slot="qs-generic-modal-error"
          class="mb-4"
        >
          <FaAlert
            variant="destructive"
            icon="i-lucide:circle-alert"
            :title="errorTitle"
          >
            <template #description>
              <div class="gap-3 grid">
                <span>{{ error }}</span>
                <div v-if="slots['error-actions']" class="flex flex-wrap gap-2">
                  <slot name="error-actions" />
                </div>
              </div>
            </template>
          </FaAlert>
        </div>

        <div
          data-slot="qs-generic-modal-body"
          :class="fillHeight ? 'flex-1 min-h-0 flex flex-col' : ''"
        >
          <slot />
        </div>
      </template>

      <span v-if="submitting" class="sr-only" role="status" aria-live="polite">
        正在提交，请稍候
      </span>
    </div>

    <template v-if="hasFooter" #footer>
      <div
        data-slot="qs-generic-modal-footer"
        class="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 flex flex-col gap-2 w-full sm:px-6 sm:flex-row sm:items-center sm:justify-end"
        :aria-busy="submitting"
        :inert="submitting || undefined"
      >
        <slot name="footer" />
      </div>
    </template>
  </FaModal>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  /*
   * 保留极短 animation，使 FaModal 的 opened / closed 生命周期仍可稳定完成，
   * 同时尊重用户的减少动态效果偏好。
   */
  :global(.qs-generic-modal-panel) {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
