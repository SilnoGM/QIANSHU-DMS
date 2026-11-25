<script setup lang="ts">
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import { computed, ref } from 'vue'
import notificationsApi from '@/api/modules/notifications'

/**
 * 正文图片只持久化 data-asset-id。已保存的图片走事件配置引用的私有读取接口；
 * 刚上传但尚未保存的草稿图片用本地 blob URL 预览，避免把短期地址写进正文。
 */
const props = defineProps(nodeViewProps)

const failed = ref(false)
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
    <img
      v-if="src !== '' && !failed"
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
