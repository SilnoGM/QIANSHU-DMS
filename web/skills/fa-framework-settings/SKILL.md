---
name: fa-framework-settings
description: 管理和配置 Fantastic-admin 框架设置。当用户提到以下任何需求时必须使用此技能：开启/关闭水印、锁屏、错误日志、更新检查、哀悼模式、移动端访问；切换暗色/亮色/跟随系统主题；修改主题同步、亮色/暗色主题、亮色/暗色基础色；修改菜单模式（侧边栏/顶部/精简/面板）；配置标签栏风格（fashion/card/square）；启用/禁用工具栏功能（收藏夹、面包屑、搜索、通知、国际化、全屏、刷新）；设置版权信息；配置认证/权限/登录过期；调整页面切换动画；配置居中布局；修改路由模式；以及任何涉及应用 `src/settings.ts` 的修改。
---

# 框架设置

## 第一步：确定工作区边界（必须执行）

本项目只有一个正式业务应用。普通业务需求以及用户所说的“正式应用”“业务应用”，都默认作用于 `apps/qsmds-arco`，无需重复询问应用名称；应用设置默认位于 `apps/qsmds-arco/src/settings.ts`。

- `examples/*` 可按需只读查阅。只有用户明确指定参考应用时，才把它作为处理目标；即便已点名，仍必须同时明确要求修改，才允许写入对应的 `examples/<name>`。仅要求参考或读取不构成写入授权。
- 下文所有 `apps/qsmds-arco/...` 都是正式业务需求的默认路径。获得上述参考应用写入授权后，先将目标根目录固定为用户点名的精确 `examples/<name>`，再把下文路径前缀 `apps/qsmds-arco` 替换为该目标根目录；除非用户另行明确要求，不得同时修改 `apps/qsmds-arco` 或其他 `examples/*`。
- `packages/*` 只承载跨应用稳定复用的框架能力；业务配置不得写入共享默认值。
- 如果用户给出的目标路径与上述边界冲突，先说明冲突并确认意图，不得把正式业务改动复制到参考应用。

## 核心文件

- `apps/qsmds-arco/src/settings.ts` - 默认目标配置文件（根据工作区边界映射后修改）
- `packages/settings/src/types.ts` - TypeScript 类型定义（只读参考）
- `packages/settings/src/default.ts` - 默认完整配置（禁止修改，仅供参考）

## 工作流程

1. 读取目标应用的 `src/settings.ts` 了解当前配置（正式业务默认路径为 `apps/qsmds-arco/src/settings.ts`）
2. 查阅 `packages/settings/src/types.ts` 中的类型定义了解可用选项
3. 查阅 `packages/settings/src/default.ts` 了解默认值
4. 仅修改目标应用的 `src/settings.ts`
5. 修改后检查：与默认值相同的配置项直接移除——`settings.ts` 只需保留真正自定义的内容，框架会自动继承默认配置，这样维护时一眼就能看出哪些是项目定制的

### 主题配置补充规则

当前 `theme` 配置包含：

- `sync`
- `baseColorLight`
- `baseColorDark`
- `light`
- `dark`
- `colorScheme`
- `radius`
- `colorAmblyopia`

处理主题配置时遵循：

- `baseColorLight` / `baseColorDark` 是基础色名称，取值来自 `@fantastic-admin/themes` 的 `BASE_COLORS`
- `light` / `dark` 是主题色名称，取值来自 `@fantastic-admin/themes` 的 `THEMES`
- 当 `sync: true` 时，运行时会同步亮暗两套基础色和主题色；如果用户要分开配置，必须显式设为 `sync: false`
- 只修改目标应用的 `src/settings.ts`，不要直接改 `packages/themes/index.ts`；如果用户是在“创建新主题”而不是“切换已有主题”，应改用 `fa-theme-customizer`

## 配置领域

详细配置选项请参考：
- **应用设置**: [references/app-settings.md](references/app-settings.md) - 认证、路由、功能开关、布局、主页、版权等
- **主题设置**: [references/theme-settings.md](references/theme-settings.md) - 基础色、主题色、颜色方案、主题同步、圆角、色弱模式等
- **导航菜单设置**: [references/menu-settings.md](references/menu-settings.md) - 导航菜单模式、风格、展开/收起行为、快捷键等
- **顶栏设置**: [references/topbar-settings.md](references/topbar-settings.md) - 标签栏、工具栏、显示模式等
- **标签栏设置**: [references/tabbar-settings.md](references/tabbar-settings.md) - 风格、图标、双击动作、记忆功能等
- **工具栏设置**: [references/toolbar-settings.md](references/toolbar-settings.md) - 收藏夹、面包屑、搜索、通知、国际化等
- **页面设置**: [references/page-settings.md](references/page-settings.md) - 快捷键、iframe 保活、切换动画、进度条等
