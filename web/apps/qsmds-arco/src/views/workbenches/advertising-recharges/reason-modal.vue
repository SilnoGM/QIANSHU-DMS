<script setup lang="ts">
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

const props = withDefaults(defineProps<{
  confirmLabel: string
  description?: string
  error?: null | string
  label: string
  modelValue: boolean
  submitting?: boolean
  title: string
}>(), {
  description: undefined,
  error: null,
  submitting: false,
})

const emit = defineEmits<{
  'confirm': [reason: string]
  'update:modelValue': [value: boolean]
}>()

const reason = ref('')

watch(() => props.modelValue, (visible) => {
  if (visible) {
    reason.value = ''
  }
})

function close(): void {
  if (!props.submitting) {
    emit('update:modelValue', false)
  }
}

function updateVisible(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
    return
  }
  close()
}

function submit(): void {
  if (props.submitting || reason.value.trim().length === 0) {
    return
  }
  emit('confirm', reason.value.trim())
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="title"
    :description="description"
    size="sm"
    :submitting="submitting"
    :dismiss-on-escape="!submitting"
    :dismiss-on-overlay="!submitting"
    @update:model-value="updateVisible"
  >
    <FaAlert v-if="error" :description="error" variant="destructive" class="mb-4" />
    <label class="flex flex-col gap-1.5">
      <span class="qs-type-meta text-muted-foreground">{{ label }}</span>
      <FaTextarea v-model="reason" maxlength="500" :rows="4" :disabled="submitting" :aria-label="label" />
    </label>

    <template #footer>
      <FaButton type="button" variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="submitting" @click="close">
        {{ $t('advertisingRecharge.action.cancel') }}
      </FaButton>
      <FaButton
        type="button"
        variant="destructive"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :loading="submitting"
        :disabled="reason.trim().length === 0"
        @click="submit"
      >
        {{ confirmLabel }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
