<script setup lang="ts">
import LockScreenLock from './lock-screen-lock.vue'
import LockScreenUnlock from './lock-screen-unlock.vue'

const emits = defineEmits<{
  lock: []
  close: []
}>()

const appAccountStore = useAppAccountStore()

const lockPassword = ref('')

function onLock(pwd: string) {
  lockPassword.value = pwd
  appAccountStore.lock()
  emits('lock')
}

function onUnlock() {
  appAccountStore.unlock()
  emits('close')
}
</script>

<template>
  <div class="py-12 flex-col-stretch-center gap-4">
    <FaAvatar :src="appAccountStore.avatar" :fallback="appAccountStore.account.slice(0, 2)" shape="circle" class="mx-auto h-100px w-100px" />
    <LockScreenLock v-if="!lockPassword" @success="onLock" />
    <LockScreenUnlock v-else :lock-password="lockPassword" @success="onUnlock" />
  </div>
</template>
