<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { MentionRange } from './types'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef } from 'vue'
import { cn } from '#utils'
import { useMentionContext } from './context'
import { createMentionValueList, normalizeWithGaps } from './mention-utils'
import MentionHighlighter from './MentionHighlighter.vue'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<{
  as?: 'input' | 'textarea'
  type?: string
  rows?: number
  class?: HTMLAttributes['class']
}>(), {
  as: 'textarea',
  type: 'text',
  rows: 4,
})

const context = useMentionContext('MentionInput')

const inputRef = shallowRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

const inputTag = computed(() => props.as)

function getTextWidth(text: string, element: HTMLInputElement | HTMLTextAreaElement) {
  const style = window.getComputedStyle(element)
  const measureSpan = document.createElement('span')

  measureSpan.style.cssText = `
    position: absolute;
    visibility: hidden;
    white-space: pre;
    font: ${style.font};
    letter-spacing: ${style.letterSpacing};
    text-transform: ${style.textTransform};
  `
  measureSpan.textContent = text

  document.body.appendChild(measureSpan)
  const width = measureSpan.offsetWidth
  document.body.removeChild(measureSpan)

  return width
}

function getLineHeight(element: HTMLInputElement | HTMLTextAreaElement) {
  const style = window.getComputedStyle(element)
  return Number.parseInt(style.lineHeight, 10) || element.offsetHeight
}

function createVirtualAnchor(
  element: HTMLInputElement | HTMLTextAreaElement,
  cursorPosition: number,
) {
  const getBoundingClientRect = () => {
    const rect = element.getBoundingClientRect()
    const textBeforeCursor = element.value.slice(0, cursorPosition)
    const lines = textBeforeCursor.split('\n')
    const currentLine = lines.length - 1
    const currentLineText = lines[currentLine] ?? ''
    const textWidth = getTextWidth(currentLineText, element)
    const style = window.getComputedStyle(element)
    const lineHeight = getLineHeight(element)
    const paddingLeft = Number.parseFloat(style.getPropertyValue('padding-left') || '0')
    const paddingRight = Number.parseFloat(style.getPropertyValue('padding-right') || '0')
    const paddingTop = Number.parseFloat(style.getPropertyValue('padding-top') || '0')
    const containerWidth = Math.max(1, element.clientWidth - paddingLeft - paddingRight)
    const wrappedLines = Math.floor(textWidth / containerWidth)
    const totalLines = currentLine + wrappedLines
    const scrollTop = element.scrollTop
    const scrollLeft = element.scrollLeft
    const effectiveTextWidth = textWidth % containerWidth
    const isRTL = context.dir.value === 'rtl'
    const x = isRTL
      ? Math.min(rect.right - paddingRight - effectiveTextWidth + scrollLeft, rect.right - 10)
      : Math.min(rect.left + paddingLeft + effectiveTextWidth - scrollLeft, rect.right - 10)
    const y = rect.top + paddingTop + (totalLines * lineHeight - scrollTop)

    return DOMRect.fromRect({
      x,
      y,
      width: 0,
      height: lineHeight,
    })
  }

  context.setVirtualAnchor({
    getBoundingClientRect,
    getClientRects() {
      const rect = getBoundingClientRect()
      const rects = [rect] as DOMRect[] & { item?: (index: number) => DOMRect | undefined }
      rects.item = index => rects[index]
      return rects
    },
  })
}

function closeMenu() {
  context.closeMenu()
}

function updateMentionState(
  element: HTMLInputElement | HTMLTextAreaElement,
  selectionStart: number | null = null,
) {
  if (context.disabled.value || context.readonly.value) {
    return false
  }

  const currentPosition = selectionStart ?? element.selectionStart

  if (currentPosition === null) {
    return false
  }

  const source = element.value
  const lastTriggerIndex = source.lastIndexOf(context.trigger.value, currentPosition)

  if (lastTriggerIndex === -1) {
    closeMenu()
    return false
  }

  const isPartOfExistingMention = context.mentions.value.some(mention => mention.start <= lastTriggerIndex && mention.end > lastTriggerIndex)

  if (isPartOfExistingMention) {
    closeMenu()
    return false
  }

  const textBeforeTrigger = source.slice(0, lastTriggerIndex)
  const hasTextBeforeTrigger = /\S/.test(textBeforeTrigger)

  if (hasTextBeforeTrigger) {
    const lastCharBeforeTrigger = textBeforeTrigger.slice(-1)

    if (lastCharBeforeTrigger !== ' ' && lastCharBeforeTrigger !== '\n') {
      closeMenu()
      return false
    }
  }

  const textAfterTrigger = source.slice(lastTriggerIndex + 1, currentPosition)
  const isValidMention = !textAfterTrigger.includes(' ')
  const isCursorAfterTrigger = currentPosition > lastTriggerIndex
  const isImmediatelyAfterTrigger = currentPosition === lastTriggerIndex + 1
  const textAfterCursor = source.slice(currentPosition)
  const firstCharAfterCursor = textAfterCursor[0]
  const isTextAfterCursorSeparated = !firstCharAfterCursor
    || firstCharAfterCursor === ' '
    || firstCharAfterCursor === '\n'
    || firstCharAfterCursor === context.trigger.value
  const isTextAfterCursorPartOfMention = context.mentions.value.some(mention => currentPosition >= mention.start && currentPosition < mention.end)
  const hasInterferingText = textAfterCursor.length > 0 && !isTextAfterCursorSeparated && !isTextAfterCursorPartOfMention

  if (hasInterferingText) {
    closeMenu()
    return false
  }

  if (isValidMention && (isCursorAfterTrigger || isImmediatelyAfterTrigger)) {
    createVirtualAnchor(element, lastTriggerIndex)
    context.setSearchTerm(isImmediatelyAfterTrigger ? '' : textAfterTrigger)
    context.setOpen(true)
    return true
  }

  closeMenu()
  return false
}

function handleInput(event: Event) {
  if (context.disabled.value || context.readonly.value) {
    return
  }

  const element = event.target as HTMLInputElement | HTMLTextAreaElement
  const nextValue = element.value
  const cursorPosition = element.selectionStart ?? 0
  const previousValue = context.inputValue.value
  const insertedLength = nextValue.length - previousValue.length

  if (insertedLength !== 0) {
    context.setMentions(prev => prev.map((mention) => {
      if (mention.start >= cursorPosition - (insertedLength > 0 ? insertedLength : 0)) {
        return {
          ...mention,
          start: mention.start + insertedLength,
          end: mention.end + insertedLength,
        }
      }

      return mention
    }))
  }

  context.inputValue.value = nextValue
  updateMentionState(element)
}

function handleClick(event: MouseEvent) {
  updateMentionState(event.currentTarget as HTMLInputElement | HTMLTextAreaElement)
}

function handleCut(event: ClipboardEvent) {
  if (context.disabled.value || context.readonly.value) {
    return
  }

  const element = event.currentTarget as HTMLInputElement | HTMLTextAreaElement
  const cursorPosition = element.selectionStart ?? 0
  const selectionEnd = element.selectionEnd ?? cursorPosition

  if (cursorPosition === selectionEnd) {
    return
  }

  const affectedMentions = context.mentions.value.filter((mention) => {
    return (mention.start >= cursorPosition && mention.start < selectionEnd)
      || (mention.end > cursorPosition && mention.end <= selectionEnd)
  })

  if (affectedMentions.length === 0) {
    return
  }

  requestAnimationFrame(() => {
    context.value.value = context.value.value.filter(value => !affectedMentions.some(mention => mention.value === value))
    context.removeMentions(affectedMentions)
  })
}

function handleFocus(event: FocusEvent) {
  updateMentionState(event.currentTarget as HTMLInputElement | HTMLTextAreaElement)
}

function handleBeforeInput(event: InputEvent) {
  if (context.disabled.value || context.readonly.value) {
    return
  }

  const element = event.currentTarget as HTMLInputElement | HTMLTextAreaElement
  const cursorPosition = element.selectionStart ?? 0

  if (event.inputType !== 'deleteContentBackward') {
    return
  }

  const mentionAtCursor = context.mentions.value.find(mention => cursorPosition > mention.start && cursorPosition <= mention.end)

  if (!mentionAtCursor) {
    return
  }

  event.preventDefault()

  const hasTrailingSpace = element.value[mentionAtCursor.end] === ' '
  const nextValue = element.value.slice(0, mentionAtCursor.start) + element.value.slice(mentionAtCursor.end + (hasTrailingSpace ? 1 : 0))

  element.value = nextValue
  context.inputValue.value = nextValue
  context.value.value = createMentionValueList(context.value.value, mentionAtCursor.value)
  context.removeMentions([mentionAtCursor])
  element.setSelectionRange(mentionAtCursor.start, mentionAtCursor.start)
}

function handleKeydown(event: KeyboardEvent) {
  const element = event.currentTarget as HTMLInputElement | HTMLTextAreaElement
  const cursorPosition = element.selectionStart ?? 0
  const selectionEnd = element.selectionEnd ?? cursorPosition
  const hasSelection = cursorPosition !== selectionEnd

  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !hasSelection && !event.shiftKey) {
    const isCtrlOrCmd = event.metaKey || event.ctrlKey
    const isLeftArrow = event.key === 'ArrowLeft'
    const adjacentMention = context.mentions.value.find((mention) => {
      if (isLeftArrow) {
        const textBetween = element.value.slice(mention.end, cursorPosition)
        const isOnlySpaces = /^\s*$/.test(textBetween)

        if (isCtrlOrCmd) {
          return cursorPosition > mention.start
            && (cursorPosition === mention.end || (cursorPosition > mention.end && isOnlySpaces))
        }

        return cursorPosition === mention.end
          || (cursorPosition > mention.end && cursorPosition <= mention.end + 1 && isOnlySpaces)
      }

      const textBetween = element.value.slice(cursorPosition, mention.start)
      const isOnlySpaces = /^\s*$/.test(textBetween)

      if (isCtrlOrCmd) {
        return (cursorPosition >= mention.start && cursorPosition < mention.end)
          || (cursorPosition < mention.start && isOnlySpaces)
      }

      return cursorPosition === mention.start
        || (cursorPosition < mention.start && cursorPosition >= mention.start - 1 && isOnlySpaces)
    })

    if (adjacentMention) {
      event.preventDefault()
      const nextPosition = isCtrlOrCmd
        ? (isLeftArrow ? adjacentMention.start : adjacentMention.end)
        : isLeftArrow
          ? (cursorPosition > adjacentMention.end ? adjacentMention.end : adjacentMention.start)
          : (cursorPosition < adjacentMention.start ? adjacentMention.start : adjacentMention.end)

      element.setSelectionRange(nextPosition, nextPosition)
      return
    }
  }

  if ((event.key === 'Backspace' || event.key === 'Delete') && hasSelection) {
    const nextValue = element.value.slice(0, cursorPosition) + element.value.slice(selectionEnd)
    const affectedMentions = context.mentions.value.filter((mention) => {
      return (mention.start >= cursorPosition && mention.start < selectionEnd)
        || (mention.end > cursorPosition && mention.end <= selectionEnd)
    })

    if (affectedMentions.length > 0) {
      event.preventDefault()
      element.value = nextValue
      context.inputValue.value = nextValue
      context.value.value = context.value.value.filter(value => !affectedMentions.some(mention => mention.value === value))
      context.removeMentions(affectedMentions)
      element.setSelectionRange(cursorPosition, cursorPosition)
      return
    }
  }

  if (event.key === 'Backspace' && !context.open.value && !hasSelection) {
    const isCtrlOrCmd = event.metaKey || event.ctrlKey
    const mentionBeforeCursor = context.mentions.value.find((mention) => {
      if (!isCtrlOrCmd) {
        return cursorPosition === mention.end
          || (cursorPosition === mention.end + 1 && element.value[mention.end] === ' ')
          || (cursorPosition > mention.start && cursorPosition <= mention.end)
      }

      const textBetween = element.value.slice(mention.end, cursorPosition)
      return mention.end <= cursorPosition && /^\s*$/.test(textBetween)
    })

    if (mentionBeforeCursor) {
      const hasTrailingSpace = element.value[mentionBeforeCursor.end] === ' '

      event.preventDefault()

      const nextValue = element.value.slice(0, mentionBeforeCursor.start) + element.value.slice(
        mentionBeforeCursor.end + (hasTrailingSpace ? 1 : 0),
      )

      element.value = nextValue
      context.inputValue.value = nextValue
      context.value.value = createMentionValueList(context.value.value, mentionBeforeCursor.value)
      context.removeMentions([mentionBeforeCursor])
      element.setSelectionRange(mentionBeforeCursor.start, mentionBeforeCursor.start)
      return
    }
  }

  if (!context.open.value) {
    return
  }

  const isNavigationKey = ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab', 'Home', 'End'].includes(event.key)

  if (isNavigationKey && event.key !== 'Tab') {
    event.preventDefault()
  }

  switch (event.key) {
    case 'Enter':
      if (context.highlightedItem.value) {
        event.preventDefault()
        const triggerIndex = element.value.lastIndexOf(context.trigger.value, cursorPosition)
        if (triggerIndex !== -1) {
          context.addMention(context.highlightedItem.value.value, triggerIndex)
        }
      }
      else {
        closeMenu()
      }
      break
    case 'Tab':
      if (context.modal.value && context.highlightedItem.value) {
        event.preventDefault()
        const triggerIndex = element.value.lastIndexOf(context.trigger.value, cursorPosition)
        if (triggerIndex !== -1) {
          context.addMention(context.highlightedItem.value.value, triggerIndex)
        }
      }
      else {
        closeMenu()
      }
      break
    case 'ArrowDown':
      context.moveHighlight(context.highlightedItem.value ? 'next' : 'first')
      break
    case 'ArrowUp':
      context.moveHighlight(context.highlightedItem.value ? 'prev' : 'last')
      break
    case 'Home':
      if (!event.metaKey && !event.ctrlKey) {
        context.moveHighlight('first')
      }
      break
    case 'End':
      if (!event.metaKey && !event.ctrlKey) {
        context.moveHighlight('last')
      }
      break
    case 'Escape':
      closeMenu()
      break
  }
}

function handleSelect() {
  if (context.disabled.value || context.readonly.value) {
    return
  }

  const element = context.inputRef.value

  if (!element) {
    return
  }

  updateMentionState(element)
}

function handlePointerDown(event: PointerEvent) {
  if (context.disabled.value || context.readonly.value) {
    return
  }

  const element = event.currentTarget as HTMLInputElement | HTMLTextAreaElement

  if (!element.value.length) {
    return
  }

  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  const paddingLeft = Number.parseFloat(style.paddingLeft || '0')
  const clickX = event.clientX - rect.left - paddingLeft
  const textWidth = getTextWidth(element.value, element)
  const charWidth = textWidth / element.value.length
  const approximatePosition = Math.round(clickX / charWidth)
  const clickedMention = context.mentions.value.find(mention => approximatePosition >= mention.start && approximatePosition < mention.end)

  if (!clickedMention) {
    return
  }

  event.preventDefault()

  requestAnimationFrame(() => {
    element.setSelectionRange(clickedMention.end, clickedMention.end)
  })
}

function handlePaste(event: ClipboardEvent) {
  if (context.disabled.value || context.readonly.value) {
    return
  }

  const element = event.currentTarget as HTMLInputElement | HTMLTextAreaElement
  const pastedText = event.clipboardData?.getData('text') ?? ''
  const cursorPosition = element.selectionStart ?? 0
  const selectionEnd = element.selectionEnd ?? cursorPosition
  const triggerIndex = pastedText.indexOf(context.trigger.value)

  if (triggerIndex === -1) {
    return
  }

  event.preventDefault()

  const parts = pastedText.split(context.trigger.value)
  let nextText = parts[0] ?? ''

  requestAnimationFrame(async () => {
    context.isPasting.value = true
    context.setOpen(true)
    await nextTick()

    const items = context.getEnabledItems()
    const nextMentions: MentionRange[] = []
    const nextValues = [...context.value.value]
    const trailingSpaces = pastedText.match(/\s+$/)?.[0] ?? ''

    for (let index = 1; index < parts.length; index++) {
      const part = parts[index]

      if (!part) {
        continue
      }

      const words = part.split(/(\s+)/)
      let mentionText = ''
      let spaces = ''
      let remainingText = ''
      let hasValidMention = false

      for (let wordCount = words.length; wordCount > 0; wordCount--) {
        const candidateWords = words.slice(0, wordCount).filter((_, wordIndex) => wordIndex % 2 === 0)
        const candidateText = candidateWords.join(' ').trim()

        if (!candidateText) {
          continue
        }

        const mentionItem = items.find(item => normalizeWithGaps(item.value) === normalizeWithGaps(candidateText))

        if (!mentionItem) {
          continue
        }

        mentionText = candidateText
        const usedWordCount = candidateWords.length
        const usedSegments = usedWordCount * 2 - 1
        const nextSegmentIndex = usedSegments
        const nextSegment = words[nextSegmentIndex]
        const afterNextSegment = words[nextSegmentIndex + 1]

        if (nextSegment && /^\s+/.test(nextSegment) && afterNextSegment) {
          spaces = nextSegment
          remainingText = words.slice(nextSegmentIndex + 1).join('')
        }
        else {
          remainingText = words.slice(nextSegmentIndex).join('')
        }

        hasValidMention = true
        break
      }

      const mentionStartPosition = cursorPosition + nextText.length

      if (hasValidMention) {
        const mentionItem = items.find(item => normalizeWithGaps(item.value) === normalizeWithGaps(mentionText))

        if (mentionItem) {
          const mentionLabel = `${context.trigger.value}${mentionItem.label}`
          const shouldAddTrailingSpaces = index === parts.length - 1 && !remainingText
          nextText += mentionLabel + spaces + remainingText + (shouldAddTrailingSpaces ? trailingSpaces : '')
          nextValues.push(mentionItem.value)
          nextMentions.push({
            value: mentionItem.value,
            label: mentionItem.label,
            start: mentionStartPosition,
            end: mentionStartPosition + mentionLabel.length,
          })
        }
      }
      else {
        const firstWord = words[0] ?? ''
        const spaceSegment = words[1] ?? ''
        spaces = /^\s+/.test(spaceSegment) ? spaceSegment : ''
        remainingText = words.slice(2).join('')
        const shouldAddTrailingSpaces = index === parts.length - 1
        nextText += `${context.trigger.value}${firstWord}${spaces}${remainingText}${shouldAddTrailingSpaces ? trailingSpaces : ''}`
      }
    }

    const finalValue = element.value.slice(0, cursorPosition) + nextText + element.value.slice(selectionEnd)

    element.value = finalValue
    context.inputValue.value = finalValue

    if (nextMentions.length > 0) {
      context.value.value = nextValues
      context.setMentions(prev => [...prev, ...nextMentions])
    }

    const nextCursorPosition = cursorPosition + nextText.length
    element.setSelectionRange(nextCursorPosition, nextCursorPosition)
    context.isPasting.value = false
    context.setOpen(false)
  })
}

onMounted(() => {
  context.inputRef.value = inputRef.value
})

onBeforeUnmount(() => {
  if (context.inputRef.value === inputRef.value) {
    context.inputRef.value = null
  }
})
</script>

<template>
  <div class="relative">
    <MentionHighlighter />
    <component
      :is="inputTag"
      :id="context.inputId"
      ref="inputRef"
      v-bind="$attrs"
      data-slot="mention-input"
      role="combobox"
      autocomplete="off"
      :aria-expanded="context.open.value"
      :aria-controls="context.listId"
      :aria-labelledby="context.labelId"
      aria-autocomplete="list"
      :aria-activedescendant="context.highlightedItem.value?.id"
      :aria-disabled="context.disabled.value"
      :aria-readonly="context.readonly.value"
      :disabled="context.disabled.value"
      :readonly="context.readonly.value"
      :dir="context.dir.value"
      :rows="props.as === 'textarea' ? props.rows : undefined"
      :type="props.as === 'input' ? props.type : undefined"
      :value="context.inputValue.value"
      :class="cn(props.class)"
      @beforeinput="handleBeforeInput"
      @input="handleInput"
      @click="handleClick"
      @cut="handleCut"
      @focus="handleFocus"
      @keydown="handleKeydown"
      @paste="handlePaste"
      @pointerdown="handlePointerDown"
      @select="handleSelect"
    />
  </div>
</template>
