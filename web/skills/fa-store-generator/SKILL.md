---
name: fa-store-generator
description: 为 Fantastic-admin 框架生成 Pinia Store 模块。当用户提到以下任何需求时必须使用此技能：多个页面需要共享数据、全局状态管理、数据需要持久化（刷新后还在）、登录状态/用户信息需要缓存、购物车/通知/权限等全局数据、需要在组件外访问状态。即使用户只是说"这个数据要全局共享"或"刷新后数据不能丢"，也应触发此技能。触发关键词：创建 store、全局状态、状态管理、pinia、持久化、共享数据。
---

# Store Generator

## 第一步：确定工作区边界（必须执行）

本项目只有一个正式业务应用。普通业务需求以及用户所说的“正式应用”“业务应用”，都默认作用于 `apps/qsmds-arco`，无需重复询问应用名称；Store 默认位于 `apps/qsmds-arco/src/store/modules/`。

- `examples/*` 可按需只读查阅。只有用户明确指定参考应用时，才把它作为处理目标；即便已点名，仍必须同时明确要求修改，才允许写入对应的 `examples/<name>`。仅要求参考或读取不构成写入授权。
- 下文所有 `apps/qsmds-arco/...` 都是正式业务需求的默认路径。获得上述参考应用写入授权后，先将目标根目录固定为用户点名的精确 `examples/<name>`，再把下文路径前缀 `apps/qsmds-arco` 替换为该目标根目录；除非用户另行明确要求，不得同时修改 `apps/qsmds-arco` 或其他 `examples/*`。
- `packages/*` 只承载跨应用稳定复用的框架能力；业务状态不得下沉到共享包。
- 如果用户给出的目标路径与上述边界冲突，先说明冲突并确认意图，不得把正式业务改动复制到参考应用。

## 项目 Store 概览

- 位置：`apps/qsmds-arco/src/store/modules/` （业务 store）
- 全部使用 **Composition API** 风格（`defineStore` + setup 函数）
- 通过 `unplugin-auto-import` 自动导入，组件中无需手动 import
- 持久化：`pinia-plugin-persistedstate` v4，配置 `persist: { pick: [...] }`

详细模板和示例见 [references/store-patterns.md](references/store-patterns.md)

---

## 交互式工作流

先收集信息再生成代码，因为 store 的字段结构、持久化需求、异步 action 直接决定代码骨架——跳过这步会生成空壳，用户还要大量修改。

### Step 1：收集基本信息

向用户提问（可合并为一次）：

1. **Store 用途**：管理什么数据？（例如：用户信息、购物车、通知列表）
2. **存放位置**：
   - `apps/qsmds-arco/src/store/modules/` — 业务 store（推荐）
   - `apps/qsmds-arco/src/store/modules/app/` — 框架级 store（仅框架内部使用）
3. **State 字段**：需要哪些状态字段？请列出字段名、类型和初始值

### Step 2：收集功能需求

根据 Step 1 的回答，继续询问：

4. **持久化**：是否需要持久化到 localStorage？如果是，哪些字段需要持久化？
5. **异步 Action**：是否有需要调用 API 的操作？如果有，请描述接口用途
6. **Computed**：是否需要派生状态（computed）？例如：从列表中过滤、统计数量等

### Step 3：确认并生成

汇总用户的回答，展示将要生成的内容摘要，确认后再写入文件。

---

## 命名规范

| 类型 | Store ID | 函数名 | 文件名 |
|------|----------|--------|--------|
| 业务 store | `camelCase` | `use<Name>Store` | `<name>.ts` |
| 框架 store | `app<Name>` | `useApp<Name>Store` | `<name>.ts` |

示例：
- 购物车 → ID: `cart`，函数: `useCartStore`，文件: `apps/qsmds-arco/src/store/modules/cart.ts`
- 通知 → ID: `notification`，函数: `useNotificationStore`，文件: `apps/qsmds-arco/src/store/modules/notification.ts`

---

## 生成后的操作

Store 文件创建完成后，告知用户：
- 无需手动 import，`unplugin-auto-import` 已自动处理
- 在任意组件/composable 中直接使用：`const xxxStore = useXxxStore()`
- 如需在 store 外部（如路由守卫）使用，需传入 pinia 实例：`useXxxStore(pinia)`
