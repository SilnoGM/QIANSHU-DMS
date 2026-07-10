<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import SwitchAdd from '@/components/AppAccountForm/switch-add.vue'
import SwitchLogout from '@/components/AppAccountForm/switch-logout.vue'
import { cn } from '@/utils'
import eventBus from '@/utils/eventBus'
import Feedback from './feedback.vue'
import LockScreen from './lock-screen.vue'
import Profile from './profile.vue'

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

const switchAddModal = useFaModal().create({
  header: false,
  footer: false,
  closeOnClickOverlay: false,
  closeOnPressEscape: false,
  openAutoFocus: true,
  content: () => h(SwitchAdd, {
    onSuccess: (account) => {
      switchAddModal.close()
      useFaModal().confirm({
        title: t('app.components.accountButton.index.add_account_success'),
        content: t('app.components.accountButton.index.add_account_success_confirm'),
        onConfirm: () => {
          appAccountStore.multipleAccountsSwitch(account)
        },
      })
    },
  }),
})

const switchLogoutModal = useFaModal().create({
  header: false,
  footer: false,
  closeOnClickOverlay: false,
  closeOnPressEscape: false,
  content: () => h(SwitchLogout),
})

const profileModal = useFaModal().create({
  alignCenter: true,
  header: false,
  footer: false,
  closeOnClickOverlay: false,
  closeOnPressEscape: false,
  class: 'h-[500px] sm:max-w-xl overflow-hidden',
  contentClass: 'min-h-full p-0 flex',
  content: () => h(Profile),
})

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

const lockScreenModal = useFaModal().create({
  title: () => t('app.components.accountButton.index.lock_screen'),
  footer: false,
  closeOnClickOverlay: false,
  closeOnPressEscape: false,
  content: () => h(LockScreen, {
    onLock: () => {
      lockScreenModal.update({
        header: false,
        closable: false,
        overlayBlur: true,
      })
    },
    onClose: () => lockScreenModal.close(),
  }),
})
</script>

<template>
  <FaDropdown
    :align="dropdownAlign" :side="dropdownSide" :items="[
      [
        ...(appSettingsStore.settings.app.home.enable
          ? [{ label: generateI18nTitle(appSettingsStore.settings.app.home.title), icon: 'i-mdi:home', handle: () => router.push({ path: appSettingsStore.settings.app.home.fullPath }) }]
          : []),
        { label: t('app.components.accountButton.index.profile'), icon: 'i-mdi:account', handle: () => profileModal.open() },
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
        ...(appSettingsStore.settings.app.lockScreen
          ? [{ label: t('app.components.accountButton.index.lock_screen'), icon: 'i-mdi:lock', handle: () => lockScreenModal.open() }]
          : []),
        {
          label: t('app.components.accountButton.index.logout'),
          icon: 'i-mdi:logout',
          handle: () => {
            if (appSettingsStore.settings.app.account.multipleAccounts && appAccountStore.multipleAccounts.length > 1) {
              switchLogoutModal.open()
            }
            else {
              appAccountStore.logout(appSettingsStore.settings.app.home.fullPath)
            }
          },
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
              [ xyz@xyz.com ]
            </div>
          </div>
          <FaDropdown
            v-if="appSettingsStore.settings.app.account.multipleAccounts"
            align="end"
            :items="[
              appAccountStore.multipleAccounts.filter(item => item.account !== appAccountStore.account).map(item => ({
                label: item.account,
                icon: item.avatar,
                handle: () => appAccountStore.multipleAccountsSwitch(item.account),
              })),
              [
                { label: t('app.components.accountButton.index.add_account'), icon: 'i-mdi:account-plus', handle: () => switchAddModal.open() },
                ...(appAccountStore.multipleAccounts.length > 1
                  ? [{ label: t('app.components.accountButton.index.logout'), icon: 'i-mdi:logout', handle: () => switchLogoutModal.open() }]
                  : []),
              ],
            ]"
          >
            <div>
              <FaTooltip :text="t('app.components.accountButton.index.switch_account')" align="end">
                <FaButton variant="ghost" size="icon-sm" class="ms-5">
                  <FaIcon name="i-ant-design:swap-outlined" class="text-secondary-foreground/80 size-4" />
                </FaButton>
              </FaTooltip>
            </div>
          </FaDropdown>
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
