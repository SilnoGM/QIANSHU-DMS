<script setup lang="ts">
import LoginAgain from '@/components/AppAccountForm/login-again.vue'
import eventBus from '@/utils/eventBus'

defineOptions({
  name: 'AppLoginAgain',
})

const isShow = ref(false)

onMounted(() => {
  eventBus.on('global-login-again-visible', () => {
    isShow.value = true
  })
})

async function handleAfterLogin() {
  isShow.value = false
}
</script>

<template>
  <FaModal v-model="isShow" :z-index="10000" :header="false" :footer="false" :closable="false" :close-on-click-overlay="false" :close-on-press-escape="false">
    <LoginAgain @on-after-login="handleAfterLogin" />
  </FaModal>
</template>
