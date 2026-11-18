<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  normalizeProductLibraryAlias,
  validateProductLibraryAlias,
} from './product-library.logic'

defineOptions({ name: 'ProductLibraryAliasModal' })

const props = withDefaults(defineProps<{
  currentAlias?: string | null
  error?: string
  modelValue: boolean
  productName: string
  productNo: string
  saving?: boolean
}>(), {
  currentAlias: null,
  error: '',
  saving: false,
})

const emit = defineEmits<{
  'clear': []
  'save': [alias: string]
  'update:modelValue': [value: boolean]
}>()

const draft = ref('')
const validationError = computed(() => draft.value.trim() === '' ? null : validateProductLibraryAlias(draft.value))
const unchanged = computed(() => normalizeProductLibraryAlias(draft.value) === (props.currentAlias ?? ''))
const canSave = computed(() => !props.saving
  && !validationError.value
  && draft.value.trim() !== ''
  && !unchanged.value)
const hasAlias = computed(() => Boolean(props.currentAlias?.trim()))

watch(
  () => [props.modelValue, props.currentAlias] as const,
  ([visible]) => {
    if (visible) {
      draft.value = props.currentAlias ?? ''
    }
  },
  { immediate: true },
)

function setVisible(value: boolean): void {
  if (props.saving) {
    return
  }
  emit('update:modelValue', value)
}

function save(): void {
  if (!canSave.value) {
    return
  }
  emit('save', normalizeProductLibraryAlias(draft.value))
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="设置产品别名"
    :description="`${productName} · ${productNo}`"
    size="sm"
    :submitting="saving"
    :closable="!saving"
    @update:model-value="setVisible"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:tag" class="size-4" aria-hidden="true" />
    </template>

    <div class="gap-3 grid">
      <FaAlert v-if="error" :description="error" variant="destructive" />
      <FaInput
        v-model="draft"
        :maxlength="36"
        placeholder="留空则唛头使用产品名称"
        aria-label="产品别名"
        class="w-full"
        @keydown.enter.prevent="save"
      />
      <div class="flex gap-3 items-center justify-between">
        <p class="qs-type-meta text-muted-foreground m-0">
          留空时唛头使用采购单上的产品名称。
        </p>
        <span class="qs-type-meta text-muted-foreground shrink-0">{{ Array.from(draft).length }}/36</span>
      </div>
      <p v-if="validationError" class="qs-type-meta text-destructive m-0">
        {{ validationError }}
      </p>
      <p class="qs-type-meta text-muted-foreground m-0">
        修改后会影响之后生成/查看的所有唛头，包括历史单据。
      </p>
    </div>

    <template #footer>
      <div class="flex flex-wrap gap-2 w-full justify-end">
        <FaButton
          v-if="hasAlias"
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="saving"
          @click="emit('clear')"
        >
          清除别名
        </FaButton>
        <FaButton
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="saving"
          @click="setVisible(false)"
        >
          取消
        </FaButton>
        <FaButton
          class="min-h-11 sm:min-h-9"
          :loading="saving"
          :disabled="!canSave"
          @click="save"
        >
          保存
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
