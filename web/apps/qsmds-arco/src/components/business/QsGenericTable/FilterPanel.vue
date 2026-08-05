<script setup lang="ts">
import type {
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValue,
  QsGenericTableFilterValues,
} from './logic'
import { QS_GENERIC_TABLE_ALL_FILTER_VALUE } from './logic'

defineOptions({ name: 'QsGenericTableFilterPanel' })

defineProps<{
  definitions: readonly QsGenericTableFilterDefinition[]
  values: QsGenericTableFilterValues
}>()

const emit = defineEmits<{
  apply: []
  reset: []
  update: [key: string, value: QsGenericTableFilterValue]
}>()

function getOptions(definition: QsGenericTableFilterDefinition) {
  return [
    // Reka Select 禁止空字符串选项，使用内部哨兵值表达“全部”，提交时再还原为 undefined。
    { label: '全部', value: QS_GENERIC_TABLE_ALL_FILTER_VALUE },
    ...definition.options.map(option => ({ ...option })),
  ]
}

function updateValue(key: string, value: unknown) {
  emit('update', key, value === QS_GENERIC_TABLE_ALL_FILTER_VALUE || value == null
    ? undefined
    : value as number | string)
}
</script>

<template>
  <div class="w-[min(30rem,calc(100vw-2rem))]">
    <div class="p-4 border-b border-border flex gap-3 items-start">
      <span class="text-primary rounded-md bg-primary/10 flex-center shrink-0 size-8">
        <FaIcon name="i-lucide:list-filter" class="size-4" />
      </span>
      <div class="min-w-0">
        <h3 class="text-sm font-semibold m-0">
          筛选条件
        </h3>
        <p class="text-xs text-muted-foreground leading-5 m-0 mt-0.5">
          选择条件后应用，关闭面板不会改变当前结果。
        </p>
      </div>
    </div>

    <div class="p-4 gap-4 grid max-h-[min(24rem,calc(100dvh-13rem))] overflow-y-auto sm-grid-cols-2">
      <label v-for="definition in definitions" :key="definition.key" class="gap-1.5 grid">
        <span class="text-xs text-muted-foreground font-medium">{{ definition.label }}</span>
        <FaSelect
          :model-value="values[definition.key]"
          :options="getOptions(definition)"
          :placeholder="definition.placeholder ?? `请选择${definition.label}`"
          class="min-h-11 w-full md:min-h-9"
          @update:model-value="value => updateValue(definition.key, value)"
        />
      </label>
    </div>

    <div class="p-3 border-t border-border bg-muted/20 flex gap-2 items-center justify-end">
      <FaButton variant="outline" class="flex-1 min-h-11 md:flex-none md:min-h-9" @click="emit('reset')">
        重置
      </FaButton>
      <FaButton class="flex-1 min-h-11 md:flex-none md:min-h-9" @click="emit('apply')">
        应用筛选
      </FaButton>
    </div>
  </div>
</template>
