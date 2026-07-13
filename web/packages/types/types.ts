import type { RouteRecordName, RouteRecordRaw } from 'vue-router'

export interface RouteMetaRaw {
  // #region docs-route-meta-auths
  /**
   * 权限池
   * @description 对路由本身无实际作用，通常用于角色管理模块，展示路由可配置权限
   * @default undefined
   * @example
   * [
   *   { name: '新闻管理(浏览)', value: 'news:view' },
   *   { name: '新闻管理(编辑)', value: 'news:edit' }
   * ]
   */
  auths?: {
    name: string
    value: string
  }[]
  // #endregion docs-route-meta-auths

  // #region docs-route-meta-auth
  /**
   * 权限
   * @description 路由访问权限，配置为数组时，只需满足一个即可进入
   * @default undefined
   * @example
   * 'news:view' - 访问该路由时，需要具备 news:view 权限
   * ['news:view', 'news:edit'] - 访问该路由时，需要具备 news:view 或 news:edit 权限
   */
  auth?: string | string[]
  // #endregion docs-route-meta-auth

  // #region docs-route-meta-localeAuth
  /**
   * 区域权限
   * @description 区域语言权限，配置为数组时，只需满足一个即可进入
   * @default undefined
   * @example
   * 'zh-cn' - 当前区域语言为 zh-cn 允许访问该路由
   * ['zh-cn', 'zh-tw'] - 当前区域语言为 zh-cn 或 zh-tw 允许访问该路由
   */
  localeAuth?: string | string[]
  // #endregion docs-route-meta-localeAuth

  // #region docs-route-meta-singleMenu
  /**
   * 单个一级导航
   * @description 该配置用于简化只想展示一级，没有二级导航的路由配置。
   * @default false
   */
  singleMenu?: boolean
  // #endregion docs-route-meta-singleMenu

  // #region docs-route-meta-title
  /**
   * 标题
   * @description 标题会在导航、标签页、面包屑等需要的展示位置显示
   * @default undefined
   * @example
   * '新闻管理' - 标题为新闻管理
   */
  title?: string | (() => string)
  // #endregion docs-route-meta-title

  // #region docs-route-meta-icon
  /**
   * 图标
   * @description 如果配置为数组，则第一个为默认图标，第二个为激活图标
   * @default undefined
   * @example
   * 'i-ep:lock' - 默认显示 i-ep:lock 图标
   * ['i-ep:lock', 'i-ep:unlock'] - 默认显示 i-ep:lock 图标，激活时显示 i-ep:unlock 图标
   */
  icon?: string | [string, string]
  // #endregion docs-route-meta-icon

  // #region docs-route-meta-query
  /**
   * 路由 query 参数
   * @description 点击导航时进行路由跳转时，携带的参数
   * @default undefined
   * @example
   * { id: 1, name: 'test' } - 点击导航时，携带 id 参数为 1，name 参数为 test
   */
  query?: Record<string, any>
  // #endregion docs-route-meta-query

  // #region docs-route-meta-menu
  /**
   * 是否在导航菜单中显示
   * @description 当子导航菜单里没有可展示的导航菜单时，会直接显示父导航菜单
   * @default true
   */
  menu?: boolean
  // #endregion docs-route-meta-menu

  // #region docs-route-meta-activeMenu
  /**
   * 高亮导航菜单
   * @description 需要设置完整路由地址
   * @default undefined
   * @example '/news/list'
   */
  activeMenu?: string
  // #endregion docs-route-meta-activeMenu

  // #region docs-route-meta-expand
  /**
   * 是否默认展开
   * @description 如果配置为数组，则第一个为默认展开状态，第二个是否始终展开
   * @default undefined
   * @example
   * true - 默认展开
   * [true, true] - 默认展开，且不允许收起
   */
  expand?: boolean | [boolean, boolean]
  // #endregion docs-route-meta-expand

  // #region docs-route-meta-badge
  /**
   * 徽章
   * @description 如果配置为数组，则第一个为徽章内容，第二个为徽章颜色
   * @default undefined
   * @example
   * 'PRO' - 显示徽章，内容为 PRO
   * [true, 'destructive'] - 显示徽章，内容为圆点，颜色为 'destructive'
   */
  badge?:
    boolean | string | number | (() => boolean | string | number)
    | [
      boolean | string | number | (() => boolean | string | number),
      'default' | 'secondary' | 'destructive' | (() => 'default' | 'secondary' | 'destructive'),
    ]
  // #endregion docs-route-meta-badge

  // #region docs-route-meta-sort
  /**
   * 导航排序
   * @description 数字越大越靠前
   * @default 0
   */
  sort?: number
  // #endregion docs-route-meta-sort

  // #region docs-route-meta-breadcrumb
  /**
   * 是否在面包屑中显示
   * @description 是否在面包屑导航中显示
   * @default true
   */
  breadcrumb?: boolean
  // #endregion docs-route-meta-breadcrumb

  // #region docs-route-meta-tabPermanent
  /**
   * 是否常驻标签页
   * @description 请勿在带有参数的路由上设置该特性
   * @default false
   */
  tabPermanent?: boolean
  // #endregion docs-route-meta-tabPermanent

  // #region docs-route-meta-tabMerge
  /**
   * 标签页合并
   * @description 根据规则合并标签页
   * @default undefined
   * @example
   * 'routeName' - 根据路由名称合并
   * 'activeMenu' - 根据 activeMenu 属性合并
   */
  tabMerge?: 'routeName' | 'activeMenu'
  // #endregion docs-route-meta-tabMerge

  // #region docs-route-meta-keepAlive
  /**
   * 保活
   * @description 根据规则保活当前路由页面
   * @default undefined
   * @example
   * true - 始终保活
   * 'news' - 访问路由name为news的页面时保活
   * ['news', 'user'] - 访问路由name为news或user的页面时保活
   */
  keepAlive?: boolean | string | string[]
  // #endregion docs-route-meta-keepAlive

  // #region docs-route-meta-noKeepAlive
  /**
   * 不保活
   * @description 根据规则不保活当前路由页面
   * @default undefined
   * @example
   * 'news' - 访问路由name为news的页面时不保活
   * ['news', 'user'] - 访问路由name为news或user的页面时不保活
   */
  noKeepAlive?: string | string[]
  // #endregion docs-route-meta-noKeepAlive

  // #region docs-route-meta-maximize
  /**
   * 最大化
   * @description 如果配置为数组，则第一个为是否开启最大化，第二个为是否允许手动退出最大化
   * @default undefined
   * @example
   * true - 开启最大化
   * [true, false] - 开启最大化，允许手动退出最大化
   * [true, true] - 开启最大化，不允许手动退出最大化
   */
  maximize?: boolean | [boolean, boolean]
  // #endregion docs-route-meta-maximize

  // #region docs-route-meta-newWindow
  /**
   * 新窗口
   * @description 是否在新窗口打开
   * @default false
   */
  newWindow?: boolean
  // #endregion docs-route-meta-newWindow

  // #region docs-route-meta-iframe
  /**
   * iframe
   * @description 是否在iframe中打开
   * @default undefined
   * @example
   * 'https://fantastic-admin.hurui.me' - 在iframe中打开 Fantastic-admin 官网
   * true - 获取路由query中的iframe属性，并在iframe中打开
   */
  iframe?: string | boolean
  // #endregion docs-route-meta-iframe

  // #region docs-route-meta-link
  /**
   * 外部链接
   * @description 会在浏览器新窗口访问该链接
   * @default undefined
   * @example
   * 'https://fantastic-admin.hurui.me' - 在浏览器新窗口打开 Fantastic-admin 官网
   */
  link?: string
  // #endregion docs-route-meta-link

  // #region docs-route-meta-layout
  /**
   * 布局
   */
  layout?: {
    /**
     * 是否居中
     * @description 如果不设置，则使用全局配置
     * @default undefined
     */
    center?: boolean
    /**
     * 作用范围
     * @description 如果不设置，则使用全局配置
     * @default undefined
     */
    centerScope?: 'inner' | 'outer'
    /**
     * 宽度
     * @description 如果不设置，则使用全局配置
     * @default undefined
     */
    centerWidth?: number
  }
  // #endregion docs-route-meta-layout

  // #region docs-route-meta-copyright
  /**
   * 是否显示版权
   * @description 如果不设置，则使用全局配置
   * @default undefined
   */
  copyright?: boolean
  // #endregion docs-route-meta-copyright

  // #region docs-route-meta-whiteList
  /**
   * 免登白名单
   * @description 开启后无需登录即可访问，仅支持在固定路由上生效
   * @default false
   */
  whiteList?: boolean
  // #endregion docs-route-meta-whiteList
}

export interface RouteRecordMainRaw {
  meta?: Pick<RouteMetaRaw, 'auths' | 'auth' | 'localeAuth' | 'title' | 'icon' | 'badge' | 'sort'>
  children: RouteRecordRaw[]
}

export interface MenuRecordRaw {
  path?: string
  meta?: Pick<RouteMetaRaw, 'auth' | 'localeAuth' | 'title' | 'icon' | 'query' | 'menu' | 'expand' | 'badge' | 'newWindow' | 'link'>
  children?: MenuRecordRaw[]
}

export interface MenuRecordMainRaw {
  meta?: Pick<RouteMetaRaw, 'auth' | 'localeAuth' | 'title' | 'icon' | 'badge'>
  children: MenuRecordRaw[]
}

export interface TabbarRecordRaw extends Pick<RouteMetaRaw, 'title' | 'icon' | 'activeMenu' | 'tabPermanent' | 'tabMerge' | 'iframe'> {
  tabId: string
  fullPath: string
  routeName?: RouteRecordName | null
  name: string[]
  customTitleList: {
    fullPath: string
    title: string
  }[]
  isPin: boolean
}
