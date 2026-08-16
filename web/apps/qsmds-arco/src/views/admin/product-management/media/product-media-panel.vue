<script setup lang="ts">
import type {
  ProductListItemDto,
  ProductMediaItemDto,
} from '../../../../api/generated/types.gen'
import type { ProductVideoPreviewFailure } from './product-media-common.logic'

import { computed, nextTick, shallowRef, toRef, useTemplateRef, watch } from 'vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import ProductImageBoard from './product-image-board.vue'
import { resolveProductVideoPreviewFailure } from './product-media-common.logic'
import ProductMediaRules from './product-media-rules.vue'
import ProductMediaUploadQueue from './product-media-upload-queue.vue'
import { formatProductMediaBytes } from './product-media-view.logic'
import ProductVideoBoard from './product-video-board.vue'
import { useProductMediaPanel } from './use-product-media-panel'

interface ProductMediaPanelProps {
  authEpoch: number
  contentReadable: boolean
  editable: boolean
  product: ProductListItemDto
}

interface ProductMediaUploadQueueExpose {
  focusFirstError: () => boolean
  focusUpload: () => void
}

defineOptions({ name: 'ProductMediaPanel' })

const props = defineProps<ProductMediaPanelProps>()
const emit = defineEmits<{
  dirtyChange: [dirty: boolean]
  productChange: [product: ProductListItemDto]
  unknownChange: [unknown: boolean]
}>()

const panelRootRef = useTemplateRef<HTMLElement>('panelRootRef')
const uploadQueueRef = useTemplateRef<ProductMediaUploadQueueExpose>('uploadQueueRef')

async function focusFirstUploadError(): Promise<void> {
  await nextTick()
  uploadQueueRef.value?.focusFirstError()
}

async function focusAfterDetach(productMediaId: string | null): Promise<void> {
  await nextTick()
  if (productMediaId !== null) {
    const cards = panelRootRef.value?.querySelectorAll<HTMLElement>('[data-media-id]')
    const targetCard = [...(cards ?? [])]
      .find(card => card.dataset.mediaId === productMediaId)
    const target = targetCard?.querySelector<HTMLElement>(
      '[data-focus-anchor], button, video',
    )
    if (target !== undefined && target !== null) {
      target.focus()
      return
    }
  }
  uploadQueueRef.value?.focusUpload()
}

const {
  acceptLatestProduct,
  boardLocked,
  canReapplyLocalLayout,
  cancelUpload,
  closeDiscard,
  confirmDetach,
  confirmDiscard,
  conflictSource,
  contentUrls,
  detachTarget,
  dirty,
  discardVisible,
  handleFilesSelected,
  latestProduct,
  layout,
  mutationPhase,
  openPreview,
  orderedImages,
  orderedVideos,
  panelFailure,
  previewItem,
  product,
  queue,
  queuedImageCount,
  queuedVideoCount,
  reapplyLocalLayout,
  refreshLatestProduct,
  requestDetach,
  retryUpload,
  saveLayout,
  selectionErrors,
  startUpload,
  setPrimary,
  totalSizeBytes,
  unknown,
  updateDraft,
  uploadLocked,
} = useProductMediaPanel({
  authEpoch: toRef(props, 'authEpoch'),
  contentReadable: toRef(props, 'contentReadable'),
  editable: toRef(props, 'editable'),
  focusAfterDetach,
  focusFirstUploadError,
  onDirtyChange: value => emit('dirtyChange', value),
  onProductChange: value => emit('productChange', value),
  onUnknownChange: value => emit('unknownChange', value),
  product: toRef(props, 'product'),
})

const previewVisible = computed({
  get: () => previewItem.value !== null,
  set: (value: boolean) => {
    if (!value) {
      previewItem.value = null
    }
  },
})
const detachVisible = computed({
  get: () => detachTarget.value !== null,
  set: (value: boolean) => {
    if (!value && mutationPhase.value !== 'detach') {
      detachTarget.value = null
    }
  },
})
const previewUrl = computed(() => previewItem.value === null
  ? null
  : contentUrls.value[previewItem.value.id] ?? null)
const previewFailure = shallowRef<ProductVideoPreviewFailure | null>(null)

function handlePreviewVideoError(event: Event): void {
  const video = event.currentTarget as HTMLVideoElement
  previewFailure.value = resolveProductVideoPreviewFailure(video.error?.code)
}

function previewFailureTitle(failure: ProductVideoPreviewFailure): string {
  return failure === 'capability' ? '当前浏览器不支持此视频' : '视频加载失败'
}

function previewFailureDescription(failure: ProductVideoPreviewFailure): string {
  return failure === 'capability'
    ? '可以下载原文件后使用本地播放器查看。'
    : '请检查网络后重试，或直接下载原文件。'
}

watch(
  [() => previewItem.value?.id, previewUrl, () => props.authEpoch],
  () => {
    previewFailure.value = null
  },
)
const statusLabel = computed(() => {
  if (!props.editable) {
    return '只读'
  }
  if (unknown.value) {
    return '结果待确认'
  }
  if (conflictSource.value !== null) {
    return '版本冲突'
  }
  if (dirty.value) {
    return '有未完成变更'
  }
  return '已同步'
})
const liveMessage = computed(() => {
  if (mutationPhase.value === 'layout') {
    return '正在保存产品媒体布局。'
  }
  if (mutationPhase.value === 'detach') {
    return '正在解除产品媒体。'
  }
  if (unknown.value) {
    return '产品媒体操作结果暂时无法确认。'
  }
  if (conflictSource.value !== null) {
    return '检测到产品版本冲突，请比较本地布局和最新布局。'
  }
  return dirty.value ? '产品媒体存在未完成变更。' : '产品媒体已与服务端同步。'
})

function latestOrder(items: readonly ProductMediaItemDto[]): string {
  return items.length === 0
    ? '空'
    : items.map((item, index) => `${index + 1}. ${item.originalFilename}`).join('；')
}

defineExpose({ hasUnsavedChanges: dirty, unknown })
</script>

<template>
  <section
    ref="panelRootRef"
    class="product-media-panel border rounded-xl bg-background min-w-0 overflow-hidden"
    aria-labelledby="product-media-panel-title"
    :aria-busy="mutationPhase !== 'idle'"
  >
    <header class="p-4 border-b bg-muted/20 flex flex-col gap-3 sm:p-5 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <div class="flex flex-wrap gap-2 items-center">
          <h2 id="product-media-panel-title" class="text-lg font-semibold m-0">
            产品媒体
          </h2>
          <FaTag variant="secondary">
            {{ statusLabel }}
          </FaTag>
          <FaTag variant="secondary" class="qs-type-meta">
            Product v{{ product.version }}
          </FaTag>
        </div>
        <p class="text-sm text-muted-foreground m-0 mt-1">
          维护产品图片、主图顺序与视频资料；文件内容保持内部私有。
        </p>
      </div>

      <FaButton
        v-if="editable"
        class="shrink-0 min-h-11 sm:min-h-9"
        :disabled="layout.phase !== 'dirty' || boardLocked"
        @click="saveLayout"
      >
        <FaIcon name="i-lucide:save" aria-hidden="true" />保存媒体布局
      </FaButton>
    </header>

    <div v-if="!editable" class="p-4 pb-0 sm:p-5 sm:pb-0">
      <FaAlert
        icon="i-lucide:lock-keyhole"
        title="当前为只读模式"
        description="你可以查看有权限读取的媒体，但不能上传、排序、设置主图或解除关联。"
      />
    </div>

    <div v-if="!contentReadable" class="p-4 pb-0 sm:p-5 sm:pb-0">
      <FaAlert
        icon="i-lucide:shield-alert"
        title="媒体内容不可读取"
        description="当前身份没有产品媒体内容权限，界面不会请求或泄露文件地址。"
      />
    </div>

    <div v-if="layout.phase === 'dirty'" class="p-4 pb-0 sm:p-5 sm:pb-0">
      <FaAlert
        icon="i-lucide:git-commit-horizontal"
        title="媒体布局尚未保存"
        description="可继续调整主图和顺序；上传或解除前请先保存媒体布局。"
      />
    </div>

    <div v-if="panelFailure" class="p-4 pb-0 sm:p-5 sm:pb-0">
      <FaAlert variant="destructive" role="alert" icon="i-lucide:circle-alert" title="产品媒体操作失败">
        <template #description>
          <div class="gap-2 grid">
            <span>{{ panelFailure.message }}</span>
            <code v-if="panelFailure.requestId" class="qs-type-meta break-all">requestId: {{ panelFailure.requestId }}</code>
          </div>
        </template>
      </FaAlert>
    </div>

    <div v-if="conflictSource !== null || layout.phase === 'unknown'" class="p-4 pb-0 sm:p-5 sm:pb-0">
      <FaAlert variant="destructive" role="alert" icon="i-lucide:git-compare-arrows" title="产品媒体版本需要人工确认">
        <template #description>
          <div class="gap-4 grid">
            <p class="m-0">
              系统保留了本地布局，不会自动重放写请求。请比较后明确选择。
            </p>
            <div class="gap-3 grid lg:grid-cols-2">
              <div class="p-3 border rounded-lg bg-background min-w-0">
                <strong class="text-sm">本地布局 · v{{ layout.sourceVersion }}</strong>
                <p class="qs-type-meta m-0 mt-2 break-words">
                  图片：{{ layout.draft.imageIds.join(' → ') || '空' }}
                </p>
                <p class="qs-type-meta m-0 mt-1 break-words">
                  视频：{{ layout.draft.videoIds.join(' → ') || '空' }}
                </p>
              </div>
              <div class="p-3 border rounded-lg bg-background min-w-0">
                <strong class="text-sm">最新布局{{ latestProduct ? ` · v${latestProduct.version}` : '' }}</strong>
                <template v-if="latestProduct">
                  <p class="qs-type-meta m-0 mt-2 break-words">
                    图片：{{ latestOrder(latestProduct.media.images) }}
                  </p>
                  <p class="qs-type-meta m-0 mt-1 break-words">
                    视频：{{ latestOrder(latestProduct.media.videos) }}
                  </p>
                </template>
                <div v-else class="mt-2 gap-2 grid">
                  <p class="text-sm text-muted-foreground m-0">
                    暂时无法读取最新产品状态。
                  </p>
                  <FaButton variant="outline" class="min-h-11 justify-self-start" @click="refreshLatestProduct">
                    <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />重新读取最新状态
                  </FaButton>
                </div>
              </div>
            </div>
            <div v-if="latestProduct" class="flex flex-wrap gap-2">
              <FaButton variant="outline" class="min-h-11" @click="acceptLatestProduct">
                <FaIcon name="i-lucide:download" aria-hidden="true" />采用最新布局
              </FaButton>
              <FaButton
                v-if="canReapplyLocalLayout"
                variant="outline"
                class="min-h-11"
                @click="reapplyLocalLayout"
              >
                <FaIcon name="i-lucide:redo-2" aria-hidden="true" />基于最新版本恢复本地布局
              </FaButton>
            </div>
          </div>
        </template>
      </FaAlert>
    </div>

    <div class="product-media-layout p-4 gap-5 grid min-w-0 overflow-x-hidden sm:p-5">
      <main class="gap-6 grid min-w-0">
        <FaCard content-class="min-w-0">
          <ProductImageBoard
            :items="orderedImages"
            :content-urls="contentUrls"
            :primary-image-id="layout.draft.primaryImageId"
            :editable="editable"
            :locked="boardLocked"
            :detach-locked="boardLocked || layout.phase !== 'ready'"
            @move="(id, index) => updateDraft('IMAGE', id, index)"
            @primary="setPrimary"
            @preview="openPreview"
            @detach="requestDetach"
          />
        </FaCard>

        <FaCard content-class="min-w-0">
          <ProductVideoBoard
            :auth-epoch="authEpoch"
            :items="orderedVideos"
            :content-urls="contentUrls"
            :editable="editable"
            :locked="boardLocked"
            :detach-locked="boardLocked || layout.phase !== 'ready'"
            @move="(id, index) => updateDraft('VIDEO', id, index)"
            @preview="openPreview"
            @detach="requestDetach"
          />
        </FaCard>
      </main>

      <aside class="gap-5 grid min-w-0 content-start">
        <FaCard v-if="editable" content-class="min-w-0">
          <ProductMediaUploadQueue
            ref="uploadQueueRef"
            :queue="queue"
            :selection-errors="selectionErrors"
            :editable="editable"
            :locked="uploadLocked"
            @files-selected="handleFilesSelected"
            @cancel="cancelUpload"
            @retry="retryUpload"
            @start="startUpload"
          />
        </FaCard>

        <FaCard content-class="min-w-0">
          <ProductMediaRules
            :current-image-count="product.media.images.length"
            :current-video-count="product.media.videos.length"
            :queued-image-count="queuedImageCount"
            :queued-video-count="queuedVideoCount"
            :total-size-bytes="totalSizeBytes"
          />
        </FaCard>
      </aside>
    </div>

    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {{ liveMessage }}
    </div>
  </section>

  <QsGenericModal
    v-model="previewVisible"
    :title="previewItem?.kind === 'VIDEO' ? '预览视频' : '预览图片'"
    :description="previewItem?.originalFilename"
    size="xl"
  >
    <div class="rounded-lg bg-muted/30 flex min-h-56 items-center justify-center overflow-hidden">
      <img
        v-if="previewItem?.kind === 'IMAGE' && previewUrl"
        :src="previewUrl"
        :alt="previewItem.originalFilename"
        class="max-h-[70vh] max-w-full object-contain"
      >
      <video
        v-else-if="previewItem?.kind === 'VIDEO' && previewUrl && previewFailure === null"
        :src="previewUrl"
        :aria-label="`播放视频 ${previewItem.originalFilename}`"
        class="max-h-[70vh] max-w-full"
        controls
        autoplay
        @error="handlePreviewVideoError"
        @loadedmetadata="previewFailure = null"
      />
      <div
        v-else-if="previewItem?.kind === 'VIDEO' && previewUrl && previewFailure"
        class="p-6 text-center gap-3 grid place-items-center"
        role="status"
      >
        <FaIcon name="i-lucide:circle-alert" class="text-muted-foreground size-8" aria-hidden="true" />
        <strong>{{ previewFailureTitle(previewFailure) }}</strong>
        <p class="text-sm text-muted-foreground m-0">
          {{ previewFailureDescription(previewFailure) }}
        </p>
        <a
          :href="previewUrl"
          download
          :aria-label="`下载视频 ${previewItem.originalFilename}`"
          class="text-sm font-medium px-4 border rounded-md inline-flex gap-2 min-h-11 items-center focus-visible:outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FaIcon name="i-lucide:download" class="shrink-0 size-4" aria-hidden="true" />
          <span>下载原视频</span>
        </a>
      </div>
      <FaEmpty v-else icon="i-lucide:shield-alert" title="媒体内容不可读取" />
    </div>
    <div v-if="previewItem" class="qs-type-meta mt-3 flex flex-wrap gap-3">
      <span>{{ previewItem.width }} × {{ previewItem.height }}</span>
      <span>{{ formatProductMediaBytes(previewItem.sizeBytes) }}</span>
      <span>{{ previewItem.mimeType }}</span>
    </div>
  </QsGenericModal>

  <QsGenericModal
    v-model="detachVisible"
    title="解除产品媒体"
    description="此操作只解除当前产品关联；文件进入保留期后再由服务端清理。"
    :submitting="mutationPhase === 'detach'"
  >
    <FaAlert
      variant="destructive"
      icon="i-lucide:triangle-alert"
      title="请核对要解除的文件"
    >
      <template #description>
        <div v-if="detachTarget" class="gap-1 grid">
          <strong class="break-all">{{ detachTarget.originalFilename }}</strong>
          <span class="qs-type-meta">类型：{{ detachTarget.kind === 'IMAGE' ? '图片' : '视频' }}</span>
        </div>
      </template>
    </FaAlert>
    <template #footer>
      <FaButton variant="outline" class="min-h-11 w-full sm:w-auto" :disabled="mutationPhase === 'detach'" @click="detachVisible = false">
        取消
      </FaButton>
      <FaButton variant="destructive" class="min-h-11 w-full sm:w-auto" :loading="mutationPhase === 'detach'" @click="confirmDetach">
        确认解除
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal
    v-model="discardVisible"
    title="离开产品媒体维护？"
    description="未保存布局、上传队列或结果未知状态不会随页面保留。"
    :dismiss-on-overlay="false"
  >
    <FaAlert
      variant="destructive"
      icon="i-lucide:triangle-alert"
      title="请确认离开"
      description="只有点击“确认离开”才会放弃当前媒体维护状态。"
    />
    <template #footer>
      <FaButton variant="outline" class="min-h-11 w-full sm:w-auto" @click="closeDiscard">
        继续维护
      </FaButton>
      <FaButton variant="destructive" class="min-h-11 w-full sm:w-auto" @click="confirmDiscard">
        确认离开
      </FaButton>
    </template>
  </QsGenericModal>
</template>

<style scoped>
.product-media-layout {
  grid-template-columns: minmax(0, 7fr) minmax(18rem, 5fr);
}

@media (width <= 64rem) {
  .product-media-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .product-media-panel :deep(*) {
    scroll-behavior: auto !important;
  }
}
</style>
