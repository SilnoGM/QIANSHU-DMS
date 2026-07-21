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
  <div>
    <div class="gap-4 grid lg-grid-cols-3 sm-grid-cols-2">
      <label v-for="definition in definitions" :key="definition.key" class="gap-1.5 grid">
        <span class="text-xs text-muted-foreground font-medium">{{ definition.label }}</span>
        <FaSelect
          :model-value="values[definition.key]"
          :options="getOptions(definition)"
          :placeholder="definition.placeholder ?? `请选择${definition.label}`"
          class="w-full"
          @update:model-value="value => updateValue(definition.key, value)"
        />
      </label>
    </div>
    <div class="mt-5 flex gap-2 items-center justify-end">
      <FaButton variant="outline" @click="emit('reset')">
        重置
      </FaButton>
      <FaButton @click="emit('apply')">
        应用筛选
      </FaButton>
    </div>
  </div>
</template>
