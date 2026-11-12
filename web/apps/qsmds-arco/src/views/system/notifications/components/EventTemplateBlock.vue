<script setup lang="ts">
import type { EffectiveTemplate } from '../event-config.logic'
import type { NotificationEventDto, NotificationTemplateDto } from '@/api/generated/types.gen'

import { computed, ref, watch } from 'vue'

import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { templateIncompatibleVariables } from '../event-config.logic'
import { splitTemplateBody, templateDomainClass, templateDomainLabel } from '../template-key-grouping.logic'

const props = defineProps<{
  busy: boolean
  canUpdatePolicy: boolean
  canUpdateTemplate: boolean
  canViewTemplate: boolean
  channel: 'IN_APP' | 'ASSISTANT'
  effective: EffectiveTemplate
  event: NotificationEventDto
}>()

const emit = defineEmits<{
  create: [key: string]
  edit: [template: NotificationTemplateDto]
  pick: []
  preview: [template: NotificationTemplateDto]
  resetDefault: []
}>()

const previewExpanded = ref(false)

watch(
  () => props.effective.template?.id,
  () => {
    previewExpanded.value = false
  },
)

const sourceLabel = computed(() => {
  if (props.effective.source === 'POLICY') {
    return '策略绑定'
  }
  if (props.effective.source === 'DEFAULT') {
    return '业务默认'
  }
  return '未指定'
})

const sourceClass = computed(() => props.effective.source === 'POLICY'
  ? 'border-primary/30 bg-primary/10 text-primary'
  : props.effective.source === 'DEFAULT'
    ? 'border-border bg-muted text-muted-foreground'
    : 'border-dashed border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300')

const bodySegments = computed(() => props.effective.template === null
  ? []
  : splitTemplateBody(props.effective.template.bodyTemplate))

const linkSegments = computed(() => props.effective.template?.linkUrlTemplate
  ? splitTemplateBody(props.effective.template.linkUrlTemplate)
  : [])

const incompatibleVariables = computed(() => props.effective.template === null
  ? []
  : templateIncompatibleVariables(props.effective.template, props.event))

const missingMessage = computed(() => {
  if (props.effective.missingReason === 'TEMPLATE_DISABLED') {
    return '策略使用的模板已停用，该渠道在发布时会被跳过。'
  }
  if (props.effective.missingReason === 'TEMPLATE_NOT_FOUND') {
    return `模板 ${props.effective.key ?? ''} 在当前渠道不存在，发布时该渠道会失败或跳过。`
  }
  if (props.effective.missingReason === 'NO_TEMPLATE_KEY') {
    return '当前事件没有业务默认模板键，请先绑定模板。'
  }
  return ''
})
</script>

<template>
  <section class="p-3 border border-border rounded-lg bg-muted/20 flex flex-col gap-2.5 min-w-0">
    <div class="flex flex-wrap gap-2 items-center justify-between">
      <p class="qs-type-compact-label m-0">
        消息内容
      </p>
      <FaTag variant="outline" :class="sourceClass">
        {{ sourceLabel }}
      </FaTag>
    </div>

    <div v-if="!canViewTemplate" class="p-3 border border-border rounded-md border-dashed">
      <p class="qs-type-meta text-muted-foreground m-0">
        当前账号没有模板查看权限，只能配置投递策略。
      </p>
    </div>

    <template v-else>
      <div
        v-if="effective.state === 'UNKNOWN'"
        class="px-3 py-2 border border-border rounded-md bg-muted/40"
      >
        <p class="qs-type-meta text-muted-foreground m-0">
          模板数据暂不可用，无法判断当前渠道是否缺模板。
        </p>
      </div>

      <div
        v-else-if="effective.state === 'MISSING_TEMPLATE'"
        class="px-3 py-2 border border-amber-500/30 rounded-md bg-amber-500/10"
      >
        <p class="qs-type-meta text-amber-800 m-0 dark:text-amber-200">
          {{ missingMessage }}
        </p>
      </div>

      <template v-if="effective.template !== null">
        <div class="flex flex-wrap gap-x-1.5 gap-y-1 min-w-0 items-baseline">
          <span class="qs-type-body-medium text-foreground min-w-0 truncate" :title="effective.template.name">
            {{ effective.template.name }}
          </span>
          <span class="qs-type-meta text-muted-foreground whitespace-nowrap">
            (v{{ effective.template.version }})
          </span>
          <FaTag variant="outline" :class="templateDomainClass(effective.template.domain)">
            {{ templateDomainLabel(effective.template.domain) }}
          </FaTag>
          <code class="qs-type-meta text-muted-foreground break-all">{{ effective.template.key }}</code>
        </div>

        <div class="p-2.5 border border-border rounded-md bg-background">
          <div
            class="overscroll-contain overflow-y-auto"
            :class="previewExpanded ? '' : 'max-h-[120px]'"
            role="region"
            tabindex="0"
            aria-label="模板正文预览"
          >
            <p class="qs-type-meta m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
              <span
                v-for="(segment, index) in bodySegments"
                :key="index"
                :class="segment.token ? 'text-primary bg-primary/10 rounded px-0.5 font-mono' : ''"
              >{{ segment.text }}</span>
            </p>
          </div>
        </div>
        <div v-if="effective.template.bodyTemplate.length > 80" class="flex justify-end">
          <FaButton variant="ghost" size="sm" @click="previewExpanded = !previewExpanded">
            {{ previewExpanded ? '收起' : '展开全文' }}
          </FaButton>
        </div>

        <div v-if="incompatibleVariables.length > 0" class="px-2.5 py-2 border border-amber-500/30 rounded-md bg-amber-500/10">
          <p class="qs-type-meta text-amber-800 m-0 dark:text-amber-200">
            模板含事件不提供的变量：{{ incompatibleVariables.join('、') }}，发布时会渲染失败。
          </p>
        </div>

        <div v-if="effective.template.linkUrlTemplate" class="px-2.5 py-2 border border-border rounded-md bg-background flex gap-2 min-w-0 items-start">
          <FaIcon name="i-lucide:external-link" class="text-muted-foreground shrink-0 size-3.5" aria-hidden="true" />
          <span class="qs-type-meta text-muted-foreground shrink-0">跳转链接</span>
          <span
            class="text-[11px] qs-type-meta text-muted-foreground leading-4 font-mono flex-1 min-w-0 whitespace-normal break-all"
            :title="effective.template.linkUrlTemplate"
          >
            <span
              v-for="(segment, index) in linkSegments"
              :key="index"
              :class="segment.token ? 'text-primary bg-primary/10 rounded px-0.5' : ''"
            >{{ segment.text }}</span>
          </span>
        </div>

        <div class="flex flex-wrap gap-2 items-center justify-between">
          <QsPersonDisplay :display-name="effective.template.updatedByName?.trim() || '系统内置'" size="sm" />
          <div class="flex flex-wrap gap-1.5">
            <FaButton variant="ghost" size="sm" @click="emit('preview', effective.template)">
              预览
            </FaButton>
            <FaButton
              variant="outline"
              size="sm"
              :disabled="!canUpdateTemplate || busy"
              @click="emit('edit', effective.template)"
            >
              编辑内容
            </FaButton>
            <FaButton
              variant="outline"
              size="sm"
              :disabled="!canUpdatePolicy || busy"
              @click="emit('pick')"
            >
              更换模板
            </FaButton>
            <FaButton
              v-if="effective.source === 'POLICY' && event.defaultTemplateKey !== null"
              variant="ghost"
              size="sm"
              :disabled="!canUpdatePolicy || busy"
              @click="emit('resetDefault')"
            >
              恢复默认
            </FaButton>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="p-3 border border-border rounded-md border-dashed flex flex-col gap-2">
          <p class="qs-type-meta text-muted-foreground m-0">
            <template v-if="effective.key !== null">
              当前使用模板键 <code class="text-foreground">{{ effective.key }}</code>，但还没有对应模板。
            </template>
            <template v-else>
              当前渠道没有可用模板键，请选择模板或先保存策略。
            </template>
          </p>
          <div class="flex flex-wrap gap-2">
            <FaButton
              v-if="effective.key !== null"
              variant="outline"
              size="sm"
              :disabled="!canUpdateTemplate || busy"
              @click="emit('create', effective.key)"
            >
              按此 Key 新建模板
            </FaButton>
            <FaButton
              variant="outline"
              size="sm"
              :disabled="!canUpdatePolicy || busy"
              @click="emit('pick')"
            >
              选择模板
            </FaButton>
            <FaButton
              v-if="effective.source === 'POLICY' && event.defaultTemplateKey !== null"
              variant="ghost"
              size="sm"
              :disabled="!canUpdatePolicy || busy"
              @click="emit('resetDefault')"
            >
              恢复默认
            </FaButton>
          </div>
        </div>
      </template>
    </template>
  </section>
</template>
