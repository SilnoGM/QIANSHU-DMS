import appApi from '@/api/modules/app'

export const useAppNotificationStore = defineStore(
  'appNotification',
  () => {
    interface TypeItem {
      name: string
      icon: string
      unRead: number // 未读数
    }

    // 消息类型，可自定义新增或移除（至少保留一个，即使你不需要）
    const types = ref<TypeItem[]>([
      { name: 'message', icon: 'i-icon-park-twotone:mail', unRead: 0 },
      { name: 'approval', icon: 'i-icon-park-twotone:seal', unRead: 0 },
      { name: 'default', icon: 'i-icon-park-twotone:application-two', unRead: 0 },
    ])
    // 未读总计
    const total = computed(() => {
      return types.value.reduce((acc, item) => acc + item.unRead, 0)
    })

    const list = ref<{
      [key in TypeItem['name']]: {
        id: number | string
        title: string
        datetime: string
        read: boolean
      }[]
    }>({})

    // 模拟单条已读
    function setRead(type: TypeItem['name'], id: number | string) {
      const item = list.value[type]?.find(item => item.id === id)
      if (item) {
        item.read = true
        const typeItem = types.value.find(item => item.name === type)
        if (typeItem && typeItem.unRead > 0) {
          typeItem.unRead--
        }
      }
    }
    // 模拟全部已读
    function setAllRead(type: TypeItem['name']) {
      list.value[type].forEach((item) => {
        item.read = true
      })
      const typeItem = types.value.find(item => item.name === type)
      if (typeItem && typeItem.unRead > 0) {
        typeItem.unRead = 0
      }
    }

    function init() {
      appApi.notificationUnread().then((res) => {
        Object.keys(res.data).forEach((key) => {
          const item = types.value.find(item => item.name === key)
          if (item) {
            item.unRead = res.data[key]
          }
        })
      })
      appApi.notificationList().then((res) => {
        Object.keys(res.data).forEach((key) => {
          list.value[key] = res.data[key]
        })
      })
    }

    return {
      types,
      total,
      list,
      setRead,
      setAllRead,
      init,
    }
  },
)
