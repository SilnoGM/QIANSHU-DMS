<script setup lang="ts">
import type { NotificationEventMediaSourceDto } from '@/api/generated/types.gen'
import { mergeAttributes, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor, VueNodeViewRenderer } from '@tiptap/vue-3'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { IMAGE_ONLY_ACCEPT } from '@/utils/upload-policy'
import AssetImageView from './AssetImageView.vue'

const props = defineProps<{
  modelValue: string
  disabled?: boolean
  mediaSources?: NotificationEventMediaSourceDto[]
  mediaMaxCount?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'focus': []
}>()

const linkHref = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref<string | null>(null)
const previewUrls = new Map<string, string>()

const MAXIMUM_INLINE_IMAGE_BYTES = 2 * 1024 * 1024

/**
 * mpnews 正文图片只允许 DMS 资产或 business media source：
 * 静态图只保留 data-asset-id，业务图片只保留 data-media-source，二者都不存外部 src。
 * 预览优先级：本次会话的上传 blob > 已保存配置引用的私有图片地址。
 */
const AssetImage = Node.create({
  name: 'assetImage',
  inline: true,
  group: 'inline',
  atom: true,
  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: element => element.getAttribute('data-asset-id'),
      },
      mediaSource: {
        default: null,
        parseHTML: element => element.getAttribute('data-media-source'),
      },
      alt: {
        default: null,
        parseHTML: element => element.getAttribute('alt'),
      },
    }
  },
  parseHTML() {
    return [
      { tag: 'img[data-asset-id]' },
      { tag: 'img[data-media-source]' },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    const mediaSource = typeof HTMLAttributes.mediaSource === 'string' ? HTMLAttributes.mediaSource : ''
    if (mediaSource.length > 0) {
      return ['img', mergeAttributes({
        'data-media-source': mediaSource,
        'alt': HTMLAttributes.alt ?? '',
      })]
    }
    const assetId = typeof HTMLAttributes.assetId === 'string' ? HTMLAttributes.assetId : ''
    return ['img', mergeAttributes({
      ...(assetId.length > 0 ? { 'data-asset-id': assetId } : {}),
      alt: HTMLAttributes.alt ?? '',
    })]
  },
  addNodeView() {
    return VueNodeViewRenderer(AssetImageView)
  },
  addStorage() {
    return { previews: {} as Record<string, string> }
  },
})

const editor = useEditor({
  content: props.modelValue,
  editable: props.disabled !== true,
  extensions: [
    StarterKit.configure({
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        },
      },
    }),
    AssetImage,
  ],
  onUpdate: ({ editor: current }) => {
    emit('update:modelValue', current.getHTML())
  },
  onFocus: () => {
    emit('focus')
  },
})

watch(() => props.modelValue, (value) => {
  if (editor.value === undefined) {
    return
  }
  if (editor.value.getHTML() !== value) {
    editor.value.commands.setContent(value, { emitUpdate: false })
  }
})

watch(() => props.disabled, (disabled) => {
  editor.value?.setEditable(disabled !== true)
})

function toggleBold(): void {
  editor.value?.chain().focus().toggleBold().run()
}

function toggleItalic(): void {
  editor.value?.chain().focus().toggleItalic().run()
}

function toggleStrike(): void {
  editor.value?.chain().focus().toggleStrike().run()
}

function toggleHeading(level: 2 | 3): void {
  editor.value?.chain().focus().toggleHeading({ level }).run()
}

function toggleBulletList(): void {
  editor.value?.chain().focus().toggleBulletList().run()
}

function toggleOrderedList(): void {
  editor.value?.chain().focus().toggleOrderedList().run()
}

function toggleBlockquote(): void {
  editor.value?.chain().focus().toggleBlockquote().run()
}

function applyLink(): void {
  const current = editor.value
  if (current === undefined) {
    return
  }
  const href = linkHref.value.trim()
  if (href.length === 0) {
    current.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  current.chain().focus().extendMarkRange('link').setLink({ href }).run()
  linkHref.value = ''
}

function insertVariableByName(name: string): void {
  if (name.length === 0) {
    return
  }
  editor.value?.chain().focus().insertContent(`{{${name}}}`).run()
}

function undo(): void {
  editor.value?.chain().focus().undo().run()
}

function redo(): void {
  editor.value?.chain().focus().redo().run()
}

function chooseImage(): void {
  uploadError.value = null
  fileInput.value?.click()
}

const businessImageCount = computed(() => (
  [...props.modelValue.matchAll(/\bdata-media-source\s*=/gu)].length
))
const businessImageMenu = computed(() => {
  const maxCount = props.mediaMaxCount ?? 0
  return [(props.mediaSources ?? []).map(source => ({
    label: `${source.label}（${source.key}）`,
    icon: 'i-lucide:image',
    disabled: props.disabled === true || businessImageCount.value >= maxCount,
    handle: () => insertBusinessImage(source),
  }))]
})

function insertBusinessImage(source: NotificationEventMediaSourceDto): void {
  if (props.disabled) {
    return
  }
  editor.value?.chain().focus().insertContent({
    type: 'assetImage',
    attrs: {
      assetId: null,
      mediaSource: source.key,
      alt: source.label,
    },
  }).run()
}

async function onImageSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined || uploading.value) {
    return
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    uploadError.value = '仅支持 JPEG、PNG、WebP 图片'
    return
  }
  if (file.size > MAXIMUM_INLINE_IMAGE_BYTES) {
    uploadError.value = '正文图片不得超过 2 MiB'
    return
  }
  uploading.value = true
  uploadError.value = null
  try {
    const response = await notificationsApi.contentMedia.upload(file, new AbortController().signal)
    const previewUrl = URL.createObjectURL(file)
    previewUrls.set(response.data.assetId, previewUrl)
    const storage = editor.value?.storage as unknown as {
      assetImage?: { previews?: Record<string, string> }
    }
    if (storage?.assetImage?.previews !== undefined) {
      storage.assetImage.previews[response.data.assetId] = previewUrl
    }
    editor.value?.chain().focus().insertContent({
      type: 'assetImage',
      attrs: { assetId: response.data.assetId, alt: file.name },
    }).run()
  }
  catch (failure) {
    uploadError.value = getApiClientFailureMessage(failure, '图片上传失败')
  }
  finally {
    uploading.value = false
  }
}

defineExpose({ insertVariable: insertVariableByName })

onBeforeUnmount(() => {
  for (const url of previewUrls.values()) {
    URL.revokeObjectURL(url)
  }
  editor.value?.destroy()
})
</script>

<template>
  <div class="border border-border rounded-md" data-testid="mpnews-rich-text-editor">
    <div class="p-2 border-b border-border flex flex-wrap gap-1">
      <FaButton variant="ghost" size="icon-sm" :disabled="disabled" title="加粗" @click="toggleBold">
        <FaIcon name="i-lucide:bold" />
      </FaButton>
      <FaButton variant="ghost" size="icon-sm" :disabled="disabled" title="斜体" @click="toggleItalic">
        <FaIcon name="i-lucide:italic" />
      </FaButton>
      <FaButton variant="ghost" size="icon-sm" :disabled="disabled" title="删除线" @click="toggleStrike">
        <FaIcon name="i-lucide:strikethrough" />
      </FaButton>
      <FaButton variant="ghost" size="icon-sm" :disabled="disabled" title="二级标题" @click="toggleHeading(2)">
        H2
      </FaButton>
      <FaButton variant="ghost" size="icon-sm" :disabled="disabled" title="三级标题" @click="toggleHeading(3)">
        H3
      </FaButton>
      <FaButton variant="ghost" size="icon-sm" :disabled="disabled" title="无序列表" @click="toggleBulletList">
        <FaIcon name="i-lucide:list" />
      </FaButton>
      <FaButton variant="ghost" size="icon-sm" :disabled="disabled" title="有序列表" @click="toggleOrderedList">
        <FaIcon name="i-lucide:list-ordered" />
      </FaButton>
      <FaButton variant="ghost" size="icon-sm" :disabled="disabled" title="引用" @click="toggleBlockquote">
        <FaIcon name="i-lucide:quote" />
      </FaButton>
      <FaDropdown
        v-if="(mediaSources?.length ?? 0) > 0"
        :items="businessImageMenu"
        align="start"
      >
        <FaButton variant="ghost" size="icon-sm" :disabled="disabled" title="插入业务图片">
          <FaIcon name="i-lucide:image" />
        </FaButton>
      </FaDropdown>
      <FaButton variant="ghost" size="icon-sm" :disabled="disabled || uploading" title="插入图片" @click="chooseImage">
        <FaIcon :name="uploading ? 'i-lucide:loader-circle' : 'i-lucide:image-plus'" :class="uploading ? 'animate-spin' : undefined" />
      </FaButton>
      <FaButton variant="ghost" size="icon-sm" :disabled="disabled" title="撤销" @click="undo">
        <FaIcon name="i-lucide:undo-2" />
      </FaButton>
      <FaButton variant="ghost" size="icon-sm" :disabled="disabled" title="重做" @click="redo">
        <FaIcon name="i-lucide:redo-2" />
      </FaButton>
    </div>
    <div class="p-2 border-b border-border flex flex-wrap gap-2 items-center">
      <FaInput v-model="linkHref" class="w-44" placeholder="链接 https://" :disabled="disabled" />
      <FaButton variant="outline" size="sm" :disabled="disabled" @click="applyLink">
        应用链接
      </FaButton>
    </div>
    <EditorContent :editor="editor" class="p-3 max-w-none prose prose-sm" />
    <p v-if="uploadError !== null" class="text-xs text-destructive m-0 px-3 py-2 border-t border-border">
      {{ uploadError }}
    </p>
    <input
      ref="fileInput"
      class="hidden"
      type="file"
      :accept="IMAGE_ONLY_ACCEPT"
      @change="onImageSelected"
    >
  </div>
</template>
