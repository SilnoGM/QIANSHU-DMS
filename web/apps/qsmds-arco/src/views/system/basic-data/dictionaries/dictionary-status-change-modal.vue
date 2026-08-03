<script setup lang="ts">
import type {
  DictionaryStatusChangeModalProps,
  DictionaryStatusChangeRequest,
} from './dictionary-status.logic'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  createDictionaryItemStatusChangeRequest,
  createDictionaryStatusChangeRequest,
  dictionaryItemStatusChangeCopy,
  dictionaryStatusChangeCopy,
} from './dictionary-status.logic'

defineOptions({ name: 'DictionaryStatusChangeModal' })

const props = withDefaults(defineProps<DictionaryStatusChangeModalProps>(), {
  error: null,
  errorCode: undefined,
  item: null,
  requestId: undefined,
  submissionBlocked: false,
  submitting: false,
  targetKind: 'type',
})

const emit = defineEmits<{
  cancel: []
  submit: [request: DictionaryStatusChangeRequest]
}>()

const submitRequested = ref(false)
const interactionLocked = computed(
  () => props.submitting || submitRequested.value,
)
const isItem = computed(() => props.targetKind === 'item')
const isDisable = computed(() => props.action === 'disable')
const copy = computed(() => isItem.value
  ? dictionaryItemStatusChangeCopy(props.action, props.type)
  : dictionaryStatusChangeCopy(props.action))
const hasEnabledItems = computed(() =>
  props.type !== null && props.type.enabledItemCount > 0)
const targetAlreadyReached = computed(() =>
  isItem.value
    ? props.item !== null && props.item.enabled === !isDisable.value
    : props.type !== null && props.type.enabled === !isDisable.value)
const itemIdentityInvalid = computed(() => isItem.value && (
  props.type === null
  || props.item === null
  || props.item.dictionaryTypeId !== props.type.id
))
const lastEnabledItemBlocked = computed(() =>
  isItem.value
  && isDisable.value
  && props.item?.enabled === true
  && props.type?.enabled === true
  && props.type.enabledItemCount <= 1)
const enabledItemRequired = computed(() =>
  props.errorCode === 'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED')
const submitDisabled = computed(() =>
  interactionLocked.value
  || props.submissionBlocked
  || enabledItemRequired.value
  || props.type === null
  || itemIdentityInvalid.value
  || targetAlreadyReached.value
  || lastEnabledItemBlocked.value
  || (!isItem.value && !isDisable.value && !hasEnabledItems.value))
const targetLabel = computed(() => isItem.value
  ? props.item?.label ?? '字典条目'
  : props.type?.name ?? '字典类型')

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

  const request = isItem.value
    ? createDictionaryItemStatusChangeRequest(
        props.action,
        props.type,
        props.item,
        props.submitting,
      )
    : createDictionaryStatusChangeRequest(
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
  [
    () => props.modelValue,
    () => props.action,
    () => props.targetKind,
    () => props.type?.id,
    () => props.item?.id,
  ],
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
              <template v-if="isItem">
                类型启用期间至少保留一个自身启用条目；请先启用其他条目，或先停用类型。
              </template>
              <template v-else>
                请先为该类型配置并启用至少一个自身启用条目，再重新发起启用。
              </template>
            </span>
            <code v-if="requestId" class="qs-type-data break-all">
              requestId: {{ requestId }}
            </code>
          </div>
        </template>
      </FaAlert>

      <dl class="m-0 gap-3 grid sm:grid-cols-2">
        <div v-if="isItem" class="gap-1 grid">
          <dt class="qs-type-label text-muted-foreground">
            字典条目
          </dt>
          <dd class="m-0 flex flex-wrap gap-x-2 gap-y-1 items-baseline">
            <strong class="qs-type-body-medium break-words">
              {{ item?.label ?? '未选择字典条目' }}
            </strong>
            <code v-if="item" class="qs-type-data-emphasis break-all">
              {{ item.value }}
            </code>
          </dd>
        </div>

        <div class="gap-1 grid">
          <dt class="qs-type-label text-muted-foreground">
            {{ isItem ? '所属字典类型' : '字典类型' }}
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

        <div v-if="type && !isItem" class="gap-1 grid sm:col-span-2">
          <dt class="qs-type-label text-muted-foreground">
            条目状态
          </dt>
          <dd class="qs-type-body m-0">
            自身启用 {{ type.enabledItemCount }} / 全部 {{ type.itemCount }}
          </dd>
        </div>

        <template v-if="isItem && item">
          <div class="gap-1 grid">
            <dt class="qs-type-label text-muted-foreground">
              自身状态
            </dt>
            <dd class="m-0">
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="item.enabled
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground'"
              >
                {{ item.enabled ? '已启用' : '已停用' }}
              </FaTag>
            </dd>
          </div>

          <div class="gap-1 grid">
            <dt class="qs-type-label text-muted-foreground">
              有效状态
            </dt>
            <dd class="m-0">
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="item.effectiveEnabled
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground'"
              >
                {{ item.effectiveEnabled ? '当前有效' : '当前无效' }}
              </FaTag>
            </dd>
          </div>
        </template>
      </dl>

      <FaAlert
        v-if="isItem"
        :variant="lastEnabledItemBlocked || isDisable ? 'destructive' : 'default'"
        :icon="lastEnabledItemBlocked || isDisable
          ? 'i-lucide:triangle-alert'
          : 'i-lucide:info'"
        :title="lastEnabledItemBlocked
          ? '暂不可停用'
          : isDisable ? '停用影响' : '启用结果'"
        :role="lastEnabledItemBlocked ? 'alert' : 'status'"
      >
        <template #description>
          <span>{{ copy.consequence }}</span>
          <span v-if="type && !type.enabled" class="font-medium">
            所属类型当前停用，有效状态由类型与条目的自身状态共同决定。
          </span>
          <span v-if="lastEnabledItemBlocked" class="font-medium">
            类型启用期间必须至少保留一个自身启用条目；请先启用其他条目，或先停用类型。
          </span>
        </template>
      </FaAlert>
      <FaAlert
        v-else-if="isDisable"
        variant="destructive"
        icon="i-lucide:triangle-alert"
        title="停用影响"
      >
        <template #description>
          {{ copy.consequence }}
        </template>
      </FaAlert>
      <FaAlert
        v-else-if="!isItem"
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
        :aria-label="`${copy.confirmLabel}${targetLabel}`"
        @click="handleSubmit"
      >
        {{ copy.confirmLabel }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
