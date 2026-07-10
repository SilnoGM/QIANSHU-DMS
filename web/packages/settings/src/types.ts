import type { BASE_COLORS, THEMES } from '@fantastic-admin/themes'
import type { SettingsPreferences } from './preferences'

export type BaseColorName = keyof typeof BASE_COLORS
export type ThemeName = keyof typeof THEMES
export type ThemeColorScheme = 'light' | 'dark' | ''
export type RouteMode = 'hash' | 'html5'
export type RouteBaseOn = 'frontend' | 'backend'
export type LayoutCenterScope = 'inner' | 'outer'
export type MenuMode = 'side' | 'head' | 'single' | 'only-side' | 'only-head' | 'side-panel' | 'head-panel'
export type MenuStyle = '' | 'arrow' | 'line' | 'dot'
export type MainMenuClickMode = 'switch' | 'jump' | 'smart'
export type TopbarMode = 'static' | 'fixed' | 'sticky'
export type TabbarStyle = '' | 'fashion' | 'card' | 'square'
export type TabbarDblclickAction = 'reload' | 'close' | 'pin' | 'maximize' | 'window'
export type BreadcrumbStyle = '' | 'modern'
export type PageTransitionMode = '' | 'fade' | 'slide-left' | 'slide-right' | 'slide-top' | 'slide-bottom'

export interface AppAccountSettings {
  /**
   * 权限验证功能
   * @description 控制是否启用权限验证功能
   * @default false
   */
  auth?: boolean
  /**
   * 登录过期模式
   * @description 当登录过期时的处理方式
   * @default 'redirect'
   * @example
   * 'redirect' - 跳转到登录页
   * 'popup' - 弹出登录窗口
   */
  expiredMode?: 'redirect' | 'popup'
  /**
   * 多账号管理
   * @description 可同时登录多个账号，方便快速切换
   * @default false
   */
  multipleAccounts?: boolean
}

export interface AppCopyrightSettings {
  /**
   * 版权信息
   * @description 控制是否显示底部版权信息，同时在路由 meta 对象里可以单独设置某个路由是否显示底部版权信息
   * @default false
   */
  enable?: boolean
  /**
   * 网站运行日期
   * @description 网站开始运行的日期
   * @default ''
   */
  dates?: string
  /**
   * 公司名称
   * @description 版权信息中显示的公司名称
   * @default ''
   */
  company?: string
  /**
   * 网站地址
   * @description 版权信息中显示的网站地址
   * @default ''
   */
  website?: string
}

export interface AppLayoutSettings {
  /**
   * 居中布局
   * @description 控制是否启用居中布局模式
   * @default false
   */
  center?: boolean
  /**
   * 居中布局作用范围
   * @description 指定居中布局的作用范围
   * @default 'inner'
   * @example
   * 'inner' - 内层
   * 'outer' - 外层
   */
  centerScope?: LayoutCenterScope
  /**
   * 居中布局宽度
   * @description 设置居中布局的最大宽度
   * @default 1400
   */
  centerWidth?: number
}

export interface AppHomeSettings {
  /**
   * 主页
   * @description 控制是否启用主页功能
   * @default true
   */
  enable?: boolean
  /**
   * 主页标题
   * @description 主页的标题，支持设置 i18n 的 key
   * @default 'app.route.home'
   */
  title?: string
  /**
   * 主页完整路径
   * @description 主页的完整路由路径
   * @default '/'
   */
  fullPath?: string
}

export interface AppSettings {
  /** 账号相关配置 */
  account?: AppAccountSettings
  /**
   * 路由模式
   * @description 设置应用的路由模式
   * @default 'hash'
   * @example
   * 'hash' - Hash 模式
   * 'html5' - HTML5 模式
   */
  routeMode?: RouteMode
  /**
   * 路由数据来源
   * @description 指定路由数据的来源方式
   * @default 'frontend'
   * @example
   * 'frontend' - 前端
   * 'backend' - 后端
   */
  routeBaseOn?: RouteBaseOn
  /**
   * 动态标题
   * @description 控制是否启用动态页面标题功能
   * @default false
   */
  dynamicTitle?: boolean
  /**
   * 页面水印
   * @description 控制是否在页面上显示水印
   * @default false
   */
  watermark?: boolean
  /**
   * 反馈
   * @description 控制是否启用用户反馈功能
   * @default false
   */
  feedback?: boolean
  /**
   * 锁屏
   * @description 控制是否启用锁屏功能
   * @default false
   */
  lockScreen?: boolean
  /**
   * 错误日志
   * @description 控制是否在非开发环境下启用错误日志记录，具体业务代码在 apps/&lt;app&gt;/src/utils/errorLog.ts
   * @default false
   */
  errorLog?: boolean
  /**
   * 检查更新
   * @description 控制是否启用应用更新检查功能
   * @default false
   */
  checkUpdates?: boolean
  /**
   * 哀悼模式
   * @description 开启后网站将会整体变灰
   * @default false
   */
  rip?: boolean
  /**
   * 移动端访问
   * @description 关闭后，网站将禁用移动端访问
   * @default true
   */
  mobile?: boolean
  /**
   * 布局相关配置
   */
  layout?: AppLayoutSettings
  /**
   * 主页相关配置
   */
  home?: AppHomeSettings
  /**
   * 版权信息配置
   */
  copyright?: AppCopyrightSettings
  /**
   * 偏好设置
   * @description 用户偏好设置，可以控制各个功能模块的启用状态
   */
  preferences?: SettingsPreferences
}

export interface ThemeSettings {
  /**
   * 主题同步
   * @description 当开启时，切换颜色方案将共用同一套基础色和主题色
   * @default true
   */
  sync?: boolean
  /**
   * 亮色基础色
   * @description 指定亮色模式下的基础色
   * @default 'neutral'
   */
  baseColorLight?: BaseColorName
  /**
   * 暗色基础色
   * @description 指定暗色模式下的基础色
   * @default 'neutral'
   */
  baseColorDark?: BaseColorName
  /**
   * 亮色主题
   * @description 指定亮色模式下的主题
   * @default 'default'
   */
  light?: ThemeName
  /**
   * 暗色主题
   * @description 指定暗色模式下的主题
   * @default 'default'
   */
  dark?: ThemeName
  /**
   * 颜色方案
   * @description 设置应用的颜色方案
   * @default 'light'
   * @example
   * 'light' - 明亮模式
   * 'dark' - 暗黑模式
   * '' - 跟随系统
   */
  colorScheme?: ThemeColorScheme
  /**
   * 圆角系数
   * @description 设置界面元素的圆角大小，取值范围 0 到 1
   * @default 0.5
   * @example 0.5 - 中等圆角
   */
  radius?: number
  /**
   * 色弱模式
   * @description 启用色弱友好的颜色方案
   * @default false
   */
  colorAmblyopia?: boolean
}

export interface MenuSettings {
  /**
   * 导航菜单模式
   * @description 设置导航菜单的显示模式
   * @default 'side'
   * @example
   * 'side' - 侧边栏模式（有主导航菜单）
   * 'head' - 顶部模式
   * 'single' - 侧边栏模式（无主导航菜单）
   * 'only-side' - 侧边栏精简模式
   * 'only-head' - 顶部精简模式
   * 'side-panel' - 侧边栏面板模式
   * 'head-panel' - 顶部面板模式
   */
  mode?: MenuMode
  /**
   * 导航菜单风格
   * @description 设置导航菜单的视觉风格
   * @default ''
   * @example
   * '' - 默认风格
   * 'arrow' - 箭头风格
   * 'line' - 线条风格
   * 'dot' - 圆点风格
   */
  style?: MenuStyle
  /**
   * 暗色模式
   * @description 仅在亮色模式下生效，控制导航菜单是否使用暗色主题
   * @default false
   */
  dark?: boolean
  /**
   * 主导航菜单点击模式
   * @description 设置主导航菜单菜单项的点击行为
   * @default 'switch'
   * @example
   * 'switch' - 切换
   * 'jump' - 跳转
   * 'smart' - 智能选择，判断次导航是否只有且只有一个可访问的菜单进行切换或跳转操作
   */
  mainMenuClickMode?: MainMenuClickMode
  /**
   * 次导航菜单只保持一个子项的展开
   * @description 控制次导航菜单是否只允许同时展开一个子导航菜单
   * @default true
   */
  subMenuUniqueExpand?: boolean
  /**
   * 次导航菜单收起
   * @description 控制次导航菜单的默认收起状态
   * @default false
   */
  subMenuCollapse?: boolean
  /**
   * 次导航菜单自动收起
   * @description 控制次导航菜单是否在特定条件下自动收起
   * @default false
   */
  subMenuAutoCollapse?: boolean
  /**
   * 次导航菜单的展开/收起按钮
   * @description 控制是否显示次导航菜单的展开/收起控制按钮
   * @default false
   */
  subMenuCollapseButton?: boolean
  /**
   * 快捷键
   * @description 控制是否启用导航菜单相关的快捷键功能
   * @default false
   */
  hotkeys?: boolean
}

export interface TopbarSettings {
  /**
   * 标签栏
   * @description 控制是否在顶栏显示标签栏
   * @default false
   */
  tabbar?: boolean
  /**
   * 工具栏
   * @description 控制是否在顶栏显示工具栏
   * @default true
   */
  toolbar?: boolean
  /**
   * 模式
   * @description 设置顶栏的显示模式
   * @default 'static'
   * @example
   * 'static' - 静止，跟随页面滚动
   * 'fixed' - 固定，不跟随页面滚动，始终固定在顶部
   * 'sticky' - 粘性，页面往下滚动时隐藏，往上滚动时显示
   */
  mode?: TopbarMode
  /**
   * 切换显示标签栏和工具栏的显示顺序
   * @description 控制标签栏和工具栏的显示顺序
   * @default false
   * @example
   * false - 标签栏在工具栏上面
   * true - 工具栏在标签栏上面
   */
  switchTabbarAndToolbar?: boolean
}

export interface TabbarSettings {
  /**
   * 标签栏风格
   * @description 设置标签栏的视觉风格
   * @default ''
   * @example
   * '' - 默认风格
   * 'fashion' - 时尚风格
   * 'card' - 卡片风格
   * 'square' - 方块风格
   */
  style?: TabbarStyle
  /**
   * 最小最大宽度
   * @description 设置标签的最小和最大宽度，当设置为 'unset' 时为自适应
   * @default [150, 150]
   * @example
   * [150, 150] - 固定宽度 150px
   * [150, 'unset'] - 最小宽度 150px
   * ['unset', 150] - 最大宽度 150px
   * ['unset', 'unset'] - 跟随文字长度自适应
   */
  minMaxWidth?: readonly [number | 'unset', number | 'unset']
  /**
   * 图标
   * @description 控制标签是否显示图标
   * @default false
   */
  icon?: boolean
  /**
   * 双击执行动作
   * @description 设置双击标签时执行的动作
   * @default 'close'
   * @example
   * 'reload' - 刷新
   * 'close' - 关闭
   * 'pin' - 固定/取消固定
   * 'maximize' - 最大化
   * 'window' - 新窗口打开
   */
  dblclickAction?: TabbarDblclickAction
  /**
   * 记忆功能
   * @description 控制是否记住用户的标签操作状态
   * @default false
   */
  memory?: boolean
  /**
   * 快捷键
   * @description 控制是否启用标签栏相关的快捷键功能
   * @default false
   */
  hotkeys?: boolean
}

export interface BreadcrumbSettings {
  /**
   * 面包屑导航
   * @description 控制是否显示面包屑导航
   * @default true
   */
  enable?: boolean
  /**
   * 风格
   * @description 设置面包屑导航的视觉风格
   * @default ''
   * @example
   * '' - 默认风格
   * 'modern' - 现代风格
   */
  style?: BreadcrumbStyle
  /**
   * 显示主导航菜单
   * @description 控制是否在面包屑中显示主导航菜单信息
   * @default false
   */
  mainMenu?: boolean
}

export interface ToolbarMenuSearchSettings {
  /**
   * 导航菜单搜索
   * @description 控制是否启用导航菜单搜索功能
   * @default true
   */
  enable?: boolean
  /**
   * 快捷键
   * @description 控制是否启用导航菜单搜索的快捷键
   * @default true
   */
  hotkeys?: boolean
}

export interface ToolbarI18nSettings {
  /**
   * 国际化
   * @description 控制是否启用多语言切换功能
   * @default false
   */
  enable?: boolean
  /**
   * 默认语言
   * @description 设置应用的默认语言，参考 apps/&lt;app&gt;/src/locales/index.ts 中导出的 localesInfo
   * @default ''
   * @example '' - 跟随浏览器语言设置
   */
  defaultLang?: string
}

export type ToolbarLayoutItem = Exclude<keyof ToolbarSettings, 'layout'> | '->'

export interface ToolbarSettings {
  /**
   * 收藏夹
   * @description 控制是否启用收藏夹功能
   * @default false
   */
  favorites?: boolean
  /**
   * 面包屑导航配置
   */
  breadcrumb?: BreadcrumbSettings
  /**
   * 导航搜索配置
   */
  menuSearch?: ToolbarMenuSearchSettings
  /**
   * 通知中心
   * @description 控制是否启用通知中心功能
   * @default false
   */
  notification?: boolean
  /**
   * 国际化配置
   */
  i18n?: ToolbarI18nSettings
  /**
   * 全屏
   * @description 控制是否启用全屏切换功能
   * @default false
   */
  fullscreen?: boolean
  /**
   * 页面刷新
   * @description 控制是否启用页面刷新功能
   * @default false
   */
  pageReload?: boolean
  /**
   * 颜色主题
   * @description 控制是否启用颜色主题切换功能
   * @default false
   */
  colorScheme?: boolean
  /**
   * 工具栏布局
   * @description 可自定义摆放位置和顺序，其中 '->' 为分隔符，用于分隔左右两侧的工具栏。设置时请确保默认值里的所有值都存在，不可删减。
   * @default ['favorites', 'breadcrumb', '->', 'menuSearch', 'notification', 'i18n', 'fullscreen', 'pageReload', 'colorScheme']
   */
  layout?: ToolbarLayoutItem[]
}

export interface PageSettings {
  /**
   * 切换动画
   * @description 设置页面切换时的动画效果
   * @default ''
   * @example
   * '' - 无动画
   * 'fade' - 淡入淡出
   * 'slide-left' - 向左滑动
   * 'slide-right' - 向右滑动
   * 'slide-top' - 向上滑动
   * 'slide-bottom' - 向下滑动
   */
  transitionMode?: PageTransitionMode
  /**
   * 载入进度条
   * @description 控制是否显示页面载入进度条
   * @default true
   */
  progress?: boolean
  /**
   * iframe 页面最大保活数量
   * @description 设置 iframe 页面的最大保活数量
   * @default 3
   */
  iframeKeepAliveMax?: number
  /**
   * 快捷键
   * @description 控制是否启用页面相关的快捷键功能
   * @default true
   */
  hotkeys?: boolean
}

export interface SettingsOptions {
  /**
   * 应用设置
   * @description 应用级别的全局配置
   */
  app?: AppSettings
  /**
   * 主题设置
   * @description 主题和样式相关的配置
   */
  theme?: ThemeSettings
  /**
   * 导航菜单设置
   * @description 导航菜单相关的配置
   */
  menu?: MenuSettings
  /**
   * 顶栏设置
   * @description 顶部工具栏相关的配置
   */
  topbar?: TopbarSettings
  /**
   * 标签栏设置
   * @description 标签页相关的配置
   */
  tabbar?: TabbarSettings
  /**
   * 工具栏设置
   * @description 工具栏功能相关的配置
   */
  toolbar?: ToolbarSettings
  /**
   * 页面设置
   * @description 页面行为和显示相关的配置
   */
  page?: PageSettings
}

export interface SettingsLegacyOptions {
  app?: {
    themeSync?: boolean
    lightTheme?: ThemeName
    darkTheme?: ThemeName
    colorScheme?: '' | 'light' | 'dark'
    radius?: number
    enableMournMode?: boolean
    enableColorAmblyopiaMode?: boolean
    defaultLang?: string
    enablePermission?: boolean
    enableProgress?: boolean
    enableDynamicTitle?: boolean
    enableWatermark?: boolean
    enableFeedback?: boolean
    enableErrorLog?: boolean
    loginExpiredMode?: 'redirect' | 'popup'
    enableCheckUpdates?: boolean
    routeBaseOn?: 'frontend' | 'backend' | 'filesystem'
    direction?: 'ltr' | 'rtl'
  }
  userPreferences?: {
    enable?: boolean
    storageTo?: 'local' | 'server'
  }
  home?: {
    enable?: boolean
    title?: string
    fullPath?: string
  }
  layout?: {
    widthMode?: 'adaption' | 'center'
    widthModeScope?: 'outer' | 'inner'
    enableMobileAdaptation?: boolean
  }
  menu?: {
    baseOn?: 'frontend' | 'backend'
    mode?: 'side' | 'head' | 'single' | 'only-side' | 'only-head' | 'side-panel' | 'head-panel'
    style?: '' | 'arrow' | 'line' | 'dot'
    enableDark?: boolean
    mainMenuClickMode?: 'switch' | 'jump' | 'smart'
    subMenuUniqueOpened?: boolean
    subMenuCollapse?: boolean
    subMenuAutoCollapse?: boolean
    enableSubMenuCollapseButton?: boolean
    enableHotkeys?: boolean
  }
  topbar?: {
    mode?: 'static' | 'fixed' | 'sticky'
    switchTabbarAndToolbar?: boolean
  }
  tabbar?: {
    enable?: boolean
    style?: '' | 'fashion' | 'card' | 'square'
    enableIcon?: boolean
    dblclickAction?: 'reload' | 'close' | 'pin' | 'maximize' | 'window'
    enableMemory?: boolean
    enableHotkeys?: boolean
    storageTo?: 'local' | 'server'
  }
  toolbar?: {
    enable?: boolean
    favorites?: boolean
    breadcrumb?: boolean
    navSearch?: boolean
    notification?: boolean
    i18n?: boolean
    fullscreen?: boolean
    pageReload?: boolean
    colorScheme?: boolean
    layout?: (('favorites' | 'breadcrumb' | 'navSearch' | 'notification' | 'i18n' | 'fullscreen' | 'pageReload' | 'colorScheme') | '->')[]
  }
  favorites?: {
    storageTo?: 'local' | 'server'
  }
  breadcrumb?: {
    style?: '' | 'modern'
    enableMainMenu?: boolean
  }
  mainPage?: {
    enableHotkeys?: boolean
    iframeCacheMax?: number
    enableTransition?: boolean
    transitionMode?: 'fade' | 'slide-left' | 'slide-right' | 'slide-top' | 'slide-bottom'
  }
  navSearch?: {
    enableHotkeys?: boolean
  }
  copyright?: {
    enable?: boolean
    dates?: string
    company?: string
    website?: string
    beian?: string
  }
}
