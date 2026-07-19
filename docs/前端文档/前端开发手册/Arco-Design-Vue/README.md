# Arco Design Vue 开发手册

本分册面向千树 DMS 唯一正式 Web 应用 `web/apps/qsmds-arco`，适用版本为 `@arco-design/web-vue@2.58.0`，核对日期为 2026-07-15。组件家族总数固定为 74；Task 6 已完成首批 28 个家族，Task 7 已完成数据展示、反馈、导航与其他共 46 个家族，五个组件分册现已完整覆盖全部家族。

## 真相源与适用边界

- [当前官网入门](https://arco.design/vue/docs/start)用于理解库的当前推荐意图；官网内容会随时间更新，不能单独证明 2.58.0 的 API。
- [2.58.0 tag](https://github.com/arco-design/arco-design-vue/tree/2.58.0)与本地已安装包用于锁定 API；官方 tag commit 已核对为 `5a707cc60c1130d8dae3aefb2e93616541952a66`。
- `web/pnpm-lock.yaml` 的 catalog resolved version 与正式应用依赖共同证明当前项目版本；升级后必须同步复核本文档。
- 本手册只描述当前项目真实接入与通用静态示例，不虚构业务 API、路由、权限或服务端字段。

## 阅读顺序

1. [Fantastic-admin 内置组件选型规则](../Fantastic-admin内置组件/选型与使用规则.md#4-与-arco-重叠能力的选择)：先按项目职责矩阵核对 Fa 公开能力，确认存在能力缺口后再继续阅读 Arco 回退资料。
2. [接入基础与全局配置](./接入基础与全局配置.md)：理解 Arco 的全局注册、样式、语言、主题和命令式 API 边界。
3. [通用与布局组件](./通用与布局组件.md)：核对按钮、文字、栅格和页面布局的回退能力。
4. [数据录入组件](./数据录入组件.md)：按受控值、校验、可访问性和安全边界实现回退表单。
5. [数据展示组件](./数据展示组件.md)：核对复合组件、受控展示状态、Table 与 Tree 的大数据边界。
6. [反馈组件](./反馈组件.md)：区分模板组件、命令式入口、异步关闭和反馈生命周期。
7. [导航与其他组件](./导航与其他组件.md)：遵守 Fantastic-admin 框架壳边界并使用底层工具组件。

## 命名与选型

矩阵中的“英文家族”是文档治理键，不等于单一 Vue 组件。模板实际使用全局注册的 `A*` 名称；例如 `Typography` 家族包含 `ATypographyTitle`、`ATypographyParagraph` 和 `ATypographyText`，`Grid` 家族包含 `ARow` 与 `ACol`。TypeScript 类型、命令式反馈 API、动态组件引用与测试代码仍应从 `@arco-design/web-vue` 显式导入。

标准业务 UI 优先使用 Fantastic-admin 内置组件；已核对本地 Fa API 且确认无法满足需求时，才使用本分册中的 Arco Design Vue 能力。回退不能只做名称替换，尤其要完整迁移表单模型、验证事件和插槽契约。

## 维护触发条件

出现以下任一变化时，必须重新核对矩阵、章节锚点和示例：

- `web/pnpm-lock.yaml` 或正式应用 `package.json` 中 Arco 版本变化；
- `src/ui/provider/`、应用入口、语言代码或主题属性变化；
- Vite resolver / auto-import 配置变化；
- 组件家族新增、移除、重命名，或 2.58.0 的固定契约被升级版本替代；
- Fantastic-admin 与 Arco 的职责矩阵变化。

## 74 个家族覆盖矩阵

“接入状态”描述运行时事实；“分册”链接到当前版本已经核对的家族章节。

| 英文家族 | 分类 | 分册 | 官方版本来源 | 接入状态 | 核对日期 |
| --- | --- | --- | --- | --- | --- |
| Button | 通用 | [通用与布局组件](./通用与布局组件.md#button) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/button) | 正式应用已全局注册 | 2026-07-15 |
| Link | 通用 | [通用与布局组件](./通用与布局组件.md#link) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/link) | 正式应用已全局注册 | 2026-07-15 |
| Typography | 通用 | [通用与布局组件](./通用与布局组件.md#typography) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/typography) | 正式应用已全局注册 | 2026-07-15 |
| Divider | 布局 | [通用与布局组件](./通用与布局组件.md#divider) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/divider) | 正式应用已全局注册 | 2026-07-15 |
| Grid | 布局 | [通用与布局组件](./通用与布局组件.md#grid) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/grid) | 正式应用已全局注册 | 2026-07-15 |
| Layout | 布局 | [通用与布局组件](./通用与布局组件.md#layout) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/layout) | 正式应用已全局注册 | 2026-07-15 |
| Space | 布局 | [通用与布局组件](./通用与布局组件.md#space) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/space) | 正式应用已全局注册 | 2026-07-15 |
| AutoComplete | 数据录入 | [数据录入组件](./数据录入组件.md#autocomplete) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/auto-complete) | 正式应用已全局注册 | 2026-07-15 |
| Cascader | 数据录入 | [数据录入组件](./数据录入组件.md#cascader) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/cascader) | 正式应用已全局注册 | 2026-07-15 |
| Checkbox | 数据录入 | [数据录入组件](./数据录入组件.md#checkbox) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/checkbox) | 正式应用已全局注册 | 2026-07-15 |
| ColorPicker | 数据录入 | [数据录入组件](./数据录入组件.md#colorpicker) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/color-picker) | 正式应用已全局注册 | 2026-07-15 |
| DatePicker | 数据录入 | [数据录入组件](./数据录入组件.md#datepicker) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/date-picker) | 正式应用已全局注册 | 2026-07-15 |
| Form | 数据录入 | [数据录入组件](./数据录入组件.md#form) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/form) | 正式应用已全局注册 | 2026-07-15 |
| Input | 数据录入 | [数据录入组件](./数据录入组件.md#input) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/input) | 正式应用已全局注册 | 2026-07-15 |
| InputNumber | 数据录入 | [数据录入组件](./数据录入组件.md#inputnumber) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/input-number) | 正式应用已全局注册 | 2026-07-15 |
| InputTag | 数据录入 | [数据录入组件](./数据录入组件.md#inputtag) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/input-tag) | 正式应用已全局注册 | 2026-07-15 |
| Mention | 数据录入 | [数据录入组件](./数据录入组件.md#mention) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/mention) | 正式应用已全局注册 | 2026-07-15 |
| Radio | 数据录入 | [数据录入组件](./数据录入组件.md#radio) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/radio) | 正式应用已全局注册 | 2026-07-15 |
| Rate | 数据录入 | [数据录入组件](./数据录入组件.md#rate) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/rate) | 正式应用已全局注册 | 2026-07-15 |
| Select | 数据录入 | [数据录入组件](./数据录入组件.md#select) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/select) | 正式应用已全局注册 | 2026-07-15 |
| Slider | 数据录入 | [数据录入组件](./数据录入组件.md#slider) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/slider) | 正式应用已全局注册 | 2026-07-15 |
| Switch | 数据录入 | [数据录入组件](./数据录入组件.md#switch) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/switch) | 正式应用已全局注册 | 2026-07-15 |
| Textarea | 数据录入 | [数据录入组件](./数据录入组件.md#textarea) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/textarea) | 正式应用已全局注册 | 2026-07-15 |
| TimePicker | 数据录入 | [数据录入组件](./数据录入组件.md#timepicker) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/time-picker) | 正式应用已全局注册 | 2026-07-15 |
| Transfer | 数据录入 | [数据录入组件](./数据录入组件.md#transfer) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/transfer) | 正式应用已全局注册 | 2026-07-15 |
| TreeSelect | 数据录入 | [数据录入组件](./数据录入组件.md#treeselect) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/tree-select) | 正式应用已全局注册 | 2026-07-15 |
| Upload | 数据录入 | [数据录入组件](./数据录入组件.md#upload) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/upload) | 正式应用已全局注册 | 2026-07-15 |
| VerificationCode | 数据录入 | [数据录入组件](./数据录入组件.md#verificationcode) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/verification-code) | 正式应用已全局注册 | 2026-07-15 |
| Avatar | 数据展示 | [数据展示组件](./数据展示组件.md#avatar) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/avatar) | 正式应用已全局注册 | 2026-07-15 |
| Badge | 数据展示 | [数据展示组件](./数据展示组件.md#badge) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/badge) | 正式应用已全局注册 | 2026-07-15 |
| Calendar | 数据展示 | [数据展示组件](./数据展示组件.md#calendar) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/calendar) | 正式应用已全局注册 | 2026-07-15 |
| Card | 数据展示 | [数据展示组件](./数据展示组件.md#card) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/card) | 正式应用已全局注册 | 2026-07-15 |
| Carousel | 数据展示 | [数据展示组件](./数据展示组件.md#carousel) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/carousel) | 正式应用已全局注册 | 2026-07-15 |
| Collapse | 数据展示 | [数据展示组件](./数据展示组件.md#collapse) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/collapse) | 正式应用已全局注册 | 2026-07-15 |
| Comment | 数据展示 | [数据展示组件](./数据展示组件.md#comment) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/comment) | 正式应用已全局注册 | 2026-07-15 |
| Descriptions | 数据展示 | [数据展示组件](./数据展示组件.md#descriptions) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/descriptions) | 正式应用已全局注册 | 2026-07-15 |
| Empty | 数据展示 | [数据展示组件](./数据展示组件.md#empty) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/empty) | 正式应用已全局注册 | 2026-07-15 |
| Image | 数据展示 | [数据展示组件](./数据展示组件.md#image) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/image) | 正式应用已全局注册 | 2026-07-15 |
| List | 数据展示 | [数据展示组件](./数据展示组件.md#list) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/list) | 正式应用已全局注册 | 2026-07-15 |
| Popover | 数据展示 | [数据展示组件](./数据展示组件.md#popover) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/popover) | 正式应用已全局注册 | 2026-07-15 |
| Progress | 数据展示 | [数据展示组件](./数据展示组件.md#progress) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/progress) | 正式应用已全局注册 | 2026-07-15 |
| Statistic | 数据展示 | [数据展示组件](./数据展示组件.md#statistic) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/statistic) | 正式应用已全局注册 | 2026-07-15 |
| Table | 数据展示 | [数据展示组件](./数据展示组件.md#table) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/table) | 正式应用已全局注册 | 2026-07-15 |
| Tag | 数据展示 | [数据展示组件](./数据展示组件.md#tag) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/tag) | 正式应用已全局注册 | 2026-07-15 |
| Timeline | 数据展示 | [数据展示组件](./数据展示组件.md#timeline) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/timeline) | 正式应用已全局注册 | 2026-07-15 |
| Tooltip | 数据展示 | [数据展示组件](./数据展示组件.md#tooltip) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/tooltip) | 正式应用已全局注册 | 2026-07-15 |
| Tree | 数据展示 | [数据展示组件](./数据展示组件.md#tree) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/tree) | 正式应用已全局注册 | 2026-07-15 |
| Alert | 反馈 | [反馈组件](./反馈组件.md#alert) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/alert) | 正式应用已全局注册 | 2026-07-15 |
| Drawer | 反馈 | [反馈组件](./反馈组件.md#drawer) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/drawer) | `ADrawer` 已全局注册；已注入 `$drawer`；静态 API 可显式导入 | 2026-07-15 |
| Message | 反馈 | [反馈组件](./反馈组件.md#message) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/message) | 已注入 `$message`；静态 API 可显式导入 | 2026-07-15 |
| Modal | 反馈 | [反馈组件](./反馈组件.md#modal) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/modal) | `AModal` 已全局注册；已注入 `$modal`；静态 API 可显式导入 | 2026-07-15 |
| Notification | 反馈 | [反馈组件](./反馈组件.md#notification) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/notification) | 已注入 `$notification`；静态 API 可显式导入 | 2026-07-15 |
| Popconfirm | 反馈 | [反馈组件](./反馈组件.md#popconfirm) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/popconfirm) | 正式应用已全局注册 | 2026-07-15 |
| Result | 反馈 | [反馈组件](./反馈组件.md#result) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/result) | 正式应用已全局注册 | 2026-07-15 |
| Skeleton | 反馈 | [反馈组件](./反馈组件.md#skeleton) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/skeleton) | 正式应用已全局注册 | 2026-07-15 |
| Spin | 反馈 | [反馈组件](./反馈组件.md#spin) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/spin) | 正式应用已全局注册 | 2026-07-15 |
| Affix | 导航 | [导航与其他组件](./导航与其他组件.md#affix) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/affix) | 正式应用已全局注册 | 2026-07-15 |
| Anchor | 导航 | [导航与其他组件](./导航与其他组件.md#anchor) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/anchor) | 正式应用已全局注册 | 2026-07-15 |
| BackTop | 导航 | [导航与其他组件](./导航与其他组件.md#backtop) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/back-top) | 正式应用已全局注册 | 2026-07-15 |
| Breadcrumb | 导航 | [导航与其他组件](./导航与其他组件.md#breadcrumb) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/breadcrumb) | 正式应用已全局注册 | 2026-07-15 |
| Dropdown | 导航 | [导航与其他组件](./导航与其他组件.md#dropdown) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/dropdown) | 正式应用已全局注册 | 2026-07-15 |
| Menu | 导航 | [导航与其他组件](./导航与其他组件.md#menu) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/menu) | 正式应用已全局注册 | 2026-07-15 |
| PageHeader | 导航 | [导航与其他组件](./导航与其他组件.md#pageheader) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/page-header) | 正式应用已全局注册 | 2026-07-15 |
| Pagination | 导航 | [导航与其他组件](./导航与其他组件.md#pagination) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/pagination) | 正式应用已全局注册 | 2026-07-15 |
| Steps | 导航 | [导航与其他组件](./导航与其他组件.md#steps) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/steps) | 正式应用已全局注册 | 2026-07-15 |
| Tabs | 导航 | [导航与其他组件](./导航与其他组件.md#tabs) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/tabs) | 正式应用已全局注册 | 2026-07-15 |
| ConfigProvider | 其他 | [导航与其他组件](./导航与其他组件.md#configprovider) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/config-provider) | 正式应用已全局注册 | 2026-07-15 |
| Icon | 其他 | [导航与其他组件](./导航与其他组件.md#icon) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/icon-component) | 正式应用已全局注册 | 2026-07-15 |
| OverflowList | 其他 | [导航与其他组件](./导航与其他组件.md#overflowlist) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/overflow-list) | 正式应用已全局注册 | 2026-07-15 |
| ResizeBox | 其他 | [导航与其他组件](./导航与其他组件.md#resizebox) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/resize-box) | 正式应用已全局注册 | 2026-07-15 |
| Scrollbar | 其他 | [导航与其他组件](./导航与其他组件.md#scrollbar) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/scrollbar) | 正式应用已全局注册 | 2026-07-15 |
| Split | 其他 | [导航与其他组件](./导航与其他组件.md#split) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/split) | 正式应用已全局注册 | 2026-07-15 |
| Trigger | 其他 | [导航与其他组件](./导航与其他组件.md#trigger) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/trigger) | 正式应用已全局注册 | 2026-07-15 |
| Watermark | 其他 | [导航与其他组件](./导航与其他组件.md#watermark) | [2.58.0 source](https://github.com/arco-design/arco-design-vue/tree/2.58.0/packages/web-vue/components/watermark) | 正式应用已全局注册 | 2026-07-15 |
