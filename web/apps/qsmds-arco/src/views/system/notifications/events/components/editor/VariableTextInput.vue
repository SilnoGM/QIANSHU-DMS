<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { insertAtSelection } from '../../message-editor.logic'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  maxlength?: number | string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'focus': []
}>()

const rootRef = ref<HTMLElement | null>(null)
const selection = ref({ start: 0, end: 0 })
const hasSelection = ref(false)

function nativeInput(): HTMLInputElement | null {
  return rootRef.value?.querySelector('input') ?? null
}

function rememberSelection(): void {
  const element = nativeInput()
  if (element === null) {
    return
  }
  selection.value = { start: element.selectionStart ?? 0, end: element.selectionEnd ?? 0 }
  hasSelection.value = true
}

function handleFocusIn(): void {
  emit('focus')
  rememberSelection()
}

function handleUpdate(value: string | number | undefined): void {
  emit('update:modelValue', String(value ?? ''))
  rememberSelection()
}

function insertVariable(name: string): void {
  if (props.disabled || name.length === 0) {
    return
  }
  const token = `{{${name}}}`
  const start = hasSelection.value ? selection.value.start : props.modelValue.length
  const end = hasSelection.value ? selection.value.end : props.modelValue.length
  const inserted = insertAtSelection(props.modelValue, token, start, end)
  emit('update:modelValue', inserted.value)
  void nextTick(() => {
    const element = nativeInput()
    if (element === null) {
      return
    }
    element.focus()
    element.setSelectionRange(inserted.cursor, inserted.cursor)
    rememberSelection()
  })
}

defineExpose({ insertVariable })
</script>

<template>
  <div
    ref="rootRef"
    @focusin="handleFocusIn"
    @click="rememberSelection"
    @keyup="rememberSelection"
    @mouseup="rememberSelection"
  >
    <FaInput
      :model-value="modelValue"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :disabled="disabled"
      class="w-full"
      @update:model-value="handleUpdate"
    />
  </div>
</template>
