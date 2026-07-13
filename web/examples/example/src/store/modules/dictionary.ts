import apiDictionary from '@/api/modules/dictionary'

export interface DictionaryItem {
  name: string
  value: string
}

export const useDictionaryStore = defineStore(
  'dictionary',
  () => {
    const isInit = ref(false)
    const dictionary = ref<Record<string, DictionaryItem[]>>({})

    /**
     * 字典初始化
     * 如果字典数据量不大，推荐初始化，能有效减少请求次数
     * 初始化位置推荐放在路由导航守卫中，和获取用户权限一起初始化
     */
    async function init() {
      if (isInit.value) {
        return
      }
      const res = await apiDictionary.get()
      dictionary.value = res.data.list
      isInit.value = true
    }

    async function get(code: string) {
      if (!dictionary.value[code]) {
        const res = await apiDictionary.get(code)
        dictionary.value[code] = res.data.list
      }
      return dictionary.value[code]
    }

    function getName(code: string, value: string) {
      // 如果数据已经在缓存中，同步返回
      if (dictionary.value[code]) {
        const item = dictionary.value[code].find(item => item.value === value)
        return item?.name
      }
      // 如果数据未缓存，异步获取
      return get(code).then((list) => {
        const item = list.find(item => item.value === value)
        return item?.name
      })
    }

    function getValue(code: string, name: string) {
      // 如果数据已经在缓存中，同步返回
      if (dictionary.value[code]) {
        const item = dictionary.value[code].find(item => item.name === name)
        return item?.value
      }
      // 如果数据未缓存，异步获取
      return get(code).then((list) => {
        const item = list.find(item => item.name === name)
        return item?.value
      })
    }

    return {
      init,
      get,
      getName,
      getValue,
    }
  },
)
