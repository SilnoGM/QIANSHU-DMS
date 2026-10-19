# 登录页重做设计说明

> 状态：方案与原型，待确认后实施。<br>
> 日期：2026-10-19。<br>
> 范围：只改登录页的界面与登录表单交互，不新增认证能力、不调整服务端契约。<br>
> 原型：[`prototype.html`](./prototype.html)。<br>
> 另一版不分栏的「居中档案版」：[`design-centered.md`](./design-centered.md) / [`prototype-centered.html`](./prototype-centered.html)。<br>
> 第三版「悬浮画布版」：[`design-canvas.md`](./design-canvas.md) / [`prototype-canvas.html`](./prototype-canvas.html)。<br>
> 第四版「业务拼贴版」：[`design-collage.md`](./design-collage.md) / [`prototype-collage.html`](./prototype-collage.html)。

## 1. 结论

推荐 **方案 A：非对称左右分栏**。

- 左侧约 40%（最大 560px）为品牌栏：使用现有 `--primary` 派生深绿到翠绿的微渐变、白色 Logo 底板、放大的产品名与 `QIANSHU DMS` 副标；中部放 Slogan 和业务范围，底部显示「内部业务数据工作台 · v0.8.4版」并与右侧版权对齐。
- 右侧为浅锌背景与 520px 白色表单卡（内容区 424px）：标题、说明、带 label 的账号/密码、全局错误提示、44px 主按钮「登录系统」。
- 小于 1024px 时收为「紧凑品牌头 + 表单主体」，表单直接贴在页面上，不再显示 Slogan、圆环与卡片边框，仅保留极低强度点阵与底部版本说明，保证 390×844 下登录按钮在首屏内。
- 保留现有主题 token、Noto 字体、Fa 组件、6/8/12px 圆角体系；不引入新依赖。
- 移除登录页右上角的布局切换、语言和主题入口。它们是 Fantastic-admin 演示控制，不是业务功能。

方案 B「居中卡片」作为备选：整页浅锌背景、品牌 lockup 在卡片上方、520px 卡片居中。原型中可切换对比，但推荐 A，因为产品名、版本和品牌色需要在首屏形成稳定识别，而登录表单本身信息量很少，纯居中卡片会显得空。

方案 C「维持左右各半 + 蓝色插画」不推荐：插画色系与主绿冲突，移动端把表单推到首屏之外，且视觉上更像模板演示页。

## 2. 现状勘察

### 2.1 实现位置

| 职责 | 文件 |
| --- | --- |
| 登录页外壳、品牌区、插画、布局切换、版权挂载 | [`web/apps/qsmds-arco/src/views/login.vue`](../../web/apps/qsmds-arco/src/views/login.vue) |
| 登录表单、校验、错误提示、提交状态 | [`web/apps/qsmds-arco/src/components/AppAccountForm/login.vue`](../../web/apps/qsmds-arco/src/components/AppAccountForm/login.vue) |
| 密码可见性切换、输入框组合 | [`web/packages/components/src/basic/input/index.vue`](../../web/packages/components/src/basic/input/index.vue) |
| 品牌 Logo、插画资源 | [`logo.svg`](../../web/apps/qsmds-arco/src/assets/images/logo.svg)、[`login-banner.svg`](../../web/apps/qsmds-arco/src/assets/images/login-banner.svg) |
| 版权数据与开关 | [`settings.ts`](../../web/apps/qsmds-arco/src/settings.ts) |
| 登录路由 meta | [`routes.ts`](../../web/apps/qsmds-arco/src/router/routes.ts) |

### 2.2 当前布局与视觉

桌面默认 `layoutAlign = 'right'`（`login.vue:40`）：

- 左侧 `.login-banner` 由 `flex: 1` 撑开，1440px 下实测 **796×900px**；右侧 `.login-form` 固定 500px（`login.vue:253-256`），表单内容实际宽 **404px**，位于 `x=916` 到 `1320`。
- 左侧是 `bg-muted` 底、两层 100px 模糊径向渐变、蓝色系 SVG 插画；表单区右侧为纯白，没有卡片边界。
- 品牌 lockup 位于左上角：40px Logo、20px 粗体产品名、12px 版本 Badge（`login.vue:105-109`），版本 Badge 外层被强制为 40px 高（`login.vue:259-277`）。
- 表单：36/40/700 的「欢迎登录」+ 14px 产品名；两个 42px 高输入框，只有 placeholder 和前置图标；40px 主按钮（`AppAccountForm/login.vue:113-148`）。
- 右上角只有一个 42×42px 的布局切换按钮，无可见文字、无 `aria-label`（`login.vue:69-87`）。语言、主题、明暗入口在当前 settings 下不显示。
- 窄屏 `data-mode="mobile"` 时，品牌与插画在上、表单在下；插画宽度放大到 `min(127%, 480px)`（`login.vue:134-176`）。390×844 实测：插画区 452px、表单区 440px、文档高 **892px**，登录按钮位于 `y=776-816`。
- 版权：`settings.app.copyright.enable = false`（`settings.ts:15-20`），登录路由没有 `meta.copyright`，因此 `login.vue:111` 和 `117` 的 `AppCopyright` 实际不渲染。
- 明暗：页面支持 `html.dark`，但 Logo SVG 含纯黑描边、插画保持白/蓝/薄荷色；暗色下左侧接近黑色，Logo 黑色轮廓几乎消失，插画高亮区域反而成为焦点。

### 2.3 当前交互

- 校验：`username` 必填，`password` 必填且按 Unicode 码点长度限制 8–20（`AppAccountForm/login.vue:28-37`）。`FaFormItem` 默认在 blur 和 value update 时校验；提交时校验全部字段。
- 错误：字段错误由 `FaFormItem` 渲染在输入框下方；账号/密码错误、429、503、网络错误统一放进 `AAlert`，位置在标题与表单之间（`login.vue:122-129`）。
- 提交：`loading` 同时用于按钮 loading 和 disabled，代码层还有 `if (loading.value) return` 防重复（`login.vue:68-90`）；但输入框没有 disabled，提交期间仍可编辑。
- 密码可见性：由 `FaInput` 内置按钮提供，只在 `!!value` 时出现（`input/index.vue:83`）；点击后在 `password`/`text` 之间切换（`input/index.vue:84`）。
- 结果未知：`isUnknownResult` 将网络错误和所有 `>=500` 视为结果未知（`login.vue:54-66`），`AAlert` 出现「检查登录状态」mini 按钮。
- 回车提交：`FaForm` 渲染真实 `<form>`，输入框内回车可提交；这是现有正确行为，保留。

## 3. 问题诊断

### 3.1 视觉观感

1. **品牌色断裂。** `login.vue:110` 使用 `login-banner.svg`，插画主色是蓝 `#4B5BF0` 附近、浅蓝 `#A1BEF7`、薄荷 `#49E5DB`；而主按钮和导航主色是绿 `oklch(0.527 0.154 150.069)`。同一屏出现两套品牌色，用户第一眼看到的蓝色插画与「千树」的绿色品牌没有关系。
2. **背景被洗成灰雾。** `login.vue:121-132` 和 `login.vue:232-243` 重复声明同一组径向渐变，`filter: blur(100px)`、`background-size: 200vw 200vh`。实测左侧大面积是低对比灰白雾，既没有形成品牌图形，也没有为插画提供稳定底色；右侧纯白，整页缺少清晰的前后层次。
3. **层级倒置。** 标题 `36px/700`（`AppAccountForm/login.vue:115`）是视觉最强元素；真正需要用户操作的输入框只有 14px placeholder、没有 label、没有必填标识（`AppAccountForm/login.vue:131-144`）。用户先看到装饰性欢迎语，再猜测两个框分别是什么。
4. **桌面左右比例失衡。** 1440px 下插画区 796px、表单列 500px，但表单内容仅 404px；右侧有 500px 容器和 404px 内容的两层留白，左侧又用大面积灰雾托一张插画。没有卡片或分隔来定义「登录区域」，页面像两个互不相关的半屏。
5. **品牌 lockup 太弱。** 40px Logo、20px 产品名和 12px 版本 Badge 挤在 796px 宽的品牌区左上角（`login.vue:105-109`）；版本 Badge 还被 `.login-version-badge { height: 40px }`（`login.vue:259-269`）强行拉到与文字块同高，实际文字只有 12px，视觉上是一个悬空的小胶囊。
6. **暗色不可用。** `logo.svg` 的大量路径是 `fill="rgb(0,0,0)"`；暗色下左侧面板接近黑色，Logo 的黑色轮廓和文字消失。插画则保持亮白/亮蓝，成为整屏最亮区域。实测暗色截图中品牌识别明显弱于亮色。
7. **右上角演示控件破坏完整性。** `login.vue:69-102` 是一个 42×42px 带边框的容器，里面只有一个无文字、无 `aria-label` 的布局图标；窄屏下所有内部控件隐藏后，容器仍保留，实测变成 **10×10px 的空边框方块**（`x=353,y=16`）。这是一个可见的样式缺陷，也让页面像开发预览而不是正式产品。
8. **入场动效只作用于标题。** `FaBlurReveal` 只包住「欢迎登录 + 产品名」（`AppAccountForm/login.vue:114-121`），表单字段和按钮直接出现；标题还在模糊淡入时输入框已经可操作，动效不完整，还会让文字短暂模糊。

### 3.2 布局与信息组织

1. **placeholder 替代 label。** `AppAccountForm/login.vue:131-144` 两个 `FaFormItem` 都没有 `label`，也没有 `required`。输入后 placeholder 消失，用户无法回看字段名；`FaFormItem` 本身支持 `label`、`required`、`aria-required`、错误关联（`FormItem.vue:229-247`、`258-272`），但当前没有使用。这违反《UI 设计规范》第 5 节「placeholder 不替代 label」。
2. **必填状态不可见。** 两个字段实际都必填，但页面没有任何必填标识，也没有 `aria-required`；屏幕阅读器只能从校验错误推断。`FaFormItem required` 会自动渲染红色星号并设置 `aria-required`，应直接使用。
3. **产品名重复且信息效率低。** 左上角品牌区已有产品名（`login.vue:107`），表单标题下又重复一次（`AppAccountForm/login.vue:118-120`）；版本号只在左上角，版权完全不显示。结果是最重要的「产品名 + 版本 + 版权」没有形成一组稳定信息，而是产品名出现两次、版权缺失。
4. **窄屏首屏放不下主操作。** 390×844 实测文档高 892px，登录按钮 `y=776-816`；真实手机浏览器去掉地址栏和底部工具栏后可视高度通常约 700px，按钮已经在首屏之外。插画区 452px、表单区 440px，插画占比超过一半。
5. **窄屏缺少紧凑品牌头。** 移动端仍使用桌面品牌 lockup + 大幅插画，没有为「先登录」重排；插画宽度 `min(127%, 480px)` 还会被父级裁切，视觉重心在插画而不是表单。
6. **版权逻辑是死代码。** `views/login.vue:111` 和 `117` 都挂了 `AppCopyright`，但 `settings.ts:16` 关闭版权、路由也没有 `meta.copyright`，两个节点永远不渲染；登录页没有任何版权信息。
7. **模板多根节点。** `views/login.vue` 模板同时渲染 `.bg-banner`、右上角控件、`.login-box` 和 `AppCopyright` 四个根节点。登录路由当前不在业务布局内时未必立刻出问题，但这与项目「页面必须单根节点」的约定不一致，重构时应统一成一个根节点。
8. **版本号语义弱。** `v0.8.4` 被当成 Badge 展示在品牌名右侧，没有说明它是构建版本；版本号适合与产品名解耦，作为较低对比度的构建信息展示，而不是和产品名竞争。

### 3.3 交互与反馈

1. **全局错误位置会推走主按钮。** `AAlert` 位于标题和表单之间（`AppAccountForm/login.vue:122-129`），出现时会把两个输入框和按钮整体下推。窄屏原本按钮已在 `y=776-816`，再加一条约 60px 的 Alert，按钮会跌出 844px 视口。
2. **错误组件混用两套体系。** 表单和主按钮是 Fa 组件，错误块却用 Arco `AAlert` + `AButton size="mini"`（`AppAccountForm/login.vue:122-129`）；mini 按钮只有 24px 左右，与 44px 输入框、40px 主按钮不成比例，错误块的操作区看起来像另一个系统的控件。
3. **全局错误不会在输入时清除。** `errorMessage` 只在 `onSubmit` 开始时清空（`AppAccountForm/login.vue:73`）。用户看到「用户名或密码错误」后开始修改密码，旧错误一直挂在页面上方，直到再次提交，反馈滞后。
4. **失败后清空密码但不移动焦点。** `catch` 中无条件 `model.value.password = ''`（`AppAccountForm/login.vue:83`），但焦点仍停留在登录按钮；键盘用户要继续输入密码，必须重新 Tab 回密码框。凭证错误时把焦点放回密码框是更直接的恢复路径。
5. **提交期间输入框仍可编辑。** `loading` 只绑定到按钮（`AppAccountForm/login.vue:145`），`FaInput` 没有 disabled，提交过程中用户仍能改动账号或密码；同时没有 `aria-busy`，屏幕阅读器不知道表单正在提交。按钮文字也保持「登录」，只靠 spinner 表达状态。
6. **密码可见性切换存在四个具体问题。**
   - 无 accessible name：`input/index.vue:83` 的 `Button` 没有 `aria-label`，快照中只是一个匿名 `button`。
   - 只在有值时出现：`!!value` 条件让空密码框没有切换入口，用户无法在输入前确认当前是隐藏状态。
   - 图标语义反了：`type === 'password'` 时显示 `eye-off`，点击后显示 `eye`（`input/index.vue:84`）；从「显示密码」的动作语义看，隐藏时应显示 `eye`，显示时应显示 `eye-off`。
   - 清空后状态不复位：`type` 是独立 `ref`，用户点开密码后把内容删空，按钮消失但 `type` 仍是 `text`；再输入的新密码会默认明文显示。这是共享组件层面的真实缺陷，影响所有密码输入。
7. **首个错误不会获得焦点。** `FaForm` 支持 `invalidSubmit` 和 `scrollToError`，但当前没有绑定（`AppAccountForm/login.vue:130`）；提交空表单后错误出现在字段下方，焦点仍在按钮，键盘用户需要自己找第一个错误。
8. **「检查登录状态」没有进行中状态。** `checkLoginState`（`AppAccountForm/login.vue:92-109`）直接调用 `revalidateAfterMutation`，按钮没有 loading/disabled；连续点击会重复发起检查，用户也看不到检查正在进行。
9. **密码校验文案偏技术。** 「密码长度应为 8 至 20 个字符」（`AppAccountForm/login.vue:35`）在登录场景是对的，但错误只在提交/blur 后出现，且没有 label 和必填提示配合；用户可能先看到一条长度规则，才意识到字段是空的。
10. **回车提交是现有正确行为。** `FaForm` 使用真实 `<form>`，输入框内回车会触发 submit；本次保留，不需要额外实现。

## 4. 设计方案

### 4.1 视觉

| 项目 | 方案 |
| --- | --- |
| 主色 | 沿用 `--primary`，在品牌栏内用 `color-mix` 形成深绿→主绿→翠绿的微渐变；主按钮保持纯 `--primary`，与背景形成区分 |
| 基础色 | 沿用 zinc `--background`、`--foreground`、`--muted`、`--border`、`--input`、`--ring` |
| 字体 | 普通中文 `--qs-font-sans`（Noto Sans SC）；版本号随底部说明展示，不再单独使用 mono 胶囊 |
| 品牌栏 | 深绿→翠绿 `linear-gradient(155deg, …)` + 右下角柔和径向高光；`color: oklch(var(--primary-foreground))`；宽 `clamp(380px, 40%, 560px)`；底部 padding 20px |
| 品牌纹理 | 右下角 CSS 点阵 + 多层同心圆环，均用 `primary-foreground` 低透明度绘制；不再放大 `logo.svg`，没有矢量化锯齿 |
| 品牌名 | 22/30/600；比现状 18px 明显放大，与 48px Logo 底板形成稳定 lockup；`QIANSHU DMS` 副标 12/16、字距 0.16em |
| 中部内容 | 40×2px 白色短线 + Slogan「产品流转与资金同频 / 业务协同与财务一体」28/38/600 + 「销售 · 采购 · 仓储 · 财务」15/24；整体上移到面板约 45% 高度，缩小 Logo 到 Slogan 的空白 |
| Logo 底板 | 48×48px 白色圆角 12px 方块，内部 Logo 36px；白色底板同时解决暗色下黑色描边消失的问题 |
| 表单区 | 浅锌 `oklch(var(--muted) / 42%)`；表单卡 520px、白色、1px 边框、12px 圆角、极轻阴影 |
| 表单卡内边距 | 桌面 `52px 48px`（内容区 424px）；窄屏去掉边框和阴影，改为页面内 4px 横向内边距 |
| 标题 | 「欢迎登录」24/32/600；按钮为「登录系统」，避免标题与按钮完全重复；说明 14/20/400 muted |
| 字段 | label 14/20/500 + 红色 `*`；账号 label/placeholder 统一为「账号 / 请输入账号」；密码 placeholder 为「请输入登录密码」；输入框 44px、6px 圆角、16px 前置图标；错误/帮助区固定 18px 高 |
| 主按钮 | 44px、6px 圆角、`--primary` 底；文案「登录系统」，loading 时为「登录中…」；hover 加深 10%，active 加深 16% 并下沉 1px |
| 版本 | 顶部胶囊移除；版本并入底部说明「内部业务数据工作台 · v0.8.4版」，12/18，与右侧版权同一基线 |
| 版权 | 12/18、muted 78%、居中；桌面固定在表单面板底部；左侧底部说明同为 12/18、padding-bottom 20px，左右底边同一基线 |
| 动效 | 不使用标题局部 blur reveal；如需入场，只对整张卡片做 150–180ms opacity/translate，并尊重 `prefers-reduced-motion` |

视觉上最重要的变化是 **把蓝色插画换成品牌渐变绿 + 中部 Slogan + 平滑几何纹理**。纹理完全由 CSS 绘制，不新增插画资产，也不会出现放大 Logo 时的边缘锯齿。

英文副标 `QIANSHU DMS` 与「销售 · 采购 · 仓储 · 财务」是可选排版层：前者用于建立品牌层级，后者用事实说明工作台范围；分隔符统一为 `·`。若品牌侧不希望出现英文或范围需调整，实施时可直接替换，不影响布局。

### 4.2 布局与信息组织

#### 桌面（> 1024px）

```text
┌──────────────────────────────┬──────────────────────────────────────┐
│ 品牌栏 40%（最大 560px）      │ 表单区（浅锌背景）                    │
│  [Logo] 千树数据管理系统       │                                      │
│  QIANSHU DMS                 │          ┌────────────────────┐      │
│                              │          │ 欢迎登录            │      │
│  ────                        │          │ 使用管理员分配...    │      │
│  产品流转与资金同频           │          │ 账号 *              │      │
│  业务协同与财务一体           │          │ [输入框]            │      │
│  销售 · 采购 · 仓储 · 财务    │          │ 密码 *              │      │
│                              │          │ [输入框]  [眼睛]     │      │
│                              │          │ [登录系统]          │      │
│  内部业务数据工作台 · v0.8.4版 │          └────────────────────┘      │
│                              │  Copyright © ...                     │
└──────────────────────────────┴──────────────────────────────────────┘
```

- 左侧不是「空插画区」，而是「顶部品牌 lockup + 中部 Slogan/业务范围 + 底部说明」三段式；中部内容上移到面板约 45% 高度，底部说明与右侧版权同一基线。
- 右下角是低透明度点阵 + 同心圆环，仅作为几何纹理；不再使用放大 Logo 水印，避免粗糙边缘。
- 右侧用不对称比例把视觉重心让给表单；卡片 520px、内容区 424px，桌面 1440px 下按钮与输入框同宽。
- 表格数据未变，登录页不需要 `FaPageMain` 等业务页容器；使用独立页面布局是合理的。

#### 窄屏（< 1024px）

- 品牌栏收成约 96px 的紧凑头部：42px Logo + 16px 产品名 + 底部「内部业务数据工作台 · v0.8.4版」；隐藏中部 Slogan、业务范围、圆环和 `QIANSHU DMS` 副标，仅保留极低强度点阵。
- 表单区改为白底、无卡片边框、20px 横向内边距；标题 24px、字段 44px、按钮 44px。
- 390px 宽原型实测：按钮距登录页顶部约 408–452px，版权约 480–516px，页面无横向溢出；相比现状按钮 `y=776-816`，主操作回到首屏内。
- 断点与框架移动模式一致（`store/modules/app/settings.ts:177` 的 `width < 1024` 进入移动布局），避免登录页和业务页的响应式判断分叉。原型用容器查询支持 390px 设备框；实际实现使用 `max-width: 1023px` 媒体查询。

#### 字段排布与必填

- 两列纵向排列，顺序为账号 → 密码；不改成一行两列，登录字段是顺序输入关系，横向排列会增加视线移动。
- 使用 `FaFormItem` 的 `label` 与 `required`：label 在字段上方，红色 `*` 跟在文字后，`aria-required` 自动设置；错误消息仍由 `FaFormItem` 输出在字段下方，并保留 18px 反馈区，避免出现错误时整张卡跳动。
- 账号字段的 label 与 placeholder 统一为「账号 / 请输入账号」，字段错误文案为「请输入账号」；密码 placeholder 为「请输入登录密码」，字段错误文案为「请输入密码」。
- 登录页只校验必填，不展示也不校验 8–20 位密码规则；密码输入保留 20 字符上限，避免超长请求，实际凭证判断交给服务端。设置/修改密码页继续保留 8–20 规则。
- 保留前置用户/锁图标；图标是弱提示，不替代 label。
- 密码框右侧保留可见性按钮，建议常显（见待确认问题）。

#### 辅助信息

- **产品名称与 Logo**：品牌栏顶部一组，移动端同一组缩小；表单区内不再重复产品名。
- **Slogan 与业务范围**：品牌栏中部一组，Slogan 使用 28px，业务范围使用 `·` 分隔；这是视觉重心，不参与业务操作。
- **版本号**：顶部胶囊移除，版本并入底部说明「内部业务数据工作台 · v0.8.4版」；值继续取构建期 `__SYSTEM_INFO__.pkg.version`，不要写死。居中方案在品牌 lockup 下方显示同一句说明。
- **版权**：桌面放在表单面板底部，移动端放在表单下方；文案取 `settings.app.copyright.dates/company`，颜色用 muted、12px，不使用低对比 50% 灰。左侧底部说明同为 12/18、padding-bottom 20px，和右侧版权同一底边。登录页单独渲染，不打开全局 `copyright.enable`，避免其他页面突然出现版权行。
- **右上角控件**：移除布局切换、语言、主题和明暗入口。若后续确实需要在登录页切换语言，应作为正式需求单独设计，而不是复用演示控件。

### 4.3 交互与反馈

#### 校验时机与提示位置

- **blur**：字段失焦时校验该字段，错误出现在字段下方固定反馈区。
- **submit**：校验全部字段；若有错误，把焦点移到第一个无效字段，并保持其错误可见。
- **输入中**：如果该字段已经有错误，随输入重新校验，错误在用户修正后立即消失；未出错的字段不在每次按键时打扰用户。
- 登录页密码只校验必填，不做 8–20 长度校验；错误文案使用「请输入密码」。
- 全局认证错误在用户修改任一字段时清除，避免旧错误一直挂着。

#### 提交加载与防重复

- 提交开始：`loading = true`；按钮禁用、文字变「登录中…」并显示 spinner；两个输入框和密码可见性按钮同时禁用；`form` 设置 `aria-busy="true"`。
- 代码继续保留 `if (loading) return`，与按钮 disabled 双重防重复。
- 失败后先释放 loading，再恢复输入；成功跳转由现有 `emits('onLogin')` 和路由处理，不新增成功弹窗。
- 不使用全屏遮罩，登录表单区域小，局部禁用足够。

#### 错误反馈

| 场景 | 展示位置 | 文案 / 动作 |
| --- | --- | --- |
| 账号空 | 字段下方 | 请输入账号 |
| 密码空 | 字段下方 | 请输入密码 |
| 401 凭证错误 | 表单内全局 Alert（标题与字段之间） | 账号或密码错误；清空密码并把焦点移回密码框 |
| 429 限流 | 全局 Alert | 操作过于频繁，请稍后重试；不显示「检查登录状态」 |
| 503 认证不可用 | 全局 Alert | 认证服务暂时不可用 / 认证服务繁忙，请稍后重试；提供「检查登录状态」 |
| 网络错误 | 全局 Alert | 网络连接失败，请稍后重试；提供「检查登录状态」 |
| 结果未知（网络/5xx） | 全局 Alert | 保留原错误 +「检查登录状态」；检查中禁用并显示「检查中…」 |
| 检查后仍未登录 | 全局 Alert | 当前仍未登录，可稍后再次检查或重新输入密码登录 |
| 改密结果未知 | 全局 Alert | 沿用现有「修改结果未知，请优先使用刚设置的新密码登录」 |

- 服务端 401 仍按现有契约返回 `INVALID_CREDENTIALS` 和「用户名或密码错误」；登录页展示层将已知凭证错误统一显示为「账号或密码错误」，不改 API 或错误码。
- 登录页不再展示密码长度规则；密码输入保留 20 字符上限，避免超长请求，低于 8 位的错误密码交给服务端统一返回凭证错误。
- 全局 Alert 使用 Fa 体系（`FaAlert variant="destructive"` 或同 token 的本地提示块），不再混用 `AAlert`/`AButton`；图标用 `i-lucide:circle-alert`，操作按钮用文字按钮，不使用 24px mini 按钮。
- Alert 放在标题/说明之后、字段之前，保持与表单的阅读顺序；出现时允许卡片变高，但不遮住主按钮，窄屏仍需保证按钮可见。
- 401 后密码清空并聚焦密码框；账号保留。429/503 是否保留密码见待确认问题。

#### 密码可见性与回车

- 密码可见性按钮常显，带 `aria-label`（显示密码/隐藏密码）和 `aria-pressed`；隐藏状态用 `eye`，显示状态用 `eye-off`。
- 清空密码时自动回到隐藏状态，避免下一次输入默认明文。
- 按钮 `type="button"`，不会触发提交；点击后把焦点放回密码输入框，方便继续输入。
- 回车提交保持现状：真实 `<form>` + 默认 submit；密码可见性按钮是 `type="button"`，不会拦截回车。

#### 可访问性

- 每个输入框有真实 `<label for>`，`required` 同时产生红色星号和 `aria-required`。
- 错误消息通过 `aria-describedby` 关联；字段错误用 `aria-live="polite"`，全局错误容器 `role="alert"`。
- 所有纯图标按钮有 accessible name；版本、版权是文本，不依赖颜色表达。
- 焦点可见：输入框使用 `--ring` 焦点环，主按钮使用 primary 焦点环；Tab 顺序为账号 → 密码 → 可见性 → 登录。
- `prefers-reduced-motion` 下关闭非必要过渡和 spinner 之外的动画。

## 5. HTML 原型

- 文件：[`specs/login-redesign/prototype.html`](./prototype.html)
- 预览方式（在仓库根目录）：

```bash
python3 -m http.server 9020 --bind 127.0.0.1
# 打开 http://127.0.0.1:9020/specs/login-redesign/prototype.html
```

原型顶部有一条「原型控制」，不属于登录页设计，用于切换：

- 布局：分栏（推荐）/ 居中卡片。
- 主题：亮色 / 暗色。
- 状态：正常 / 校验 / 凭证错误 / 服务不可用 / 提交中。
- 视口：桌面 / 390px 设备框。

原型已按本轮反馈调整：品牌名放大到 22px、`QIANSHU DMS` 提到 12px、顶部版本胶囊移除并并入底部说明、Slogan 改为「产品流转与资金同频 / 业务协同与财务一体」并上移到面板约 45% 高度、业务范围字号提到 15px、主按钮改为「登录系统」、登录卡 520px（内容区 424px，padding `52px 48px`）、左右底部说明同一基线。

原型已实际检查：1440×900 分栏与居中、暗色分栏、390×780 窄屏、校验/凭证错误/服务不可用/提交中状态；390px 下无横向溢出，登录按钮在首屏内。1440px 实测登录卡 `520×434`、内容区约 424px；Slogan 文字块中心位于品牌栏约 45% 高度；左侧底部说明（含版本）与右侧版权均为 12/18，`y=862`、`bottom=880`。390px 下品牌头高约 96px，按钮距页面顶部约 408–452px，版本说明保留在品牌头底部。1025px 下卡片 520px，左右各保留约 48px，页面无横向溢出。原型中的 Logo 使用仓库相对路径引用 `web/apps/qsmds-arco/src/assets/images/logo.svg`，请从仓库根目录启动静态服务预览。

## 6. 改动清单与影响范围

| 文件 / 组件 | 改动 | 影响 |
| --- | --- | --- |
| `web/apps/qsmds-arco/src/views/login.vue` | 重写为单根布局：品牌栏 + 表单面板 + 登录版权；删除 `layoutAlign`、布局切换、语言/主题控件、`bg-banner`、插画、`FaBlurReveal` 外壳；保留 `appTitle`、`appVersion`、`redirect`、`handleLogin` | 仅登录页视觉与布局；不影响业务路由 |
| `web/apps/qsmds-arco/src/components/AppAccountForm/login.vue` | 使用 `FaFormItem label/required`；账号/密码文案统一；密码只校验必填、移除 8–20 提示与校验；401 展示层映射为「账号或密码错误」；全局错误改 Fa 体系；提交时禁用输入并 `aria-busy`；错误清除/聚焦密码；检查登录状态加 loading；标题改 24px 语义；按钮文案改「登录系统」，loading 时为「登录中…」 | 登录表单行为；`autocomplete` 保持，按钮文案变更需同步浏览器认证测试 |
| `web/apps/qsmds-arco/test/browser/auth.browser.test.mjs` | 登录按钮查找依赖 `textContent === '登录'`；文案改为「登录系统」后需同步更新，或改用稳定 test id | 浏览器认证套件；不更新会找不到登录按钮 |
| `web/packages/components/src/basic/input/index.vue` | 建议修复密码可见性按钮：常显、`aria-label`、`aria-pressed`、图标语义、清空复位 | **共享组件**，影响所有密码输入（登录、修改密码、用户新建/重置密码）；需确认是否本轮一并修 |
| `web/apps/qsmds-arco/test/views/typography-consumers.test.ts` | 当前断言 h3 文本「欢迎登录」且使用 `qs-type-auth-display`；标题改为 24px 后需同步更新断言 | 静态排版契约；不更新会失败 |
| `web/apps/qsmds-arco/src/assets/images/login-banner.svg/png` | 不再被登录页引用；**保留文件**，删除需另行确认 | 无运行时影响 |
| `web/apps/qsmds-arco/src/settings.ts` / `router/routes.ts` | 若采用登录页自定义版权 footer，则不需要改；如要复用 `AppCopyright`，需给登录路由加 `meta.copyright: true` | 不改全局版权开关，避免其他页面变化 |
| 服务端 / OpenAPI / 数据库 | 无改动 | 登录接口、错误码、限流策略均不变 |

### 风险与注意

- **共享 FaInput 变更**是本次唯一跨页面影响面；如果不修，登录页的密码可见性仍会缺少 accessible name，且清空后可能明文。建议单独确认后一起修。
- 登录页当前有中文硬编码文案（「请输入账号」「账号或密码错误」等）。本次不新增 i18n key 可以保持范围最小；若要严格遵循新文案进 i18n 的规范，需要同步补 locales。
- 登录页不再引用插画后，`login-banner.*` 会成为未使用资产；按项目规则不直接删除，等确认。
- 暗色需要检查品牌栏、卡片、输入框、错误块和版权；原型已用 `html.dark` 验证，但实现后仍应在真实主题切换下走一遍。
- 移动端需补安全区：表单面板底部 `padding-bottom: max(32px, env(safe-area-inset-bottom))`，避免版权或按钮被系统手势区遮挡。

## 7. 验收清单

- [ ] 1440×900、1025×900、1024×900、768×900、390×844 五个尺寸无横向溢出。
- [ ] 390×844 下登录按钮和版权在首屏内；输入法弹出前后按钮可用。
- [ ] 亮色/暗色下品牌栏、Logo、卡片、输入框、错误块、主按钮对比度可读。
- [ ] 空用户名、空密码、短密码分别在 blur 和 submit 时给出字段错误；首个错误获得焦点。
- [ ] 401、429、503、网络错误分别展示正确文案；结果未知时「检查登录状态」可用且有进行中状态。
- [ ] 提交期间按钮、输入框、密码可见性按钮均 disabled，`aria-busy` 正确；连续点击/回车不重复提交。
- [ ] 密码可见性按钮有 accessible name，图标与状态一致；清空密码后回到隐藏状态。
- [ ] 账号/密码 `autocomplete` 保持 `username` / `current-password`，浏览器密码管理器可填充。
- [ ] 登录后跳转 `redirect` 行为不变；浏览器认证套件通过。
- [ ] 更新排版静态测试；按需补一条登录页浏览器测试覆盖校验、加载和错误态。

## 8. 待确认问题

1. **布局选型**：确认采用方案 A（左侧品牌栏 + 右侧表单卡），还是方案 B（整页居中卡片）。原型可切两种对比。
2. **移除演示控件**：是否同意删掉登录页右上角的布局切换（以及不再渲染的语言/主题入口）？建议删除，避免生产登录页出现无标签开发控件和 10×10 空框。
3. **版权展示**：是否同意登录页单独展示版权（使用现有 `settings.app.copyright` 数据，不改全局开关）？若不需要，可只保留版本号。
4. **FaInput 共享修复**：是否允许本轮修改 `web/packages/components/src/basic/input/index.vue`，让密码可见性按钮常显、带 `aria-label`、图标语义正确、清空后复位？该改动会影响所有密码输入。
5. **失败后的密码保留**：401 明确清空密码并聚焦密码框；429 限流是否保留用户已输入的密码以便稍后重试？当前实现是所有失败都清空。建议 401/结果未知清空，429 保留。
6. **文案与副标**：确认 Slogan「产品流转与资金同频 / 业务协同与财务一体」和 `QIANSHU DMS` 副标是否保留；如需调整 Slogan 措辞，直接在实施前替换。登录卡当前为 520px 外宽 / 424px 内容宽。
