<i18n lang="yaml">
zh-cn:
  account:
    switch: 切换账号
    permissions: 当前账号权限
  route:
    title: 路由鉴权
    test: 跳转测试页面
  directive:
    title: 鉴权指令
  component:
    title: 鉴权组件
  function:
    title: 鉴权函数
    valid: 校验通过
    invalid: 校验不通过
  have: 校验 '{permission}' 权限
  or: 校验 '{permission1}' 或 '{permission2}' 权限
  and: 校验 '{permission1}' 和 '{permission2}' 权限
zh-tw:
  account:
    switch: 切换账号
    permissions: 現有账号权限
  route:
    title: 路由鉴权
    test: 跳转測試頁面
  directive:
    title: 鉴權指令
  component:
    title: 鉴權組件
  function:
    title: 鉴權函數
    valid: 校驗通過
    invalid: 校驗不通過
  have: 確認 '{permission}' 權限
  or: 確認 '{permission1}' 或 '{permission2}' 權限
  and: 確認 '{permission1}' 和 '{permission2}' 權限
en:
  account:
    switch: Switch Account
    permissions: Current Account Permissions
  route:
    title: Route Authentication
    test: Jump to Test Page
  directive:
    title: Directive Authentication
  component:
    title: Component Authentication
  function:
    title: Function Authentication
    valid: Validation Passed
    invalid: Validation Failed
  have: Check '{permission}' Permission
  or: Check '{permission1}' or '{permission2}' Permission
  and: Check '{permission1}' and '{permission2}' Permission
</i18n>

<script setup lang="ts">
defineOptions({
  name: 'PermissionExample',
})

const { t } = useI18n()
const router = useRouter()

const appSettingsStore = useAppSettingsStore()
const appAccountStore = useAppAccountStore()

const { auth, authAll } = useAppAuth()

async function accountSwitch(val: any) {
  await appAccountStore.login({
    account: val,
    password: '',
  })
  location.reload()
}
function goTest() {
  router.push({
    name: 'authExampleTest',
  })
}
function permissionCheck(permissions: string | string[]) {
  if (auth(permissions)) {
    useFaToast().success(t('function.valid'), {
      position: 'top-center',
    })
  }
  else {
    useFaToast().error(t('function.invalid'), {
      position: 'top-center',
    })
  }
}
function permissionCheck2(permissions: string[]) {
  if (authAll(permissions)) {
    useFaToast().success(t('function.valid'), {
      position: 'top-center',
    })
  }
  else {
    useFaToast().error(t('function.invalid'), {
      position: 'top-center',
    })
  }
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.auth.root')" />
    <FaPageMain v-if="!appSettingsStore.settings.app.account.auth">
      请到 settings.ts 里设置并开启权限功能，再进入该页面查看演示
    </FaPageMain>
    <FaPageMain v-else :title="t('account.switch')" main-class="space-y-2">
      <FaButtonGroup separator>
        <FaButton
          v-for="(item, index) in [
            { label: 'admin', value: 'admin' },
            { label: 'test', value: 'test' },
            { label: 'hooray', value: 'hooray' },
          ]" :key="index" :variant="appAccountStore.account === item.value ? 'default' : 'outline'" @click="accountSwitch(item.value)"
        >
          {{ item.label }}
        </FaButton>
      </FaButtonGroup>
      <div>{{ t('account.permissions') }}</div>
      <div>{{ appAccountStore.permissions }}</div>
    </FaPageMain>
    <FaPageMain v-if="appSettingsStore.settings.app.account.auth" :title="t('route.title')">
      <FaButton @click="goTest">
        {{ t('route.test') }}
      </FaButton>
    </FaPageMain>
    <FaPageMain v-if="appSettingsStore.settings.app.account.auth" :title="t('directive.title')" main-class="space-y-2">
      <div class="flex-center-start gap-2">
        <div>{{ t('have', { permission: 'pages.general:browse' }) }}</div>
        <div v-auth="'pages.general:browse'">
          ✅
        </div>
      </div>
      <div class="flex-center-start gap-2">
        <div>{{ t('have', { permission: 'pages.form:browse' }) }}</div>
        <div v-auth="'pages.form:browse'">
          ✅
        </div>
      </div>
      <div class="flex-center-start gap-2">
        <div>{{ t('or', { permission1: 'pages.general:browse', permission2: 'pages.form:browse' }) }}</div>
        <div v-auth="['pages.general:browse', 'pages.form:browse']">
          ✅
        </div>
      </div>
      <div class="flex-center-start gap-2">
        <div>{{ t('and', { permission1: 'pages.general:browse', permission2: 'pages.form:browse' }) }}</div>
        <div v-auth.all="['pages.general:browse', 'pages.form:browse']">
          ✅
        </div>
      </div>
    </FaPageMain>
    <FaPageMain v-if="appSettingsStore.settings.app.account.auth" :title="t('component.title')" main-class="space-y-2">
      <div class="flex-center-start gap-2">
        <div>{{ t('have', { permission: 'pages.general:browse' }) }}</div>
        <AppAuth value="pages.general:browse">
          ✅
          <template #no-auth>
            ❌
          </template>
        </AppAuth>
      </div>
      <div class="flex-center-start gap-2">
        <div>{{ t('have', { permission: 'pages.form:browse' }) }}</div>
        <AppAuth value="pages.form:browse">
          ✅
          <template #no-auth>
            ❌
          </template>
        </AppAuth>
      </div>
      <div class="flex-center-start gap-2">
        <div>{{ t('or', { permission1: 'pages.general:browse', permission2: 'pages.form:browse' }) }}</div>
        <AppAuth :value="['pages.general:browse', 'pages.form:browse']">
          ✅
          <template #no-auth>
            ❌
          </template>
        </AppAuth>
      </div>
      <div class="flex-center-start gap-2">
        <div>{{ t('and', { permission1: 'pages.general:browse', permission2: 'pages.form:browse' }) }}</div>
        <AppAuth :value="['pages.general:browse', 'pages.form:browse']" all>
          ✅
          <template #no-auth>
            ❌
          </template>
        </AppAuth>
      </div>
    </FaPageMain>
    <FaPageMain v-if="appSettingsStore.settings.app.account.auth" :title="t('function.title')" main-class="flex-col-start gap-2">
      <FaButton variant="outline" @click="permissionCheck('pages.general:browse')">
        {{ t('have', { permission: 'pages.general:browse' }) }}
      </FaButton>
      <FaButton variant="outline" @click="permissionCheck('pages.form:browse')">
        {{ t('have', { permission: 'pages.form:browse' }) }}
      </FaButton>
      <FaButton variant="outline" @click="permissionCheck(['pages.general:browse', 'pages.form:browse'])">
        {{ t('or', { permission1: 'pages.general:browse', permission2: 'pages.form:browse' }) }}
      </FaButton>
      <FaButton variant="outline" @click="permissionCheck2(['pages.general:browse', 'pages.form:browse'])">
        {{ t('and', { permission1: 'pages.general:browse', permission2: 'pages.form:browse' }) }}
      </FaButton>
    </FaPageMain>
  </div>
</template>
