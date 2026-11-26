<script setup lang="ts">
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import { computed, ref } from 'vue'
import notificationsApi from '@/api/modules/notifications'

/**
 * 正文静态图只持久化 data-asset-id，业务图片只持久化 data-media-source。
 * 已保存的静态图走事件配置引用的私有读取接口；刚上传但尚未保存的草稿图用本地 blob URL 预览。
 * 业务图片在配置阶段没有资产 ID，只显示来源占位。
 */
const props = defineProps(nodeViewProps)

const failed = ref(false)
const mediaSource = computed(() => {
  const value = props.node.attrs.mediaSource
  return typeof value === 'string' ? value : ''
})
const sourceLabel = computed(() => {
  const value = props.node.attrs.alt
  return typeof value === 'string' && value.length > 0 ? value : mediaSource.value
})
const assetId = computed(() => {
  const value = props.node.attrs.assetId
  return typeof value === 'string' ? value : ''
})
const previewUrl = computed(() => {
  const storage = props.editor.storage as unknown as {
    assetImage?: { previews?: Record<string, string> }
  }
  return storage.assetImage?.previews?.[assetId.value]
})
const src = computed(() =>
  previewUrl.value ?? (assetId.value === '' ? '' : notificationsApi.contentMedia.contentUrl(assetId.value)),
)
</script>

<template>
  <NodeViewWrapper as="span" class="align-middle max-w-full inline-block" data-testid="mpnews-asset-image">
    <span
      v-if="mediaSource !== ''"
      class="text-xs text-amber-700 px-2 py-1 border border-amber-500/30 rounded bg-amber-500/10 inline-flex gap-1 items-center dark:text-amber-400"
      :title="mediaSource"
      data-testid="mpnews-business-image-placeholder"
    >
      <FaIcon name="i-lucide:image" />
      业务图片：{{ sourceLabel }}（发布时插入）
    </span>
    <img
      v-else-if="src !== '' && !failed"
      :src="src"
      :alt="String(node.attrs.alt ?? '')"
      :title="`资产 ${assetId}`"
      class="border border-border rounded max-h-48 max-w-full"
      @error="failed = true"
    >
    <span v-else class="text-xs text-muted-foreground px-2 py-1 border border-border rounded bg-muted inline-flex gap-1 items-center">
      <FaIcon name="i-lucide:image-off" />
      图片不可预览 {{ assetId }}
    </span>
  </NodeViewWrapper>
</template>
