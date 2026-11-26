import type { MessageChannel, MessageKind, MessageSendMethod } from './message-editor.types'

export interface AddMessageKindOption {
  readonly kind: MessageKind
  readonly enabled: boolean
}

export interface AddMessageKindContext {
  readonly channel: MessageChannel
  readonly sendMethod: MessageSendMethod
  readonly messageCount: number
  readonly hasMpnews: boolean
  readonly hasMedia: boolean
}

/** 已实现类型按当前渠道/发送方式开放加入消息组。 */
const WECOM_APP_KINDS: readonly MessageKind[] = ['TEXT', 'MARKDOWN', 'TEXTCARD', 'FILE', 'NEWS']
const WECOM_ROBOT_KINDS: readonly MessageKind[] = ['TEXT', 'MARKDOWN', 'MARKDOWN_V2', 'FILE', 'NEWS']

/**
 * 尚未实现的类型仍展示在菜单中，但不可点击加入。
 * 只列该发送方式理论上支持的类型，避免把「群机器人不支持 mpnews」这类能力边界
 * 混成「后续开放」。
 */
const WECOM_APP_PENDING_KINDS: readonly MessageKind[] = [
  'VOICE',
  'VIDEO',
  'MINIPROGRAM_NOTICE',
  'TEMPLATE_CARD',
  'INTERACTIVE_TASKCARD',
]
const WECOM_ROBOT_PENDING_KINDS: readonly MessageKind[] = ['VOICE', 'TEMPLATE_CARD']

export const MESSAGE_KIND_ICONS: Readonly<Record<MessageKind, string>> = {
  TEXT: 'i-lucide:type',
  MARKDOWN: 'i-lucide:file-text',
  MARKDOWN_V2: 'i-lucide:table-2',
  TEXTCARD: 'i-lucide:layout-template',
  MPNEWS: 'i-lucide:newspaper',
  NEWS: 'i-lucide:gallery-horizontal-end',
  IMAGE: 'i-lucide:image-plus',
  FILE: 'i-lucide:file-text',
  VOICE: 'i-lucide:mic',
  VIDEO: 'i-lucide:video',
  MINIPROGRAM_NOTICE: 'i-lucide:smartphone',
  TEMPLATE_CARD: 'i-lucide:layout-grid',
  INTERACTIVE_TASKCARD: 'i-lucide:mouse-pointer-click',
}

export function addMessageKindGroups(context: AddMessageKindContext): AddMessageKindOption[][] {
  if (context.channel === 'IN_APP') {
    // 站内固定只有一条文本；已有内容后不再展示插入入口。
    return context.messageCount === 0 ? [[{ kind: 'TEXT', enabled: true }]] : []
  }

  const enabledKinds = context.sendMethod === 'ROBOT' ? WECOM_ROBOT_KINDS : WECOM_APP_KINDS
  const pendingKinds = context.sendMethod === 'ROBOT' ? WECOM_ROBOT_PENDING_KINDS : WECOM_APP_PENDING_KINDS
  const enabled: AddMessageKindOption[] = enabledKinds.map(kind => ({ kind, enabled: true }))
  if (context.sendMethod === 'APP' && !context.hasMpnews) {
    enabled.push({ kind: 'MPNEWS', enabled: true })
  }
  if (context.hasMedia) {
    enabled.push({ kind: 'IMAGE', enabled: true })
  }
  const pending: AddMessageKindOption[] = pendingKinds.map(kind => ({ kind, enabled: false }))
  return [enabled, pending]
}
