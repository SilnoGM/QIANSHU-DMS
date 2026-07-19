<script setup lang="ts">
import { diffTwoObj } from '@fantastic-admin/settings'
import { BASE_COLORS, THEMES } from '@fantastic-admin/themes'
import Login from '@/components/AppAccountForm/login.vue'
import ColorScheme from '@/layouts/components/Topbar/Toolbar/ColorScheme/index.vue'
import Language from '@/layouts/components/Topbar/Toolbar/I18n/index.vue'
import settingsDefault from '@/settings'

defineOptions({
  name: 'Login',
})

const route = useRoute()
const router = useRouter()
const appSettingsStore = useAppSettingsStore()

// 复用构建环境中的应用标题与版本号，避免登录页品牌信息和其他入口出现分叉。
const appTitle = import.meta.env.VITE_APP_TITLE
const appVersion = `v${__SYSTEM_INFO__.pkg.version}`
const redirect = ref(route.query.redirect?.toString() ?? appSettingsStore.settings.app.home.fullPath)

const activeColorScheme = computed(() => appSettingsStore.currentColorScheme ?? 'light')
const currentBaseColor = computed(() => {
  return activeColorScheme.value === 'dark'
    ? appSettingsStore.settings.theme.baseColorDark
    : appSettingsStore.settings.theme.baseColorLight
})
const themeList = computed(() => {
  const baseColorPrimary = BASE_COLORS[currentBaseColor.value][activeColorScheme.value]['--primary']
  return Object.keys(THEMES).map((key) => {
    const tokens = THEMES[key as keyof typeof THEMES][activeColorScheme.value] as Partial<Record<'--primary', string>>
    return {
      label: key as keyof typeof THEMES,
      preview: tokens['--primary'] ?? baseColorPrimary,
    }
  })
})

// 布局对齐方式
const layoutAlign = ref<'left' | 'center' | 'right'>('right')
function checkVisible<T extends object>(preference: boolean | T | undefined, property?: keyof T): boolean {
  if (typeof preference === 'boolean') {
    return preference
  }

  if (typeof preference !== 'object' || preference === null) {
    return false
  }

  if (property === undefined) {
    return true
  }

  return Boolean(preference[property])
}

function handleLogin() {
  const data = diffTwoObj(settingsDefault, appSettingsStore.settings)
  router.push(redirect.value).then(() => {
    if (Object.keys(data).length > 0) {
      appSettingsStore.updateSettings(data)
    }
  })
}
</script>

<template>
  <div class="bg-banner" />
  <div class="text-base p-1 border rounded-lg bg-background flex-center right-4 top-4 absolute z-1">
    <FaDropdown
      v-if="appSettingsStore.mode === 'pc'"
      :items="[[
        { label: '左侧布局', disabled: layoutAlign === 'left', handle: () => { layoutAlign = 'left' } },
        { label: '居中布局', disabled: layoutAlign === 'center', handle: () => { layoutAlign = 'center' } },
        { label: '右侧布局', disabled: layoutAlign === 'right', handle: () => { layoutAlign = 'right' } },
      ]]"
    >
      <FaButton variant="ghost" size="icon-sm">
        <FaIcon
          :name="{
            left: 'i-icon-park-outline:left-bar',
            center: 'i-icon-park-outline:square',
            right: 'i-icon-park-outline:right-bar',
          }[layoutAlign]" class="size-4"
        />
      </FaButton>
    </FaDropdown>
    <Language v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'i18n') && appSettingsStore.settings.toolbar.i18n" tag="span" />
    <FaPopover v-if="checkVisible(appSettingsStore.settings.app.preferences.theme, 'light') || checkVisible(appSettingsStore.settings.app.preferences.theme, 'dark')" class="p-0 min-w-auto">
      <FaButton variant="ghost" size="icon-sm">
        <FaIcon name="i-mdi:circle" class="text-primary" />
      </FaButton>
      <template #panel>
        <div class="p-4 gap-2 grid grid-cols-3 w-28">
          <div v-for="item in themeList" :key="item.label" class="text-xs m-auto border-2 border-border border-transparent rounded-full flex h-5 w-5 cursor-pointer transition-border items-center justify-center" :class="{ 'border-primary!': activeColorScheme === 'dark' ? appSettingsStore.settings.theme.dark === item.label : appSettingsStore.settings.theme.light === item.label }" @click="activeColorScheme === 'dark' ? appSettingsStore.settings.theme.dark = item.label : appSettingsStore.settings.theme.light = item.label">
            <div class="rounded-full flex h-3 w-3 items-center justify-center" :style="`background-color: oklch(${item.preview});`" />
          </div>
        </div>
      </template>
    </FaPopover>
    <ColorScheme v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'colorScheme') && appSettingsStore.settings.toolbar.colorScheme" />
  </div>
  <div class="login-box" :class="layoutAlign">
    <div class="login-banner">
      <div class="login-brand inset-s-4 inset-t-4 absolute z-1 flex items-center gap-2">
        <img src="@/assets/images/logo.svg" :alt="`${appTitle} LOGO`" class="rounded h-8 w-8 object-contain">
        <span class="text-base text-foreground font-bold leading-none whitespace-nowrap">{{ appTitle }}</span>
        <FaBadge :value="appVersion" variant="secondary" class="login-version-badge" badge-class="text-[10px] font-medium leading-4 ring-border" />
      </div>
      <img src="@/assets/images/login-banner.svg" alt="数据管理系统插画" class="banner">
      <AppCopyright v-if="appSettingsStore.mode === 'pc' && ['left', 'right'].includes(layoutAlign)" class="w-full bottom-0 absolute" />
    </div>
    <div class="login-form flex-col-center">
      <Login @on-login="handleLogin" />
    </div>
  </div>
  <AppCopyright v-if="appSettingsStore.mode === 'mobile' || layoutAlign === 'center'" class="copyright" />
</template>

<style scoped>
.bg-banner {
  position: fixed;
  z-index: 0;
  width: 100%;
  height: 100%;
  background:
    radial-gradient(closest-side, oklch(var(--border) / 10%) 30%, oklch(var(--primary) / 20%) 30%, oklch(var(--border) / 30%) 50%) no-repeat,
    radial-gradient(closest-side, oklch(var(--border) / 10%) 30%, oklch(var(--primary) / 20%) 30%, oklch(var(--border) / 30%) 50%) no-repeat;
  background-position: 100% 100%, 0% 0%;
  background-size: 200vw 200vh;
  filter: blur(100px);
}

[data-mode="mobile"] {
  .login-box {
    position: relative;
    flex-direction: column;
    justify-content: start;
    width: 100%;

    .login-banner {
      width: 100%;
      padding: 20px 0;

      .login-brand {
        position: relative;
        inset-block-start: auto;
        inset-inline-start: auto;
        margin: 0 16px 12px;
      }

      .banner {
        position: relative;
        top: inherit;
        right: inherit;
        display: inherit;
        width: 100%;
        max-width: 375px;
        margin: 0 auto;
        transform: translateY(0);
      }
    }

    .login-form {
      width: 100%;
    }
  }

  .copyright {
    position: relative;
  }
}

.login-box {
  position: absolute;
  display: flex;
  overflow: hidden;
  background-color: oklch(var(--background));

  [data-mode="pc"] & {
    &.center {
      --uno: shadow-md rounded-md;

      top: 50%;
      left: 50%;
      transform: translateX(-50%) translateY(-50%);
    }

    &.left,
    &.right {
      width: 100%;
      height: 100%;

      .login-banner {
        flex: 1;

        .banner {
          position: absolute;
          top: 50%;
          left: 50%;
          /* SVG 画布为 4:3，桌面端按宽度缩放并限制上限，避免宽屏下尺寸失控或比例失真。 */
          width: min(60%, 680px);
          height: auto;
          aspect-ratio: 4 / 3;
          object-fit: contain;
          transform: translateX(-50%) translateY(-50%);
        }
      }

      .login-form {
        margin: 0 5vw;
      }
    }

    &.left {
      flex-direction: row-reverse;
    }
  }

  .login-banner {
    --uno: bg-muted dark:bg-muted/30;

    position: relative;
    width: 450px;
    overflow: hidden;

    &::before {
      position: absolute;
      width: 100%;
      height: 100%;
      content: "";
      background:
        radial-gradient(closest-side, oklch(var(--border) / 10%) 30%, oklch(var(--primary) / 20%) 30%, oklch(var(--border) / 30%) 50%) no-repeat,
        radial-gradient(closest-side, oklch(var(--border) / 10%) 30%, oklch(var(--primary) / 20%) 30%, oklch(var(--border) / 30%) 50%) no-repeat;
      background-position: 100% 100%, 0% 0%;
      background-size: 200vw 200vh;
      filter: blur(100px);
    }

    .banner {
      position: absolute;
      top: 50%;
      width: 100%;
      transform: translateY(-50%);
    }
  }

  .login-form {
    width: 500px;
    transition: height 0.15s ease;
  }
}

.login-version-badge {
  flex: none;
  height: 32px;

  :deep(> div) {
    position: static;
    display: flex;
    align-items: center;
    width: auto;
    height: auto;
  }

  :deep([data-slot="badge"]) {
    position: static;
    inset: auto;
    transform: none !important;
    translate: none !important;
  }
}

.copyright {
  position: absolute;
  bottom: 0;
  width: 100%;
  padding: 20px;
  margin: 0;
}
</style>
