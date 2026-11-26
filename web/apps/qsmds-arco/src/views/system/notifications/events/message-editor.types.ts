import type {
  NotificationEventChannelMessageDto,
  NotificationEventVariableDto,
} from '@/api/generated/types.gen'

export type MessageKind = NotificationEventChannelMessageDto['kind']
export type MessageChannel = 'IN_APP' | 'WECOM'
export type MessageSendMethod = 'IN_APP' | 'APP' | 'ROBOT'

export interface MessageDraft {
  kind: MessageKind
  payload: Record<string, unknown>
  mediaPolicy: Record<string, unknown>
  enabled: boolean
}

export interface MessageEditorContext {
  readonly channel: MessageChannel
  readonly sendMethod: MessageSendMethod
  readonly mediaMaxCount: number
  readonly mediaSources: readonly string[]
  readonly variables: readonly NotificationEventVariableDto[]
  readonly variablesKnown: boolean
}

export interface MessageValidationIssue {
  readonly field: string
  readonly message: string
}

/** 服务端 issues 已收敛为可直接驱动 UI 定位的结构。 */
export interface MessageServerIssue {
  readonly code: string
  readonly message: string
  readonly channel: MessageChannel | null
  readonly itemIndex: number | null
  readonly field: string | null
}

export interface MessageServerIssueInput {
  readonly code: string
  readonly message: string
  readonly channel?: string
  readonly itemIndex?: number
  readonly field?: string
}
