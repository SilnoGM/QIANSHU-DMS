<script setup lang="ts">
import { BASE_COLORS, THEMES } from '@fantastic-admin/themes'

const appSettingsStore = useAppSettingsStore()

const features = [
  {
    icon: 'i-ion:color-palette',
    title: '多主题切换',
    description: '支持亮色/暗色主题，多种配色方案随意切换',
  },
  {
    icon: 'i-ion:grid',
    title: '菜单模式',
    description: '侧边栏、顶部、精简等多种菜单布局模式',
  },
  {
    icon: 'i-ion:layers',
    title: '灵活配置',
    description: '圆角、间距、样式等细节可自由调整',
  },
  {
    icon: 'i-ion:eye',
    title: '视觉风格',
    description: '箭头、线条、圆点等多种菜单指示样式',
  },
]

function randomTheme() {
  function randomExcludeCurrent<T>(options: readonly T[], current?: T): T {
    const filtered = options.filter(item => item !== current)
    return filtered[Math.floor(Math.random() * filtered.length)]
  }

  const currentSettings = appSettingsStore.settings
  const nextSync = randomExcludeCurrent([true, false], currentSettings.theme.sync)
  const newLightTheme = randomExcludeCurrent(Object.keys(THEMES), currentSettings.theme.light) as keyof typeof THEMES
  const newDarkTheme = nextSync
    ? newLightTheme
    : randomExcludeCurrent(Object.keys(THEMES), currentSettings.theme.dark) as keyof typeof THEMES
  const newLightBaseColor = randomExcludeCurrent(Object.keys(BASE_COLORS), currentSettings.theme.baseColorLight) as keyof typeof BASE_COLORS
  const newDarkBaseColor = nextSync
    ? newLightBaseColor
    : randomExcludeCurrent(Object.keys(BASE_COLORS), currentSettings.theme.baseColorDark) as keyof typeof BASE_COLORS

  appSettingsStore.updateSettings({
    app: {
      layout: {
        center: randomExcludeCurrent([true, false]),
        centerScope: randomExcludeCurrent(['inner', 'outer']),
      },
    },
    theme: {
      sync: nextSync,
      baseColorLight: newLightBaseColor,
      baseColorDark: newDarkBaseColor,
      light: newLightTheme,
      dark: newDarkTheme,
      colorScheme: randomExcludeCurrent(['light', 'dark'], appSettingsStore.currentColorScheme ?? 'light'),
      radius: randomExcludeCurrent([0, 0.25, 0.5, 0.75, 1], currentSettings.theme.radius),
    },
    menu: {
      mode: randomExcludeCurrent(['side', 'head', 'single', 'only-side', 'only-head', 'side-panel', 'head-panel'], currentSettings.menu.mode),
      style: randomExcludeCurrent(['', 'arrow', 'line', 'dot'], currentSettings.menu.style),
      subMenuCollapse: randomExcludeCurrent([true, false]),
      subMenuAutoCollapse: randomExcludeCurrent([true, false]),
    },
    topbar: {
      switchTabbarAndToolbar: randomExcludeCurrent([true, false]),
    },
    toolbar: {
      breadcrumb: {
        style: randomExcludeCurrent(['', 'modern'], currentSettings.toolbar.breadcrumb.style),
      },
    },
  })
}
</script>

<template>
  <div class="bg-background inset-0 absolute overflow-auto">
    <div class="mx-auto px-6 py-10 max-w-7xl md-px-8 md-py-14">
      <!-- Hero Section -->
      <div class="mb-12 text-center">
        <div class="mb-6 px-4 py-1.5 border rounded-full bg-muted/50 inline-flex gap-2 items-center">
          <FaIcon name="i-ion:dice" class="text-primary" />
          <span class="text-xs font-medium">风格实验室</span>
        </div>
        <h1 class="text-3xl tracking-tight font-bold mb-4 md-text-5xl">
          随机切换风格
        </h1>
        <p class="text-base text-muted-foreground mx-auto mb-8 max-w-2xl md-text-lg">
          一键体验框架的所有视觉风格组合，包括主题配色、菜单模式、圆角样式等
        </p>
        <FaButton size="lg" @click="randomTheme">
          立即切换
        </FaButton>
      </div>

      <!-- Features Grid -->
      <div class="mb-12 gap-4 grid lg-grid-cols-4 md-grid-cols-2">
        <FaSpotlightCard v-for="feature in features" :key="feature.title">
          <div class="p-6">
            <div class="mb-4 rounded-xl bg-primary/10 flex size-12 items-center justify-center">
              <FaIcon :name="feature.icon" class="text-primary size-6" />
            </div>
            <h3 class="text-sm font-semibold mb-2">
              {{ feature.title }}
            </h3>
            <p class="text-xs text-muted-foreground leading-relaxed">
              {{ feature.description }}
            </p>
          </div>
        </FaSpotlightCard>
      </div>
    </div>
  </div>
</template>
