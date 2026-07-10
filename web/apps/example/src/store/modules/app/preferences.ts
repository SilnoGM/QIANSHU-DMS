import type { SettingsOptions } from '@fantastic-admin/settings'
import { diffTwoObj, mergeWithoutUndefinedProps } from '@fantastic-admin/settings'
import apiApp from '@/api/modules/app'
import settingsDefault from '@/settings'

export const useAppPreferencesStore = defineStore(
  'appPreferences',
  () => {
    const appSettingsStore = useAppSettingsStore()
    const appAccountStore = useAppAccountStore()

    const storageTo = ref<'local' | 'server'>('local')

    const isEnabled = computed(() => {
      return Object.values(appSettingsStore.settings.app.preferences).some((value) => {
        if (typeof value === 'boolean') {
          return value
        }
        else if (typeof value === 'object' && value !== null) {
          return Object.values(value).includes(true)
        }
        return false
      })
    })

    const immediateUpdate = ref(true)
    watch(() => appSettingsStore.settings, () => {
      immediateUpdate.value && updatePreferences(appSettingsStore.settings)
    }, {
      deep: true,
    })

    // 获取偏好设置
    async function getPreferences() {
      let data = {}
      if (storageTo.value === 'local') {
        if (localStorage.has('preferences')) {
          data = JSON.parse(localStorage.getItem('preferences') as string)[appAccountStore.account] || {}
        }
      }
      else if (storageTo.value === 'server') {
        const res = await apiApp.preferences()
        data = JSON.parse(res.data.preferences || '{}')
      }
      appSettingsStore.updateSettings(mergeWithoutUndefinedProps(data, appSettingsStore.settings), true)
    }
    // 更新偏好设置
    async function updatePreferences(data: SettingsOptions = {}) {
      if (!appAccountStore.isLogin) {
        return
      }
      data = diffTwoObj(settingsDefault, data)
      delete data.app
      if (storageTo.value === 'local') {
        const preferencesData = localStorage.has('preferences') ? JSON.parse(localStorage.getItem('preferences') as string) : {}
        preferencesData[appAccountStore.account] = data
        localStorage.setItem('preferences', JSON.stringify(preferencesData))
      }
      else if (storageTo.value === 'server') {
        await apiApp.preferencesEdit(JSON.stringify(data))
      }
    }

    return {
      isEnabled,
      immediateUpdate,
      getPreferences,
      updatePreferences,
    }
  },
)
