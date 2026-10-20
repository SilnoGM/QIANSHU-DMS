<script setup lang="ts">
import { getHealth } from '@/api/modules/health'
import LoginCollageForm from '@/components/AppAccountForm/login-collage.vue'
import AppLoginCollage from '@/components/AppLoginCollage/index.vue'
import { useAppStartup } from '@/composables/app/startup'

defineOptions({ name: 'LoginCollage' })

type HealthState = 'checking' | 'healthy' | 'unhealthy'

const route = useRoute()
const router = useRouter()
const appSettingsStore = useAppSettingsStore()
const { run: runStartup } = useAppStartup()

const appTitle = import.meta.env.VITE_APP_TITLE
const appVersion = `v${__SYSTEM_INFO__.pkg.version}`
const redirect = ref(route.query.redirect?.toString() ?? appSettingsStore.settings.app.home.fullPath)
const copyright = computed(() => appSettingsStore.settings.app.copyright)
const isDark = computed(() => appSettingsStore.currentColorScheme === 'dark')
const healthState = ref<HealthState>('checking')
const healthTexts = {
  checking: { full: '系统状态检测中', short: '检测中' },
  healthy: { full: '系统运行正常', short: '正常' },
  unhealthy: { full: '系统运行异常', short: '异常' },
} as const
const healthFullText = computed(() => healthTexts[healthState.value].full)
const healthShortText = computed(() => healthTexts[healthState.value].short)

const healthAbort = new AbortController()
let healthTimer: number | undefined
let healthPending = false

async function refreshHealth() {
  if (healthPending) {
    return
  }
  healthPending = true
  try {
    const response = await getHealth(undefined, healthAbort.signal)
    if (healthAbort.signal.aborted) {
      return
    }
    healthState.value = response.status === 200 && response.data.status === 'ok'
      ? 'healthy'
      : 'unhealthy'
  }
  catch {
    if (!healthAbort.signal.aborted) {
      healthState.value = 'unhealthy'
    }
  }
  finally {
    healthPending = false
  }
}

function handleLogin() {
  void runStartup(() => router.push(redirect.value))
}

onMounted(() => {
  void refreshHealth()
  healthTimer = window.setInterval(() => {
    void refreshHealth()
  }, 30_000)
})

onBeforeUnmount(() => {
  healthAbort.abort()
  if (healthTimer !== undefined) {
    window.clearInterval(healthTimer)
  }
})
</script>

<template>
  <div class="login-collage-page" :class="{ 'is-dark': isDark }">
    <svg class="page-arc" viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <circle cx="100" cy="100" r="90" stroke="currentColor" stroke-width="1.5" />
      <circle cx="100" cy="100" r="65" stroke="currentColor" stroke-width="1" />
    </svg>

    <header class="login-topbar">
      <div class="brand-lockup">
        <img class="brand-logo" src="@/assets/images/logo.svg" :alt="`${appTitle} Logo`">
        <div class="brand-text">
          <p class="brand-name">
            <FaTextShiny class="block">
              {{ appTitle }}
            </FaTextShiny>
          </p>
          <p class="brand-submark">
            QIANSHU DMS
          </p>
        </div>
      </div>
      <span
        class="status-pill"
        role="status"
        aria-live="polite"
        :aria-label="`${healthFullText}，版本 ${appVersion}`"
      >
        <span class="status-dot" :class="`status-dot--${healthState}`" aria-hidden="true" />
        <span class="status-full">{{ healthFullText }} · {{ appVersion }}</span>
        <span class="status-short">{{ healthShortText }} · {{ appVersion }}</span>
      </span>
    </header>

    <main class="login-main">
      <div class="login-layout">
        <div class="collage-panel">
          <AppLoginCollage :title="appTitle" :dark="isDark" />
        </div>
        <div class="login-panel">
          <LoginCollageForm @on-login="handleLogin" />
        </div>
      </div>
    </main>

    <footer class="page-footer">
      <FaTextShiny class="block">
        Copyright © {{ copyright.dates }} {{ copyright.company }}
      </FaTextShiny>
    </footer>
  </div>
</template>

<style scoped>
.login-collage-page {
  --login-accent-text: oklch(var(--primary));
  --login-page-background: linear-gradient(100deg, #f0f6fe 0%, #ecf5ff 30%, #f4f7f7 62%, #fefae9 100%);

  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  overflow: clip;
  color: oklch(var(--foreground));
  background: var(--login-page-background);
}

.login-collage-page.is-dark {
  --login-accent-text: color-mix(in oklch, oklch(var(--primary)), white 38%);
  --login-page-background:
    radial-gradient(circle at 8% 4%, oklch(var(--primary) / 10%), transparent 38%),
    linear-gradient(135deg, color-mix(in oklch, oklch(var(--background)), oklch(var(--primary)) 10%) 0%, color-mix(in oklch, oklch(var(--background)), oklch(var(--primary)) 3%) 50%, color-mix(in oklch, oklch(var(--background)), oklch(var(--primary)) 9%) 100%);
}

.page-arc {
  position: absolute;
  bottom: -180px;
  left: -150px;
  z-index: 0;
  width: 520px;
  height: 520px;
  color: oklch(var(--primary) / 8%);
  pointer-events: none;
}

.login-collage-page.is-dark .page-arc {
  color: oklch(var(--foreground) / 5%);
}

.login-topbar {
  position: relative;
  z-index: 10;
  display: flex;
  flex: none;
  gap: 24px;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 1280px;
  padding: 24px 48px 12px;
  margin: 0 auto;
}

.brand-lockup {
  display: flex;
  gap: 14px;
  align-items: center;
  min-width: 0;
}

.brand-logo {
  display: block;
  flex: none;
  width: 56px;
  height: 56px;
  object-fit: contain;
}

.login-collage-page.is-dark .brand-logo {
  filter: drop-shadow(0 0 1px rgb(255 255 255 / 55%));
}

.brand-name {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 32px;
  color: oklch(var(--foreground));
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.brand-submark {
  margin: 4px 0 0;
  font-family: var(--qs-font-mono);
  font-size: 11px;
  font-weight: 500;
  line-height: 15px;
  color: oklch(var(--muted-foreground));
  text-transform: uppercase;
  letter-spacing: 0.18em;
  white-space: nowrap;
}

.status-pill {
  display: flex;
  flex: none;
  gap: 8px;
  align-items: center;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  color: oklch(var(--muted-foreground));
  white-space: nowrap;
  background: color-mix(in oklch, oklch(var(--card)), transparent 25%);
  border: 1px solid oklch(var(--primary) / 12%);
  border-radius: 999px;
  box-shadow: 0 2px 10px rgb(6 78 59 / 5%);
  backdrop-filter: blur(8px);
}

.status-dot {
  width: 8px;
  height: 8px;
  background: oklch(var(--muted-foreground));
  border-radius: 50%;
  box-shadow: 0 0 0 3px color-mix(in oklch, oklch(var(--muted-foreground)), transparent 88%);
}

.status-dot--healthy {
  background: var(--login-accent-text);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--login-accent-text), transparent 88%);
}

.status-dot--unhealthy {
  background: oklch(var(--destructive));
  box-shadow: 0 0 0 3px oklch(var(--destructive) / 12%);
}

.status-short {
  display: none;
}

.login-main {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  padding: 16px 48px 8px;
}

.login-layout {
  display: grid;
  grid-template-columns: minmax(0, 7fr) minmax(380px, 5fr);
  gap: 48px;
  align-items: center;
  width: 100%;
  max-width: 1220px;
}

.collage-panel {
  min-width: 0;
}

.login-panel {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
}

.page-footer {
  position: relative;
  z-index: 1;
  flex: none;
  width: 100%;
  padding: 16px 24px;
  font-size: 11px;
  line-height: 17px;
  color: oklch(var(--muted-foreground));
  text-align: center;
}

@media (width <= 1199px) {
  .login-layout {
    grid-template-columns: minmax(0, 1fr);
    max-width: 440px;
  }

  .collage-panel {
    display: none;
  }

  .login-panel {
    justify-content: center;
  }
}

@media (width <= 640px) {
  .login-topbar {
    padding: 18px 20px 8px;
  }

  .brand-logo {
    width: 46px;
    height: 46px;
  }

  .brand-lockup {
    gap: 10px;
  }

  .brand-name {
    font-size: 20px;
    line-height: 28px;
  }

  .brand-submark {
    font-size: 10px;
    line-height: 13px;
  }

  .status-pill {
    gap: 6px;
    padding: 5px 9px;
    font-size: 10px;
    line-height: 14px;
  }

  .status-full {
    display: none;
  }

  .status-short {
    display: inline;
  }

  .login-main {
    padding: 12px 16px 8px;
  }

  .page-footer {
    padding: 12px 20px 16px;
    font-size: 10px;
    line-height: 16px;
  }
}
</style>
