<script setup lang="ts">
import type {
  CreateFundBusinessSourceRequestDto,
  FundBusinessSourceDto,
  FundPostingTypeDto,
  UpdateFundBusinessSourceRequestDto,
} from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  buildFundBusinessSourceCreateRequest,
  buildFundBusinessSourceUpdateRequest,
} from './fund-configuration.logic'

defineOptions({ name: 'FundBusinessSourceFormModal' })

const props = withDefaults(defineProps<{
  error?: null | string
  mode: FormMode
  modelValue: boolean
  postingTypes: readonly FundPostingTypeDto[]
  requestId?: null | string
  submitting?: boolean
  target: FundBusinessSourceDto | null
}>(), {
  error: null,
  requestId: null,
  submitting: false,
})

const emit = defineEmits<{
  'submit': [payload: CreateFundBusinessSourceRequestDto | UpdateFundBusinessSourceRequestDto]
  'update:modelValue': [value: boolean]
}>()

type FormMode = 'create' | 'edit'

const code = ref('')
const name = ref('')
const description = ref('')
const enabled = ref(false)
const allowedPostingTypeIds = ref<string[]>([])
const typeSearch = ref('')
const localError = ref('')

const filteredPostingTypeOptions = computed(() => {
  const keyword = typeSearch.value.trim().toLocaleLowerCase()
  return props.postingTypes
    .filter(item => keyword.length === 0 || (
      item.code.toLocaleLowerCase().includes(keyword)
      || item.name.toLocaleLowerCase().includes(keyword)
    ))
    .map(item => ({
      label: `${item.name}（${item.code}）${item.enabled ? '' : ' · 已停用'}`,
      value: item.id,
    }))
})

function resetForm(): void {
  code.value = ''
  name.value = props.target?.name ?? ''
  description.value = props.target?.description ?? ''
  enabled.value = props.target?.enabled ?? false
  allowedPostingTypeIds.value = props.target?.allowedPostingTypes.map(item => item.id) ?? []
  typeSearch.value = ''
  localError.value = ''
}

function close(): void {
  if (!props.submitting) {
    emit('update:modelValue', false)
  }
}

function updateVisible(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
  }
  else {
    close()
  }
}

function submit(): void {
  if (props.submitting) {
    return
  }
  try {
    const payload = props.mode === 'create'
      ? buildFundBusinessSourceCreateRequest({
          allowedPostingTypeIds: allowedPostingTypeIds.value,
          code: code.value,
          description: description.value,
          enabled: enabled.value,
          name: name.value,
        })
      : props.target === null
        ? null
        : buildFundBusinessSourceUpdateRequest(props.target, {
            allowedPostingTypeIds: allowedPostingTypeIds.value,
            description: description.value,
            name: name.value,
          })
    if (payload === null) {
      return
    }
    localError.value = ''
    emit('submit', payload)
  }
  catch (error) {
    localError.value = error instanceof Error ? error.message : '业务来源配置无效'
  }
}

watch(
  [() => props.modelValue, () => props.target?.id, () => props.mode],
  ([visible]) => {
    if (visible) {
      resetForm()
    }
  },
)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="mode === 'create' ? '创建业务来源' : '编辑业务来源'"
    description="来源用于绑定可信业务域，并限制该业务域允许调用的资金类型。"
    size="lg"
    :submitting="submitting"
    @update:model-value="updateVisible"
  >
    <FaAlert
      v-if="error || localError"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="业务来源保存失败"
      class="mb-4"
      role="alert"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ localError || error }}</span>
          <code v-if="requestId" class="qs-type-meta break-all">requestId: {{ requestId }}</code>
        </div>
      </template>
    </FaAlert>

    <FaAlert
      icon="i-lucide:lock-keyhole"
      title="稳定来源身份"
      description="来源编码创建后不可修改；停用来源只阻止新调用，不影响历史批次。"
      class="mb-4"
    />

    <FaForm :model="{ code, name, description, enabled, allowedPostingTypeIds }" :disabled="submitting" @submit="submit">
      <div class="gap-x-4 gap-y-4 grid grid-cols-2 max-[479px]:grid-cols-1">
        <FaFormItem v-if="mode === 'create'" name="code" label="来源编码" required>
          <FaInput v-model="code" autocapitalize="characters" autocomplete="off" class="w-full" maxlength="64" placeholder="例如 ORDER_DOMAIN" />
        </FaFormItem>
        <FaFormItem v-else name="stableCode" label="稳定编码">
          <FaInput :model-value="target?.code ?? ''" class="font-mono w-full" disabled />
        </FaFormItem>
        <FaFormItem name="name" label="来源名称" required>
          <FaInput v-model="name" autocomplete="off" class="w-full" maxlength="128" />
        </FaFormItem>
      </div>

      <FaFormItem name="description" label="说明">
        <FaTextarea v-model="description" class="w-full" input-class="min-h-24 max-h-40" maxlength="500" />
      </FaFormItem>

      <FaFormItem v-if="mode === 'create'" name="enabled" label="创建后启用" required>
        <FaSwitch v-model="enabled" :disabled="submitting" :aria-label="enabled ? '创建后启用' : '创建后停用'" class="my-3 relative before:absolute before:-inset-3" />
      </FaFormItem>

      <FaFormItem name="allowedPostingTypeIds" label="允许业务类型" :auto-bind="false">
        <div class="gap-3 grid">
          <FaInput v-model="typeSearch" type="search" clearable class="w-full" placeholder="搜索类型名称或编码">
            <template #start>
              <FaIcon name="i-lucide:search" />
            </template>
          </FaInput>
          <FaEmpty
            v-if="filteredPostingTypeOptions.length === 0"
            icon="i-lucide:search-x"
            title="没有匹配业务类型"
            description="可调整关键词；空集合表示该来源暂不能调用任何类型。"
            class="py-5"
          />
          <FaCheckboxGroup
            v-else
            v-model="allowedPostingTypeIds"
            :options="filteredPostingTypeOptions"
            :disabled="submitting"
            :max="100"
            class="pr-1"
          />
        </div>
      </FaFormItem>
    </FaForm>

    <template #footer>
      <FaButton variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="submitting" @click="close">
        取消
      </FaButton>
      <FaButton class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="submitting" :disabled="submitting" @click="submit">
        {{ mode === 'create' ? '创建来源' : '保存来源' }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
