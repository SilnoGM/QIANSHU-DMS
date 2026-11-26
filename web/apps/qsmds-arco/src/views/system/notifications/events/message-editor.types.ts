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
