import type { HTMLAttributes, ShallowRef } from 'vue'

export type MentionSide = 'top' | 'right' | 'bottom' | 'left'
export type MentionAlign = 'start' | 'center' | 'end'
export type MentionDirection = 'ltr' | 'rtl'

export interface MentionOption {
  value: string
  label?: string
  disabled?: boolean
}

export interface MentionRange {
  value: string
  label: string
  start: number
  end: number
}

export interface MentionItemRegistration {
  id: string
  ref: ShallowRef<HTMLElement | null>
  value: string
  label: string
  disabled: boolean
}

export interface MentionCollisionPadding {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export type MentionClassName = HTMLAttributes['class']
