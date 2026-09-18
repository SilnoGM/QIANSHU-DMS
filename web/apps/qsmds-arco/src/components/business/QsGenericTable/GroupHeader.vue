<script setup lang="ts">
defineProps<{ label: string, expanded: boolean, disabled?: boolean }>()
defineEmits<{ toggle: [] }>()
const { t } = useI18n({
  useScope: 'local',
  messages: { 'zh-cn': { expand: '展开 {label}', collapse: '收起 {label}' } },
})
</script>

<template>
  <div data-slot="qs-generic-table-group-header" class="flex gap-2 min-w-0 items-center">
    <FaButton
      type="button" variant="ghost" size="icon" class="shrink-0 size-11 md:size-8"
      :disabled="disabled" :aria-expanded="expanded"
      :aria-label="t(expanded ? 'collapse' : 'expand', { label })" @click.stop="$emit('toggle')"
    >
      <FaIcon :name="expanded ? 'i-lucide:chevron-down' : 'i-lucide:chevron-right'" class="size-4" aria-hidden="true" />
    </FaButton>
    <div class="qs-type-body-medium flex-1 min-w-0 break-words">
      <slot>{{ label }}</slot>
    </div>
  </div>
</template>
