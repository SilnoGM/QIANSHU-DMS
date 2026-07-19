# 登录页品牌标题 Design QA

## 验收基线

- source visual truth：用户提供的 Chrome 登录页截图，以及修改前实页截图 `/private/tmp/qianshu-login-before-brand-title.png`。
- implementation screenshot：桌面端 `/private/tmp/qianshu-login-final-brand-title.png`；移动端 `/private/tmp/qianshu-login-mobile-brand-title-fixed.png`。
- viewport：桌面端 `1920 × 810`；移动端 `390 × 844`。
- state：浅色主题、登录页默认右侧布局、未输入账号信息。
- primary interactions tested：用户名、密码和登录按钮均可见且可用；未提交登录，避免改变当前认证状态。
- console errors checked：最终页面无 `error` 级别控制台日志。

## 全页对比证据

修改前与最终桌面端截图已在同一比较输入中检查。页面分栏比例、插画位置、登录表单位置、工具栏和背景均保持不变；唯一预期变化是左上角由单独 LOGO 变为“LOGO + 千树数据管理系统”的品牌组合。

## 局部对比证据

- 桌面端品牌区位于 `x: 16px, y: 16px`，LOGO 为 `32 × 32px`，组合宽度为 `168px`，文字与 LOGO 垂直居中。
- 移动端最终品牌区从绝对定位调整为独立占位行，品牌区位于 `y: 20px`，插画从 `y: 64px` 开始，二者不再重叠。
- 移动端 `clientWidth` 与 `scrollWidth` 均为 `390px`，无横向溢出，登录按钮完整可见。

## 必查视觉面

- 字体与层级：沿用项目默认字体，标题使用现有品牌组件一致的 `font-bold` 与 `text-base`，层级清楚且没有换行。
- 间距与布局：桌面端保持 `16px` 左上边距和 `8px` 图文间距；移动端使用独立占位行隔开品牌与插画。
- 色彩与 Token：文字使用 `text-foreground`，兼容项目现有明暗主题；未引入新色值。
- 图片质量与素材一致性：继续使用现有 `logo.svg` 与 `login-banner.png`，没有替代、拉伸或新增近似素材。
- 文案：标题读取 `VITE_APP_TITLE`，当前显示“千树数据管理系统”，与浏览器标题和侧边栏品牌真相源一致。

## Findings

- 最终比较未发现可执行的 P0、P1 或 P2 问题。

## Comparison History

1. 第一轮移动端检查发现 P2：绝对定位的品牌标题与插画头部轻微重叠。
2. 修复：为品牌组合增加 `login-brand` 定位钩子，在移动端改为独立占位行，并保留桌面端绝对定位。
3. 修复后证据：移动端品牌区与插画垂直分离，`390px` 视口无横向溢出；桌面端布局与修改前保持一致。

## Implementation Checklist

- [x] 左上角 LOGO 右侧显示网站标题。
- [x] 标题复用项目应用标题真相源。
- [x] 桌面端保持原有布局比例。
- [x] 移动端不重叠、不溢出。
- [x] 登录控件可见且可用。
- [x] 最终页面无控制台错误。

final result: passed
