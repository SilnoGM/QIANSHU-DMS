<script setup lang="ts">
import type { QsToastViewProps } from './types'
import {
  QS_TOAST_ICON_NAMES,
  resolveQsToastRole,
} from './config'

defineOptions({ name: 'QsToast' })

const props = withDefaults(defineProps<QsToastViewProps>(), {
  action: undefined,
  closable: false,
  description: undefined,
  isPaused: false,
})

const emit = defineEmits<{
  closeToast: []
}>()

const iconName = computed(() => QS_TOAST_ICON_NAMES[props.type])
const toastRole = computed(() => resolveQsToastRole(props.type))

function handleActionClick() {
  try {
    props.action?.onClick()
  }
  finally {
    if (props.action?.closeOnClick !== false) {
      emit('closeToast')
    }
  }
}
</script>

<template>
  <article
    :role="toastRole"
    data-qs-toast
    :data-type="type"
    :data-paused="isPaused"
    class="qs-toast"
    :class="`qs-toast--${type}`"
  >
    <span class="qs-toast__accent" aria-hidden="true" />

    <span class="qs-toast__status" aria-hidden="true">
      <FaIcon
        :name="iconName"
        class="qs-toast__status-icon"
        :class="{ 'qs-toast__status-icon--loading': type === 'loading' }"
      />
    </span>

    <div class="qs-toast__content">
      <p class="qs-toast__title">
        {{ title }}
      </p>
      <p v-if="description" class="qs-toast__description">
        {{ description }}
      </p>
    </div>

    <button
      v-if="action"
      type="button"
      class="qs-toast__action"
      @click="handleActionClick"
    >
      {{ action.label }}
    </button>

    <button
      v-if="closable"
      type="button"
      class="qs-toast__close"
      aria-label="关闭提示"
      @click="emit('closeToast')"
    >
      <FaIcon name="i-lucide:x" class="size-4" aria-hidden="true" />
    </button>
  </article>
</template>

<style scoped>
.qs-toast {
  --qs-toast-tone: oklch(var(--foreground));
  --qs-toast-tone-soft: color-mix(in oklch, var(--qs-toast-tone) 10%, transparent);
  --qs-toast-tone-border: color-mix(in oklch, var(--qs-toast-tone) 22%, transparent);

  position: relative;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 3px 32px minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  width: var(--width, 356px);
  max-width: calc(100vw - 32px);
  min-height: 54px;
  padding: 10px 11px 10px 9px;
  overflow: hidden;
  color: oklch(var(--popover-foreground));
  background: color-mix(in oklch, oklch(var(--popover)) 94%, transparent);
  border: 1px solid color-mix(in oklch, oklch(var(--border)) 86%, transparent);
  border-radius: 14px;
  box-shadow:
    0 18px 44px -24px oklch(var(--foreground) / 34%),
    inset 0 1px 0 oklch(var(--background) / 72%);
  backdrop-filter: blur(18px) saturate(130%);
}

.qs-toast--success {
  --qs-toast-tone: oklch(52.7% 0.154 150.069deg);
}

.qs-toast--info {
  --qs-toast-tone: oklch(55% 0.15 244deg);
}

.qs-toast--warning {
  --qs-toast-tone: oklch(62% 0.14 70deg);
}

.qs-toast--error {
  --qs-toast-tone: oklch(var(--destructive));
}

.qs-toast--loading {
  --qs-toast-tone: oklch(var(--primary));
}

:global(.dark) .qs-toast--success {
  --qs-toast-tone: oklch(72% 0.16 150deg);
}

:global(.dark) .qs-toast--info {
  --qs-toast-tone: oklch(72% 0.13 244deg);
}

:global(.dark) .qs-toast--warning {
  --qs-toast-tone: oklch(78% 0.14 80deg);
}

.qs-toast__accent {
  width: 3px;
  height: 28px;
  background: var(--qs-toast-tone);
  border-radius: 999px;
}

.qs-toast__status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--qs-toast-tone);
  background: var(--qs-toast-tone-soft);
  border: 1px solid var(--qs-toast-tone-border);
  border-radius: 10px;
  box-shadow: inset 0 1px 0 oklch(var(--background) / 48%);
}

.qs-toast__status-icon {
  width: 17px;
  height: 17px;
}

.qs-toast__status-icon--loading {
  animation: qs-toast-spin 900ms linear infinite;
}

.qs-toast__content {
  min-width: 0;
}

.qs-toast__title,
.qs-toast__description {
  margin: 0;
  overflow-wrap: anywhere;
}

.qs-toast__title {
  font-size: var(--qs-type-size-sm);
  font-weight: var(--qs-type-weight-semibold);
  line-height: var(--qs-type-leading-sm);
  letter-spacing: -0.01em;
}

.qs-toast__description {
  margin-top: 1px;
  font-size: var(--qs-type-size-xs);
  font-weight: var(--qs-type-weight-regular);
  line-height: 1.125rem;
  color: oklch(var(--muted-foreground));
}

.qs-toast__action,
.qs-toast__close {
  flex-shrink: 0;
  font-family: var(--qs-font-sans);
  cursor: pointer;
  outline: none;
  transition:
    color 180ms cubic-bezier(0.16, 1, 0.3, 1),
    background-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
    border-color 180ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

.qs-toast__action {
  min-height: 30px;
  padding: 4px 10px;
  font-size: var(--qs-type-size-xs);
  font-weight: var(--qs-type-weight-semibold);
  line-height: var(--qs-type-leading-xs);
  color: oklch(var(--foreground));
  white-space: nowrap;
  background: oklch(var(--muted) / 72%);
  border: 1px solid oklch(var(--border) / 88%);
  border-radius: 9px;
}

.qs-toast__action:hover {
  background: oklch(var(--accent));
  border-color: color-mix(in oklch, var(--qs-toast-tone) 32%, oklch(var(--border)));
}

.qs-toast__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: oklch(var(--muted-foreground));
  background: transparent;
  border: 1px solid transparent;
  border-radius: 9px;
}

.qs-toast__close:hover {
  color: oklch(var(--foreground));
  background: oklch(var(--muted) / 72%);
  border-color: oklch(var(--border) / 72%);
}

.qs-toast__action:focus-visible,
.qs-toast__close:focus-visible {
  box-shadow:
    0 0 0 2px oklch(var(--popover)),
    0 0 0 4px oklch(var(--ring) / 72%);
}

.qs-toast__action:active,
.qs-toast__close:active {
  transform: translateY(1px) scale(0.98);
}

@media (width <= 480px) {
  .qs-toast {
    grid-template-columns: 3px 32px minmax(0, 1fr) auto;
  }

  .qs-toast__action {
    grid-row: 2;
    grid-column: 3 / -1;
    justify-self: start;
  }

  .qs-toast__close {
    grid-row: 1;
    grid-column: 4;
  }
}

@media (prefers-reduced-motion: reduce) {
  .qs-toast__status-icon--loading {
    animation: none;
  }

  .qs-toast__action,
  .qs-toast__close {
    transition: none;
  }
}

@supports not (backdrop-filter: blur(1px)) {
  .qs-toast {
    background: oklch(var(--popover));
  }
}

@keyframes qs-toast-spin {
  to {
    transform: rotate(1turn);
  }
}
</style>
