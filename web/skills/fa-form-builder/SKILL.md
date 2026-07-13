---
name: fa-form-builder
description: "为 Fantastic-admin 框架生成独立的表单页面，使用 FaForm/FaFormItem + vee-validate + zod 验证，表单 model 使用 ref，全部使用框架内建 Fa* 组件。当用户说：'帮我做一个用户信息填写页'、'我只需要一个提交表单，不需要列表'、'做个设置页面，有几个输入框和保存按钮'、'生成一个注册/编辑/配置表单页'、'只要表单页，不需要增删改查'，即使用户只是说'做个表单页面'也应触发此技能。"
---

# 表单页面生成器

在 Fantastic-admin 框架中生成独立的 Router 表单页面，使用 `FaForm/FaFormItem` 承接 vee-validate + zod 表单验证。

**生成的文件：**
- `apps/qsmds-arco/src/views/{path}/{name}/index.vue` — 表单页面（含验证、提交骨架、固定操作栏）

---

## 第一步：确定工作区边界（必须执行）

本项目只有一个正式业务应用。普通业务需求以及用户所说的“正式应用”“业务应用”，都默认作用于 `apps/qsmds-arco`，无需重复询问应用名称；表单页面默认位于 `apps/qsmds-arco/src/views/`。

- `examples/*` 可按需只读查阅。只有用户明确指定参考应用时，才把它作为处理目标；即便已点名，仍必须同时明确要求修改，才允许写入对应的 `examples/<name>`。仅要求参考或读取不构成写入授权。
- 下文所有 `apps/qsmds-arco/...` 都是正式业务需求的默认路径。获得上述参考应用写入授权后，先将目标根目录固定为用户点名的精确 `examples/<name>`，再把下文路径前缀 `apps/qsmds-arco` 替换为该目标根目录；除非用户另行明确要求，不得同时修改 `apps/qsmds-arco` 或其他 `examples/*`。
- `packages/*` 只承载跨应用稳定复用的框架能力；表单页面和业务校验不得下沉。
- 如果用户给出的目标路径与上述边界冲突，先说明冲突并确认意图，不得把正式业务改动复制到参考应用。

---

## 工作流程

### Step 1：收集基本信息

向用户询问（可合并为一次提问）：

1. **模块名**（英文，用于文件路径，如 `user`、`profile`、`setting`）
2. **模块中文名**（用于页面标题，如 `用户信息`、`个人资料`）
3. **存放路径**（在 `apps/qsmds-arco/src/views/` 下的子目录，如 `system`、`account`，留空则直接放在 `src/views/` 下）

### Step 2：收集字段信息

询问用户该表单有哪些字段，每个字段需要：
- **字段名**（英文，如 `name`、`avatar`、`status`）
- **中文标签**（如 `姓名`、`头像`、`状态`）
- **字段类型**（见 references/templates.md 中的字段类型映射表）
- **是否必填**

如果用户没有提供字段信息，使用默认字段 `title`（标题，string，必填）作为示例占位，并在生成后提示用户替换。

### Step 3：判断布局

字段较多时单列会导致页面过长，双列更紧凑。根据字段数量和复杂度判断是否询问用户布局偏好：

- **单列**：`max-w-600px`，`grid gap-6`（字段少、字段较长时适合）
- **双列**：`max-w-1200px`，`grid grid-cols-1 gap-x-8 gap-y-6 items-start md:grid-cols-2`（字段多、字段较短时适合）

### Step 4：确认并生成

汇总信息，展示将要生成的文件，确认后写入。

生成完成后提示：如需配置路由，请使用 `fa-route-generator` 技能；如需 API 模块，请使用 `fa-crud-page-generator` 或手动创建。

---

## 命名规范

给定模块名 `name` 和路径 `path`（相对于 `apps/qsmds-arco/src/views/`）：

| 用途 | 规则 | 示例（path=system, name=user） |
|------|------|-------------------------------|
| 视图目录 | `apps/qsmds-arco/src/views/{path}/{name}/` | `apps/qsmds-arco/src/views/system/user/` |
| 组件名 | `PascalCase({path}-{name}-form)` | `SystemUserForm` |

---

## 代码模板

详细的代码模板和字段类型映射表见 [references/templates.md](references/templates.md)。

生成代码时替换模板中的占位符：
- `{cname}` → 模块中文名
- `{componentName}` → PascalCase 组件名
- `{zodSchema}` → zod 字段定义（每个必填字段对应一行 zod 规则）
- `{initialValues}` → `model` 字段初始值（string 默认 `''`，boolean 默认 `false`，number 默认 `0`，array 默认 `[]`）
- `{formItems}` → 各字段对应的 FaFormItem 代码片段
- `{imports}` → 必要的额外 import；默认留空，Fa* 组件通常由自动导入处理
- `{maxWidth}` → 单列 `max-w-600px` / 双列 `max-w-1200px`
- `{gridClass}` → 双列时 `grid grid-cols-1 gap-x-8 gap-y-6 items-start md:grid-cols-2` / 单列时 `grid gap-6`

生成的代码是骨架：API 调用处用 `// TODO:` 注释标记，动态数据源（select options、upload action 等）用占位注释标记，用户根据实际接口替换。表单对象必须使用 `const model = ref({...})`，模板中直接 `:model="model"`；脚本里读写字段使用 `model.value.xxx`。操作栏按钮使用 `FaButton`：取消用 `variant="outline"`，提交用默认 variant 并传 `:loading="loading"`。
