<script setup lang="ts">
defineOptions({ name: 'ProductTaxonomySelect' })

const props = withDefaults(defineProps<{
  createLabel: string
  disabled?: boolean
  modelValue: string | null
  options: readonly string[]
  placeholder: string
  selectLabel: string
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const CREATE_OPTION_VALUE = '__CREATE_TAXONOMY_OPTION__' as const
const MAXIMUM_LENGTH = 64

const creating = ref(false)
const draft = ref('')
const createError = ref('')
const selectEpoch = ref(0)
const createInputRef = useTemplateRef<{ focus?: () => void }>('createInputRef')

const selectOptions = computed(() => {
  const options = props.options.map(value => ({ label: value, value }))
  // 本地新建值尚未进入服务端选项；先作为当前值显示，保存成功后由父级刷新选项。
  if (
    props.modelValue !== null
    && !props.options.includes(props.modelValue)
  ) {
    options.push({ label: props.modelValue, value: props.modelValue })
  }
  options.push({ label: `＋ ${props.createLabel}`, value: CREATE_OPTION_VALUE })
  return options
})

const selectValue = computed(() => props.modelValue ?? undefined)

function handleSelect(value: unknown): void {
  if (value === CREATE_OPTION_VALUE) {
    // FaSelect 会把哨兵保留为内部选中值；重建实例把触发器恢复为真实表单值。
    selectEpoch.value += 1
    void openCreate()
    return
  }
  if (typeof value !== 'string' || value === '') {
    emit('update:modelValue', null)
    return
  }
  emit('update:modelValue', value)
}

async function openCreate(): Promise<void> {
  if (props.disabled) {
    return
  }
  creating.value = true
  draft.value = ''
  createError.value = ''
  await nextTick()
  createInputRef.value?.focus?.()
}

function cancelCreate(): void {
  creating.value = false
  draft.value = ''
  createError.value = ''
}

function confirmCreate(): void {
  const normalized = draft.value.trim().normalize('NFC')
  const length = [...normalized].length
  if (length === 0) {
    createError.value = `请输入${props.createLabel.replace(/^新建/u, '')}名称`
    return
  }
  if (length > MAXIMUM_LENGTH) {
    createError.value = `不能超过 ${MAXIMUM_LENGTH} 个字符`
    return
  }
  const existing = props.options.find(value => value === normalized)
  emit('update:modelValue', existing ?? normalized)
  cancelCreate()
}

watch(() => props.disabled, (disabled) => {
  if (disabled) {
    cancelCreate()
  }
})
</script>

<template>
  <div class="gap-2 grid">
    <label class="block">
      <span class="sr-only">{{ selectLabel }}</span>
      <FaSelect
        :key="selectEpoch"
        :model-value="selectValue"
        :options="selectOptions"
        :placeholder="placeholder"
        :disabled="disabled"
        class="w-full"
        @update:model-value="handleSelect"
      />
    </label>
    <div
      v-if="creating"
      class="p-2 border border-border rounded-lg bg-muted/30 gap-2 grid"
    >
      <FaInput
        ref="createInputRef"
        v-model="draft"
        :aria-label="`输入${createLabel.replace(/^新建/u, '')}名称`"
        :disabled="disabled"
        :maxlength="MAXIMUM_LENGTH"
        :placeholder="`输入${createLabel.replace(/^新建/u, '')}名称`"
        @keydown.enter.prevent="confirmCreate"
        @keydown.esc.prevent="cancelCreate"
      />
      <p v-if="createError" class="text-xs text-destructive m-0" role="alert">
        {{ createError }}
      </p>
      <div class="flex gap-2 justify-end">
        <FaButton type="button" variant="outline" size="sm" @click="cancelCreate">
          取消
        </FaButton>
        <FaButton type="button" size="sm" @click="confirmCreate">
          确定
        </FaButton>
      </div>
    </div>
  </div>
</template>
