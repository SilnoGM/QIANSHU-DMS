<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/utils'
import eventBus from '@/utils/eventBus'
import Feedback from './feedback.vue'

defineOptions({
  name: 'AppAccountButton',
})

const props = withDefaults(defineProps<{
  onlyAvatar?: boolean
  dropdownAlign?: 'start' | 'center' | 'end'
  dropdownSide?: 'left' | 'right' | 'top' | 'bottom'
  buttonVariant?: 'secondary' | 'ghost'
  class?: HTMLAttributes['class']
}>(), {
  dropdownAlign: 'end',
  dropdownSide: 'right',
  buttonVariant: 'ghost',
})

const router = useRouter()

const appSettingsStore = useAppSettingsStore()
const appPreferencesStore = useAppPreferencesStore()
const appAccountStore = useAppAccountStore()

const { t } = useI18n()
const { generateI18nTitle } = useAppMenu()

const feedbackModal = useFaModal().create({
  title: () => t('app.components.accountButton.index.feedback'),
  footer: false,
  closeOnClickOverlay: false,
  closeOnPressEscape: false,
  class: 'sm:max-w-[800px]',
  content: () => h(Feedback, {
    onClose: () => feedbackModal.close(),
  }),
})

async function handleLogout() {
  try {
    await appAccountStore.logout()
  }
  catch {
    useFaToast().error('退出失败', {
      description: '当前登录状态尚未确认，请稍后重试。',
    })
  }
}

function confirmLogoutAll() {
  useFaModal().confirm({
    title: '退出全部登录',
    content: '将撤销该账号在所有浏览器中的登录，是否继续？',
    onConfirm: async () => {
      try {
        await appAccountStore.logoutAll()
      }
      catch {
        useFaToast().error('退出失败', {
          description: '当前登录状态尚未确认，请稍后重试。',
        })
      }
    },
  })
}
</script>

<template>
  <FaDropdown
    :align="dropdownAlign" :side="dropdownSide" :items="[
      [
        ...(appSettingsStore.settings.app.home.enable
          ? [{ label: generateI18nTitle(appSettingsStore.settings.app.home.title), icon: 'i-mdi:home', handle: () => router.push({ path: appSettingsStore.settings.app.home.fullPath }) }]
          : []),
        ...(appPreferencesStore.isEnabled
          ? [{ label: t('app.components.accountButton.index.preferences'), icon: 'i-mdi:cog', handle: () => eventBus.emit('global-app-setting-toggle', 'preferences') }]
          : []),
        ...(appSettingsStore.settings.app.feedback
          ? [{ label: t('app.components.accountButton.index.feedback'), icon: 'i-mdi:comment-processing', handle: () => feedbackModal.open() }]
          : []),
      ],
      [
        ...(appSettingsStore.mode === 'pc'
          ? [{ label: t('app.components.accountButton.index.hotkeys'), icon: 'i-mdi:keyboard', handle: () => eventBus.emit('global-hotkeys-intro-toggle') }]
          : []),
      ],
      [
        { label: '修改密码', icon: 'i-mdi:form-textbox-password', handle: () => eventBus.emit('global-change-password-visible') },
        {
          label: t('app.components.accountButton.index.logout'),
          icon: 'i-mdi:logout',
          handle: handleLogout,
        },
        {
          label: '退出全部登录',
          icon: 'i-mdi:logout-variant',
          handle: confirmLogoutAll,
        },
      ],
    ]" class="flex-center"
  >
    <template #header>
      <div class="space-y-2">
        <div class="text-xs text-secondary-foreground/50 font-light">
          {{ t('app.components.accountButton.index.current_account') }}
        </div>
        <div class="flex-center-start gap-2">
          <FaAvatar :src="appAccountStore.avatar" :fallback="appAccountStore.account.slice(0, 2)" shape="square" />
          <div class="space-y-1">
            <div class="text-base lh-none">
              {{ appAccountStore.account }}
            </div>
            <div class="text-xs text-secondary-foreground/50 font-normal">
              {{ appAccountStore.displayName }}
            </div>
          </div>
        </div>
      </div>
    </template>
    <FaButton
      :variant="buttonVariant" size="icon-sm" :class="cn('flex-center gap-1 p-2', {
        'p-1': onlyAvatar,
      }, props.class)"
    >
      <FaAvatar :src="appAccountStore.avatar" :class="cn('size-6', { 'size-full': onlyAvatar })">
        <FaIcon name="i-carbon:user-avatar-filled" class="text-secondary-foreground/50 size-6" />
      </FaAvatar>
      <div v-if="!onlyAvatar" class="flex-center-between flex-1 gap-2 min-w-0">
        <div class="text-start flex-1 truncate">
          {{ appAccountStore.account }}
        </div>
        <FaIcon name="i-material-symbols:expand-all-rounded" />
      </div>
    </FaButton>
  </FaDropdown>
</template>
