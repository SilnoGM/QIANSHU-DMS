import { faker } from '@faker-js/faker/locale/zh_CN'
import { defineFakeRoute } from 'vite-plugin-fake-server/client'

// 管理员
const managerList: any[] = []
for (let i = 0; i < 50; i++) {
  managerList.push({
    id: i + 1,
    account: faker.person.firstName(),
    name: faker.person.fullName(),
    sex: faker.number.int(2),
    mobile: faker.phone.number({ style: 'international' }),
    status: faker.datatype.boolean(),
  })
}

export default defineFakeRoute([
  {
    url: '/fake/manager/list',
    method: 'get',
    response: ({ query }) => {
      const { account, name, mobile, sex, from, limit, sort, order } = query
      let list = managerList.filter((item) => {
        return account ? item.account.includes(account) : true
      })
      list = list.filter((item) => {
        return name ? item.name.includes(name) : true
      })
      list = list.filter((item) => {
        return mobile ? item.mobile === mobile : true
      })
      list = list.filter((item) => {
        return sex ? item.sex === ~~sex : true
      })
      // 排序处理
      if (sort && order) {
        const sortKey = String(sort)
        const sortOrder = String(order)
        list.sort((a, b) => {
          const aVal = a[sortKey]
          const bVal = b[sortKey]
          if (aVal === bVal) {
            return 0
          }
          const result = aVal < bVal ? -1 : 1
          return sortOrder === 'asc' ? result : -result
        })
      }
      const pageList = list.filter((_item, index) => {
        return index >= ~~from && index < (~~from + ~~limit)
      })
      return {
        error: '',
        status: 1,
        data: {
          list: pageList,
          total: list.length,
        },
      }
    },
  },
  {
    url: '/fake/manager/detail',
    method: 'get',
    response: ({ query }) => {
      const info = managerList.filter(item => item.id === ~~query.id)
      return {
        error: '',
        status: 1,
        data: info[0],
      }
    },
  },
  {
    url: '/fake/manager/create',
    method: 'post',
    response: () => {
      return {
        error: '',
        status: 1,
        data: {
          isSuccess: true,
        },
      }
    },
  },
  {
    url: '/fake/manager/edit',
    method: 'post',
    response: () => {
      return {
        error: '',
        status: 1,
        data: {
          isSuccess: true,
        },
      }
    },
  },
  {
    url: '/fake/manager/delete',
    method: 'post',
    response: () => {
      return {
        error: '',
        status: 1,
        data: {
          isSuccess: true,
        },
      }
    },
  },
  {
    url: '/fake/manager/password/reset',
    method: 'post',
    response: () => {
      return {
        error: '',
        status: 1,
        data: {
          isSuccess: true,
        },
      }
    },
  },
  {
    url: '/fake/manager/change/status',
    method: 'post',
    response: () => {
      return {
        error: '',
        status: 1,
        data: {
          isSuccess: true,
        },
      }
    },
  },
  {
    url: '/fake/manager/check',
    method: 'post',
    response: ({ body }) => {
      const { key, value, id } = body
      let exist = false
      exist = managerList.some((item) => {
        let flag
        switch (key) {
          case 'account':
            if (item.account === value && (id ? id !== item.id : true)) {
              flag = true
            }
            break
          case 'mobile':
            if (item.mobile === value && (id ? id !== item.id : true)) {
              flag = true
            }
            break
        }
        return flag
      })
      return {
        error: '',
        status: 1,
        data: {
          exist,
        },
      }
    },
  },
])
