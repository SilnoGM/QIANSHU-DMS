# 用户资料扩展需求

## 1. 背景与目标

当前 `users` 表承担登录身份、密码状态、账号状态和认证审计职责。系统的主要普通用户角色为 `operations_staff`，其不应获得 `users:read` 或 `users:update` 等系统管理权限，但仍需要在登录后维护自己的联系信息和头像。

本需求新增与 `users` 严格一对一的 `user_profiles`，把可自助维护的个人资料与认证账号字段分离，并保持管理员备注仅对系统管理员可见。

## 2. 用户故事

### 2.1 普通用户

作为已正常登录的普通用户，我希望查看和修改自己的邮箱、手机号和头像地址，以便系统展示并使用最新的本人资料，同时不能查看或修改其他用户的信息。

### 2.2 系统管理员

作为 `system_admin`，我希望在用户管理中查看用户资料并维护管理员备注，以便补充与账号管理相关的内部说明。

## 3. 数据需求

`user_profiles` 包含以下数据库字段：

| 字段 | 数据库类型 | 约束 |
| --- | --- | --- |
| `user_id` | `UUID` | 主键；外键关联 `users.id` |
| `email` | `VARCHAR(254)` | 可空 |
| `email_normalized` | `VARCHAR(254)` | 可空；非空时全局唯一 |
| `mobile_e164` | `VARCHAR(16)` | 可空；非空时全局唯一 |
| `avatar_url` | `VARCHAR(2048)` | 可空 |
| `remark` | `TEXT` | 可空；仅系统管理员可见和修改 |
| `created_at` | `TIMESTAMPTZ(6)` | 非空；默认数据库当前时间 |
| `updated_at` | `TIMESTAMPTZ(6)` | 非空；由 Prisma 更新 |

迁移必须为全部已有用户补建一条空资料记录。正常创建用户与 `system_admin` bootstrap 必须在创建 User 的同一数据库事务中创建资料记录，不允许留下只有 User、没有 UserProfile 的已提交状态。

## 4. 接口需求

### 4.1 本人资料读取

新增 `GET /api/profile`，只返回当前 Session 对应用户的：

- `userId`
- `email`
- `mobileE164`
- `avatarUrl`
- `createdAt`
- `updatedAt`

响应不得包含 `emailNormalized`、`remark`、密码、Session 标识或其他敏感认证字段。

### 4.2 本人资料更新

新增 `PATCH /api/profile`。请求只允许包含以下可选字段：

- `email: string | null`
- `mobileE164: string | null`
- `avatarUrl: string | null`

传入 `null` 表示清空对应字段。客户端不得传入 `userId`、`remark`、`emailNormalized` 或其他字段；身份必须由服务端可信 Session 决定。

### 4.3 管理员维护

现有用户管理接口与界面扩展用户资料字段。拥有现有 `users:read` 的管理员可以查看用户资料；拥有现有 `users:update` 的管理员可以更新公开资料和 `remark`。普通用户本人接口不得复用或绕过这两个管理权限。

## 5. 规范化与校验

- `email` 保存 NFC 和 trim 后的展示值；`email_normalized` 使用展示值的 lowercase 结果。
- `email` 必须通过邮箱格式校验，最大 254 个 Unicode code point。
- `mobileE164` 必须匹配 `^\+[1-9]\d{7,14}$`。
- `avatarUrl` 必须是最大 2048 个字符的绝对 `http` 或 `https` URL；禁止 `data:`、`javascript:`、`file:` 等协议。
- Web 表单把空字符串转换为 `null`，公共 API 不依赖空字符串表达清空。
- 非空的 `email_normalized` 与 `mobile_e164` 分别使用数据库唯一索引保证最终一致性。

## 6. 错误与安全

- 邮箱冲突返回 HTTP `409` 和 `EMAIL_ALREADY_EXISTS`。
- 手机号冲突返回 HTTP `409` 和 `MOBILE_ALREADY_EXISTS`。
- DTO 白名单拒绝额外字段并返回现有 `422` 校验错误契约。
- `PATCH /api/profile` 要求有效 Session、CSRF 校验和正常认证状态；`mustChangePassword=true` 时不得访问。
- 资料响应使用 `Cache-Control: private, no-store`。
- 外部 `avatarUrl` 仍必须是绝对 HTTP(S) URL；服务端不抓取、不探测外链。
- 上传头像由 profile 域接口返回同源内容地址，内容读取要求有效 Session；`READY` 头像对所有已登录用户可读。
- 日志、错误响应和 Audit metadata 不得记录邮箱、手机号、头像 URL 或备注的具体值。

## 7. 审计需求

本人或管理员修改资料时复用现有 `USER_UPDATED` 审计事件：

- actor 使用当前登录用户。
- target 使用被修改的 User。
- metadata 只记录稳定的 `changedFields` 字段名列表。
- metadata 不记录修改前后的个人资料值。

## 8. 前端体验

### 8.1 设计规格

- **Purpose Statement**：在现有账户菜单内提供低干扰的本人资料维护入口，让无系统管理权限的普通用户也能完成必要的联系信息更新。界面必须清楚区分只读账号身份和可编辑资料。
- **Aesthetic Direction**：Industrial/utilitarian，延续当前 Fantastic-admin/Arco 管理端视觉语言。
- **Color Palette**：背景 `#FFFFFF`、正文 `#18181B`、弱背景 `#F4F4F5`、边框 `#E4E4E7`、成功反馈 `#16A34A`；实际实现优先使用现有语义主题 token，并同时支持暗色主题。
- **Typography**：沿用项目中文字体体系，以 `PingFang SC`、`Microsoft YaHei` 为主；技术值沿用现有等宽字体表现。
- **Layout Strategy**：桌面端使用左侧头像预览、右侧资料表单的非对称双区布局；移动端收敛为单列。复用现有 `FaModal`、`FaForm`、`FaInput` 和专业图标，不新增 UI 依赖。

### 8.2 交互要求

- 账户下拉菜单新增“个人资料”入口。
- 弹窗左侧只放头像上传区块；显示名与账号位于右侧表单顶部。
- 弹窗展示只读的显示名与用户名，以及可编辑的邮箱、+86 大陆手机号和头像。
- 手机号输入固定 `+86` 前缀，用户只输入 11 位；提交时拼接为 E.164，回显时剥离 `+86`。
- 未触碰的存量非 `+86` / 非 11 位手机号原样保留并提示修正；仅修改其他字段不能把它清空，用户可显式清除或替换。
- 头像点击上传，复用现有 `FaImageUpload` 与媒体管线；浏览器内压缩为最大边 512px 的 WebP，上传后即时预览，保存时写入 `avatarUrl`。
- 头像加载失败时回退现有默认头像，不暴露底层错误；上传失败显示可重试提示。
- 保存期间禁止重复提交；成功后刷新本人资料状态并展示成功反馈。
- `remark` 不出现在普通用户个人资料弹窗中。
- 管理员用户表单增加公开资料、头像上传和管理员备注字段，手机号同样使用 `+86` 输入。
- 桌面、移动、亮色和暗色模式均需真实验证。

## 9. EARS 验收标准

1. 当 migration 应用于含有既有 User 的数据库时，系统应为每个 User 创建且仅创建一条 UserProfile。
2. 当系统通过正常用户创建或管理员 bootstrap 创建 User 时，系统应在同一事务创建对应 UserProfile。
3. 在用户处于正常 authenticated 状态时，当其请求 `GET /api/profile`，系统应只返回该 Session 用户的公开资料。
4. 在用户处于正常 authenticated 状态时，当其请求 `PATCH /api/profile`，系统应只允许更新 `email`、`mobileE164` 和 `avatarUrl`。
5. 当本人资料更新请求包含 `remark`、`userId` 或其他额外字段时，系统应返回现有 `422` 校验错误。
6. 当用户提交已经被其他用户占用的规范化邮箱时，系统应返回 `409 EMAIL_ALREADY_EXISTS`，且不得修改任何资料字段。
7. 当用户提交已经被其他用户占用的 E.164 手机号时，系统应返回 `409 MOBILE_ALREADY_EXISTS`，且不得修改任何资料字段。
8. 当 `mustChangePassword=true` 的用户请求资料接口时，系统应拒绝资料读取和修改，保持强制改密边界。
9. 当资料修改成功时，系统应写入不包含个人资料值的 `USER_UPDATED` 审计事件。
10. 当普通用户打开账户菜单并进入个人资料时，Web 应允许其查看和修改本人公开资料，而不要求任何系统管理权限。
11. 当普通用户尝试查看或修改 `remark` 或其他用户资料时，系统应拒绝该访问。
12. 当系统管理员通过用户管理读取或修改用户时，系统应按现有 `users:read`、`users:update` 权限继续执行服务端授权。
13. 当用户在资料弹窗输入手机号时，Web 应只接受 `+86` 后的 11 位大陆号码，并在提交时拼接为 E.164。
14. 当存量手机号不是 `+86` + 11 位且用户未编辑它时，系统应保留原值；用户显式清除或重新输入后才改变。
15. 当用户上传头像时，系统应以 `USER_AVATAR` 用途暂存媒体，保存资料时绑定并激活；替换或清除头像时应回收旧资产。
16. 当已登录用户读取 `READY` 头像时，系统应返回图片内容；其他用户不得读取尚未绑定的 `UPLOADING` 头像。

## 10. 明确不做

- 不实现邮箱或手机号登录、验证码、账号找回和消息通知。
- 不提供头像裁剪、相册、历史头像或多头像；上传图片统一压缩为单张 WebP。
- 不新增组织、部门、租户或业务数据范围。
- 不修改用户名登录规则、Role/Permission 模型或现有管理权限目录。
- 不增加 User 删除接口，也不改变现有认证 Session 设计。
