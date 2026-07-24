<script setup lang="ts">
import type { VNode } from 'vue'
import type {
  QsGenericDrawerCloseReason,
  QsGenericDrawerProps,
} from './logic'
import {
  canCloseGenericDrawer,
  createGenericDrawerContentClass,
  QS_GENERIC_DRAWER_DEFAULT_SIZE,
  resolveFaDrawerCloseReason,
} from './logic'

defineOptions({ name: 'QsGenericDrawer' })

const props = withDefaults(defineProps<QsGenericDrawerProps>(), {
  beforeClose: undefined,
  closable: true,
  description: undefined,
  destroyOnClose: true,
  dismissOnEscape: true,
  dismissOnOverlay: true,
  error: null,
  loading: false,
  modelValue: false,
  placement: 'right',
  size: QS_GENERIC_DRAWER_DEFAULT_SIZE,
  submitting: false,
})

const emit = defineEmits<{
  'closed': []
  'opened': []
  'update:modelValue': [value: boolean]
}>()

const slots = defineSlots<{
  'default'?: () => VNode[]
  'error-actions'?: () => VNode[]
  'footer'?: () => VNode[]
  'header-extra'?: () => VNode[]
  'header-leading'?: () => VNode[]
  'loading'?: () => VNode[]
}>()

const localOpen = ref(props.modelValue)
const closePending = ref(false)
const lastEscapeKeyAt = ref<null | number>(null)
const previousActiveElement = shallowRef<HTMLElement | null>(null)
let escapeReasonResetTimer: ReturnType<typeof setTimeout> | undefined

const contentClass = computed(() =>
  createGenericDrawerContentClass(props.size, props.placement))
const hasFooter = computed(() => Boolean(slots.footer))

function rememberActiveElement() {
  if (typeof document === 'undefined') {
    return
  }

  previousActiveElement.value = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
}

function clearEscapeReason() {
  lastEscapeKeyAt.value = null
  if (escapeReasonResetTimer) {
    clearTimeout(escapeReasonResetTimer)
    escapeReasonResetTimer = undefined
  }
}

/**
 * 使用 capture 先于 Reka Dialog 记录 Escape。FaDrawer 的 beforeClose 随后同步执行，
 * 因而无需读取底层私有 DOM，也不会把遮罩关闭误写成一个伪造的键盘事件。
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

async function runCloseGuard(reason: QsGenericDrawerCloseReason): Promise<boolean> {
  if (props.submitting || closePending.value) {
    return false
  }

  closePending.value = true
  const canClose = await canCloseGenericDrawer(props.beforeClose, reason)
  closePending.value = false
  return canClose
}

async function closeFromButton() {
  if (!await runCloseGuard('close-button')) {
    return
  }

  localOpen.value = false
  emit('update:modelValue', false)
}

/**
 * FaDrawer 的 action 仅能表达 confirm/cancel/close；本组件关闭按钮由自己管理，
 * 所以到达此处的原生 close 只可能来自遮罩或 Escape。
 */
async function handleFaBeforeClose(
  _action: 'cancel' | 'close' | 'confirm',
  done: () => void,
) {
  const reason = resolveFaDrawerCloseReason(lastEscapeKeyAt.value, Date.now())
  clearEscapeReason()

  if (await runCloseGuard(reason)) {
    done()
  }
}

function handleFaModelValue(value: boolean) {
  // FaDrawer 监听受控值时会再次发出同值事件；同值短路可避免 v-model 重复通知。
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
  emit('closed')

  const element = previousActiveElement.value
  previousActiveElement.value = null
  nextTick(() => {
    if (element?.isConnected) {
      element.focus({ preventScroll: true })
    }
  })
}

watch(
  () => props.modelValue,
  async (value) => {
    if (value) {
      if (!localOpen.value) {
        rememberActiveElement()
        localOpen.value = true
      }
      return
    }

    if (!localOpen.value) {
      return
    }

    if (await runCloseGuard('programmatic')) {
      localOpen.value = false
    }
    else {
      // 受控关闭被拒绝后回写 true，防止父组件状态与可见状态永久分叉。
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
    rememberActiveElement()
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
  <FaDrawer
    :model-value="localOpen"
    :title="title"
    :description="description"
    :side="placement"
    :content-class="contentClass"
    header-class="p-0"
    footer-class="p-0 bg-muted/25"
    :footer="hasFooter"
    :closable="false"
    :loading="false"
    :show-confirm-button="false"
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
        data-slot="qs-generic-drawer-header"
        class="px-4 py-4 flex gap-3 min-w-0 items-start md:px-5"
      >
        <div
          v-if="slots['header-leading']"
          class="text-primary rounded-lg bg-primary/10 flex shrink-0 size-9 items-center justify-center"
        >
          <slot name="header-leading" />
        </div>

        <div class="pt-0.5 flex-1 min-w-0">
          <h2 data-slot="sheet-title" class="m-0 break-words">
            {{ title }}
          </h2>
          <p
            v-if="description"
            data-slot="sheet-description"
            class="m-0 mt-1 break-words"
          >
            {{ description }}
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
          class="rounded-lg shrink-0 size-11 -m-1 md:m-0 md:size-9"
          aria-label="关闭抽屉"
          :disabled="submitting || closePending"
          @click="closeFromButton"
        >
          <FaIcon name="i-lucide:x" class="size-4" />
        </FaButton>
      </div>
    </template>

    <div
      data-slot="qs-generic-drawer"
      class="min-h-full md:p-2"
      :aria-busy="loading || submitting"
    >
      <div
        v-if="loading"
        data-slot="qs-generic-drawer-loading"
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
          <span class="sr-only">正在加载抽屉内容</span>
        </slot>
      </div>

      <template v-else>
        <div
          v-if="error"
          data-slot="qs-generic-drawer-error"
          class="mb-4"
          role="alert"
        >
          <FaAlert
            variant="destructive"
            icon="i-lucide:circle-alert"
            title="加载失败"
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

        <div data-slot="qs-generic-drawer-body">
          <slot />
        </div>
      </template>

      <span v-if="submitting" class="sr-only" role="status" aria-live="polite">
        正在提交，请稍候
      </span>
    </div>

    <template v-if="hasFooter" #footer>
      <div
        data-slot="qs-generic-drawer-footer"
        class="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 flex flex-col-reverse gap-2 w-full md:px-6 md:flex-row md:items-center md:justify-end"
        :aria-busy="submitting"
        :inert="submitting || undefined"
      >
        <slot name="footer" />
      </div>
    </template>
  </FaDrawer>
</template>
