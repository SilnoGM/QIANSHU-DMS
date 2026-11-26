<script setup lang="ts">
import type {
  MessageChannel,
  MessageDraft,
  MessageEditorContext,
  MessageKind,
  MessageSendMethod,
  MessageValidationIssue,
} from '../../message-editor.types'
import type {
  NotificationEventMediaDto,
  NotificationEventVariableDto,
} from '@/api/generated/types.gen'

import { computed, ref, watch } from 'vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  cloneMessageDraft,
  createDefaultMessageDraft,
  messageDraftSnapshot,
  messageFieldLabel,
  messageKindLabel,
  validateMessageDraft,
} from '../../message-editor.logic'
import FileMessageEditor from './FileMessageEditor.vue'
import ImageMessageEditor from './ImageMessageEditor.vue'
import MarkdownMessageEditor from './MarkdownMessageEditor.vue'
import MpnewsMessageEditor from './MpnewsMessageEditor.vue'
import NewsMessageEditor from './NewsMessageEditor.vue'
import TextcardMessageEditor from './TextcardMessageEditor.vue'
import TextMessageEditor from './TextMessageEditor.vue'
import VariablePalette from './VariablePalette.vue'

const props = defineProps<{
  modelValue: boolean
  kind: MessageKind
  seed: MessageDraft | null
  channel: MessageChannel
  sendMethod: MessageSendMethod
  media: NotificationEventMediaDto | null
  variables: NotificationEventVariableDto[]
  variablesKnown: boolean
  eventLabel: string
  eventType: string
  canUpdate: boolean
  serverErrors?: Record<string, string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'apply': [message: MessageDraft]
}>()

const draft = ref<MessageDraft>(createDefaultMessageDraft('TEXT', { mediaMaxCount: 0, mediaSources: [] }))
const snapshot = ref('')
const errors = ref<Record<string, string>>({})
const discardPending = ref(false)
const closingForced = ref(false)
const editorRef = ref<{ insertVariable?: (name: string) => void } | null>(null)

const context = computed<MessageEditorContext>(() => ({
  channel: props.channel,
  sendMethod: props.sendMethod,
  mediaMaxCount: props.media?.maxCount ?? 0,
  mediaSources: props.media?.sources.map(source => source.key) ?? [],
  variables: props.variables,
  variablesKnown: props.variablesKnown,
}))

const dirty = computed(() => messageDraftSnapshot(draft.value) !== snapshot.value)
const title = computed(() => {
  const action = props.seed === null ? '添加' : '编辑'
  return `${action}${messageKindLabel(props.kind)}`
})
const hasErrors = computed(() => Object.keys(errors.value).length > 0)
const errorEntries = computed(() => Object.entries(errors.value).map(([field, message]) => ({
  field,
  label: messageFieldLabel(field),
  message,
})))

function resetDraft(): void {
  const initial = props.seed === null
    ? createDefaultMessageDraft(props.kind, context.value)
    : cloneMessageDraft(props.seed)
  draft.value = initial
  snapshot.value = messageDraftSnapshot(initial)
  errors.value = { ...(props.serverErrors ?? {}) }
  discardPending.value = false
  closingForced.value = false
}

watch(() => props.modelValue, (open) => {
  if (open) {
    resetDraft()
  }
})

// 用户继续修改后先撤掉上一轮错误提示，点击「完成」时再按最新内容校验。
// 打开弹窗时的初始草稿与快照相同，不能把服务端回填的错误立即清掉。
watch(draft, () => {
  if (messageDraftSnapshot(draft.value) === snapshot.value) {
    return
  }
  if (Object.keys(errors.value).length > 0) {
    errors.value = {}
  }
}, { deep: true })

function groupIssues(issues: readonly MessageValidationIssue[]): Record<string, string> {
  const grouped = new Map<string, string[]>()
  for (const issue of issues) {
    const messages = grouped.get(issue.field) ?? []
    messages.push(issue.message)
    grouped.set(issue.field, messages)
  }
  return Object.fromEntries([...grouped.entries()].map(([field, messages]) => [field, messages.join('；')]))
}

function complete(): void {
  if (!props.canUpdate) {
    return
  }
  const issues = validateMessageDraft(draft.value, context.value)
  if (issues.length > 0) {
    errors.value = groupIssues(issues)
    return
  }
  errors.value = {}
  // 未改动时只关闭，避免把「打开后点完成」误标成页面有未保存修改。
  if (!dirty.value) {
    closingForced.value = true
    emit('update:modelValue', false)
    return
  }
  emit('apply', cloneMessageDraft(draft.value))
  closingForced.value = true
  emit('update:modelValue', false)
}

function requestClose(): void {
  emit('update:modelValue', false)
}

function beforeClose(): boolean {
  if (closingForced.value || !dirty.value) {
    return true
  }
  discardPending.value = true
  return false
}

function continueEditing(): void {
  discardPending.value = false
}

function discardAndClose(): void {
  closingForced.value = true
  discardPending.value = false
  emit('update:modelValue', false)
}

function insertVariable(name: string): void {
  if (props.kind === 'IMAGE' || props.kind === 'FILE') {
    return
  }
  editorRef.value?.insertVariable?.(name)
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="title"
    :description="`${eventLabel} · ${eventType}`"
    size="2xl"
    :before-close="beforeClose"
    @update:model-value="value => emit('update:modelValue', value)"
  >
    <div class="gap-4 grid lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div class="flex flex-col gap-3 min-w-0 lg:h-full">
        <div
          v-if="hasErrors"
          class="px-3 py-2.5 border border-destructive/30 rounded-lg bg-destructive/5"
          role="alert"
        >
          <div class="text-sm text-destructive font-medium">
            请先修正以下问题
          </div>
          <ul class="text-xs text-destructive/90 mt-1 pl-4 list-disc flex flex-col gap-0.5">
            <li v-for="entry in errorEntries" :key="entry.field">
              {{ entry.label }}：{{ entry.message }}
            </li>
          </ul>
        </div>

        <TextMessageEditor
          v-if="kind === 'TEXT'"
          ref="editorRef"
          v-model="draft.payload"
          class="flex-1"
          :channel="channel"
          :disabled="!canUpdate"
          :error="errors.content"
        />
        <MarkdownMessageEditor
          v-else-if="kind === 'MARKDOWN' || kind === 'MARKDOWN_V2'"
          ref="editorRef"
          v-model="draft.payload"
          class="flex-1"
          :send-method="sendMethod"
          :disabled="!canUpdate"
          :error="errors.content"
        />
        <TextcardMessageEditor
          v-else-if="kind === 'TEXTCARD'"
          ref="editorRef"
          v-model="draft.payload"
          :disabled="!canUpdate"
          :errors="errors"
        />
        <FileMessageEditor
          v-else-if="kind === 'FILE'"
          v-model="draft"
          :media-sources="media?.sources ?? []"
          :disabled="!canUpdate"
          :errors="errors"
        />
        <ImageMessageEditor
          v-else-if="kind === 'IMAGE'"
          v-model="draft.mediaPolicy"
          :sources="media?.sources ?? []"
          :max-count="media?.maxCount ?? 0"
          :disabled="!canUpdate"
          :source-error="errors.mediaPolicy"
          :max-count-error="errors.maxCount"
        />
        <MpnewsMessageEditor
          v-else-if="kind === 'MPNEWS'"
          ref="editorRef"
          v-model="draft.payload"
          :disabled="!canUpdate"
          :errors="errors"
          :media-sources="media?.sources ?? []"
          :media-max-count="media?.maxCount ?? 0"
        />
        <NewsMessageEditor
          v-else-if="kind === 'NEWS'"
          ref="editorRef"
          v-model="draft.payload"
          :disabled="!canUpdate"
          :errors="errors"
        />
        <div v-else class="text-sm text-muted-foreground p-6 text-center border border-border rounded-lg border-dashed">
          该类型暂未开放编辑。
        </div>
      </div>

      <aside class="min-w-0 lg:pl-4 lg:border-l lg:border-border">
        <VariablePalette
          v-if="kind !== 'IMAGE' && kind !== 'FILE'"
          :variables="variables"
          :variables-known="variablesKnown"
          :disabled="!canUpdate"
          @insert="insertVariable"
        />
        <div v-else class="text-xs text-muted-foreground">
          {{ kind === 'IMAGE' ? '图片附件使用业务附件来源，不使用变量。' : '文件消息使用固定文件或业务附件，不使用变量。' }}
        </div>
      </aside>
    </div>

    <template #footer>
      <div
        v-if="discardPending"
        class="px-4 py-3 flex flex-wrap gap-3 items-center justify-between"
      >
        <span class="text-sm">有未保存的修改，确定放弃？</span>
        <div class="flex gap-2">
          <FaButton variant="outline" size="sm" @click="continueEditing">
            继续编辑
          </FaButton>
          <FaButton variant="destructive" size="sm" @click="discardAndClose">
            放弃修改
          </FaButton>
        </div>
      </div>
      <div v-else class="px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
        <span class="text-xs text-muted-foreground">完成后仍需点击页面右上角「保存修改」。</span>
        <div class="flex gap-2">
          <FaButton variant="outline" size="sm" @click="requestClose">
            取消
          </FaButton>
          <FaButton size="sm" :disabled="!canUpdate" @click="complete">
            完成
          </FaButton>
        </div>
      </div>
    </template>
  </QsGenericModal>
</template>
