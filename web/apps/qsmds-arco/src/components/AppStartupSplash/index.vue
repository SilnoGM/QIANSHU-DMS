<script setup lang="ts">
defineOptions({ name: 'AppStartupSplash' })

defineProps<{
  leaving?: boolean
}>()

const appTitle = import.meta.env.VITE_APP_TITLE
const appVersion = `v${__SYSTEM_INFO__.pkg.version}`
const appSettingsStore = useAppSettingsStore()
const copyright = computed(() => appSettingsStore.settings.app.copyright)
</script>

<template>
  <div
    class="workspace-startup"
    :class="{ 'is-leaving': leaving }"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <div class="startup-stripes" aria-hidden="true" />
    <div class="startup-stage">
      <img class="startup-logo" src="@/assets/images/logo.svg" alt="">
      <div class="startup-heading">
        <p class="startup-title">
          {{ appTitle }}
        </p>
        <span class="startup-version">{{ appVersion }}</span>
      </div>
      <div class="startup-progress" aria-hidden="true">
        <span class="startup-progress-value" />
      </div>
      <p class="startup-status">
        正在准备工作台
      </p>
    </div>
    <p class="startup-copyright">
      <FaTextShiny class="block">
        © {{ copyright.dates }} {{ copyright.company }}
      </FaTextShiny>
    </p>
  </div>
</template>

<style scoped>
.workspace-startup {
  --startup-primary: oklch(52.7% 0.154 150.069deg);
  --startup-foreground: oklch(14.1% 0.005 285.823deg);

  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
  overflow: hidden;
  font-family: var(--font-sans);
  color: var(--startup-foreground);
  text-align: center;
  user-select: none;
  background: linear-gradient(100deg, #f0f6fe 0%, #ecf5ff 30%, #f4f7f7 62%, #fefae9 100%);
  isolation: isolate;
  opacity: 1;
  transition: opacity 180ms ease;
}

.workspace-startup.is-leaving {
  opacity: 0;
}

.startup-stripes {
  position: absolute;
  inset: -25%;
  z-index: 0;
  pointer-events: none;
  background-image:
    repeating-linear-gradient(
      113deg,
      transparent 0,
      transparent 127px,
      color-mix(in oklch, var(--startup-primary), transparent 95.5%) 128px,
      color-mix(in oklch, var(--startup-primary), transparent 95.5%) 129px,
      transparent 130px,
      transparent 256px
    );
  animation: startup-stripes 8s linear infinite alternate;
  will-change: transform;
}

.startup-stage {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(360px, calc(100vw - 48px));
  transform: translateY(-3vh);
}

.startup-logo {
  display: block;
  width: 108px;
  height: 108px;
  object-fit: contain;
  filter: drop-shadow(0 12px 20px color-mix(in oklch, var(--startup-primary), transparent 90%));
}

.startup-heading {
  display: flex;
  gap: 9px;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  margin-top: 20px;
}

.startup-title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.startup-version {
  flex: 0 0 auto;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--startup-primary);
  letter-spacing: 0.02em;
  background: color-mix(in oklch, var(--startup-primary), transparent 92%);
  border: 1px solid color-mix(in oklch, var(--startup-primary), transparent 86%);
  border-radius: 999px;
}

.startup-progress {
  width: min(320px, 100%);
  height: 4px;
  margin-top: 28px;
  overflow: hidden;
  background: color-mix(in oklch, var(--startup-primary), transparent 90%);
  border-radius: 999px;
}

.startup-progress-value {
  display: block;
  width: 40%;
  height: 100%;
  background: var(--startup-primary);
  border-radius: inherit;
  box-shadow: 0 0 12px color-mix(in oklch, var(--startup-primary), transparent 76%);
  animation: startup-progress 1.45s cubic-bezier(0.45, 0, 0.55, 1) infinite;
  will-change: transform;
}

.startup-status {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: color-mix(in oklch, var(--startup-foreground), transparent 38%);
  letter-spacing: 0.04em;
}

.startup-copyright {
  position: absolute;
  right: max(24px, env(safe-area-inset-right));
  bottom: max(24px, calc(env(safe-area-inset-bottom) + 16px));
  left: max(24px, env(safe-area-inset-left));
  z-index: 1;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: color-mix(in oklch, var(--startup-foreground), transparent 38%);
}

@keyframes startup-stripes {
  from {
    transform: translate3d(-6vw, 0, 0);
  }

  to {
    transform: translate3d(6vw, 0, 0);
  }
}

@keyframes startup-progress {
  from {
    transform: translate3d(-130%, 0, 0);
  }

  to {
    transform: translate3d(350%, 0, 0);
  }
}

@media (width <= 560px) {
  .startup-stage {
    width: min(280px, calc(100vw - 48px));
    transform: translateY(-2vh);
  }

  .startup-logo {
    width: 84px;
    height: 84px;
  }

  .startup-heading {
    gap: 7px;
    margin-top: 18px;
  }

  .startup-title {
    font-size: 21px;
    line-height: 1.35;
  }

  .startup-version {
    padding: 2px 7px;
  }

  .startup-progress {
    width: min(240px, 100%);
    margin-top: 24px;
  }

  .startup-copyright {
    right: max(16px, env(safe-area-inset-right));
    bottom: max(16px, calc(env(safe-area-inset-bottom) + 12px));
    left: max(16px, env(safe-area-inset-left));
    font-size: 11px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .startup-stripes,
  .startup-progress-value {
    animation: none;
  }

  .startup-stripes {
    transform: none;
  }

  .startup-progress-value {
    width: 42%;
    transform: none;
  }
}
</style>
