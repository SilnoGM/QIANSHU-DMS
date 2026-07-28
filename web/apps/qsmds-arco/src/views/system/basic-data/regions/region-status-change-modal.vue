<script setup lang="ts">
import type {
  RegionStatusChangeModalProps,
  RegionStatusChangeRequest,
} from './region-status.logic'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  createRegionStatusChangeRequest,
  formatRegionStatusPath,
  regionStatusChangeCopy,
} from './region-status.logic'

defineOptions({ name: 'RegionStatusChangeModal' })

const props = withDefaults(defineProps<RegionStatusChangeModalProps>(), {
  error: null,
  requestId: undefined,
  submitting: false,
})

const emit = defineEmits<{
  cancel: []
  submit: [request: RegionStatusChangeRequest]
}>()

const submitRequested = ref(false)
const interactionLocked = computed(
  () => props.submitting || submitRequested.value,
)
const isDisable = computed(() => props.action === 'disable')
const copy = computed(() => regionStatusChangeCopy(props.action))
const fullPath = computed(() => props.region === null
  ? '未选择地区'
  : formatRegionStatusPath(props.ancestorPath, props.region))

function handleCancel(): void {
  if (interactionLocked.value) {
    return
  }
  emit('cancel')
}

function handleVisibilityChange(value: boolean): void {
  // QsGenericModal 只在遮罩、Escape 或关闭按钮获准关闭后回发 false。
  if (value || interactionLocked.value) {
    return
  }
  emit('cancel')
}

async function handleSubmit(): Promise<void> {
  if (interactionLocked.value) {
    return
  }

  const request = createRegionStatusChangeRequest(
    props.action,
    props.region,
    props.submitting,
  )
  if (request === null) {
    return
  }

  /*
   * emit 到父级设置 submitting 之间仍可能出现同一事件循环内的第二次点击，
   * 因此先上本地锁。若父级没有进入提交态，则在一次渲染后释放，避免按钮永久锁死。
   */
  submitRequested.value = true
  emit('submit', request)
  await nextTick()
  if (!props.submitting) {
    submitRequested.value = false
  }
}

function handleStatusActionClick(event: MouseEvent): void {
  const target = event.target
  const actionRoot = event.currentTarget
  if (!(target instanceof Element) || !(actionRoot instanceof HTMLElement)) {
    return
  }

  const actionButton = target.closest<HTMLElement>('[data-region-status-action]')
  if (actionButton === null || !actionRoot.contains(actionButton)) {
    return
  }

  // 与地区表单使用同一原生祖先事件边界，确保 FaButton 多层透传后仍有稳定交互。
  event.preventDefault()
  if (actionButton.dataset.regionStatusAction === 'cancel') {
    handleCancel()
    return
  }
  if (actionButton.dataset.regionStatusAction === 'submit') {
    void handleSubmit()
  }
}

watch(
  () => props.submitting,
  (submitting) => {
    if (!submitting) {
      submitRequested.value = false
    }
  },
)

watch(
  [() => props.modelValue, () => props.action, () => props.region?.id],
  ([visible]) => {
    if (!visible) {
      submitRequested.value = false
    }
  },
)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="copy.title"
    description="请核对地区与影响范围后再确认。"
    size="sm"
    :submitting="interactionLocked"
    @update:model-value="handleVisibilityChange"
  >
    <template #header-leading>
      <FaIcon
        :name="isDisable ? 'i-lucide:circle-pause' : 'i-lucide:circle-play'"
        class="size-5"
        aria-hidden="true"
      />
    </template>

    <div class="gap-4 grid">
      <FaAlert
        v-if="error"
        variant="destructive"
        icon="i-lucide:circle-alert"
        title="操作失败"
        role="alert"
      >
        <template #description>
          <div class="gap-2 grid">
            <span class="break-words">{{ error }}</span>
            <code
              v-if="requestId"
              class="qs-type-data break-all"
            >
              requestId: {{ requestId }}
            </code>
          </div>
        </template>
      </FaAlert>

      <dl class="m-0 gap-3 grid">
        <div class="gap-1 grid">
          <dt class="qs-type-label text-muted-foreground">
            完整路径
          </dt>
          <dd class="qs-type-body-medium m-0 break-words">
            {{ fullPath }}
          </dd>
        </div>

        <div class="gap-1 grid">
          <dt class="qs-type-label text-muted-foreground">
            当前操作对象
          </dt>
          <dd class="m-0 flex flex-wrap gap-x-2 gap-y-1 items-baseline">
            <strong class="qs-type-body-medium break-words">
              {{ region?.name ?? '未选择地区' }}
            </strong>
            <code v-if="region" class="qs-type-data-emphasis break-all">
              {{ region.code }}
            </code>
          </dd>
        </div>
      </dl>

      <FaAlert
        v-if="isDisable"
        variant="destructive"
        icon="i-lucide:triangle-alert"
        title="停用影响"
      >
        <template #description>
          {{ copy.consequence }}
        </template>
      </FaAlert>
      <FaAlert
        v-else
        icon="i-lucide:info"
        title="启用影响"
      >
        <template #description>
          {{ copy.consequence }}
        </template>
      </FaAlert>
    </div>

    <!-- 与表单弹窗一致，操作节点留在默认 slot，保证点击事件落到真实 DOM。 -->
    <div
      data-slot="region-status-actions"
      class="mt-6 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 border-t border-border/70 bg-muted/25 flex flex-col gap-2 -mx-4 -mb-4 sm:px-6 sm:flex-row sm:items-center sm:justify-end sm:-mx-6 sm:-mb-6"
      @click="handleStatusActionClick"
    >
      <FaButton
        type="button"
        data-region-status-action="cancel"
        variant="outline"
        class="min-h-[44px] w-full sm:w-auto"
        :disabled="interactionLocked"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        data-region-status-action="submit"
        :variant="isDisable ? 'destructive' : 'default'"
        class="min-h-[44px] w-full sm:w-auto"
        :loading="interactionLocked"
        :disabled="interactionLocked || region === null"
        :aria-label="`${copy.confirmLabel}${region?.name ?? '地区'}`"
      >
        {{ copy.confirmLabel }}
      </FaButton>
    </div>
  </QsGenericModal>
</template>
