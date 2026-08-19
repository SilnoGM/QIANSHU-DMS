<script setup lang="ts">
import type {
  CreateFundPostingTypeRequestDto,
  FundPostingRuleLegRequestDto,
  FundPostingTypeDto,
  UpdateFundPostingTypeRequestDto,
} from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  buildFundPostingTypeCreateRequest,
  buildFundPostingTypeUpdateRequest,
} from './fund-configuration.logic'
import FundPostingRuleEditor from './fund-posting-rule-editor.vue'

defineOptions({ name: 'FundPostingTypeFormModal' })

const props = withDefaults(defineProps<{
  error?: null | string
  mode: FormMode
  modelValue: boolean
  requestId?: null | string
  submitting?: boolean
  target: FundPostingTypeDto | null
}>(), {
  error: null,
  requestId: null,
  submitting: false,
})

const emit = defineEmits<{
  'submit': [payload: CreateFundPostingTypeRequestDto | UpdateFundPostingTypeRequestDto]
  'update:modelValue': [value: boolean]
}>()

type FormMode = 'create' | 'edit'

const code = ref('')
const name = ref('')
const description = ref('')
const businessCategory = ref<CreateFundPostingTypeRequestDto['businessCategory']>('COST')
const amountSignPolicy = ref<CreateFundPostingTypeRequestDto['amountSignPolicy']>('POSITIVE_ONLY')
const legs = ref<FundPostingRuleLegRequestDto[]>([])
const localError = ref('')

const categoryOptions = [
  { label: '收益', value: 'REVENUE' },
  { label: '成本', value: 'COST' },
  { label: '非收益成本', value: 'NEUTRAL' },
]
const amountSignOptions = [
  { label: '必须大于 0', value: 'POSITIVE_ONLY' },
  { label: '非零，可正可负', value: 'NON_ZERO_SIGNED' },
]

function resetForm(): void {
  code.value = ''
  name.value = props.target?.name ?? ''
  description.value = props.target?.description ?? ''
  businessCategory.value = 'COST'
  amountSignPolicy.value = 'POSITIVE_ONLY'
  legs.value = [
    {
      accountTarget: 'USER',
      amountStrategy: 'USER_SHARE',
      directionPolicy: 'DEBIT',
      position: 1,
    },
    {
      accountTarget: 'COMPANY',
      amountStrategy: 'COMPANY_REMAINDER',
      directionPolicy: 'DEBIT',
      position: 2,
    },
  ]
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

function updateCategory(value: unknown): void {
  if (value === 'REVENUE' || value === 'COST' || value === 'NEUTRAL') {
    businessCategory.value = value
    localError.value = ''
  }
}

function updateAmountPolicy(value: unknown): void {
  if (value === 'POSITIVE_ONLY' || value === 'NON_ZERO_SIGNED') {
    amountSignPolicy.value = value
    localError.value = ''
  }
}

function submit(): void {
  if (props.submitting) {
    return
  }
  try {
    const payload = props.mode === 'create'
      ? buildFundPostingTypeCreateRequest({
          amountSignPolicy: amountSignPolicy.value,
          businessCategory: businessCategory.value,
          code: code.value,
          description: description.value,
          legs: legs.value,
          name: name.value,
        })
      : props.target === null
        ? null
        : buildFundPostingTypeUpdateRequest(
            props.target,
            name.value,
            description.value,
          )
    if (payload === null) {
      return
    }
    localError.value = ''
    emit('submit', payload)
  }
  catch (error) {
    localError.value = error instanceof Error
      ? error.message
      : '业务类型配置无效'
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
    :title="mode === 'create' ? '创建业务类型' : '编辑业务类型'"
    description="类型身份与历史分类在创建后保持稳定；规则通过独立草稿版本发布。"
    size="lg"
    :submitting="submitting"
    @update:model-value="updateVisible"
  >
    <FaAlert
      v-if="error || localError"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="业务类型保存失败"
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
      v-if="mode === 'create'"
      icon="i-lucide:lock-keyhole"
      title="稳定身份字段"
      description="创建后编码和业务分类不可修改；ADMIN_MANUAL_ADJUSTMENT 是系统保留编码。"
      class="mb-4"
    />

    <div v-else class="mb-5 p-4 border border-border rounded-lg bg-muted/25">
      <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2 max-[479px]:grid-cols-1">
        <div>
          <dt class="qs-type-compact-label mb-1">
            稳定编码
          </dt>
          <dd class="qs-type-data-emphasis font-mono m-0 break-all">
            {{ target?.code }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            历史分类
          </dt>
          <dd class="qs-type-data m-0">
            {{ target?.businessCategory }}
          </dd>
        </div>
      </dl>
    </div>

    <FaForm :model="{ code, name, description }" :disabled="submitting" @submit="submit">
      <div class="gap-x-4 gap-y-4 grid grid-cols-2 max-[479px]:grid-cols-1">
        <FaFormItem v-if="mode === 'create'" name="code" label="类型编码" required>
          <FaInput
            v-model="code"
            autocapitalize="characters"
            autocomplete="off"
            class="w-full"
            maxlength="64"
            placeholder="例如 STORAGE_FEE"
          />
        </FaFormItem>
        <FaFormItem name="name" label="类型名称" required>
          <FaInput v-model="name" autocomplete="off" class="w-full" maxlength="128" />
        </FaFormItem>
        <FaFormItem v-if="mode === 'create'" name="businessCategory" label="业务分类" required>
          <FaSelect
            :model-value="businessCategory"
            :options="categoryOptions"
            class="min-h-11 w-full sm:min-h-9"
            @update:model-value="updateCategory"
          />
        </FaFormItem>
        <FaFormItem v-if="mode === 'create'" name="amountSignPolicy" label="金额策略" required>
          <FaSelect
            :model-value="amountSignPolicy"
            :options="amountSignOptions"
            class="min-h-11 w-full sm:min-h-9"
            @update:model-value="updateAmountPolicy"
          />
        </FaFormItem>
      </div>

      <FaFormItem name="description" label="说明">
        <FaTextarea
          v-model="description"
          class="w-full"
          input-class="min-h-24 max-h-40"
          maxlength="500"
          placeholder="说明该业务类型的适用场景"
        />
      </FaFormItem>

      <FaFormItem v-if="mode === 'create'" name="legs" label="初始规则草稿" required :auto-bind="false">
        <FundPostingRuleEditor
          v-model="legs"
          :amount-sign-policy="amountSignPolicy"
          :disabled="submitting"
        />
      </FaFormItem>
    </FaForm>

    <template #footer>
      <FaButton variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="submitting" @click="close">
        取消
      </FaButton>
      <FaButton class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="submitting" :disabled="submitting" @click="submit">
        {{ mode === 'create' ? '创建草稿' : '保存基本信息' }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
