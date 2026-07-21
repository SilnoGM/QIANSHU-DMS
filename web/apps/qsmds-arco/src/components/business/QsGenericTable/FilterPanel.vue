<script setup lang="ts">
import type {
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValue,
  QsGenericTableFilterValues,
} from './logic'

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
    { label: '全部', value: '' },
    ...definition.options.map(option => ({ ...option })),
  ]
}

function updateValue(key: string, value: unknown) {
  emit('update', key, value === '' || value == null
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
