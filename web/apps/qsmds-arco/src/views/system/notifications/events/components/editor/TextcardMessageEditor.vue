<script setup lang="ts">
import { ref } from 'vue'
import VariableTextInput from './VariableTextInput.vue'

type Field = 'title' | 'description' | 'url' | 'btntxt'

interface VariableInputRef {
  insertVariable?: (name: string) => void
}

const props = defineProps<{
  modelValue: Record<string, unknown>
  disabled?: boolean
  errors: Record<string, string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
}>()

const titleRef = ref<VariableInputRef | null>(null)
const descriptionRef = ref<VariableInputRef | null>(null)
const urlRef = ref<VariableInputRef | null>(null)
const btntxtRef = ref<VariableInputRef | null>(null)
const lastFocusedField = ref<Field>('title')

const title = ref(typeof props.modelValue.title === 'string' ? props.modelValue.title : '')
const description = ref(typeof props.modelValue.description === 'string' ? props.modelValue.description : '')
const url = ref(typeof props.modelValue.url === 'string' ? props.modelValue.url : '')
const btntxt = ref(typeof props.modelValue.btntxt === 'string' ? props.modelValue.btntxt : '')

function update(next: Record<string, unknown>): void {
  emit('update:modelValue', next)
}

function setString(key: Field, value: string, nullable = false): void {
  const normalized = value.trim().length === 0 && nullable ? null : value
  switch (key) {
    case 'title':
      title.value = value
      break
    case 'description':
      description.value = value
      break
    case 'url':
      url.value = value
      break
    case 'btntxt':
      btntxt.value = value
      break
  }
  update({ ...props.modelValue, [key]: normalized })
}

function insertVariable(name: string): void {
  switch (lastFocusedField.value) {
    case 'title':
      titleRef.value?.insertVariable?.(name)
      return
    case 'description':
      descriptionRef.value?.insertVariable?.(name)
      return
    case 'url':
      urlRef.value?.insertVariable?.(name)
      return
    case 'btntxt':
      btntxtRef.value?.insertVariable?.(name)
  }
}

defineExpose({ insertVariable })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap gap-2 items-baseline">
      <div class="text-xs text-muted-foreground font-medium">
        文本卡片
      </div>
      <span class="text-[11px] text-muted-foreground">
        支持变量，点击右侧变量会插入到最近聚焦的字段
      </span>
    </div>

    <div class="gap-3 grid md:grid-cols-2">
      <label class="text-sm flex flex-col gap-1">
        <span class="font-medium">标题</span>
        <VariableTextInput
          ref="titleRef"
          :model-value="title"
          :disabled="disabled"
          maxlength="128"
          placeholder="支持 {{变量}}"
          @focus="lastFocusedField = 'title'"
          @update:model-value="value => setString('title', value)"
        />
        <span v-if="errors.title !== undefined" class="text-xs text-destructive">{{ errors.title }}</span>
      </label>
      <label class="text-sm flex flex-col gap-1">
        <span class="font-medium">按钮文字</span>
        <VariableTextInput
          ref="btntxtRef"
          :model-value="btntxt"
          :disabled="disabled"
          maxlength="16"
          placeholder="详情"
          @focus="lastFocusedField = 'btntxt'"
          @update:model-value="value => setString('btntxt', value, true)"
        />
        <span v-if="errors.btntxt !== undefined" class="text-xs text-destructive">{{ errors.btntxt }}</span>
      </label>
      <label class="text-sm flex flex-col gap-1 md:col-span-2">
        <span class="font-medium">描述</span>
        <VariableTextInput
          ref="descriptionRef"
          :model-value="description"
          :disabled="disabled"
          maxlength="512"
          placeholder="支持 {{变量}}"
          @focus="lastFocusedField = 'description'"
          @update:model-value="value => setString('description', value)"
        />
        <span v-if="errors.description !== undefined" class="text-xs text-destructive">{{ errors.description }}</span>
      </label>
      <label class="text-sm flex flex-col gap-1 md:col-span-2">
        <span class="font-medium">链接</span>
        <VariableTextInput
          ref="urlRef"
          :model-value="url"
          :disabled="disabled"
          placeholder="https://"
          @focus="lastFocusedField = 'url'"
          @update:model-value="value => setString('url', value)"
        />
        <span class="text-[11px] text-muted-foreground">变量只能放在固定 http/https 地址中</span>
        <span v-if="errors.url !== undefined" class="text-xs text-destructive">{{ errors.url }}</span>
      </label>
    </div>
  </div>
</template>
