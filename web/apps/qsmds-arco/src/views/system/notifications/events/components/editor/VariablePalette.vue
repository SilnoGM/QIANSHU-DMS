<script setup lang="ts">
import type { NotificationEventVariableDto } from '@/api/generated/types.gen'

import { computed, ref } from 'vue'
import { filterVariables } from '../../message-editor.logic'

const props = withDefaults(defineProps<{
  variables: NotificationEventVariableDto[]
  variablesKnown: boolean
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  insert: [name: string]
}>()

const search = ref('')
const filtered = computed(() => filterVariables(props.variables, search.value))

function insert(name: string): void {
  if (!props.disabled) {
    emit('insert', name)
  }
}

function variableToken(name: string): string {
  return `{{${name}}}`
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="message-variable-palette">
    <div>
      <div class="text-sm font-medium">
        可用变量
      </div>
      <p class="text-xs text-muted-foreground mt-0.5">
        点击变量插入到正文；变量值由发布时业务数据渲染。
      </p>
    </div>

    <FaInput
      v-model="search"
      type="search"
      clearable
      class="w-full"
      placeholder="搜索变量名或说明"
      aria-label="搜索变量"
    />

    <FaAlert
      v-if="!variablesKnown"
      variant="destructive"
      title="该事件未登记变量说明，使用占位符可能导致发布失败"
    />

    <div v-if="filtered.length === 0" class="text-xs text-muted-foreground py-6 text-center border border-border rounded-lg border-dashed">
      没有匹配的变量
    </div>

    <div v-else class="pr-1 flex flex-col gap-1.5 max-h-[52vh] overflow-y-auto">
      <button
        v-for="variable in filtered"
        :key="variable.name"
        type="button"
        class="p-2.5 text-left border border-border rounded-lg bg-background flex flex-col gap-1 hover:bg-muted/40 disabled:opacity-60 disabled:cursor-not-allowed"
        :disabled="disabled"
        @mousedown.prevent
        @click="insert(variable.name)"
      >
        <span class="flex flex-wrap gap-1.5 items-center">
          <span class="text-sm font-medium">{{ variable.label }}</span>
          <span class="text-[11px] text-muted-foreground font-mono">{{ variableToken(variable.name) }}</span>
          <span v-if="variable.required" class="text-[10px] text-amber-700 px-1 py-0.5 border border-amber-500/25 rounded bg-amber-500/10 dark:text-amber-400">
            必填
          </span>
          <span v-if="variable.sensitive" class="text-[10px] text-rose-700 px-1 py-0.5 border border-rose-500/25 rounded bg-rose-500/10 dark:text-rose-400">
            敏感
          </span>
          <span class="text-[10px] text-muted-foreground ml-auto">≤{{ variable.maxLength }} 字</span>
        </span>
        <span class="text-xs text-muted-foreground">
          {{ variable.description }}
        </span>
        <span class="text-[11px] text-muted-foreground font-mono break-all">
          示例：{{ variable.example }}
        </span>
      </button>
    </div>
  </div>
</template>
