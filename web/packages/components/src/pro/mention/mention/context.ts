import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue'
import type { MentionItemRegistration, MentionRange } from './types'
import { inject } from 'vue'

export interface MentionVirtualAnchor {
  getBoundingClientRect: () => DOMRect
  getClientRects: () => DOMRect[] & { item?: (index: number) => DOMRect | undefined }
}

export interface MentionRootSlotProps {
  open: boolean
  inputValue: string
  value: string[]
  searchTerm: string
  visibleItems: MentionItemRegistration[]
  highlightedItem: MentionItemRegistration | null
}

export interface MentionContextValue {
  open: Ref<boolean>
  value: Ref<string[]>
  inputValue: Ref<string>
  searchTerm: Ref<string>
  trigger: Ref<string>
  highlightedId: Ref<string | null>
  highlightedItem: ComputedRef<MentionItemRegistration | null>
  mentions: Ref<MentionRange[]>
  visibleItems: ComputedRef<MentionItemRegistration[]>
  visibleEnabledItems: ComputedRef<MentionItemRegistration[]>
  dir: ComputedRef<'ltr' | 'rtl'>
  disabled: ComputedRef<boolean>
  readonly: ComputedRef<boolean>
  loop: ComputedRef<boolean>
  modal: ComputedRef<boolean>
  inputId: string
  labelId: string
  listId: string
  rootRef: Readonly<ShallowRef<HTMLElement | null>>
  inputRef: ShallowRef<HTMLInputElement | HTMLTextAreaElement | null>
  listRef: ShallowRef<HTMLElement | null>
  virtualAnchor: ShallowRef<MentionVirtualAnchor | null>
  isPasting: Ref<boolean>
  closeMenu: () => void
  setOpen: (value: boolean) => void
  setSearchTerm: (value: string) => void
  setVirtualAnchor: (anchor: MentionVirtualAnchor | null) => void
  setHighlightedId: (id: string | null) => void
  moveHighlight: (direction: 'next' | 'prev' | 'first' | 'last') => void
  upsertItem: (item: MentionItemRegistration) => void
  removeItem: (id: string) => void
  isItemVisible: (value: string) => boolean
  getEnabledItems: () => MentionItemRegistration[]
  addMention: (value: string, triggerIndex: number) => void
  setMentions: (updater: MentionRange[] | ((prev: MentionRange[]) => MentionRange[])) => void
  removeMentions: (mentions: MentionRange[]) => void
}

export const mentionContextKey: InjectionKey<MentionContextValue> = Symbol('mention-context')

export function useMentionContext(componentName: string) {
  const context = inject(mentionContextKey, null)

  if (!context) {
    throw new Error(`\`${componentName}\` must be used within \`MentionRoot\`.`)
  }

  return context
}
