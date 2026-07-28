<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type {
  RegionFormModalEmits,
  RegionFormModalProps,
  RegionFormModel,
  RegionFormResolvedFieldErrors,
} from './region-form.logic'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  buildCreateRegionFormSubmit,
  buildUpdateRegionFormSubmit,
  createRegionFormModel,
  firstRegionFormErrorField,
  formatRegionFormParentPath,
  regionFormLevelLabel,
  resolveRegionFormFieldErrors,
  validateRegionForm,
} from './region-form.logic'

defineOptions({ name: 'RegionFormModal' })

const props = withDefaults(defineProps<RegionFormModalProps>(), {
  error: null,
  fieldErrors: undefined,
  region: null,
  requestId: null,
  submitting: false,
})

const emit = defineEmits<RegionFormModalEmits>()

const formRef = useTemplateRef<FormExpose<RegionFormModel>>('formRef')
const model = reactive<RegionFormModel>(createRegionFormModel(props.mode, props.region))
const localError = ref('')
const localFieldErrors = ref<RegionFormResolvedFieldErrors>({})
const submitRequested = ref(false)

const submitLocked = computed(() => props.submitting || submitRequested.value)
const parentPathLabel = computed(() => formatRegionFormParentPath(props.parentPath))
const targetLevelLabel = computed(() => regionFormLevelLabel(props.targetLevel))
const externalFieldErrors = computed(() =>
  resolveRegionFormFieldErrors(props.fieldErrors, props.mode))
const visibleFieldErrors = computed<RegionFormResolvedFieldErrors>(() => ({
  ...externalFieldErrors.value,
  ...localFieldErrors.value,
}))
const visibleError = computed(() => {
  if (typeof props.error === 'string' && props.error.trim() !== '') {
    return props.error
  }
  if (localError.value !== '') {
    return localError.value
  }
  return Object.keys(externalFieldErrors.value).length > 0
    ? '部分字段未通过校验，请检查后重试'
    : ''
})
const hasEditChanges = computed(() => {
  if (props.mode !== 'edit' || props.region === null) {
    return false
  }
  return Object.keys(
    buildUpdateRegionFormSubmit(model, props.region).value,
  ).length > 0
})
const submitDisabled = computed(() =>
  submitLocked.value
  || (props.mode === 'edit' && !hasEditChanges.value)
  || (props.mode === 'edit' && props.region === null))

function replaceModel(next: RegionFormModel): void {
  model.code = next.code
  model.enabled = next.enabled
  model.englishName = next.englishName
  model.name = next.name
  model.sortOrder = next.sortOrder
}

async function applyFieldErrors(
  errors: RegionFormResolvedFieldErrors,
  focusFirst: boolean,
): Promise<void> {
  formRef.value?.clearValidate()
  for (const [field, message] of Object.entries(errors)) {
    formRef.value?.setFieldError(field, message)
  }

  if (!focusFirst) {
    return
  }
  const firstField = firstRegionFormErrorField(errors, props.mode)
  if (firstField === undefined) {
    return
  }

  // FaForm 的 scrollToField 同时滚动并聚焦真实控件；等待错误 DOM 完成后再执行，
  // 避免 Modal 首帧或 Server 错误刚到达时找不到字段节点。
  await nextTick()
  formRef.value?.scrollToField(firstField)
}

async function initializeForm(): Promise<void> {
  replaceModel(createRegionFormModel(props.mode, props.region))
  localError.value = props.mode === 'edit' && props.region === null
    ? '地区资料不完整，请关闭弹窗后重试'
    : ''
  localFieldErrors.value = {}
  submitRequested.value = false
  await nextTick()
  await applyFieldErrors(visibleFieldErrors.value, true)
}

function cancel(): void {
  if (submitLocked.value) {
    return
  }
  emit('cancel')
}

function handleModalVisibleChange(visible: boolean): void {
  if (!visible) {
    cancel()
  }
}

function handleFormActionClick(event: MouseEvent): void {
  const target = event.target
  const actionRoot = event.currentTarget
  if (!(target instanceof Element) || !(actionRoot instanceof HTMLElement)) {
    return
  }

  const actionButton = target.closest<HTMLElement>('[data-region-form-action]')
  if (actionButton === null || !actionRoot.contains(actionButton)) {
    return
  }

  /*
   * FaButton 经过 Modal slot 与 Primitive 两层组件边界后，浏览器最终按钮仍能保留
   * type/data 属性，但不能把业务提交依赖在 listener fallthrough 上。操作区作为
   * 稳定原生祖先统一接管 click；键盘 Enter 仍由 FaForm 的 submit 事件处理。
   */
  event.preventDefault()
  if (actionButton.dataset.regionFormAction === 'cancel') {
    cancel()
    return
  }
  if (actionButton.dataset.regionFormAction === 'submit') {
    void submit()
  }
}

async function submit(): Promise<void> {
  if (submitLocked.value) {
    return
  }

  localError.value = ''
  localFieldErrors.value = validateRegionForm(model, props.mode)
  await applyFieldErrors(visibleFieldErrors.value, true)
  if (Object.keys(localFieldErrors.value).length > 0) {
    localError.value = '部分字段未通过校验，请检查后重试'
    return
  }

  if (props.mode === 'edit' && props.region === null) {
    localError.value = '地区资料不完整，请关闭弹窗后重试'
    return
  }

  const submission = props.mode === 'create'
    ? buildCreateRegionFormSubmit(model, props.parentId)
    : buildUpdateRegionFormSubmit(model, props.region!)
  if (submission.mode === 'edit' && Object.keys(submission.value).length === 0) {
    localError.value = '没有可保存的变更'
    return
  }

  /*
   * 父页面会在 submit 后接管真实 mutation。这里先加本地锁，覆盖父 props 尚未经过
   * 下一次渲染的同步窗口，防止双击或 Enter 连发造成两次写请求。
   */
  submitRequested.value = true
  emit('submit', submission)
  await nextTick()
  if (!props.submitting) {
    submitRequested.value = false
  }
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      void initializeForm()
      return
    }
    localError.value = ''
    localFieldErrors.value = {}
    submitRequested.value = false
    formRef.value?.clearValidate()
  },
  { immediate: true },
)

watch(
  () => props.fieldErrors,
  () => {
    if (props.modelValue) {
      void applyFieldErrors(visibleFieldErrors.value, true)
    }
  },
  { deep: true },
)

watch(
  () => props.submitting,
  (submitting) => {
    if (!submitting) {
      submitRequested.value = false
    }
  },
)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="mode === 'create' ? '新增地区' : '编辑地区'"
    :description="mode === 'create'
      ? `在当前范围下新增${targetLevelLabel}`
      : '仅允许修改名称、英文名与排序'"
    size="lg"
    :submitting="submitLocked"
    @update:model-value="handleModalVisibleChange"
  >
    <FaAlert
      v-if="visibleError"
      class="mb-5"
      icon="i-lucide:circle-alert"
      title="保存失败"
      variant="destructive"
      role="alert"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ visibleError }}</span>
          <code v-if="requestId" class="qs-type-meta break-all">
            requestId: {{ requestId }}
          </code>
        </div>
      </template>
    </FaAlert>

    <div class="mb-5 p-4 border border-border rounded-lg bg-muted/35">
      <dl class="m-0 gap-x-5 gap-y-3 grid grid-cols-1 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <dt class="qs-type-compact-label mb-1">
            父级路径
          </dt>
          <dd class="qs-type-body m-0 break-words">
            {{ parentPathLabel }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            目标层级
          </dt>
          <dd class="qs-type-body m-0">
            {{ targetLevelLabel }}
          </dd>
        </div>
        <div v-if="mode === 'edit'">
          <dt class="qs-type-compact-label mb-1">
            地区 Code
          </dt>
          <dd class="qs-type-data-emphasis m-0 break-all">
            {{ region?.code || '—' }}
          </dd>
        </div>
      </dl>
    </div>

    <FaForm
      ref="formRef"
      :model="model"
      :disabled="submitLocked"
      class="gap-4"
      @submit="submit"
    >
      <div class="gap-x-4 gap-y-4 grid grid-cols-1 sm:grid-cols-2">
        <FaFormItem name="name" label="名称" required>
          <FaInput
            v-model="model.name"
            autocomplete="off"
            clearable
            class="w-full"
            maxlength="256"
            placeholder="请输入默认显示名称"
            @clear="model.name = ''"
          />
        </FaFormItem>

        <FaFormItem name="englishName" label="英文名">
          <FaInput
            v-model="model.englishName"
            autocomplete="off"
            clearable
            class="w-full"
            maxlength="256"
            placeholder="可选；留空表示不设置"
            @clear="model.englishName = ''"
          />
        </FaFormItem>

        <template v-if="mode === 'create'">
          <FaFormItem name="code" label="Code" required>
            <FaInput
              v-model="model.code"
              autocapitalize="characters"
              autocomplete="off"
              clearable
              class="w-full"
              maxlength="64"
              placeholder="例如 TW-64000"
              spellcheck="false"
              @clear="model.code = ''"
            />
          </FaFormItem>
        </template>

        <FaFormItem name="sortOrder" label="排序" required>
          <FaInput
            v-model="model.sortOrder"
            autocomplete="off"
            clearable
            class="w-full"
            inputmode="numeric"
            max="2147483647"
            min="0"
            placeholder="请输入 0 到 2147483647"
            step="1"
            type="number"
            @clear="model.sortOrder = ''"
          />
        </FaFormItem>

        <FaFormItem
          v-if="mode === 'create'"
          name="enabled"
          label="自身状态"
          :description="model.enabled
            ? '当前为启用；可立即用于业务地区选择。'
            : '当前为停用；该节点及其后代不会出现在业务地区选择器中。'"
          required
          class="sm:col-span-2"
        >
          <FaSwitch
            v-model="model.enabled"
            :disabled="submitLocked"
            :aria-label="model.enabled ? '自身状态：启用' : '自身状态：停用'"
            class="my-3 relative before:absolute before:-inset-3"
          />
        </FaFormItem>
      </div>

      <!--
        操作区必须留在默认内容与 FaForm 的真实 DOM 子树内；经过两级 footer slot
        转发会让组件事件失去稳定的原生落点。负边距保持 QsGenericModal footer 视觉。
      -->
      <div
        data-slot="region-form-actions"
        class="mt-6 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 border-t border-border/70 bg-muted/25 flex flex-col gap-2 -mx-4 -mb-4 sm:px-6 sm:flex-row sm:items-center sm:justify-end sm:-mx-6 sm:-mb-6"
        @click="handleFormActionClick"
      >
        <FaButton
          type="button"
          data-region-form-action="cancel"
          variant="outline"
          class="min-h-[44px] w-full sm:w-auto"
          :disabled="submitLocked"
        >
          取消
        </FaButton>
        <FaButton
          type="submit"
          data-region-form-action="submit"
          class="min-h-[44px] w-full sm:w-auto"
          :disabled="submitDisabled"
          :loading="submitLocked"
        >
          {{ mode === 'create' ? '创建地区' : '保存修改' }}
        </FaButton>
      </div>
    </FaForm>
  </QsGenericModal>
</template>
