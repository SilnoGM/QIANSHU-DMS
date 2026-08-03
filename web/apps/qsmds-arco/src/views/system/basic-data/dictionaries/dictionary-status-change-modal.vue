<script setup lang="ts">
import type {
  DictionaryStatusChangeModalProps,
  DictionaryStatusChangeRequest,
} from './dictionary-status.logic'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  createDictionaryStatusChangeRequest,
  dictionaryStatusChangeCopy,
} from './dictionary-status.logic'

defineOptions({ name: 'DictionaryStatusChangeModal' })

const props = withDefaults(defineProps<DictionaryStatusChangeModalProps>(), {
  error: null,
  errorCode: undefined,
  requestId: undefined,
  submissionBlocked: false,
  submitting: false,
})

const emit = defineEmits<{
  cancel: []
  submit: [request: DictionaryStatusChangeRequest]
}>()

const submitRequested = ref(false)
const interactionLocked = computed(
  () => props.submitting || submitRequested.value,
)
const isDisable = computed(() => props.action === 'disable')
const copy = computed(() => dictionaryStatusChangeCopy(props.action))
const hasEnabledItems = computed(() =>
  props.type !== null && props.type.enabledItemCount > 0)
const targetAlreadyReached = computed(() =>
  props.type !== null && props.type.enabled === !isDisable.value)
const submitDisabled = computed(() =>
  interactionLocked.value
  || props.submissionBlocked
  || props.type === null
  || targetAlreadyReached.value
  || (!isDisable.value && !hasEnabledItems.value))
const enabledItemRequired = computed(() =>
  props.errorCode === 'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED')

function handleCancel(): void {
  if (interactionLocked.value) {
    return
  }
  emit('cancel')
}

function handleVisibilityChange(value: boolean): void {
  // 遮罩、Escape 与关闭按钮都必须经过同一把本地提交锁。
  if (value || interactionLocked.value) {
    return
  }
  emit('cancel')
}

async function handleSubmit(): Promise<void> {
  if (submitDisabled.value) {
    return
  }

  const request = createDictionaryStatusChangeRequest(
    props.action,
    props.type,
    props.submitting,
  )
  if (request === null) {
    return
  }

  /*
   * 父页面回写 submitting 前，同一事件循环仍可能收到第二次点击；先设置本地锁，
   * 若父页面没有进入提交态，则在一次渲染后释放，避免界面永久锁死。
   */
  submitRequested.value = true
  emit('submit', request)
  await nextTick()
  if (!props.submitting) {
    submitRequested.value = false
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
  [() => props.modelValue, () => props.action, () => props.type?.id],
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
    :description="copy.description"
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
            <span v-if="enabledItemRequired" class="font-medium">
              请先为该类型配置并启用至少一个自身启用条目，再重新发起启用。
            </span>
            <code v-if="requestId" class="qs-type-data break-all">
              requestId: {{ requestId }}
            </code>
          </div>
        </template>
      </FaAlert>

      <dl class="m-0 gap-3 grid">
        <div class="gap-1 grid">
          <dt class="qs-type-label text-muted-foreground">
            字典类型
          </dt>
          <dd class="m-0 flex flex-wrap gap-x-2 gap-y-1 items-baseline">
            <strong class="qs-type-body-medium break-words">
              {{ type?.name ?? '未选择字典类型' }}
            </strong>
            <code v-if="type" class="qs-type-data-emphasis break-all">
              {{ type.code }}
            </code>
          </dd>
        </div>

        <div v-if="type" class="gap-1 grid">
          <dt class="qs-type-label text-muted-foreground">
            条目状态
          </dt>
          <dd class="qs-type-body m-0">
            自身启用 {{ type.enabledItemCount }} / 全部 {{ type.itemCount }}
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
        :variant="hasEnabledItems ? 'default' : 'destructive'"
        :icon="hasEnabledItems ? 'i-lucide:info' : 'i-lucide:circle-alert'"
        title="启用条件"
        :role="hasEnabledItems ? 'status' : 'alert'"
      >
        <template #description>
          {{ copy.consequence }}
          <span v-if="!hasEnabledItems" class="font-medium">
            当前不满足至少一个自身启用条目的约束，暂不可提交。
          </span>
        </template>
      </FaAlert>
    </div>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:w-auto"
        :disabled="interactionLocked"
        @click="handleCancel"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        :variant="isDisable ? 'destructive' : 'default'"
        class="min-h-11 w-full sm:w-auto"
        :loading="interactionLocked"
        :disabled="submitDisabled"
        :aria-label="`${copy.confirmLabel}${type?.name ?? '字典类型'}`"
        @click="handleSubmit"
      >
        {{ copy.confirmLabel }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
