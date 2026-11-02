# 广告账户充值实施任务

## 1. 已完成

| # | 任务 | 产物 |
|---|---|---|
| 1 | Schema：模型、两个枚举、资金来源枚举值、五个审计事件 | `server/prisma/schema.prisma` |
| 2 | 迁移：表/约束/触发器/索引/编号/来源绑定/批次形状/媒体用途/权限/审计 | `server/prisma/migrations/20261102160000_advertising_recharge/migration.sql` |
| 2.1 | 应用迁移到本地开发库时发现两个媒体外键名与 Prisma 推导不一致，补向前修复 | `server/prisma/migrations/20261102170000_advertising_recharge_fk_names/migration.sql` |
| 3 | 资金域：来源常量、受控来源映射、来源快照 kind 与映射 | `fund-advertising-recharge.ts`、`fund-posting.service.ts`、`fund-source-snapshot.ts` |
| 4 | 服务端模块：契约/错误/DTO/逻辑/文档/命令/查询/控制器/模块注册 | `server/src/modules/advertising-recharges/`、`http.modules.ts` |
| 5 | 媒体引用仓储与契约测试扩展 | `media-reference.repository.ts`、两个 spec |
| 6 | 契约同步 | `server/openapi/openapi.json`、`web/openapi/openapi.json`、`types.gen.ts`（忽略） |
| 7 | 前端 API 与页面 | `api/modules/advertising-recharges.ts`、两组页面组件 |
| 8 | 路由、菜单、语言包、品牌图标 | 两个路由模块、`locales/lang/advertising-recharge/`、3 个 SVG + 清单 |
| 9 | 测试 | logic spec、schema spec、e2e、路由测试更新、审计文案 |
| 10 | 文档 | 数据库迁移规范、本 spec 目录 |

## 2. 验证结果

| 检查 | 结果 |
|---|---|
| `server` 单元测试 | 393 套件 / 4353 条通过 |
| `server` 类型检查与 lint | 通过 |
| 迁移重放（临时 PostgreSQL 16） | 147 条迁移全部应用 |
| 全量重放 vs `schema.prisma` | 广告充值表无差异（仓库另有四处既有漂移，见迁移规范记录） |
| 广告充值 e2e | 8 条通过 |
| `web` `test:scripts` | 187 + 50 + 2050 条通过 |
| `web` 类型检查 | 通过 |
| `web` eslint（新增文件） | 无 error |
| 图标清单 | 396 项，一致性测试通过 |
| 本地开发库应用 | 147 条迁移，业务表行数不变，种子与约束全部落库 |

## 3. 未做与风险

- 未做页面级浏览器验收（需要登录与真实账号）。
- 迁移只应用到本地开发库（`qianshu_dms_prodcopy`），测试机与生产未应用。
- `20261102170000_advertising_recharge_fk_names` 只修正两个媒体外键的约束名；开发库与 schema 还有四处与本功能无关的既有漂移，未在本次处理。
- `ADVERTISING_FEE` 规则可被管理员停用或改比例：付款会失败并给出可读错误，需要财务先核对资金配置。
- 作废为终态，重新付款需重新提交申请（已与需求方确认）。
- 充值金额与付款金额之间没有汇率校验，付款金额由财务按实际支付填写。
