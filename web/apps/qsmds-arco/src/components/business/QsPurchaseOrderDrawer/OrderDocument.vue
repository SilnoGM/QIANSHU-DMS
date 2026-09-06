<script setup lang="ts">
import type { PurchaseOrderDocumentDto } from '@/api/generated/types.gen'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'

const props = defineProps<{ document: PurchaseOrderDocumentDto, canManageDocument: boolean, busy: boolean }>()
const emit = defineEmits<{ downloadDocument: [document: PurchaseOrderDocumentDto], detachDocument: [document: PurchaseOrderDocumentDto] }>()
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
  <div class="gap-5 grid grid-cols-1 min-w-0 items-start sm:grid-cols-[6rem_minmax(0,1fr)]">
    <ImageGroup v-if="images.length" :items="images" :size="96" :max-count="1" />
    <span v-else class="text-muted-foreground border border-border/70 rounded-lg bg-muted/20 flex size-24 items-center justify-center">
      <FaIcon name="i-lucide:file-text" class="size-8" aria-hidden="true" />
    </span>
    <div class="text-sm flex flex-col gap-4 min-w-0">
      <div class="flex flex-col gap-1.5">
        <p class="qs-type-body-medium leading-relaxed m-0 [overflow-wrap:anywhere]">
          {{ document.title || document.originalFilename }}
        </p>
        <p class="qs-type-meta m-0 flex flex-wrap gap-x-2 gap-y-1 items-baseline">
          <span class="min-w-0 [overflow-wrap:anywhere]">{{ document.originalFilename }}</span>
          <span class="shrink-0">· {{ fileSize }}</span>
        </p>
      </div>
      <!-- 凭证上传信息独立标注，不与付款记录时间或付款备注混用。 -->
      <dl data-slot="order-document-metadata" class="m-0 gap-x-3 gap-y-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-start">
        <dt class="text-muted-foreground">
          {{ t('purchaseOrderDrawer.documentRemark') }}
        </dt>
        <dd class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {{ document.remark || '-' }}
        </dd>
        <dt class="text-muted-foreground">
          {{ t('purchaseOrderDrawer.uploadedBy') }}
        </dt>
        <dd class="m-0 min-w-0">
          <QsPersonDisplay :display-name="document.createdBy.displayName" size="sm" />
        </dd>
        <dt class="text-muted-foreground">
          {{ t('purchaseOrderDrawer.uploadedAt') }}
        </dt>
        <dd class="m-0 min-w-0">
          <DateTimeDisplay :value="document.createdAt" class="whitespace-normal!" />
        </dd>
      </dl>
      <p v-if="document.detachedAt" class="text-muted-foreground m-0">
        {{ t('purchaseOrderDrawer.detached') }} · <DateTimeDisplay :value="document.detachedAt" />
      </p>
      <div v-if="document.detachedAt === null" class="flex flex-wrap gap-2">
        <FaButton type="button" variant="outline" size="sm" :disabled="busy" @click="emit('downloadDocument', document)">
          {{ t('purchaseOrderDrawer.download') }}
        </FaButton>
        <FaButton v-if="canManageDocument" type="button" variant="ghost" size="sm" :disabled="busy" @click="emit('detachDocument', document)">
          {{ t('purchaseOrderDrawer.detach') }}
        </FaButton>
      </div>
    </div>
  </div>
</template>
