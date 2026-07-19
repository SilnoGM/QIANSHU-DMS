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

// 菜单顶部优先展示用户可读的显示名；显示名缺失时回退用户名，并避免上下两行重复。
const accountDisplayName = computed(() => appAccountStore.displayName.trim() || appAccountStore.account)
const accountUsername = computed(() => {
  const username = appAccountStore.account.trim()
  return username !== '' && username !== accountDisplayName.value ? username : ''
})

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

type LogoutScope = 'current' | 'all'

const logoutDialogVisible = ref(false)
const logoutAction = ref<LogoutScope | null>(null)
const logoutPending = computed(() => logoutAction.value !== null)

function openLogoutDialog() {
  logoutDialogVisible.value = true
}

function closeLogoutDialog() {
  if (!logoutPending.value) {
    logoutDialogVisible.value = false
  }
}

async function submitLogout(scope: LogoutScope) {
  // 退出请求会改变全局认证状态，请求期间禁止切换退出范围或重复提交。
  if (logoutPending.value) {
    return
  }

  logoutAction.value = scope
  try {
    if (scope === 'all') {
      await appAccountStore.logoutAll()
    }
    else {
      await appAccountStore.logout()
    }
    logoutDialogVisible.value = false
  }
  catch {
    useFaToast().error('退出失败', {
      description: '当前登录状态尚未确认，请稍后重试。',
    })
  }
  finally {
    logoutAction.value = null
  }
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
          handle: openLogoutDialog,
        },
      ],
    ]" class="flex-center"
  >
    <template #header>
      <div class="w-[194px] space-y-2">
        <div class="text-xs text-secondary-foreground/50 font-light">
          {{ t('app.components.accountButton.index.current_account') }}
        </div>
        <div class="flex-center-start gap-2">
          <FaAvatar :src="appAccountStore.avatar" :fallback="appAccountStore.account.slice(0, 2)" shape="square" />
          <div class="flex-1 min-w-0 space-y-1">
            <div class="text-base lh-none truncate">
              {{ accountDisplayName }}
            </div>
            <div v-if="accountUsername" class="text-xs text-secondary-foreground/50 font-normal truncate">
              {{ accountUsername }}
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

  <FaModal
    v-model="logoutDialogVisible"
    title="退出登录"
    description="请选择本次要退出的登录范围。"
    align-center
    :closable="!logoutPending"
    :close-on-click-overlay="!logoutPending"
    :close-on-press-escape="!logoutPending"
    class="sm:max-w-[560px]"
  >
    <div class="space-y-3">
      <section class="p-4 border rounded-lg space-y-1.5">
        <div class="font-medium flex gap-2 items-center">
          <FaIcon name="i-mdi:logout" class="text-primary size-5" />
          退出当前登录
        </div>
        <p class="text-sm text-secondary-foreground/70 leading-6">
          只退出当前浏览器的这次登录，其他浏览器或电脑仍保持登录。
        </p>
      </section>

      <section class="p-4 border border-destructive/30 rounded-lg bg-destructive/5 space-y-1.5">
        <div class="text-destructive font-medium flex gap-2 items-center">
          <FaIcon name="i-mdi:logout-variant" class="size-5" />
          退出所有登录
        </div>
        <p class="text-sm text-secondary-foreground/70 leading-6">
          撤销该账号的所有登录，包括当前浏览器、其他浏览器和其他电脑。
        </p>
      </section>
    </div>

    <template #footer>
      <div class="gap-2 grid w-full sm:flex sm:justify-end">
        <FaButton variant="outline" :disabled="logoutPending" @click="closeLogoutDialog">
          取消
        </FaButton>
        <FaButton
          :loading="logoutAction === 'current'"
          :disabled="logoutPending"
          @click="submitLogout('current')"
        >
          退出当前登录
        </FaButton>
        <FaButton
          variant="destructive"
          :loading="logoutAction === 'all'"
          :disabled="logoutPending"
          @click="submitLogout('all')"
        >
          退出所有登录
        </FaButton>
      </div>
    </template>
  </FaModal>
</template>
