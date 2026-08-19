<script setup lang="ts">
import type {
  FundPostingRuleLegRequestDto,
  FundPostingTypeDto,
  ReplaceFundDraftRuleRequestDto,
} from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import { buildFundDraftRuleRequest } from './fund-configuration.logic'
import FundPostingRuleEditor from './fund-posting-rule-editor.vue'

defineOptions({ name: 'FundPostingRuleModal' })

const props = withDefaults(defineProps<{
  error?: null | string
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
  'submit': [payload: ReplaceFundDraftRuleRequestDto]
  'update:modelValue': [value: boolean]
}>()

const legs = ref<FundPostingRuleLegRequestDto[]>([])
const localError = ref('')

function resetForm(): void {
  const source = props.target?.draftRule?.legs ?? props.target?.activeRule?.legs ?? []
  legs.value = source.map((leg, index) => ({
    accountTarget: leg.accountTarget,
    amountStrategy: leg.amountStrategy,
    directionPolicy: leg.directionPolicy,
    position: index + 1,
  }))
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
  else { close() }
}

function submit(): void {
  if (props.submitting || props.target === null) {
    return
  }
  try {
    // builder 显式复制 accountTarget、directionPolicy 与 amountStrategy，拒绝任意公式字段。
    const payload = buildFundDraftRuleRequest(props.target, legs.value)
    localError.value = ''
    emit('submit', payload)
  }
  catch (error) {
    localError.value = error instanceof Error ? error.message : '规则草稿无效'
  }
}

watch(
  [() => props.modelValue, () => props.target?.id],
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
    title="编辑规则草稿"
    :description="target === null ? undefined : `${target.name}（${target.code}）`"
    size="lg"
    :submitting="submitting"
    @update:model-value="updateVisible"
  >
    <FaAlert
      v-if="error || localError"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="规则草稿保存失败"
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
      icon="i-lucide:shield-check"
      title="受控规则编辑"
      description="标准类型最多两条标准分录，只允许用户全额、公司全额或用户当前比例加公司尾差；保存后仍需单独发布。"
      class="mb-4"
    />

    <dl class="mb-5 p-4 border border-border rounded-lg bg-muted/25 gap-x-4 gap-y-3 grid grid-cols-2 max-[479px]:grid-cols-1">
      <div>
        <dt class="qs-type-compact-label mb-1">
          生效版本
        </dt>
        <dd class="qs-type-data m-0">
          {{ target?.activeRule ? `v${target.activeRule.revision}` : '尚未发布' }}
        </dd>
      </div>
      <div>
        <dt class="qs-type-compact-label mb-1">
          草稿版本
        </dt>
        <dd class="qs-type-data m-0">
          {{ target?.draftRule ? `v${target.draftRule.revision}` : '保存后新建' }}
        </dd>
      </div>
    </dl>

    <!--
      FundPostingRuleEditor 也会嵌入“创建业务类型”的现有 FaForm，因此不能在
      编辑器内部再创建 form。独立草稿 Modal 由调用侧补齐上下文，确保其中的
      FaFormItem 不会在 setup 阶段抛错并留下不可见模态遮罩。
    -->
    <FaForm :model="{ legs }" :disabled="submitting">
      <FundPostingRuleEditor
        v-if="target"
        v-model="legs"
        :amount-sign-policy="target.amountSignPolicy"
        :requires-user="target.requiresUser"
        :disabled="submitting"
      />
    </FaForm>

    <template #footer>
      <FaButton variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="submitting" @click="close">
        取消
      </FaButton>
      <FaButton class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="submitting" :disabled="submitting" @click="submit">
        保存规则草稿
      </FaButton>
    </template>
  </QsGenericModal>
</template>
