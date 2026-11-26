<script setup lang="ts">
import type { TargetValueOption } from '../target-options'

import { FaPopover } from '@fantastic-admin/components'
import { computed, ref, watch } from 'vue'
import { filterTargetOptions, targetOptionLabel, toggleTargetValue } from '../target-options'

const props = withDefaults(defineProps<{
  modelValue: string[]
  options: TargetValueOption[]
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  emptyText?: string
}>(), {
  placeholder: '请选择',
  disabled: false,
  loading: false,
  emptyText: '没有匹配的选项',
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const open = ref(false)
const search = ref('')
const selected = computed(() => new Set(props.modelValue))
const filtered = computed(() => filterTargetOptions(props.options, search.value))
const triggerLabel = computed(() => {
  if (props.loading) {
    return '正在加载选项…'
  }
  return props.modelValue.length === 0 ? props.placeholder : `已选择 ${props.modelValue.length} 项`
})

function labelFor(value: string): string {
  return targetOptionLabel(props.options, value)
}

function toggle(value: string): void {
  emit('update:modelValue', toggleTargetValue(props.modelValue, value))
}

function remove(value: string): void {
  emit('update:modelValue', props.modelValue.filter(item => item !== value))
}

function clearAll(): void {
  emit('update:modelValue', [])
}

watch(open, (value) => {
  if (!value) {
    search.value = ''
  }
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="modelValue.length > 0" class="flex flex-wrap gap-1.5">
      <span
        v-for="value in modelValue"
        :key="value"
        class="text-xs px-2 py-1 border border-border rounded-md bg-muted/50 inline-flex gap-1 max-w-full items-center"
      >
        <span class="truncate">{{ labelFor(value) }}</span>
        <button
          v-if="!disabled"
          type="button"
          class="text-muted-foreground shrink-0 hover:text-foreground"
          :aria-label="`移除 ${labelFor(value)}`"
          @click="remove(value)"
        >
          <FaIcon name="i-lucide:x" class="size-3" />
        </button>
      </span>
    </div>

    <FaPopover v-model:open="open" class="p-0 max-w-[calc(100vw-2rem)] w-80" :collision-padding="16">
      <button
        type="button"
        class="text-sm px-3 border border-border rounded-md bg-background flex gap-2 h-9 w-full items-center justify-between disabled:opacity-60 disabled:cursor-not-allowed"
        :disabled="disabled || loading"
        aria-haspopup="listbox"
        :aria-expanded="open"
      >
        <span
          class="truncate"
          :class="modelValue.length === 0 || loading ? 'text-muted-foreground' : 'text-foreground'"
        >
          {{ triggerLabel }}
        </span>
        <FaIcon name="i-lucide:chevron-down" class="text-muted-foreground shrink-0 size-4" />
      </button>

      <template #panel>
        <div class="flex flex-col">
          <div class="p-2 border-b border-border">
            <FaInput
              v-model="search"
              type="search"
              clearable
              class="w-full"
              placeholder="搜索选项"
              aria-label="搜索选项"
            />
          </div>
          <div class="p-1 max-h-64 overflow-y-auto" role="listbox" aria-multiselectable="true">
            <button
              v-for="option in filtered"
              :key="option.value"
              type="button"
              role="option"
              :aria-selected="selected.has(option.value)"
              class="text-sm px-2 py-2 text-left rounded-md flex gap-2 w-full items-center hover:bg-muted/60"
              @click="toggle(option.value)"
            >
              <span
                class="border rounded flex shrink-0 size-4 items-center justify-center"
                :class="selected.has(option.value)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background'"
              >
                <FaIcon v-if="selected.has(option.value)" name="i-lucide:check" class="size-3" />
              </span>
              <span class="flex-1 min-w-0">
                <span class="text-sm block truncate">{{ option.label }}</span>
                <span v-if="option.description !== undefined" class="text-[11px] text-muted-foreground font-mono block truncate">
                  {{ option.description }}
                </span>
              </span>
            </button>
            <div v-if="filtered.length === 0" class="text-xs text-muted-foreground py-6 text-center">
              {{ emptyText }}
            </div>
          </div>
          <div class="p-2 border-t border-border flex items-center justify-between">
            <span class="text-xs text-muted-foreground">已选 {{ modelValue.length }} 项</span>
            <button
              v-if="modelValue.length > 0 && !disabled"
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground"
              @click="clearAll"
            >
              清空
            </button>
          </div>
        </div>
      </template>
    </FaPopover>
  </div>
</template>
