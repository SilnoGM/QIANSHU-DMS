import api from '../index'
import { isMockDataEnabled } from '../mock-mode'

/**
 * 这些 app 外壳接口目前只有 mock 实现（`src/api/fake_modules/app.fake.ts`），
 * 因此 `fake` 必须跟随 mock 开关：生产构建里若仍打 fake 适配器，请求会被改写到同源 `/fake/*`，
 * 而静态站点不代理该前缀，只会返回 404（HTML），前端表现为「服务器返回了无法识别的错误响应」。
 */
export default {
  // 后端获取路由数据
  routeList: () => api.get('app/route/list', {
    fake: isMockDataEnabled,
  }),

  // 获取偏好设置
  preferences: () => api.get('app/preferences', {
    fake: isMockDataEnabled,
  }),

  // 修改偏好设置
  preferencesEdit: (preferences: string) => api.post('app/preferences/edit', {
    preferences,
  }, {
    fake: isMockDataEnabled,
  }),

  // 获取标签栏固定标签页数据
  tabbar: () => api.get('app/tabbar', {
    fake: isMockDataEnabled,
  }),

  // 修改标签栏固定标签页数据
  tabbarEdit: (tabbar: string) => api.post('app/tabbar/edit', {
    tabbar,
  }, {
    fake: isMockDataEnabled,
  }),

  // 获取收藏夹
  favorites: () => api.get('app/toolbar/favorites', {
    fake: isMockDataEnabled,
  }),

  // 修改收藏夹
  favoritesEdit: (favorites: string) => api.post('app/toolbar/favorites/edit', {
    favorites,
  }, {
    fake: isMockDataEnabled,
  }),

  // 获取通知未读数
  notificationUnread: () => api.get('app/notification/unread', {
    fake: isMockDataEnabled,
  }),

  // 获取通知未读列表
  notificationList: () => api.get('app/notification/list', {
    fake: isMockDataEnabled,
  }),
}
