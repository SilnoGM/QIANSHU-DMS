---
name: fa-route-generator
description: 管理 Vue Router 路由配置，用于 Fantastic-admin 框架。当用户提到以下任何需求时必须使用此技能：新建页面需要加路由、详情页不想显示在菜单里、新增页和编辑页老是开两个标签、从列表跳详情返回后状态丢失、给菜单项加 NEW 标签或红点、路由需要权限控制、配置页面保活、修改路由 meta、添加面包屑配置。即使用户只是说"加个路由"或"新建了一个页面"，也应触发此技能。
---

# 路由生成器

框架通过路由自动生成导航菜单，路由配置需要遵循特定约定。

## 第一步：确定工作区边界（必须执行）

本项目只有一个正式业务应用。普通业务需求以及用户所说的“正式应用”“业务应用”，都默认作用于 `apps/qsmds-arco`，无需重复询问应用名称；路由文件默认位于 `apps/qsmds-arco/src/router/`。

- `examples/*` 可按需只读查阅。只有用户明确指定参考应用时，才把它作为处理目标；即便已点名，仍必须同时明确要求修改，才允许写入对应的 `examples/<name>`。仅要求参考或读取不构成写入授权。
- 下文所有 `apps/qsmds-arco/...` 都是正式业务需求的默认路径。获得上述参考应用写入授权后，先将目标根目录固定为用户点名的精确 `examples/<name>`，再把下文路径前缀 `apps/qsmds-arco` 替换为该目标根目录；除非用户另行明确要求，不得同时修改 `apps/qsmds-arco` 或其他 `examples/*`。
- `packages/*` 只承载跨应用稳定复用的框架能力，不能存放业务路由。
- 如果用户给出的目标路径与上述边界冲突，先说明冲突并确认意图，不得把正式业务改动复制到参考应用。

## 前置检查

读取 `apps/qsmds-arco/src/settings.ts`，检查 `app.routeBaseOn` 的值：

- `'frontend'`（默认）：可以继续
- `'backend'`：路由由后端驱动，手动创建的路由文件会被忽略，告知用户此模式不支持前端路由文件生成

## 工作流程

### 场景 A: 创建新路由

#### 1. 收集路由信息

向用户询问或确认：路由路径、页面标题、图标（可选）、是否多级路由、所属主导航分组。

#### 2. 创建路由文件

在 `apps/qsmds-arco/src/router/modules/` 下创建 `<模块名>.ts`：

```typescript
import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/example',
  component: Layout,
  name: 'example',
  meta: {
    title: '示例',
    icon: 'i-ep:menu',
  },
  children: [
    {
      path: '',
      name: 'exampleIndex',
      component: () => import('@/views/example/index.vue'),
      meta: {
        title: '示例页面',
      },
    },
  ],
}

export default routes
```

#### 3. 更新 routes.ts

在 `apps/qsmds-arco/src/router/routes.ts` 中添加 import 并注册到对应主导航分组的 `children` 数组。

### 场景 B: 修改现有路由

定位路由文件（在 `apps/qsmds-arco/src/router/modules/` 下搜索），读取后按需修改 meta 属性。常见修改：

**标签页合并**（新增页/编辑页合并到同一标签，避免开多个标签）：
```typescript
meta: { activeMenu: '/user', tabMerge: 'activeMenu' }
```

**权限控制**：
```typescript
meta: { auth: 'user:view' }  // 或数组 ['user:view', 'user:edit']
```

**页面保活**（从详情返回列表时保留列表状态）：
```typescript
// 列表页
meta: { keepAlive: ['productDetail'] }
// 详情页
meta: { menu: false, activeMenu: '/product', noKeepAlive: 'productList' }
```

**徽章**：
```typescript
meta: { badge: 'NEW' }  // 文字；或 [true, 'destructive'] 红点
```

**隐藏菜单项**：
```typescript
meta: { menu: false, activeMenu: '/parent/path' }
```

## 框架约定

- 一级路由 `path` 必须以 `/` 开头，`component` 必须是 `Layout`
- 子路由 `path` 不要以 `/` 开头
- 多级路由的中间层级无需设置 `component`
- 所有路由的 `name` 必须全局唯一

## Meta 属性配置

详细属性说明见 [references/route-meta.md](references/route-meta.md)，更多示例见 [references/examples.md](references/examples.md)。

常用属性：`title`（必需）、`icon`、`menu`、`auth`、`keepAlive`、`badge`、`activeMenu`、`tabMerge`、`breadcrumb`
