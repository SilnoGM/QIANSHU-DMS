import { defineFakeRoute } from 'vite-plugin-fake-server/client'

export default defineFakeRoute([
  {
    url: '/fake/app/route/list',
    method: 'get',
    response: () => {
      return [
        // 主导航
        {
          meta: {
            title: '演示',
            icon: 'uim:box',
          },
          children: [
            // 次导航（一级路由）
            {
              path: '/multilevel_menu_example',
              component: 'Layout',
              name: 'multilevelMenuExample',
              meta: {
                title: 'route.multimenu.root',
                icon: 'heroicons-solid:menu-alt-3',
              },
              children: [
                // 次导航（二级路由）
                {
                  path: 'page',
                  name: 'multilevelMenuExample1',
                  component: 'multilevel_menu_example/page.vue',
                  meta: {
                    title: 'route.multimenu.page',
                  },
                },
                {
                  path: 'level2',
                  name: 'multilevelMenuExample2',
                  meta: {
                    title: 'route.multimenu.level2.root',
                  },
                  children: [
                    // 次导航（三级路由）
                    {
                      path: 'page',
                      name: 'multilevelMenuExample2-1',
                      component: 'multilevel_menu_example/level2/page.vue',
                      meta: {
                        title: 'route.multimenu.level2.page',
                      },
                    },
                    {
                      path: 'level3',
                      name: 'multilevelMenuExample2-2',
                      meta: {
                        title: 'route.multimenu.level2.level3.root',
                      },
                      children: [
                        // 次导航（四级路由）
                        {
                          path: 'page1',
                          name: 'multilevelMenuExample2-2-1',
                          component: 'multilevel_menu_example/level2/level3/page1.vue',
                          meta: {
                            title: 'route.multimenu.level2.level3.page1',
                          },
                        },
                        {
                          path: 'page2',
                          name: 'multilevelMenuExample2-2-2',
                          component: 'multilevel_menu_example/level2/level3/page2.vue',
                          meta: {
                            title: 'route.multimenu.level2.level3.page2',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]
    },
  },
  {
    url: '/fake/app/preferences',
    method: 'get',
    response: () => ({ preferences: '' }),
  },
  {
    url: '/fake/app/preferences/edit',
    method: 'post',
    response: () => {
      return {
        isSuccess: true,
      }
    },
  },
  {
    url: '/fake/app/tabbar',
    method: 'get',
    response: () => ({ tabbar: '' }),
  },
  {
    url: '/fake/app/tabbar/edit',
    method: 'post',
    response: () => {
      return {
        isSuccess: true,
      }
    },
  },
  {
    url: '/fake/app/toolbar/favorites',
    method: 'get',
    response: () => ({ favorites: '' }),
  },
  {
    url: '/fake/app/toolbar/favorites/edit',
    method: 'post',
    response: () => {
      return {
        isSuccess: true,
      }
    },
  },
  {
    url: '/fake/app/notification/unread',
    method: 'get',
    response: () => {
      return {
        message: 4,
        approval: 10,
        default: 0,
      }
    },
  },
  {
    url: '/fake/app/notification/list',
    method: 'get',
    response: () => {
      const messageList: any[] = []
      const approvalList: any[] = []
      const defaultList: any[] = []
      for (let i = 0; i < 4; i++) {
        messageList.push({
          id: i + 1,
          title: '你收到了 8 份日报',
          datetime: '2020-10-10 10:00:00',
          read: false,
        })
      }
      for (let i = 0; i < 10; i++) {
        approvalList.push({
          id: i + 1,
          title: '你的请假已通过',
          datetime: '2020-10-10 10:00:00',
          read: false,
        })
      }
      return {
        message: messageList,
        approval: approvalList,
        default: defaultList,
      }
    },
  },
])
