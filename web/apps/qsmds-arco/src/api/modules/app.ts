import api from '../index'

export default {
  // 后端获取路由数据
  routeList: () => api.get('app/route/list', {
    fake: true,
  }),

  // 获取偏好设置
  preferences: () => api.get('app/preferences', {
    fake: true,
  }),

  // 修改偏好设置
  preferencesEdit: (preferences: string) => api.post('app/preferences/edit', {
    preferences,
  }, {
    fake: true,
  }),

  // 获取标签栏固定标签页数据
  tabbar: () => api.get('app/tabbar', {
    fake: true,
  }),

  // 修改标签栏固定标签页数据
  tabbarEdit: (tabbar: string) => api.post('app/tabbar/edit', {
    tabbar,
  }, {
    fake: true,
  }),

  // 获取收藏夹
  favorites: () => api.get('app/toolbar/favorites', {
    fake: true,
  }),

  // 修改收藏夹
  favoritesEdit: (favorites: string) => api.post('app/toolbar/favorites/edit', {
    favorites,
  }, {
    fake: true,
  }),

  // 获取通知未读数
  notificationUnread: () => api.get('app/notification/unread', {
    fake: true,
  }),

  // 获取通知未读列表
  notificationList: () => api.get('app/notification/list', {
    fake: true,
  }),
}
