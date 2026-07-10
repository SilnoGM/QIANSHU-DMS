<i18n lang="yaml">
zh-cn:
  description: 让你的页面响起来
  controls:
    theme: 主题
    volume: 音量
    muted: 静音
    reinitialize: 重新初始化
    themeSoft: Soft
    themeCrisp: Crisp
    success: 已按当前面板设置重新初始化
  gallery:
    title: Sounds API
    toggleOn: 打开
    toggleOff: 关闭
    hoverAction: 鼠标移入这里试听
  sounds:
    click:
      label: Click
      description: 短促清脆，适合按钮点击。
    toggle:
      label: Toggle
      description: 根据开关状态播放上扬或下落的提示音。
    success:
      label: Success
      description: 两段式上扬反馈，适合提交完成。
    error:
      label: Error
      description: 低频顿挫，用于失败或阻断提示。
    warning:
      label: Warning
      description: 比错误更轻，适合风险提醒。
    hover:
      label: Hover
      description: 极轻的掠过音，适合列表和快捷操作。
    pop:
      label: Pop
      description: 轻快的气泡声，适合气泡或标签交互。
    swoosh:
      label: Swoosh
      description: 用于抽屉、页面切换或状态跃迁。
    notify:
      label: Notify
      description: 明亮提醒音，适合通知或待办变化。
zh-tw:
  description: 讓你的頁面響起來
  controls:
    theme: 主題
    volume: 音量
    muted: 靜音
    reinitialize: 重新初始化
    themeSoft: Soft
    themeCrisp: Crisp
    success: 已按當前面板設定重新初始化
  gallery:
    title: Sounds API
    toggleOn: 打開
    toggleOff: 關閉
    hoverAction: 將滑鼠移入這裡試聽
  sounds:
    click:
      label: Click
      description: 短促清脆，適合按鈕點擊。
    toggle:
      label: Toggle
      description: 根據開關狀態播放上揚或下落的提示音。
    success:
      label: Success
      description: 兩段式上揚回饋，適合提交完成。
    error:
      label: Error
      description: 低頻頓挫，用於失敗或阻斷提示。
    warning:
      label: Warning
      description: 比錯誤更輕，適合風險提醒。
    hover:
      label: Hover
      description: 極輕的掠過音，適合列表和快捷操作。
    pop:
      label: Pop
      description: 輕快的氣泡聲，適合氣泡或標籤交互。
    swoosh:
      label: Swoosh
      description: 用於抽屜、頁面切換或狀態躍遷。
    notify:
      label: Notify
      description: 明亮提醒音，適合通知或待辦變化。
en:
  description: Add sound to your interface
  controls:
    theme: Theme
    volume: Volume
    muted: Muted
    reinitialize: Reinitialize
    themeSoft: Soft
    themeCrisp: Crisp
    success: Reinitialized with the current panel settings
  gallery:
    title: Sounds API
    toggleOn: On
    toggleOff: Off
    hoverAction: Move your mouse here to preview
  sounds:
    click:
      label: Click
      description: Short and crisp, ideal for button taps.
    toggle:
      label: Toggle
      description: Plays a rising or falling cue based on the toggle state.
    success:
      label: Success
      description: Two ascending notes for completion feedback.
    error:
      label: Error
      description: A low thud for failures or blocked actions.
    warning:
      label: Warning
      description: Softer than error, suited for caution states.
    hover:
      label: Hover
      description: A whisper-light tick for lists and quick actions.
    pop:
      label: Pop
      description: A playful bubble pop for chips and lightweight actions.
    swoosh:
      label: Swoosh
      description: Works well for drawers, transitions, and state changes.
    notify:
      label: Notify
      description: A bright ping for notifications and pending updates.
</i18n>

<script setup lang="ts">
const { t } = useI18n()

type SoundKey = 'click' | 'toggle' | 'success' | 'error' | 'warning' | 'hover' | 'pop' | 'swoosh' | 'notify'

const themeMap = {
  soft: 'soft',
  crisp: 'crisp',
} as const

const selectedTheme = ref<keyof typeof themeMap>('soft')
const volume = ref<number[]>([35])
const muted = ref(false)
const toggleValue = ref(false)

const tiks = useTiks({
  theme: themeMap[selectedTheme.value],
  volume: volume.value[0] / 100,
  muted: muted.value,
  respectReducedMotion: true,
})

const soundItems: Array<{ key: SoundKey, icon: string }> = [
  { key: 'click', icon: 'i-ri:cursor-line' },
  { key: 'toggle', icon: 'i-ri:toggle-line' },
  { key: 'success', icon: 'i-ri:check-double-line' },
  { key: 'error', icon: 'i-ri:close-circle-line' },
  { key: 'warning', icon: 'i-ri:alert-line' },
  { key: 'hover', icon: 'i-ri:mouse-line' },
  { key: 'pop', icon: 'i-ri:bubble-chart-line' },
  { key: 'swoosh', icon: 'i-ri:flight-takeoff-line' },
  { key: 'notify', icon: 'i-ri:notification-3-line' },
]

const themeOptions = computed(() => [
  { label: t('controls.themeSoft'), value: 'soft' },
  { label: t('controls.themeCrisp'), value: 'crisp' },
])

watch(selectedTheme, (value) => {
  tiks.setTheme(themeMap[value])
})

watch(() => volume.value[0], (value) => {
  tiks.setVolume((value ?? 0) / 100)
})

watch(muted, (value) => {
  value ? tiks.mute() : tiks.unmute()
})

function isDirectPlaySound(key: SoundKey) {
  return key !== 'toggle' && key !== 'hover'
}

function handleToggleChange(value: boolean | undefined) {
  tiks.toggle(!!value)
}

function handleHoverPreview() {
  tiks.hover()
}

function playSound(key: SoundKey) {
  switch (key) {
    case 'click':
      tiks.click()
      break
    case 'success':
      tiks.success()
      break
    case 'error':
      tiks.error()
      break
    case 'warning':
      tiks.warning()
      break
    case 'pop':
      tiks.pop()
      break
    case 'swoosh':
      tiks.swoosh()
      break
    case 'notify':
      tiks.notify()
      break
  }
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.tiks')" :description="t('description')" />
    <FaPageMain main-class="gap-4 grid md:grid-cols-2 xl:grid-cols-3">
      <div class="p-4 border rounded-xl bg-background flex flex-col">
        <div class="text-sm text-muted-foreground mb-2">
          {{ t('controls.theme') }}
        </div>
        <div class="flex flex-1 items-center">
          <FaSelect v-model="selectedTheme" :options="themeOptions" class="w-full" />
        </div>
      </div>
      <div class="p-4 border rounded-xl bg-background flex flex-col">
        <div class="text-sm text-muted-foreground mb-2">
          {{ t('controls.volume') }}
        </div>
        <div class="flex flex-1 items-center">
          <FaSlider v-model="volume" :min="0" :max="100" :step="5" />
        </div>
      </div>
      <div class="p-4 border rounded-xl bg-background flex flex-col">
        <div class="text-sm text-muted-foreground mb-2">
          {{ t('controls.muted') }}
        </div>
        <div class="flex flex-1 items-center">
          <FaSwitch v-model="muted" />
        </div>
      </div>
    </FaPageMain>
    <FaPageMain :title="t('gallery.title')" main-class="gap-4 grid md:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="sound in soundItems"
        :key="sound.key"
        class="p-4 border rounded-xl bg-background" :class="[
          isDirectPlaySound(sound.key) && 'cursor-pointer transition-colors hover:bg-accent/40 active:bg-accent/60',
        ]"
        :role="isDirectPlaySound(sound.key) ? 'button' : undefined"
        :tabindex="isDirectPlaySound(sound.key) ? 0 : undefined"
        @click="isDirectPlaySound(sound.key) && playSound(sound.key)"
        @keydown.enter.prevent="isDirectPlaySound(sound.key) && playSound(sound.key)"
        @keydown.space.prevent="isDirectPlaySound(sound.key) && playSound(sound.key)"
      >
        <div class="mb-4 flex gap-3 items-start justify-between">
          <div>
            <div class="font-medium">
              {{ t(`sounds.${sound.key}.label`) }}
            </div>
            <p class="text-sm text-muted-foreground mt-1">
              {{ t(`sounds.${sound.key}.description`) }}
            </p>
          </div>
          <FaIcon :name="sound.icon" class="text-lg text-muted-foreground mt-0.5 shrink-0" />
        </div>
        <div v-if="sound.key === 'toggle'" class="px-4 py-3 border rounded-lg bg-muted/20 flex gap-4 items-center justify-between">
          <span class="text-sm text-muted-foreground">
            {{ toggleValue ? t('gallery.toggleOn') : t('gallery.toggleOff') }}
          </span>
          <FaSwitch v-model="toggleValue" @update:model-value="handleToggleChange" />
        </div>
        <div
          v-else-if="sound.key === 'hover'"
          class="text-sm text-muted-foreground px-4 py-6 text-center border rounded-lg border-dashed bg-muted/20 transition-colors hover:bg-muted/40"
          @mouseover="handleHoverPreview"
        >
          {{ t('gallery.hoverAction') }}
        </div>
      </div>
    </FaPageMain>
  </div>
</template>
