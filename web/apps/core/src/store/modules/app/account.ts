import apiApp from '@/api/modules/app'
import router from '@/router'
import eventBus from '@/utils/eventBus'

interface accountItem {
  token: string
  account: string
  avatar: string
}

export const useAppAccountStore = defineStore(
  'appAccount',
  () => {
    const appSettingsStore = useAppSettingsStore()
    const appTabbarStore = useAppTabbarStore()
    const appRouteStore = useAppRouteStore()
    const appMenuStore = useAppMenuStore()

    // 账号信息
    const token = ref(localStorage.getItem('token') ?? '')
    const account = ref(localStorage.getItem('account') ?? '')
    const avatar = ref(localStorage.getItem('avatar') ?? '')

    // 权限信息
    const permissions = ref<string[]>([])

    // 多账号信息
    const multipleAccounts = ref<accountItem[]>([])

    // 登录状态
    const isLogin = computed(() => {
      if (token.value) {
        return true
      }
      return false
    })

    // 登录
    async function login(data: {
      account: string
      password: string
    }) {
      const res = await apiApp.login(data)
      localStorage.setItem('account', res.data.account)
      localStorage.setItem('token', res.data.token)
      localStorage.setItem('avatar', res.data.avatar)
      account.value = res.data.account
      token.value = res.data.token
      avatar.value = res.data.avatar
      if (appSettingsStore.settings.app.account.multipleAccounts) {
        multipleAccountsAdd({
          account: res.data.account,
          token: res.data.token,
          avatar: res.data.avatar,
        })
      }
    }

    // 手动登出
    function logout(redirect = router.currentRoute.value.fullPath) {
      localStorage.removeItem('token')
      token.value = ''
      router.push({
        name: 'login',
        query: {
          ...(redirect !== appSettingsStore.settings.app.home.fullPath && router.currentRoute.value.name !== 'login' && { redirect }),
        },
      }).then(logoutCleanStatus)
    }
    // 请求登出
    function requestLogout() {
      if (appSettingsStore.settings.app.account.expiredMode === 'redirect' || !appRouteStore.isGenerate) {
        localStorage.removeItem('token')
        token.value = ''
        router.push({
          name: 'login',
          query: {
            ...(
              router.currentRoute.value.fullPath !== appSettingsStore.settings.app.home.fullPath
              && router.currentRoute.value.name !== 'login'
              && {
                redirect: router.currentRoute.value.fullPath,
              }
            ),
          },
        }).then(logoutCleanStatus)
      }
      else {
        // 此处仅清除 localStorage 中登录状态的变量，以保证在弹出登录窗口模式下页面展示依旧正常
        localStorage.removeItem('token')
        eventBus.emit('global-login-again-visible')
      }
    }
    // 登出后清除状态
    function logoutCleanStatus() {
      const logoutAccount = account.value
      localStorage.removeItem('account')
      localStorage.removeItem('avatar')
      account.value = ''
      avatar.value = ''
      permissions.value = []
      appSettingsStore.updateSettings({}, true)
      appTabbarStore.clean()
      appRouteStore.removeRoutes()
      appMenuStore.setActived(0)
      multipleAccountsRemove(logoutAccount)
    }

    // 获取权限
    async function getPermissions() {
      const res = await apiApp.permission()
      permissions.value = res.data.permissions
    }

    // 修改密码
    async function editPassword(data: {
      password: string
      newPassword: string
    }) {
      await apiApp.passwordEdit(data)
    }

    async function multipleAccountsCheck(data: {
      account: string
      password: string
    }) {
      const res = await apiApp.login(data)
      multipleAccountsAdd({
        token: res.data.token,
        account: res.data.account,
        avatar: res.data.avatar,
      })
    }

    function multipleAccountsAdd(accItem: accountItem) {
      const index = multipleAccounts.value.findIndex(item => item.account === accItem.account)
      if (index !== -1) {
        multipleAccounts.value[index] = accItem
      }
      else {
        multipleAccounts.value.push(accItem)
      }
    }

    function multipleAccountsRemove(acc?: accountItem['account']) {
      if (acc) {
        multipleAccounts.value = multipleAccounts.value.filter(item => item.account !== acc)
      }
      else {
        multipleAccounts.value = []
      }
    }

    // 切换账号
    function multipleAccountsSwitch(acc: string) {
      const item = multipleAccounts.value.find(item => item.account === acc)
      if (item) {
        localStorage.setItem('account', item.account)
        localStorage.setItem('token', item.token)
        localStorage.setItem('avatar', item.avatar)
        window.location.reload()
      }
    }

    // 锁屏
    function lock() {
      localStorage.removeItem('token')
    }

    // 解锁
    function unlock() {
      localStorage.setItem('token', token.value)
    }

    return {
      token,
      account,
      avatar,
      permissions,
      multipleAccounts,
      isLogin,
      login,
      logout,
      requestLogout,
      getPermissions,
      editPassword,
      multipleAccountsCheck,
      multipleAccountsAdd,
      multipleAccountsRemove,
      multipleAccountsSwitch,
      lock,
      unlock,
    }
  },
  {
    persist: {
      pick: ['multipleAccounts'],
    },
  },
)
