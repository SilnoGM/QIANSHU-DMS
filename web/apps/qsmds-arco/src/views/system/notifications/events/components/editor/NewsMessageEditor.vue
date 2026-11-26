<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { IMAGE_ONLY_ACCEPT } from '@/utils/upload-policy'
import VariableTextInput from './VariableTextInput.vue'

interface NewsArticleDraft {
  readonly title: string
  readonly description: string | null
  readonly url: string
  readonly imageAssetId: string | null
}

interface VariableInputRef {
  insertVariable?: (name: string) => void
}

type VariableField = 'title' | 'description' | 'url'

const props = defineProps<{
  modelValue: Record<string, unknown>
  disabled?: boolean
  errors: Record<string, string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
}>()

const MAX_ARTICLES = 8
const MAXIMUM_IMAGE_BYTES = 2 * 1024 * 1024

const fieldRefs = ref<Record<string, VariableInputRef | null>>({})
const lastFocusedField = ref<string | null>(null)
const imageInput = ref<HTMLInputElement | null>(null)
const uploadingIndex = ref<number | null>(null)
const imageError = ref<{ index: number, message: string } | null>(null)
// 预览只在本机使用；按资产 ID 保存，避免文章删除或换序后索引错位。
const previewUrls = ref<Record<string, string>>({})

const articles = computed<NewsArticleDraft[]>(() => {
  const value = props.modelValue.articles
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((raw) => {
    const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}
    return {
      title: typeof record.title === 'string' ? record.title : '',
      description: typeof record.description === 'string' && record.description.trim().length > 0 ? record.description : null,
      url: typeof record.url === 'string' ? record.url : '',
      imageAssetId: typeof record.imageAssetId === 'string' && record.imageAssetId.length > 0 ? record.imageAssetId : null,
    }
  })
})

function update(next: readonly NewsArticleDraft[]): void {
  emit('update:modelValue', { ...props.modelValue, articles: next })
}

function setArticles(next: NewsArticleDraft[]): void {
  imageError.value = null
  // 增删或换序会改变索引；先丢弃旧引用，等下一次渲染按新索引重新登记。
  fieldRefs.value = {}
  update(next.map(article => ({ ...article })))
}

function updateArticle(index: number, patch: Partial<NewsArticleDraft>): void {
  const next = articles.value.map((article, current) => current === index ? { ...article, ...patch } : article)
  update(next)
}

function setFieldRef(index: number, field: VariableField, instance: unknown): void {
  const key = `articles.${index}.${field}`
  fieldRefs.value[key] = (instance as VariableInputRef | null) ?? null
}

function focusField(index: number, field: VariableField): void {
  lastFocusedField.value = `articles.${index}.${field}`
}

function insertVariable(name: string): void {
  const fallback = lastFocusedField.value ?? 'articles.0.title'
  const target = fieldRefs.value[fallback] ?? fieldRefs.value['articles.0.title']
  target?.insertVariable?.(name)
}

function addArticle(): void {
  if (articles.value.length >= MAX_ARTICLES) {
    return
  }
  setArticles([...articles.value, { title: '', description: null, url: '', imageAssetId: null }])
}

function removeArticle(index: number): void {
  if (articles.value.length <= 1) {
    return
  }
  setArticles(articles.value.filter((_, current) => current !== index))
}

function moveArticle(index: number, offset: -1 | 1): void {
  const target = index + offset
  if (target < 0 || target >= articles.value.length) {
    return
  }
  const next = [...articles.value]
  const [moved] = next.splice(index, 1)
  if (moved === undefined) {
    return
  }
  next.splice(target, 0, moved)
  setArticles(next)
}

function imageUrl(article: NewsArticleDraft): string {
  if (article.imageAssetId === null) {
    return ''
  }
  return previewUrls.value[article.imageAssetId] ?? notificationsApi.contentMedia.contentUrl(article.imageAssetId)
}

function chooseImage(index: number): void {
  if (props.disabled || uploadingIndex.value !== null) {
    return
  }
  imageError.value = null
  uploadingIndex.value = index
  imageInput.value?.click()
}

async function onImageSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const index = uploadingIndex.value
  if (file === undefined || index === null) {
    uploadingIndex.value = null
    return
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    imageError.value = { index, message: '仅支持 JPEG、PNG、WebP 图片' }
    uploadingIndex.value = null
    return
  }
  if (file.size > MAXIMUM_IMAGE_BYTES) {
    imageError.value = { index, message: '图文卡片图片不得超过 2 MiB' }
    uploadingIndex.value = null
    return
  }
  try {
    const response = await notificationsApi.contentMedia.upload(file, new AbortController().signal)
    const assetId = response.data.assetId
    previewUrls.value = { ...previewUrls.value, [assetId]: URL.createObjectURL(file) }
    updateArticle(index, { imageAssetId: assetId })
  }
  catch (failure) {
    imageError.value = { index, message: getApiClientFailureMessage(failure, '图片上传失败') }
  }
  finally {
    uploadingIndex.value = null
  }
}

function clearImage(index: number): void {
  updateArticle(index, { imageAssetId: null })
}

onBeforeUnmount(() => {
  for (const url of Object.values(previewUrls.value)) {
    URL.revokeObjectURL(url)
  }
})

defineExpose({ insertVariable })
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap gap-2 items-baseline justify-between">
      <div>
        <div class="text-sm font-medium">
          图文文章
        </div>
        <p class="text-xs text-muted-foreground mt-0.5">
          1–8 篇，首篇作为主文章展示；图片会在发送时转为短期公开签名链接。标题、描述和链接支持变量。
        </p>
      </div>
      <span class="text-xs text-muted-foreground tabular-nums">{{ articles.length }} / {{ MAX_ARTICLES }}</span>
    </div>

    <p v-if="errors.articles !== undefined" class="text-xs text-destructive m-0">
      {{ errors.articles }}
    </p>

    <div
      v-for="(article, index) in articles"
      :key="index"
      class="p-3 border border-border rounded-lg bg-muted/20 flex flex-col gap-3"
    >
      <div class="flex flex-wrap gap-2 items-center justify-between">
        <div class="flex gap-2 items-center">
          <span class="text-sm font-medium">文章 {{ index + 1 }}</span>
          <span v-if="index === 0" class="text-[10px] text-primary px-1.5 py-0.5 border border-primary/30 rounded-full bg-primary/5">
            主文章
          </span>
        </div>
        <div v-if="!disabled" class="flex gap-0.5 items-center">
          <FaButton
            variant="ghost"
            size="icon-sm"
            title="上移"
            :disabled="index === 0"
            @click="moveArticle(index, -1)"
          >
            <FaIcon name="i-lucide:arrow-up" />
          </FaButton>
          <FaButton
            variant="ghost"
            size="icon-sm"
            title="下移"
            :disabled="index === articles.length - 1"
            @click="moveArticle(index, 1)"
          >
            <FaIcon name="i-lucide:arrow-down" />
          </FaButton>
          <FaButton
            variant="ghost"
            size="icon-sm"
            title="删除文章"
            :disabled="articles.length <= 1"
            @click="removeArticle(index)"
          >
            <FaIcon name="i-lucide:trash-2" />
          </FaButton>
        </div>
      </div>

      <div class="gap-3 grid md:grid-cols-2">
        <label class="text-sm flex flex-col gap-1">
          <span class="font-medium">标题</span>
          <VariableTextInput
            :ref="instance => setFieldRef(index, 'title', instance)"
            :model-value="article.title"
            :disabled="disabled"
            maxlength="128"
            placeholder="支持 {{变量}}"
            @focus="focusField(index, 'title')"
            @update:model-value="value => updateArticle(index, { title: value })"
          />
          <span v-if="errors[`articles.${index}.title`] !== undefined" class="text-xs text-destructive">
            {{ errors[`articles.${index}.title`] }}
          </span>
        </label>
        <label class="text-sm flex flex-col gap-1">
          <span class="font-medium">描述</span>
          <VariableTextInput
            :ref="instance => setFieldRef(index, 'description', instance)"
            :model-value="article.description ?? ''"
            :disabled="disabled"
            maxlength="512"
            placeholder="可选，支持 {{变量}}"
            @focus="focusField(index, 'description')"
            @update:model-value="value => updateArticle(index, { description: value.trim().length === 0 ? null : value })"
          />
          <span v-if="errors[`articles.${index}.description`] !== undefined" class="text-xs text-destructive">
            {{ errors[`articles.${index}.description`] }}
          </span>
        </label>
        <label class="text-sm flex flex-col gap-1 md:col-span-2">
          <span class="font-medium">链接</span>
          <VariableTextInput
            :ref="instance => setFieldRef(index, 'url', instance)"
            :model-value="article.url"
            :disabled="disabled"
            maxlength="2048"
            placeholder="https://"
            @focus="focusField(index, 'url')"
            @update:model-value="value => updateArticle(index, { url: value })"
          />
          <span class="text-[11px] text-muted-foreground">必须是 http/https 地址，变量只能放在固定地址中</span>
          <span v-if="errors[`articles.${index}.url`] !== undefined" class="text-xs text-destructive">
            {{ errors[`articles.${index}.url`] }}
          </span>
        </label>
      </div>

      <div class="flex flex-wrap gap-3 items-start">
        <img
          v-if="imageUrl(article) !== ''"
          :src="imageUrl(article)"
          alt="图文卡片图片预览"
          class="border border-border rounded-lg bg-background shrink-0 h-20 w-32 object-contain"
        >
        <div v-else class="text-xs text-muted-foreground border border-border rounded-lg border-dashed bg-background flex shrink-0 h-20 w-32 items-center justify-center">
          未选择图片
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">
            图片
          </div>
          <p class="text-xs text-muted-foreground mt-1">
            可选，JPEG/PNG/WebP，不超过 2 MiB。
          </p>
          <div v-if="!disabled" class="mt-2 flex flex-wrap gap-2">
            <FaButton
              variant="outline"
              size="sm"
              :loading="uploadingIndex === index"
              :disabled="uploadingIndex !== null && uploadingIndex !== index"
              @click="chooseImage(index)"
            >
              <FaIcon name="i-lucide:image-up" />
              {{ article.imageAssetId === null ? '选择图片' : '更换图片' }}
            </FaButton>
            <FaButton
              v-if="article.imageAssetId !== null"
              variant="ghost"
              size="sm"
              :disabled="uploadingIndex !== null"
              @click="clearImage(index)"
            >
              <FaIcon name="i-lucide:x" />
              清除
            </FaButton>
          </div>
          <p v-if="imageError !== null && imageError.index === index" class="text-xs text-destructive m-0 mt-1">
            {{ imageError.message }}
          </p>
          <p v-if="errors[`articles.${index}.imageAssetId`] !== undefined" class="text-xs text-destructive m-0 mt-1">
            {{ errors[`articles.${index}.imageAssetId`] }}
          </p>
        </div>
      </div>
    </div>

    <div v-if="!disabled">
      <FaButton
        variant="outline"
        size="sm"
        :disabled="articles.length >= MAX_ARTICLES"
        @click="addArticle"
      >
        <FaIcon name="i-lucide:plus" />
        添加文章
      </FaButton>
      <span v-if="articles.length >= MAX_ARTICLES" class="text-xs text-muted-foreground ml-2">
        最多 {{ MAX_ARTICLES }} 篇
      </span>
    </div>

    <input
      ref="imageInput"
      class="hidden"
      type="file"
      :accept="IMAGE_ONLY_ACCEPT"
      @change="onImageSelected"
    >
  </div>
</template>
