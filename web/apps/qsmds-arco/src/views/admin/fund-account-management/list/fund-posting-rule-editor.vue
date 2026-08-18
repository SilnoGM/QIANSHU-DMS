<script setup lang="ts">
import type {
  CreateFundPostingTypeRequestDto,
  FundPostingRuleLegRequestDto,
} from '@/api/generated/types.gen'

defineOptions({ name: 'FundPostingRuleEditor' })

const props = withDefaults(defineProps<{
  amountSignPolicy: CreateFundPostingTypeRequestDto['amountSignPolicy']
  disabled?: boolean
  modelValue: readonly FundPostingRuleLegRequestDto[]
  requiresUser?: boolean
}>(), {
  disabled: false,
  requiresUser: undefined,
})
const emit = defineEmits<{
  'update:modelValue': [value: FundPostingRuleLegRequestDto[]]
}>()
type AllocationMode = 'BY_SHARE' | 'COMPANY_FULL' | 'USER_FULL'
type DirectionPolicy = FundPostingRuleLegRequestDto['directionPolicy']

const allocationMode = ref<AllocationMode>('BY_SHARE')
const directionPolicy = ref<DirectionPolicy>('DEBIT')

const allocationOptions = computed(() => [
  {
    disabled: props.requiresUser === false,
    label: '用户全额',
    value: 'USER_FULL',
  },
  {
    label: '公司全额',
    disabled: props.requiresUser === true,
    value: 'COMPANY_FULL',
  },
  {
    disabled: props.requiresUser === false,
    label: '按用户当前比例 / 公司尾差',
    value: 'BY_SHARE',
  },
])

const directionOptions = computed(() => (
  props.amountSignPolicy === 'NON_ZERO_SIGNED'
    ? [{ label: '跟随金额符号（正数入账，负数出账）', value: 'FOLLOW_AMOUNT_SIGN' }]
    : [
        { label: '入账', value: 'CREDIT' },
        { label: '出账', value: 'DEBIT' },
      ]
))

function resolveAllocationMode(
  legs: readonly FundPostingRuleLegRequestDto[],
): AllocationMode {
  if (legs.length === 1 && legs[0]?.accountTarget === 'USER') {
    return 'USER_FULL'
  }
  if (legs.length === 1 && legs[0]?.accountTarget === 'COMPANY') {
    return 'COMPANY_FULL'
  }
  return 'BY_SHARE'
}

function createLegs(): FundPostingRuleLegRequestDto[] {
  const policy = props.amountSignPolicy === 'NON_ZERO_SIGNED'
    ? 'FOLLOW_AMOUNT_SIGN'
    : directionPolicy.value
  if (allocationMode.value === 'USER_FULL') {
    return [{
      accountTarget: 'USER',
      amountStrategy: 'FULL_AMOUNT',
      directionPolicy: policy,
      position: 1,
    }]
  }
  if (allocationMode.value === 'COMPANY_FULL') {
    return [{
      accountTarget: 'COMPANY',
      amountStrategy: 'FULL_AMOUNT',
      directionPolicy: policy,
      position: 1,
    }]
  }
  return [
    {
      accountTarget: 'USER',
      amountStrategy: 'USER_SHARE',
      directionPolicy: policy,
      position: 1,
    },
    {
      accountTarget: 'COMPANY',
      amountStrategy: 'COMPANY_REMAINDER',
      directionPolicy: policy,
      position: 2,
    },
  ]
}

function applyChange(): void {
  emit('update:modelValue', createLegs())
}

function updateAllocation(value: unknown): void {
  if (
    value !== 'USER_FULL'
    && value !== 'COMPANY_FULL'
    && value !== 'BY_SHARE'
  ) {
    return
  }
  if (
    (props.requiresUser === false && value !== 'COMPANY_FULL')
    || (props.requiresUser === true && value === 'COMPANY_FULL')
  ) {
    return
  }
  allocationMode.value = value
  applyChange()
}

function updateDirection(value: unknown): void {
  if (
    value !== 'CREDIT'
    && value !== 'DEBIT'
    && value !== 'FOLLOW_AMOUNT_SIGN'
  ) {
    return
  }
  directionPolicy.value = value
  applyChange()
}

watch(
  () => [props.modelValue, props.amountSignPolicy] as const,
  ([legs, amountSignPolicy]) => {
    allocationMode.value = resolveAllocationMode(legs)
    directionPolicy.value = amountSignPolicy === 'NON_ZERO_SIGNED'
      ? 'FOLLOW_AMOUNT_SIGN'
      : (legs[0]?.directionPolicy === 'CREDIT' ? 'CREDIT' : 'DEBIT')
  },
  { deep: true, immediate: true },
)

watch(() => props.amountSignPolicy, () => applyChange())
</script>

<template>
  <div class="p-4 border border-border rounded-lg bg-muted/20 gap-4 grid">
    <div class="gap-x-4 gap-y-4 grid grid-cols-2 max-[479px]:grid-cols-1">
      <FaFormItem name="accountAllocation" label="账户目标与金额策略" required>
        <FaSelect
          :model-value="allocationMode"
          :options="allocationOptions"
          :disabled="disabled"
          class="min-h-11 w-full sm:min-h-9"
          @update:model-value="updateAllocation"
        />
      </FaFormItem>
      <FaFormItem name="directionPolicy" label="收支方向策略" required>
        <FaSelect
          :model-value="directionPolicy"
          :options="directionOptions"
          :disabled="disabled"
          class="min-h-11 w-full sm:min-h-9"
          @update:model-value="updateDirection"
        />
      </FaFormItem>
    </div>

    <div class="gap-2 grid" aria-label="规则分录预览">
      <div
        v-for="leg in modelValue"
        :key="`${leg.position}-${leg.accountTarget}`"
        class="px-3 py-2 border border-border/70 rounded-md bg-background flex flex-wrap gap-2 items-center justify-between"
      >
        <span class="qs-type-data-emphasis">分录 {{ leg.position }}</span>
        <code class="qs-type-meta break-all">
          {{ leg.accountTarget }} · {{ leg.directionPolicy }} · {{ leg.amountStrategy }}
        </code>
      </div>
    </div>
  </div>
</template>
