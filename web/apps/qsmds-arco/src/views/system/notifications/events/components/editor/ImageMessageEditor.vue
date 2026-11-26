<script setup lang="ts">
import type { NotificationEventMediaSourceDto } from '@/api/generated/types.gen'

import { computed } from 'vue'
import { imageMaxCount, imageSourceKeys } from '../../message-editor.logic'

const props = defineProps<{
  modelValue: Record<string, unknown>
  sources: NotificationEventMediaSourceDto[]
  maxCount: number
  disabled?: boolean
  sourceError?: string
  maxCountError?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
}>()

const sourceKeys = computed(() => props.sources.map(source => source.key))
const selected = computed(() => new Set(imageSourceKeys(props.modelValue, sourceKeys.value)))
const currentMaxCount = computed(() => imageMaxCount(props.modelValue))

function update(next: Record<string, unknown>): void {
  emit('update:modelValue', next)
}

function toggleSource(key: string): void {
  const next = new Set(selected.value)
  if (next.has(key)) {
    if (next.size <= 1) {
      return
    }
    next.delete(key)
  }
  else {
    next.add(key)
  }
  update({
    ...props.modelValue,
    sourceKeys: sourceKeys.value.filter(sourceKey => next.has(sourceKey)),
  })
}

function setMaxCount(value: string): void {
  const parsed = Number(value)
  const normalized = Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, Math.max(1, props.maxCount))
    : 1
  update({ ...props.modelValue, maxCount: normalized })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <div class="text-sm font-medium">
        附件来源
      </div>
      <p class="text-xs text-muted-foreground mt-0.5">
        发布时从业务附件中按来源选取；至少保留一个来源。
      </p>
    </div>

    <div class="gap-2 grid sm:grid-cols-2">
      <label
        v-for="source in sources"
        :key="source.key"
        class="text-sm px-3 py-2.5 border border-border rounded-lg bg-background flex gap-2 items-center hover:bg-muted/30"
      >
        <FaCheckbox
          :model-value="selected.has(source.key)"
          :disabled="disabled"
          @update:model-value="toggleSource(source.key)"
        />
        <span class="flex-1 min-w-0">
          <span class="block truncate">{{ source.label }}</span>
          <span class="text-[11px] text-muted-foreground font-mono block truncate">{{ source.key }}</span>
        </span>
      </label>
    </div>
    <p v-if="sourceError !== undefined" class="text-xs text-destructive m-0">
      {{ sourceError }}
    </p>

    <label class="text-sm flex flex-col gap-1 max-w-48">
      <span class="font-medium">最多发送张数</span>
      <FaInput
        type="number"
        min="1"
        :max="maxCount"
        :model-value="String(currentMaxCount)"
        :disabled="disabled"
        @update:model-value="value => setMaxCount(value ?? '1')"
      />
      <span class="text-xs text-muted-foreground">最多 {{ maxCount }} 张，图片在全部正文之后发送。</span>
      <span v-if="maxCountError !== undefined" class="text-xs text-destructive">{{ maxCountError }}</span>
    </label>
  </div>
</template>
