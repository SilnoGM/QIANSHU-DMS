# 登录页品牌区与 SVG 插画 Design QA

## 验收基线

- source visual truth：用户提供的 Chrome 登录页截图，以及目标素材 `web/apps/qsmds-arco/src/assets/images/login-banner.svg`。
- implementation screenshot：桌面端 `/private/tmp/qianshu-login-input-height-desktop-final.jpg`；移动端通过 `390 × 844` 实际视口 DOM 尺寸与溢出状态验收。
- account menu screenshot：`/private/tmp/qianshu-account-menu-200-final.jpg`，使用已登录账户实际打开菜单验收。
- viewport：桌面端 `1920 × 900`；移动端 `390 × 844`。
- state：浅色主题、登录页默认右侧布局、未输入账号信息。
- primary interactions tested：用户名、密码和登录按钮均可见且可用；未提交登录，避免改变当前认证状态。
- console errors checked：最终页面无 `error` 级别控制台日志。

## 全页对比证据

最终桌面端与移动端截图均已检查。页面分栏比例、登录表单位置、工具栏、背景和左上角品牌组合保持不变；登录插画已替换为指定 SVG，并在两种视口下完整显示。

## 局部对比证据

- 桌面端品牌区位于 `x: 16px, y: 16px`，LOGO 由 `32 × 32px` 放大为 `40 × 40px`，标题由 `16px` 放大为 `20px`；版本 Badge 字号由 `10px` 放大为 `12px`，实际约为 `55.6 × 26px`，三者在 `40px` 高的品牌行内垂直居中。
- 桌面端 SVG 图片框最终放大为 `920 × 690px`，保持素材 `4:3` 画布比例并在左侧区域居中；与右侧登录表单没有重叠。
- 移动端最终品牌区从绝对定位调整为独立占位行，品牌区位于 `y: 20px`，插画从 `y: 72px` 开始，二者不再重叠。
- 移动端 SVG 图片框最终放大为 `480 × 360px`；核心仪表盘完整显示，左右装饰元素采用轻微出血效果。页面内容宽度与滚动宽度均为 `379px`，无横向溢出；整页高度为 `892px`，可正常纵向滚动且登录按钮完整可见。
- 用户名与密码输入框在桌面端和移动端均为 `44px` 高，内部输入区域为 `42px`；前置图标区域为 `26px` 高且与输入框垂直居中。

## 必查视觉面

- 字体与层级：沿用项目默认字体，标题使用现有品牌组件一致的 `font-bold` 与 `text-base`；版本 Badge 使用 `10px` 字号，信息层级清楚且没有换行。
- 间距与布局：桌面端保持 `16px` 左上边距和 `8px` 图文间距；移动端使用独立占位行隔开品牌与插画。
- 色彩与 Token：文字使用 `text-foreground`，版本 Badge 使用 `secondary` 与 `ring-border`，兼容项目现有明暗主题；未引入新色值。
- 图片质量与素材一致性：品牌继续使用现有 `logo.svg`；登录插画使用指定 `login-banner.svg`，按 `4:3` 比例缩放，没有裁切或拉伸。
- 文案：标题读取 `VITE_APP_TITLE`；版本读取 `__SYSTEM_INFO__.pkg.version` 并显示为 `v0.1.2`，与项目构建版本真相源一致。

## Findings

- 最终比较未发现可执行的 P0、P1 或 P2 问题。

## 账户菜单验收

- 顶部主文字读取 `displayName`，当前实测为“超级管理员”；辅助文字读取 `username`，当前实测为 `superadmin`。
- `displayName` 为空时主文字回退到 `username`；回退后隐藏重复的辅助文字。
- 菜单实际宽度最终调整为 `200px`，可视宽度与滚动宽度一致，用户信息与菜单项均无横向溢出。

## Comparison History

1. 第一轮移动端检查发现 P2：绝对定位的品牌标题与插画头部轻微重叠。
2. 修复：为品牌组合增加 `login-brand` 定位钩子，在移动端改为独立占位行，并保留桌面端绝对定位。
3. 修复后证据：移动端品牌区与插画垂直分离，`390px` 视口无横向溢出；桌面端布局与修改前保持一致。
4. 版本 Badge 首轮检查发现 `FaBadge` 默认悬浮位移使版本号偏向品牌行顶部。
5. 修复：保留 `FaBadge`，将其内部徽章层改为静态布局并清除默认 `translate`，最终 Badge 在桌面端与移动端均垂直居中。
6. SVG 插画替换后，桌面端原有 `width: 50%` 与 `height: 50%` 形成的图片框不符合素材 `4:3` 比例。
7. 修复：桌面端改为 `width: min(60%, 680px)`、`height: auto` 和 `aspect-ratio: 4 / 3`；移动端保留 `375px` 上限，最终两种视口均完整显示。
8. 按最新视觉反馈继续放大插画：桌面端调整为 `width: min(68%, 780px)`，实际图片框为 `780 × 585px`；移动端调整为 `width: min(108%, 420px)`，实际图片框为 `420 × 315px`。
9. 放大后重新验证真实前后端联调页面：桌面端插画与表单不重叠，移动端 `390 × 844` 视口无横向滚动，控制台无 `error` 日志。
10. 按进一步放大要求，桌面端上限调整为 `920px`，实际图片框为 `920 × 690px`；移动端上限调整为 `480px`，实际图片框为 `480 × 360px`。
11. 最终真实页面复核：桌面端插画与表单仍无重叠；移动端核心图形完整、登录控件可见，无横向滚动，并保留正常纵向滚动能力。
12. 放大左上角品牌组合：LOGO 调整为 `40 × 40px`，标题调整为 `20px`，版本 Badge 调整为 `12px` 字号并增加内边距。
13. 桌面端与移动端复核：品牌组合垂直居中；移动端品牌区位于 `y: 20px`，插画从 `y: 72px` 开始，二者不重叠，页面无横向滚动。
14. 用户名与密码输入框容器统一调整为 `44px` 高，内部输入控件使用 `height: 100%` 跟随容器。
15. 桌面端与移动端复核：两个输入框高度一致，文字与前置图标垂直居中；移动端页面无横向滚动。
16. 账户菜单顶部文字层级调整为显示名在上、用户名在下，并加入显示名缺失时的回退与去重处理。
17. 账户菜单通过头部内容宽度局部撑开到实际 `360px`，未修改共享下拉菜单公共 API。
18. 按最新尺寸要求，将账户菜单内部内容宽度由 `334px` 调整为 `214px`，菜单实际外宽由 `360px` 缩小到 `240px`。
19. 将账户菜单内部内容宽度进一步调整为 `194px`，已登录页面实测菜单实际外宽为 `220px`。
20. 将账户菜单内部内容宽度调整为 `174px`，已登录页面实测菜单实际外宽为 `200px`。

## Implementation Checklist

- [x] 左上角 LOGO 右侧显示网站标题。
- [x] 标题复用项目应用标题真相源。
- [x] 标题右侧使用 `FaBadge` 显示构建版本号。
- [x] LOGO、标题和版本 Badge 已同步放大并保持垂直居中。
- [x] 登录插画替换为指定 SVG，并保持 4:3 比例。
- [x] 桌面端与移动端插画在原尺寸基础上继续放大。
- [x] 桌面端保持原有布局比例。
- [x] 移动端不重叠、不溢出。
- [x] 登录控件可见且可用。
- [x] 用户名与密码输入框已增高并保持文字、图标垂直居中。
- [x] 最终页面无控制台错误。

final result: passed

---

# 销售订单币种选择弹窗 Design QA

## 验收基线

- source visual truth：用户提供的参考图 `/var/folders/mq/jghl7cqn6fl2mccy65d_8k8w0000gn/T/codex-clipboard-8b010522-582d-449e-88d3-51738302a2da.png`。
- implementation screenshot：`/tmp/qianshu-sales-order-currency-selector-1407x1118.png`。
- viewport：参考图与实现图均为 `1407 × 1118`，实现图通过临时浏览器视口覆盖捕获，验收结束后已恢复默认视口。
- state：浅色主题、销售订单列表、币种弹窗打开、`TWD` 已选中。
- primary interactions tested：打开弹窗时没有默认币种；点击可见的 `TWD` 卡片后选中态与主按钮同步启用；点击“进入新增订单”进入 `#/operations/sales-orders/create?currency=TWD`。

## 同尺寸对照结论

- 弹窗采用宽幅双卡片结构，TWD 与 MYR 横向并排，卡片内部均包含货币徽标、货币名称、地区标签、币种编码、分隔线、选择提示和地区特色水印。
- `TWD` 选中态具有绿色边框、浅绿背景、选中图标和绿色状态文字；`MYR` 保持中性边框、蓝金徽标和暖黄色月星水印。
- 蓝色信息提示、取消按钮和绿色主按钮的位置与信息层级均与参考图一致。
- 实现沿用项目 `QsGenericModal` 的标题、正文、页脚密度，因此标题区和页脚区比视觉概念图更紧凑；该差异不影响信息结构、选择路径或可读性，归类为可接受的产品设计系统差异。

## Findings

- 最终比较未发现可执行的 P0、P1 或 P2 问题。
- P3：参考图采用更宽松的概念稿垂直留白；实现保留后台系统既有模态框密度，避免在常见笔记本视口产生不必要的内部滚动。

## Implementation Checklist

- [x] TWD、MYR 使用横向并排的矩形卡片。
- [x] 每次打开弹窗均无默认选择。
- [x] 货币名称、符号与启用状态继续读取货币目录。
- [x] 卡片选中、键盘选择、禁用状态与主按钮状态同步。
- [x] 提示文案明确币种进入新增页后不可修改。
- [x] 同尺寸、同状态参考图与实现图已放入同一对照输入检查。
- [x] 交互最终进入带固定币种参数的新增订单路由。

final result: passed

---

# QsSalesOrderDesc Design QA

## 验收基线

- source visual truth：Figma 文件 `b3PkjOqgVsvNtmmuvaQ5g4`，桌面 Ready 节点 `10:23`、移动 Ready 节点 `10:24`。
- source screenshots：`/tmp/qianshu-sales-order-desc-acceptance/figma-desktop-ready.png`（`496 × 1295`）、`/tmp/qianshu-sales-order-desc-acceptance/figma-mobile-ready.png`（`426 × 1325`）。去除各方向 `18px` 设计画布后，真实卡片分别是 `460 × 1267` 与 `390 × 1297`。
- implementation screenshots：`/tmp/qianshu-sales-order-desc-acceptance/implementation-desktop-final.png`（`460 × 1372`）、`/tmp/qianshu-sales-order-desc-acceptance/implementation-mobile-final.png`（`390 × 1408`）、`/tmp/qianshu-sales-order-desc-acceptance/implementation-desktop-dark-final.png`（`460 × 1372`）。
- combined comparisons：`/tmp/qianshu-sales-order-desc-acceptance/comparison-desktop-final.png` 与 `/tmp/qianshu-sales-order-desc-acceptance/comparison-mobile-final.png`；两图均为左侧 Figma、右侧真实组件。
- viewport：桌面 `900 × 1900`，移动 `390 × 1800`，深色桌面 `900 × 1600`；浏览器报告 `devicePixelRatio = 1`。
- density normalization：浏览器截图后端输出为 CSS 尺寸的 `0.5` 倍；桌面从 `230 × 686`、移动从 `195 × 704` 的有效组件区域使用 Lanczos 恢复为各自 CSS 尺寸后再与 Figma 等宽比较。只对截图证据做密度归一化，不修改组件渲染。
- state：TWD、两个产品、两个图片附件、资料已完成；`actions` 插槽提供完成提示与提交按钮。

## 全视图对比证据

- 五段信息顺序与 Figma 一致：订单基础信息 → 客户信息 → 产品列表与小计 → 销售信息 → 附件缩略图。
- 桌面组件宽度为 `460px`，移动组件宽度为 `390px`；两种视口均无页面级或组件级横向溢出。
- 最终实现比 Figma 卡片高 `105px`（桌面）和 `111px`（移动）。差异来自真实自动标题、完整 `TWD` 代码和原始文件名等可审计内容；没有改变区域比例或隐藏固定操作区，归类为可接受的数据密度差异。
- Figma 的顶部“核验通过”状态和移动抽屉把手/关闭按钮属于页面校验状态及 `QsGenericDrawer` 外壳；本轮已确认组件保持纯展示，因此未把这些状态耦合进 `QsSalesOrderDesc`。完成度与提交动作通过 `actions` 插槽注入。

## 局部对比证据

- 销售信息：销售总价保持整行主强调；约定定金、约定尾款保持两列次级强调。移动端两项金额容器 `clientWidth = scrollWidth = 146px`，`NT$30,000.00 TWD` 与 `NT$150,000.00 TWD` 默认均完整可见。
- 产品：目录产品显示产品编号，临时产品显示“本单临时产品”；真实售价、数量、行小计和产品明细汇总均使用同一 TWD 金额格式，没有在组件内重算浮点数。
- 附件：桌面为两列、移动为单列。两张 SVG 缩略图均加载成功，`naturalWidth = naturalHeight = 150`，`alt` 为完整自动标题；点击首张图片可打开预览对话框，关闭后触发器仍可见。
- 语义：标题顺序为 `订单详情`、五个业务区块标题；所有区块均使用 `section + aria-labelledby`，文本数据使用 `dl/dt/dd`。
- 深色主题：根卡片前景与背景分别为近白和深色 token，销售总价继续使用主题主色透明背景与边框；无横向溢出、无控制台 warning/error。

## 必查视觉面

- 字体与层级：实际标题使用 `Noto Sans SC`，`24px / 32px / 600`；金额继续使用项目 `qs-type-data-emphasis` 的 Noto Mono 与等宽数字。长标题和地址允许受控换行。
- 间距与布局：桌面保留 `24px` 卡片内边距，移动使用 `16px`；区块采用 `16px` 节奏、圆角卡片和单一纵向阅读顺序。产品行经首轮修正后从 `161px` 收敛到约 `90px`，附件桌面切换为两列。
- 色彩与 Token：仅使用 `background`、`foreground`、`muted`、`border`、`primary` 等主题 token；没有硬编码十六进制色、渐变或新建调色板。
- 图片质量与素材一致性：验收使用项目现有真实 SVG fixture，通过正式 `ImageGroup` 渲染与预览；没有手绘 SVG、CSS 图形、Emoji 或占位框代替附件。
- 文案与内容：订单编号明确“正式保存后派发”；产品区只突出真实售价、数量与小计；销售区明确“销售总价 / 约定定金 / 约定尾款”；附件展示凭证类型、自动标题和原始文件名。

## Findings

- 最终比较未发现可执行的 P0、P1 或 P2 问题。
- P3：真实数据比 Figma 示例更长，使整体高度增加约 8%；后续页面接入时应由右侧栏或抽屉外壳统一管理滚动，不应在组件内部再建立嵌套滚动区。

## Comparison History

1. 首轮桌面对比发现 P2：组件高 `1667px`，产品区同时展示标准价四格、备注占用基础信息一行、附件始终单列，明显偏离 Figma 的摘要密度。
2. 修复：按已确认的组件范围移除未要求的备注和标准价摘要；产品行改为“身份 + 真实售价 × 数量 + 小计”；附件在桌面改为两列，移动仍保持单列；区块节奏从 `20px` 收敛到 `16px`。
3. 修复后桌面证据：组件高度降为 `1372px`，五段层级、产品卡、金额强调和附件密度均与 Figma 保持同一视觉方向。
4. 首轮移动对比发现 P2：`AmountDisplay` 带完整 `TWD` 后缀，定金和尾款在 `146px` 内容宽度内需要横向滚动。
5. 修复：定金和尾款在窄屏使用 `12px` 等宽金额，`sm` 以上恢复 `16px`；修复后两项 `scrollWidth` 均等于 `clientWidth`，文字完整可见。
6. 最终重新捕获桌面、移动与深色主题，合并源图和实现图进行对比；没有新的 P0/P1/P2 发现。

## Implementation Checklist

- [x] 五段业务结构顺序固定且语义完整。
- [x] 销售总价、约定定金、约定尾款层级清晰。
- [x] 桌面 `460px`、移动 `390px` 均无横向溢出。
- [x] 附件桌面两列、移动单列，图片可预览并具有非空 `alt`。
- [x] 空产品、空附件和空文本状态保留稳定区块。
- [x] 浅色、深色主题均使用项目 token。
- [x] 浏览器控制台无 warning/error。
- [x] 页面提交、校验、API、Store 和 Object URL 生命周期未进入组件职责。

final result: passed
