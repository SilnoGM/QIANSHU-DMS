<script setup lang="ts">
defineOptions({
  name: 'SwitchLogout',
})

const { t } = useI18n()

const appAccountStore = useAppAccountStore()

// 将当前登录的账号置顶
const sortedMultipleAccounts = computed(() => {
  const accounts = [...appAccountStore.multipleAccounts]
  const currentAccountIndex = accounts.findIndex(item => item.account === appAccountStore.account)
  if (currentAccountIndex > 0) {
    const currentAccount = accounts.splice(currentAccountIndex, 1)[0]
    accounts.unshift(currentAccount)
  }
  return accounts
})

function handleSignOut(account?: string) {
  appAccountStore.multipleAccountsRemove(account)
  if ((account && account === appAccountStore.account) || !account) {
    appAccountStore.logout()
  }
}
</script>

<template>
  <div class="p-4 space-y-4">
    <div class="text-center">
      <h2 class="text-xl text-foreground font-semibold">
        {{ t('app.components.accountForm.switchLogout.select_account_to_sign_out') }}
      </h2>
    </div>
    <div class="space-y-3">
      <div
        v-for="(item, index) in sortedMultipleAccounts"
        :key="index"
        class="px-4 py-3 border border-border rounded-lg bg-card flex transition-colors items-center justify-between hover:bg-accent/50"
      >
        <div class="flex gap-3 items-center">
          <FaAvatar :src="item.avatar" :fallback="item.account.slice(0, 2).toUpperCase()" class="size-10" />
          <div class="flex flex-col">
            <span class="text-sm text-foreground font-medium">
              {{ item.account }}
            </span>
            <div v-if="item.account === appAccountStore.account" class="text-xs text-secondary-foreground/50 font-normal">
              {{ t('app.components.accountForm.switchLogout.current_login') }}
            </div>
          </div>
        </div>
        <FaButton variant="outline" size="sm" @click="handleSignOut(item.account)">
          {{ t('app.components.accountForm.switchLogout.sign_out') }}
        </FaButton>
      </div>
    </div>
    <FaButton variant="destructive" class="w-full" @click="handleSignOut()">
      {{ t('app.components.accountForm.switchLogout.sign_out_from_all_accounts') }}
    </FaButton>
  </div>
</template>
