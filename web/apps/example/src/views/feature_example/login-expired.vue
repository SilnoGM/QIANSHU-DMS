<i18n lang="yaml">
zh-cn:
  description: 如果网络请求被 axios 拦截器判定为登录过期时，框架提供了 2 种重新登录的方式：
  mode1: 重定向到登录页
  mode2: 弹出登录窗口
  default: 默认
  test: 测试
zh-tw:
  description: 如果網絡請求被 axios 拦截器判定為登錄過期時，框架提供了 2 种重新登錄的方式：
  mode1: 重定向到登錄頁
  mode2: 弹出登錄窗口
  default: 預設
  test: 測試
en:
  description: 'If the network request is intercepted by axios and judged as login expired, the framework provides 2 ways to re-login:'
  mode1: Redirect to login page
  mode2: Popup login window
  default: Default
  test: Test
</i18n>

<script setup lang="ts">
import type { SettingsOptions } from '@fantastic-admin/settings'
import type { RequiredDeep } from 'type-fest'
import api from '@/api'

const { t } = useI18n()

const appSettingsStore = useAppSettingsStore()

function reLogin(type: RequiredDeep<SettingsOptions>['app']['account']['expiredMode']) {
  appSettingsStore.$patch((state) => {
    state.settings.app.account.expiredMode = type
  })
  api.post('app/account/login/expired', null, {
    fake: true,
  })
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.login-expired')">
      <template #description>
        <div class="space-y-2">
          <p>{{ t('description') }}</p>
          <ol class="ps-4 list-decimal">
            <li>
              <FaBadge :value="t('default')" badge-class="start-full translate-y-0 ms-2">
                {{ t('mode1') }}
              </FaBadge>
            </li>
            <li>{{ t('mode2') }}</li>
          </ol>
        </div>
      </template>
    </FaPageHeader>
    <FaPageMain :title="t('mode1')">
      <FaButton @click="reLogin('redirect')">
        {{ t('test') }}
      </FaButton>
    </FaPageMain>
    <FaPageMain :title="t('mode2')">
      <FaButton @click="reLogin('popup')">
        {{ t('test') }}
      </FaButton>
    </FaPageMain>
  </div>
</template>
