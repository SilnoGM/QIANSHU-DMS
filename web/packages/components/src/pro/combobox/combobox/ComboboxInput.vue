<script setup lang="ts">
import type { ComboboxInputProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit, useVModel } from '@vueuse/core'
import { ComboboxInput } from 'reka-ui'
import { ref } from 'vue'
import { cn } from '#utils'

const props = withDefaults(
  defineProps<ComboboxInputProps & { class?: HTMLAttributes['class'] }>(),
  {
    as: 'input',
  },
)

const emits = defineEmits<{
  'update:modelValue': [value: string]
}>()

const delegatedProps = reactiveOmit(props, 'class', 'modelValue')
const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
})

const inputRef = ref<HTMLInputElement | null>(null)

defineExpose({
  ref: inputRef,
})
</script>

<template>
  <ComboboxInput
    ref="inputRef"
    v-model="modelValue"
    data-slot="combobox-input"
    v-bind="delegatedProps"
    :class="cn(
      'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground h-full w-full min-w-0 bg-transparent px-3 py-1 text-sm shadow-none outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      props.class,
    )"
  >
    <slot />
  </ComboboxInput>
</template>
