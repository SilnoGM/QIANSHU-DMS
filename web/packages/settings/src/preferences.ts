// 由 `pnpm --filter @fantastic-admin/settings generate:preferences` 自动生成，请勿手动修改。

export interface ThemePreferences {
  /**
   * 主题同步
   * @description 偏好设置中控制该项是否显示。原配置说明：当开启时，切换颜色方案将共用同一套基础色和主题色
   */
  sync?: boolean
  /**
   * 亮色基础色
   * @description 偏好设置中控制该项是否显示。原配置说明：指定亮色模式下的基础色
   */
  baseColorLight?: boolean
  /**
   * 暗色基础色
   * @description 偏好设置中控制该项是否显示。原配置说明：指定暗色模式下的基础色
   */
  baseColorDark?: boolean
  /**
   * 亮色主题
   * @description 偏好设置中控制该项是否显示。原配置说明：指定亮色模式下的主题
   */
  light?: boolean
  /**
   * 暗色主题
   * @description 偏好设置中控制该项是否显示。原配置说明：指定暗色模式下的主题
   */
  dark?: boolean
  /**
   * 颜色方案
   * @description 偏好设置中控制该项是否显示。原配置说明：设置应用的颜色方案
   */
  colorScheme?: boolean
  /**
   * 圆角系数
   * @description 偏好设置中控制该项是否显示。原配置说明：设置界面元素的圆角大小，取值范围 0 到 1
   */
  radius?: boolean
  /**
   * 色弱模式
   * @description 偏好设置中控制该项是否显示。原配置说明：启用色弱友好的颜色方案
   */
  colorAmblyopia?: boolean
}

export interface MenuPreferences {
  /**
   * 导航菜单模式
   * @description 偏好设置中控制该项是否显示。原配置说明：设置导航菜单的显示模式
   */
  mode?: boolean
  /**
   * 导航菜单风格
   * @description 偏好设置中控制该项是否显示。原配置说明：设置导航菜单的视觉风格
   */
  style?: boolean
  /**
   * 暗色模式
   * @description 偏好设置中控制该项是否显示。原配置说明：仅在亮色模式下生效，控制导航菜单是否使用暗色主题
   */
  dark?: boolean
  /**
   * 主导航菜单点击模式
   * @description 偏好设置中控制该项是否显示。原配置说明：设置主导航菜单菜单项的点击行为
   */
  mainMenuClickMode?: boolean
  /**
   * 次导航菜单只保持一个子项的展开
   * @description 偏好设置中控制该项是否显示。原配置说明：控制次导航菜单是否只允许同时展开一个子导航菜单
   */
  subMenuUniqueExpand?: boolean
  /**
   * 次导航菜单收起
   * @description 偏好设置中控制该项是否显示。原配置说明：控制次导航菜单的默认收起状态
   */
  subMenuCollapse?: boolean
  /**
   * 次导航菜单自动收起
   * @description 偏好设置中控制该项是否显示。原配置说明：控制次导航菜单是否在特定条件下自动收起
   */
  subMenuAutoCollapse?: boolean
  /**
   * 次导航菜单的展开/收起按钮
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否显示次导航菜单的展开/收起控制按钮
   */
  subMenuCollapseButton?: boolean
  /**
   * 快捷键
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否启用导航菜单相关的快捷键功能
   */
  hotkeys?: boolean
}

export interface TopbarPreferences {
  /**
   * 标签栏
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否在顶栏显示标签栏
   */
  tabbar?: boolean
  /**
   * 工具栏
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否在顶栏显示工具栏
   */
  toolbar?: boolean
  /**
   * 模式
   * @description 偏好设置中控制该项是否显示。原配置说明：设置顶栏的显示模式
   */
  mode?: boolean
  /**
   * 切换显示标签栏和工具栏的显示顺序
   * @description 偏好设置中控制该项是否显示。原配置说明：控制标签栏和工具栏的显示顺序
   */
  switchTabbarAndToolbar?: boolean
}

export interface TabbarPreferences {
  /**
   * 标签栏风格
   * @description 偏好设置中控制该项是否显示。原配置说明：设置标签栏的视觉风格
   */
  style?: boolean
  /**
   * 最小最大宽度
   * @description 偏好设置中控制该项是否显示。原配置说明：设置标签的最小和最大宽度，当设置为 'unset' 时为自适应
   */
  minMaxWidth?: boolean
  /**
   * 图标
   * @description 偏好设置中控制该项是否显示。原配置说明：控制标签是否显示图标
   */
  icon?: boolean
  /**
   * 双击执行动作
   * @description 偏好设置中控制该项是否显示。原配置说明：设置双击标签时执行的动作
   */
  dblclickAction?: boolean
  /**
   * 记忆功能
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否记住用户的标签操作状态
   */
  memory?: boolean
  /**
   * 快捷键
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否启用标签栏相关的快捷键功能
   */
  hotkeys?: boolean
}

export interface BreadcrumbPreferences {
  /**
   * 面包屑导航
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否显示面包屑导航
   */
  enable?: boolean
  /**
   * 风格
   * @description 偏好设置中控制该项是否显示。原配置说明：设置面包屑导航的视觉风格
   */
  style?: boolean
  /**
   * 显示主导航菜单
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否在面包屑中显示主导航菜单信息
   */
  mainMenu?: boolean
}

export interface ToolbarMenuSearchPreferences {
  /**
   * 导航菜单搜索
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否启用导航菜单搜索功能
   */
  enable?: boolean
  /**
   * 快捷键
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否启用导航菜单搜索的快捷键
   */
  hotkeys?: boolean
}

export interface ToolbarI18nPreferences {
  /**
   * 国际化
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否启用多语言切换功能
   */
  enable?: boolean
  /**
   * 默认语言
   * @description 偏好设置中控制该项是否显示。原配置说明：设置应用的默认语言，参考 apps/&lt;app&gt;/src/locales/index.ts 中导出的 localesInfo
   */
  defaultLang?: boolean
}

export interface ToolbarPreferences {
  /**
   * 收藏夹
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否启用收藏夹功能
   */
  favorites?: boolean
  /**
   * 面包屑导航配置
   * @description 偏好设置中控制该项是否显示。
   */
  breadcrumb?: boolean | BreadcrumbPreferences
  /**
   * 导航搜索配置
   * @description 偏好设置中控制该项是否显示。
   */
  menuSearch?: boolean | ToolbarMenuSearchPreferences
  /**
   * 通知中心
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否启用通知中心功能
   */
  notification?: boolean
  /**
   * 国际化配置
   * @description 偏好设置中控制该项是否显示。
   */
  i18n?: boolean | ToolbarI18nPreferences
  /**
   * 全屏
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否启用全屏切换功能
   */
  fullscreen?: boolean
  /**
   * 页面刷新
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否启用页面刷新功能
   */
  pageReload?: boolean
  /**
   * 颜色主题
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否启用颜色主题切换功能
   */
  colorScheme?: boolean
  /**
   * 工具栏布局
   * @description 偏好设置中控制该项是否显示。原配置说明：可自定义摆放位置和顺序，其中 '->' 为分隔符，用于分隔左右两侧的工具栏。设置时请确保默认值里的所有值都存在，不可删减。
   */
  layout?: boolean
}

export interface PagePreferences {
  /**
   * 切换动画
   * @description 偏好设置中控制该项是否显示。原配置说明：设置页面切换时的动画效果
   */
  transitionMode?: boolean
  /**
   * 载入进度条
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否显示页面载入进度条
   */
  progress?: boolean
  /**
   * iframe 页面最大保活数量
   * @description 偏好设置中控制该项是否显示。原配置说明：设置 iframe 页面的最大保活数量
   */
  iframeKeepAliveMax?: boolean
  /**
   * 快捷键
   * @description 偏好设置中控制该项是否显示。原配置说明：控制是否启用页面相关的快捷键功能
   */
  hotkeys?: boolean
}

export interface SettingsPreferences {
  /**
   * 主题设置
   * @description 偏好设置中控制整个分组是否显示，或继续细分到具体字段。原配置说明：主题和样式相关的配置
   */
  theme?: boolean | ThemePreferences
  /**
   * 导航菜单设置
   * @description 偏好设置中控制整个分组是否显示，或继续细分到具体字段。原配置说明：导航菜单相关的配置
   */
  menu?: boolean | MenuPreferences
  /**
   * 顶栏设置
   * @description 偏好设置中控制整个分组是否显示，或继续细分到具体字段。原配置说明：顶部工具栏相关的配置
   */
  topbar?: boolean | TopbarPreferences
  /**
   * 标签栏设置
   * @description 偏好设置中控制整个分组是否显示，或继续细分到具体字段。原配置说明：标签页相关的配置
   */
  tabbar?: boolean | TabbarPreferences
  /**
   * 工具栏设置
   * @description 偏好设置中控制整个分组是否显示，或继续细分到具体字段。原配置说明：工具栏功能相关的配置
   */
  toolbar?: boolean | ToolbarPreferences
  /**
   * 页面设置
   * @description 偏好设置中控制整个分组是否显示，或继续细分到具体字段。原配置说明：页面行为和显示相关的配置
   */
  page?: boolean | PagePreferences
}
