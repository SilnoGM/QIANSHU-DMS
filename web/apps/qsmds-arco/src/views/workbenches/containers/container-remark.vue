<script setup lang="ts">
const props = defineProps<{ text: string | null, mobile?: boolean }>()
const { t } = useI18n()
const expanded = ref(false)
const contentId = useId()
watch(() => props.text, () => {
  expanded.value = false
})
</script>

<template>
  <span v-if="!text" class="qs-type-meta text-muted-foreground">{{ t('containerPage.none') }}</span>
  <div v-else-if="mobile" class="min-w-0">
    <p :id="contentId" class="qs-type-body m-0 whitespace-pre-wrap [overflow-wrap:anywhere]" :class="!expanded && 'line-clamp-2'">
      {{ text }}
    </p>
    <FaButton variant="ghost" size="sm" class="text-primary mt-1 px-0" :aria-expanded="expanded" :aria-controls="contentId" @click="expanded = !expanded">
      {{ t(expanded ? 'containerPage.collapseRemark' : 'containerPage.expandRemark') }}
      <FaIcon :name="expanded ? 'i-lucide:chevron-up' : 'i-lucide:chevron-down'" class="size-3.5" />
    </FaButton>
  </div>
  <FaTooltip v-else>
    <p tabindex="0" class="qs-type-body m-0 rounded-sm max-w-49 whitespace-pre-wrap [overflow-wrap:anywhere] line-clamp-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline" :aria-label="`${t('containerPage.remark')}：${text}`">
      {{ text }}
    </p>
    <template #content>
      <p class="m-0 max-w-80 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {{ text }}
      </p>
    </template>
  </FaTooltip>
</template>
