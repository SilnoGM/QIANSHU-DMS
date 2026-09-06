<script setup lang="ts">
import type { NumberingPurpose } from '@/api/modules/numbering-purpose'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

const props = withDefaults(defineProps<{ modelValue: boolean, loading?: boolean }>(), { loading: false })
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'confirm': [purpose: NumberingPurpose]
  'closed': []
}>()
const selected = ref<NumberingPurpose | null>(null)
const requested = ref(false)
const locked = computed(() => props.loading || requested.value)
const choices = [
  { value: 'BUSINESS', label: '业务编码', tag: '业务单据', icon: 'i-lucide:binary', description: '用于销售订单、采购订单、产品等业务编号' },
  { value: 'SHIPPING_MARK', label: '唛头编码', tag: '货物标识', icon: 'i-lucide:tags', description: '用于唛头编码规则；本期不自动填写采购唛头' },
] as const
watch(() => props.modelValue, (visible) => {
  if (visible) {
    selected.value = null
    requested.value = false
  }
}, { immediate: true })
watch(() => props.loading, (loading) => {
  if (!loading) {
    requested.value = false
  }
})
async function confirm(): Promise<void> {
  if (selected.value === null || locked.value) {
    return
  }
  requested.value = true
  emit('confirm', selected.value)
  await nextTick()
  if (!props.loading) {
    requested.value = false
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue" size="xl" title="选择编码用途"
    description="先确定编码用途，再配置编号规则。两类编码使用相同的规则引擎与派发机制。"
    :submitting="locked" @update:model-value="emit('update:modelValue', $event)" @closed="emit('closed')"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:binary" />
    </template>
    <fieldset class="m-0 p-0 border-0 min-w-0" :disabled="locked">
      <legend class="qs-type-body-medium font-semibold mb-3">
        编码用途
      </legend>
      <div class="gap-4 grid grid-cols-1 sm:grid-cols-2" role="radiogroup" aria-label="编码用途">
        <label v-for="choice in choices" :key="choice.value" class="min-w-0 cursor-pointer relative">
          <input v-model="selected" type="radio" name="numbering-purpose" :value="choice.value" class="peer sr-only">
          <span
            data-testid="numbering-purpose-card" :data-purpose="choice.value"
            class="p-5 text-start border rounded-xl bg-background flex flex-col min-h-64 transition-[border-color,background-color,box-shadow] duration-200 relative overflow-hidden sm:p-6 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background motion-reduce:transition-none"
            :class="selected === choice.value ? 'border-primary bg-primary/[0.035] shadow-md ring-1 ring-primary/20' : 'border-border shadow-sm hover:border-primary/40 hover:bg-muted/20 hover:shadow-md'"
          >
            <span class="flex gap-4 min-w-0 items-start">
              <span
                class="rounded-xl flex shrink-0 size-16 ring-2 shadow-sm items-center justify-center"
                :class="choice.value === 'BUSINESS' ? 'text-emerald-700 bg-emerald-50 ring-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/60 dark:ring-emerald-700/50' : 'text-amber-700 bg-amber-50 ring-amber-200 dark:text-amber-300 dark:bg-amber-950/60 dark:ring-amber-700/50'"
              ><FaIcon :name="choice.icon" class="size-8" aria-hidden="true" /></span>
              <span class="flex-1 min-w-0">
                <strong class="text-lg leading-7 font-semibold block">{{ choice.label }}</strong>
                <span class="qs-type-meta mt-1.5 block">{{ choice.tag }}</span>
              </span>
              <FaIcon v-if="selected === choice.value" name="i-lucide:circle-check-big" class="text-primary shrink-0 size-7" aria-hidden="true" />
            </span>
            <span class="mt-6 pt-5 border-t border-dashed flex flex-1 flex-col min-w-0 relative">
              <span class="flex flex-wrap gap-x-3 gap-y-2 items-baseline relative z-10">
                <strong class="text-3xl leading-none font-semibold">{{ choice.label }}</strong>
                <code class="qs-type-meta break-all">{{ choice.value }}</code>
              </span>
              <span class="qs-type-meta mt-3 relative z-10">{{ choice.description }}</span>
              <span class="text-sm font-medium mt-auto pt-6 flex gap-2 items-center relative z-10" :class="selected === choice.value ? 'text-primary' : 'text-muted-foreground'">
                <FaIcon name="i-lucide:mouse-pointer-click" class="size-4" aria-hidden="true" />
                {{ selected === choice.value ? '已选中' : '点击选择' }}
              </span>
              <FaIcon :name="choice.icon" class="size-28 absolute -bottom-8 -right-5" :class="choice.value === 'BUSINESS' ? 'text-emerald-500/10 dark:text-emerald-400/10' : 'text-amber-500/10 dark:text-amber-400/10'" aria-hidden="true" />
            </span>
          </span>
        </label>
      </div>
    </fieldset>
    <p class="qs-type-description mb-0 mt-5 px-4 py-3 border border-border rounded-lg bg-muted/25">
      进入新增页后用途不可切换，请确认后继续
    </p>
    <template #footer>
      <FaButton variant="outline" :disabled="locked" @click="emit('update:modelValue', false)">
        取消
      </FaButton>
      <FaButton data-testid="numbering-purpose-continue" :disabled="selected === null || locked" :loading="locked" @click="confirm">
        进入新增规则
      </FaButton>
    </template>
  </QsGenericModal>
</template>
