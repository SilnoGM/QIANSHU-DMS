<script setup lang="ts">
import type { SalesOrderDocumentDto } from '@/api/generated/types.gen'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'

const props = defineProps<{ document: SalesOrderDocumentDto }>()
const { t } = useI18n()
const images = computed(() => props.document.mediaType === 'IMAGE' && props.document.detachedAt === null && props.document.contentUrl
  ? [{ src: props.document.contentUrl, previewSrc: props.document.contentUrl, alt: props.document.originalFilename }]
  : [])
const fileSize = computed(() => {
  const bytes = Number(props.document.sizeBytes)
  return props.document.sizeBytes === null || !Number.isFinite(bytes)
    ? '-'
    : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`
})
</script>

<template>
  <div class="flex flex-col gap-3 min-w-0 sm:flex-row">
    <ImageGroup v-if="images.length" :items="images" :size="80" :max-count="1" class="shrink-0" />
    <FaIcon v-else name="i-lucide:file-text" class="text-muted-foreground shrink-0 size-8" aria-hidden="true" />
    <div class="text-sm flex-1 min-w-0 space-y-2">
      <p class="font-medium m-0 [overflow-wrap:anywhere]">
        {{ document.title || document.originalFilename }}
      </p>
      <p class="text-muted-foreground m-0 [overflow-wrap:anywhere]">
        {{ document.originalFilename }} · {{ fileSize }}
      </p>
      <p class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {{ t('salesOrderDrawer.remark') }}：{{ document.remark || '-' }}
      </p>
      <div class="text-muted-foreground flex flex-wrap gap-x-4 gap-y-2 items-center">
        <span class="inline-flex gap-1 items-center">{{ t('salesOrderDrawer.uploadedBy') }}：<QsPersonDisplay :display-name="document.createdBy.displayName" size="sm" /></span>
        <DateTimeDisplay :value="document.createdAt" />
      </div>
      <p v-if="document.detachedAt" class="text-muted-foreground m-0">
        {{ t('salesOrderDrawer.detached') }} · <DateTimeDisplay :value="document.detachedAt" />
      </p>
      <a v-else-if="document.contentUrl && document.mediaType !== 'IMAGE'" :href="document.contentUrl" target="_blank" rel="noopener noreferrer" class="text-primary underline">
        {{ t('salesOrderDrawer.openDocument') }}
      </a>
    </div>
  </div>
</template>
