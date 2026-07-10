# 阶段三 Server 初始化实施计划

> **供智能代理执行：** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. 所有新功能遵循 `test-driven-development` 的 RED/GREEN/REFACTOR 顺序；配置文件、生成文件和 Prisma CLI 产物属于 TDD 例外，但必须通过相邻的边界测试或真实命令验证。

**目标：** 初始化可独立安装、检查、构建和运行的单一 NestJS Server，接入 Prisma 7 PostgreSQL driver adapter，建立安全的运行时配置、数据库生命周期、`GET /api/health` 和第一条空 migration。

**架构：** `server/` 是独立的单一 pnpm package，使用自己的 `package.json` 与 `pnpm-lock.yaml`，不加入根 workspace，也不依赖 `web/`。pnpm 11 要求项目级 lifecycle script 审批写入 `pnpm-workspace.yaml`，因此 Server 保留一个不声明 `packages` 的最小安全配置文件，只批准 Prisma 当前所需的两个 build scripts；这不会引入第二个 package 或跨目录 package graph。应用保持 CommonJS，Prisma Client 显式生成 CJS 代码；请求沿 `Controller -> Service -> PrismaService -> PostgreSQL` 流动，阶段三不创建业务模型、Repository、UseCase 或 Domain Entity。无数据库的工程检查与连接真实 PostgreSQL 的 migration/E2E 分开执行。

**技术栈：** Node.js 24、pnpm 11.9、NestJS 11.1、TypeScript 5.9、Jest 29、Prisma ORM 7.8、`@prisma/adapter-pg` 7.8、`pg` 8.22、PostgreSQL 16、ESLint 9、`node:test`。

---

## 已确认边界

- Server 使用 CommonJS；`prisma-client` generator 使用 `moduleFormat = "cjs"`。
- 第一条 migration 是不包含业务表的空初始化 migration，不创建 `User` 或其他示例模型。
- 本阶段新增唯一公共端点 `GET /api/health`，路由受全局 `/api` 前缀约束。
- 健康检查成功体采用 Terminus 的端点专属结构，不增加全局成功 envelope。
- 统一 `ApiError`、`X-Request-Id`、OpenAPI 快照、用户模块和 Web 契约适配留到阶段四。
- 根 `package.json` 和根编排实现不改；Server 提供根脚本已经约定的 `dev`、`check`、`build`。
- `server/pnpm-workspace.yaml` 仅承担 pnpm 11 项目配置职责，不声明 `packages`，`allowBuilds` 精确批准 `prisma` 与 `@prisma/engines`；新增 build script 依赖必须重新审查。
- 不提交真实 `.env`、数据库连接串、生成的 Prisma Client、构建产物或测试日志。
- 临时 PostgreSQL 使用独立容器和随机密码；不复用当前机器已有的 `5432`、`5433` 数据库。

## EARS 验收需求

| ID | EARS 需求 | 验证归属 |
| --- | --- | --- |
| `S3-R01` | **当**仅复制 `server/` 到干净目录时，**系统应**能够使用 frozen lockfile 安装，并独立执行 `check` 与 `build`。 | Task 1、Task 7 |
| `S3-R02` | **当**未提供 `DATABASE_URL` 时，**系统应**仍可执行 `prisma:generate`、`check` 与 `build`，且这些命令不得尝试连接数据库。 | Task 1、Task 3、Task 7 |
| `S3-R03` | **当**Server 启动时，**系统应**校验 `NODE_ENV`、`PORT`、`DATABASE_URL`；`DATABASE_URL` 仅接受可解析且以 `postgres://` 或 `postgresql://` 开头的分层 URI，失败信息只描述变量名和约束，不回显输入值。 | Task 2 |
| `S3-R04` | **当**Nest 模块初始化和关闭时，**系统应**依次连接 Prisma，并在关闭时同时释放 Prisma Client 与外部 `pg.Pool`；即使任一释放步骤失败，也必须尝试另一步，对外只抛出固定脱敏错误。 | Task 3 |
| `S3-R05` | **当**PostgreSQL 可用且请求 `GET /api/health` 时，**系统应**返回 `200` 和数据库 `up` 状态；**当**探测失败时，**系统应**返回 `503`，且响应和日志不含连接串或底层错误。 | Task 5、Task 7 |
| `S3-R06` | **当**在空 PostgreSQL 16 数据库执行 migration 时，**系统应**成功应用空初始化 migration；再次执行时应无待应用 migration，并在 `_prisma_migrations` 中只有一条成功记录。 | Task 4、Task 7 |
| `S3-R07` | **当**执行根 `test:root`、`check`、`build` 时，**系统应**真实编排 Server 与 Web，同时根目录仍不产生 workspace、lockfile 或 `node_modules/`。 | Task 1、Task 6、Task 7 |
| `S3-R08` | **系统应始终**忽略真实环境文件、Prisma Client、构建和覆盖率产物，只跟踪无凭据的 `.env.example`。 | Task 1、Task 7 |
| `S3-R09` | **当**应用完成全局初始化时，**系统应**启用 `/api` 前缀、shutdown hooks 和返回 `422` 的 DTO `ValidationPipe`。 | Task 2、Task 5 |
| `S3-R10` | **系统应始终**保持单一 NestJS package；`server/pnpm-workspace.yaml` **应仅**包含精确的 Prisma `allowBuilds`，不声明 `packages` 或其他 package graph；所有依赖只允许固定 registry SemVer，不得使用 range、tag、alias、路径、URL、Git 来源或跨端源码。 | Task 1、Task 7 |

## 文件职责图

```text
server/
├── AGENTS.md                         # 后端开发、migration、安全和验证规则
├── README.md                         # Server 独立安装、配置和命令说明
├── package.json                      # 独立依赖与公开脚本
├── pnpm-lock.yaml                    # Server 独立锁文件
├── pnpm-workspace.yaml               # pnpm 11 单 package allowBuilds 配置
├── nest-cli.json                     # Nest 编译入口
├── tsconfig.json                     # CommonJS TypeScript 基线
├── tsconfig.build.json               # 生产构建排除项
├── eslint.config.mjs                 # 只读 lint 与显式 lint:fix
├── prisma.config.ts                  # Prisma schema、migration 和运行时 URL 来源
├── .gitignore                        # Server 被独立复制时仍有效的忽略规则
├── .env.example                      # 无凭据环境变量模板
├── prisma/
│   ├── schema.prisma                 # PostgreSQL datasource 与 CJS client generator
│   └── migrations/                   # 不可变 migration 历史
├── src/
│   ├── main.ts                       # HTTP 前缀、ValidationPipe、shutdown 和启动失败边界
│   ├── app.setup.ts                  # 可由 production 与 E2E 复用的应用级配置
│   ├── app.setup.spec.ts             # 前缀、422 Pipe 与 shutdown hooks 配置测试
│   ├── app.module.ts                 # 全局配置、数据库和健康模块装配
│   ├── config/
│   │   ├── app.config.ts             # 类型化应用配置
│   │   ├── env.validation.ts         # 无敏感值回显的运行时校验
│   │   └── env.validation.spec.ts    # 配置 RED/GREEN 测试
│   ├── infrastructure/database/
│   │   ├── prisma.module.ts          # 全局 Prisma provider
│   │   ├── prisma.service.ts         # PrismaPg、Pool 和生命周期
│   │   └── prisma.service.spec.ts    # 生命周期与脱敏测试
│   └── modules/health/
│       ├── database-health.indicator.ts
│       ├── database-health.indicator.spec.ts
│       ├── health.controller.ts
│       └── health.module.ts
└── test/
    ├── app.e2e-spec.ts               # 真实 PostgreSQL HTTP 健康检查
    └── jest-e2e.json                 # 独立 E2E 配置
```

## 目标提交序列

```text
docs: 添加阶段三 Server 初始化计划
chore(server): 初始化独立 NestJS 工程
feat(server): 建立环境校验与启动基线
feat(server): 配置 Prisma PostgreSQL 基础设施
feat(server): 添加空初始化数据库迁移
feat(server): 添加数据库健康检查
docs(server): 添加后端架构与迁移规范
docs: 记录阶段三验证完成
```

每次提交必须精确 `git add` 当前 Task 路径，再执行：

```bash
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
```

只有暂存范围与当前 Task 一致时才能提交；禁止使用未审计的 `git add -A`，禁止 push。

### Task 0：提交阶段三实施计划

**Files:**

- Create: `docs/全局文档/阶段三Server初始化实施计划.md`
- Modify: `docs/文档索引.md`

- [x] **Step 1：验证计划结构与索引**

运行：

```bash
node --run test:root
git diff --check
rg -n "T[B]D|TO[D]O|implemen[t] later|稍后补[充]" docs/全局文档/阶段三Server初始化实施计划.md
```

Expected: 根测试通过，`git diff --check` 通过，占位符扫描退出码 `1`。

- [x] **Step 2：精确暂存、审计并提交**

```bash
git add docs/全局文档/阶段三Server初始化实施计划.md docs/文档索引.md
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "docs: 添加阶段三 Server 初始化计划"
```

### Task 1：建立 Server 独立 package 边界

**Files:**

- Create: `scripts/server-boundary.test.mjs`
- Create: `server/package.json`
- Create: `server/pnpm-lock.yaml`
- Create: `server/pnpm-workspace.yaml`
- Create: `server/nest-cli.json`
- Create: `server/tsconfig.json`
- Create: `server/tsconfig.build.json`
- Create: `server/eslint.config.mjs`
- Create: `server/test/jest-e2e.json`
- Create: `server/.gitignore`
- Create: `server/.env.example`
- Create: `server/README.md`
- Create: `server/AGENTS.md`

- [ ] **Step 1：先写 Server 边界失败测试**

`scripts/server-boundary.test.mjs` 使用 `node:test` 和 `node:assert/strict`，至少断言：

```js
test('Server 是带独立 lockfile 的单一私有 package', async () => {
  const manifest = JSON.parse(await readFile(fromRoot('server/package.json'), 'utf8'))

  assert.equal(manifest.name, '@qianshu-dms/server')
  assert.equal(manifest.private, true)
  assert.equal(manifest.packageManager, 'pnpm@11.9.0')
  assert.equal('workspaces' in manifest, false)
  assert.equal(await exists('server/pnpm-lock.yaml'), true)
  assert.equal(await exists('server/pnpm-workspace.yaml'), true)
  assert.equal(await exists('server/package-lock.json'), false)
  assert.equal(await exists('server/yarn.lock'), false)
})

test('Server 暴露根编排要求的脚本且只使用固定 registry SemVer', async () => {
  const manifest = JSON.parse(await readFile(fromRoot('server/package.json'), 'utf8'))

  for (const scriptName of ['dev', 'check', 'build']) {
    assert.equal(typeof manifest.scripts?.[scriptName], 'string')
  }
  for (const { specifier } of dependencyEntries(manifest)) {
    assert.equal(isFixedRegistryVersion(specifier), true)
  }
})
```

依赖分类器必须只接受固定 SemVer，包括合法 prerelease 与 build metadata；必须拒绝 range、tag、npm alias、本地相对或绝对路径、tarball URL、Git URL、GitHub shorthand，以及 `file:`、`link:`、`portal:`、`workspace:`。测试覆盖 `dependencies`、`devDependencies`、`optionalDependencies`、`peerDependencies` 四个区段，并在不引入根 YAML 依赖、不运行安装命令的前提下安全读取 lockfile：`importers` 只能包含 `.`，每个 manifest specifier 必须与对应 importer 精确一致，fixture 必须证明 manifest/lock 漂移会失败。

测试还必须确认 `tsconfig.build.json` 只包含 `src/**/*.ts`，用 `rootDir: "./src"` 保持产物入口为 `dist/main.js`，并显式设置 `incremental: false`，避免 Nest 删除 `dist/` 后因目录外的旧增量状态而跳过 emit；确认根目录仍不存在 `pnpm-workspace.yaml`、`pnpm-lock.yaml` 和 `node_modules/`；Server 配置文件内容精确为本 Task 下方的 `allowBuilds`，不含 `packages`、`catalog`、`overrides` 或其他 workspace graph 配置；并确认 Server `.gitignore` 独立忽略 `.env`、`dist`、`coverage`、`src/generated/prisma` 与 `*.tsbuildinfo`，同时放行 `.env.example`。

运行：

```bash
node --test scripts/server-boundary.test.mjs
```

Expected RED: 因 `server/package.json`、lockfile 和独立规则尚不存在而失败。

- [ ] **Step 2：创建最终 package manifest**

`server/package.json` 使用固定的 Prisma、TypeScript 和 Jest 兼容线；所有会编译或执行应用源码的入口先生成 Prisma Client：

```json
{
  "name": "@qianshu-dms/server",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@11.9.0",
  "engines": {
    "node": "^24.15.0"
  },
  "scripts": {
    "dev": "pnpm prisma:generate && nest start --watch",
    "build": "pnpm prisma:generate && nest build",
    "start": "pnpm prisma:generate && nest start",
    "start:prod": "node dist/main.js",
    "typecheck": "pnpm prisma:generate && tsc --noEmit",
    "lint": "pnpm prisma:generate && eslint \"{src,test}/**/*.ts\" \"*.ts\"",
    "lint:fix": "pnpm prisma:generate && eslint \"{src,test}/**/*.ts\" \"*.ts\" --fix",
    "test": "pnpm prisma:generate && jest",
    "test:e2e": "pnpm prisma:generate && jest --config test/jest-e2e.json --runInBand",
    "check": "pnpm prisma:validate && pnpm typecheck && pnpm lint && pnpm test",
    "prisma:generate": "prisma generate",
    "prisma:validate": "prisma validate",
    "db:migrate:dev": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "11.1.28",
    "@nestjs/config": "4.0.4",
    "@nestjs/core": "11.1.28",
    "@nestjs/platform-express": "11.1.28",
    "@nestjs/terminus": "11.1.1",
    "@prisma/adapter-pg": "7.8.0",
    "@prisma/client": "7.8.0",
    "class-transformer": "0.5.1",
    "class-validator": "0.15.1",
    "pg": "8.22.0",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.2"
  },
  "devDependencies": {
    "@eslint/js": "9.39.4",
    "@nestjs/cli": "11.0.23",
    "@nestjs/schematics": "11.1.0",
    "@nestjs/testing": "11.1.28",
    "@types/jest": "29.5.14",
    "@types/node": "24.13.3",
    "@types/pg": "8.20.0",
    "@types/supertest": "7.2.0",
    "dotenv": "17.4.2",
    "eslint": "9.39.4",
    "globals": "17.7.0",
    "jest": "29.7.0",
    "prisma": "7.8.0",
    "supertest": "7.2.2",
    "ts-jest": "29.4.11",
    "typescript": "5.9.3",
    "typescript-eslint": "8.63.0"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testEnvironment": "node",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": {
      "^.+\\.(t|j)s$": "ts-jest"
    },
    "modulePathIgnorePatterns": ["<rootDir>/generated/"]
  }
}
```

`server/nest-cli.json`：

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

`server/tsconfig.build.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "incremental": false,
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "test", "dist", "**/*.spec.ts"]
}
```

`server/test/jest-e2e.json`：

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "testEnvironment": "node",
  "testRegex": ".*\\.e2e-spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "modulePathIgnorePatterns": ["<rootDir>/src/generated/"]
}
```

`server/eslint.config.mjs`：

```js
import eslint from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['coverage/**', 'dist/**', 'src/generated/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
)
```

`server/pnpm-workspace.yaml` 不声明 `packages`，只审批已核验的 Prisma build scripts：

```yaml
allowBuilds:
  '@prisma/engines': true
  prisma: true
```

禁止设置 `dangerouslyAllowAllBuilds` 或 `strictDepBuilds: false`。若未来依赖图出现新的 lifecycle script，安装应继续失败，直到完成审查并精确更新 `allowBuilds`。

production dependencies 精确固定为：

```text
@nestjs/common@11.1.28
@nestjs/config@4.0.4
@nestjs/core@11.1.28
@nestjs/platform-express@11.1.28
@nestjs/terminus@11.1.1
@prisma/adapter-pg@7.8.0
@prisma/client@7.8.0
class-transformer@0.5.1
class-validator@0.15.1
pg@8.22.0
reflect-metadata@0.2.2
rxjs@7.8.2
```

dev dependencies 精确固定为：

```text
@eslint/js@9.39.4
@nestjs/cli@11.0.23
@nestjs/schematics@11.1.0
@nestjs/testing@11.1.28
@types/jest@29.5.14
@types/node@24.13.3
@types/pg@8.20.0
@types/supertest@7.2.0
dotenv@17.4.2
eslint@9.39.4
globals@17.7.0
jest@29.7.0
prisma@7.8.0
supertest@7.2.2
ts-jest@29.4.11
typescript@5.9.3
typescript-eslint@8.63.0
```

不要加入 `tsx`、Swagger、OpenAPI、Repository 或业务依赖。

- [ ] **Step 3：创建 CommonJS 编译、lint、Jest 和独立忽略配置**

关键配置必须满足：

`server/tsconfig.json`：

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2023",
    "moduleResolution": "node",
    "declaration": true,
    "sourceMap": true,
    "outDir": "./dist",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "incremental": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

```gitignore
# server/.gitignore
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
!.env.*.example
src/generated/prisma/
*.tsbuildinfo
*.log
```

`.env.example` 只包含公开键，不提供可误用的凭据：

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=
```

Jest unit root 指向 `src/`，E2E root 指向 `server/`；两者都忽略 `src/generated/prisma/`。ESLint 使用 flat config 和 type-aware TypeScript rules，忽略 `dist/`、`coverage/`、`src/generated/`，`lint` 不得自动修复。若真实 lint 证明某条规则与 Prisma 生成类型或 Supertest 的外部类型冲突，只能对精确测试文件做最小规则覆盖，不得全局关闭类型检查。

`server/README.md` 必须给出独立 install、无数据库 check/build、运行时三个环境变量和真实数据库 E2E 命令；明确 `start:prod` 直接运行已构建产物。`server/AGENTS.md` 必须固定 Controller/Service/Prisma 方向、migration 不可变、中文注释、TDD、敏感信息禁令、`check` 不含 E2E 和禁止跨根/Web 依赖。

- [ ] **Step 4：安装依赖并生成独立 lockfile**

```bash
pnpm -C server install
pnpm -C server install --frozen-lockfile
```

Expected: 两次均成功，只生成 `server/node_modules` 和 `server/pnpm-lock.yaml`；已提交的 `server/pnpm-workspace.yaml` 内容不被安装改写，根目录无依赖状态。

- [ ] **Step 5：运行边界 GREEN 并提交**

```bash
node --test scripts/server-boundary.test.mjs
node --run test:root
git add scripts/server-boundary.test.mjs \
  server/package.json server/pnpm-lock.yaml server/nest-cli.json \
  server/pnpm-workspace.yaml \
  server/tsconfig.json server/tsconfig.build.json server/eslint.config.mjs \
  server/test/jest-e2e.json server/.gitignore server/.env.example \
  server/README.md server/AGENTS.md
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "chore(server): 初始化独立 NestJS 工程"
```

### Task 2：建立环境校验与 Nest 启动基线

**Files:**

- Create: `server/src/config/env.validation.spec.ts`
- Create: `server/src/config/env.validation.ts`
- Create: `server/src/config/app.config.ts`
- Create: `server/src/main.ts`
- Create: `server/src/app.setup.ts`
- Create: `server/src/app.setup.spec.ts`
- Create: `server/src/app.module.ts`

- [ ] **Step 1：先写环境校验失败测试**

环境测试覆盖默认值、两种合法 PostgreSQL 分层 URL、必填 URL、opaque URI、协议、端口边界和不回显输入：

```ts
describe('validateEnvironment', () => {
  it('normalizes valid environment values', () => {
    expect(validateEnvironment({
      DATABASE_URL: 'postgresql://localhost:5432/test',
    })).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: 'postgresql://localhost:5432/test',
    })
  })

  it.each([
    [{}, 'DATABASE_URL'],
    [{ DATABASE_URL: 'mysql://user:do-not-print@localhost/test' }, 'DATABASE_URL'],
    [{ DATABASE_URL: 'postgresql:opaque-do-not-print' }, 'DATABASE_URL'],
    [{ DATABASE_URL: 'postgresql://localhost/test', PORT: '0' }, 'PORT'],
    [{ DATABASE_URL: 'postgresql://localhost/test', NODE_ENV: 'preview' }, 'NODE_ENV'],
  ])('rejects invalid environment without echoing values', (input, key) => {
    expect(() => validateEnvironment(input)).toThrow(key)
    try {
      validateEnvironment(input)
    } catch (error) {
      expect(String(error)).not.toContain('do-not-print')
    }
  })
})
```

`app.setup.spec.ts` 使用最小 mock app，断言 `setGlobalPrefix('api')`、一次 `useGlobalPipes()` 和一次 `enableShutdownHooks()`。从 `useGlobalPipes()` 捕获的 `ValidationPipe` 调用 `createExceptionFactory()([])` 后必须得到 status `422`。

运行：

```bash
pnpm -C server exec jest --runInBand src/config/env.validation.spec.ts
pnpm -C server exec jest --runInBand src/app.setup.spec.ts
```

Expected RED: `env.validation.ts` 与 `app.setup.ts` 尚不存在。

- [ ] **Step 2：实现无敏感值回显的校验**

`validateEnvironment(config)` 返回保留未知键并规范化后的对象，规则精确为：

- `NODE_ENV`: `development | test | production`，默认 `development`。
- `PORT`: `1..65535` 的整数，默认 `3000`，测试必须覆盖 `1` 和 `65535` 两个合法边界。
- `DATABASE_URL`: 必填非空字符串，只接受以 `postgres://` 或 `postgresql://` 开头的分层 URI；拒绝 `postgresql:foo`、`postgresql:/foo` 和其他 opaque 形式。
- 所有错误文本仅使用 `Environment validation failed: <KEY> <constraint>`，不得拼接输入值或完整 `Error`。

URL 在校验分层 URI 前缀后仍使用标准 `URL` 解析器；不额外强制 host 或数据库名，以兼容 PostgreSQL Unix socket URL。测试中的 URL 只是假数据，不连接数据库。

- [ ] **Step 3：实现应用配置和启动边界**

`AppModule` 使用：

```ts
ConfigModule.forRoot({
  cache: true,
  isGlobal: true,
  load: [appConfig],
  validate: validateEnvironment,
})
```

`app.setup.ts` 导出 `configureApplication(app: INestApplication)`，由 production bootstrap 与 E2E 共同调用。应用初始化必须包含：

```ts
app.setGlobalPrefix('api')
app.useGlobalPipes(new ValidationPipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  forbidNonWhitelisted: true,
  transform: true,
  whitelist: true,
}))
app.enableShutdownHooks()
```

`main.ts` 只负责创建 `AppModule`、调用 `configureApplication()`、从 `ConfigService` 读取端口并监听。若创建 app 后的任一步失败，bootstrap 必须在重新抛出前安全调用 `app.close()`；顶层 `.catch()` 只能记录固定文本 `Server bootstrap failed` 并设置非零退出状态，不输出原始异常或 `DATABASE_URL`。不得从 E2E 直接 import 一个会自动启动监听器的入口文件。

- [ ] **Step 4：运行 GREEN、无数据库构建并提交**

```bash
pnpm -C server exec jest --runInBand src/config/env.validation.spec.ts
pnpm -C server exec jest --runInBand src/app.setup.spec.ts
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server exec tsc --noEmit
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server exec nest build
test -f server/dist/main.js
test ! -e server/dist/src/main.js
test ! -e server/dist/prisma.config.js
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server exec nest build
test -f server/dist/main.js
test ! -e server/dist/src/main.js
test ! -e server/dist/prisma.config.js
git add server/src/config server/src/main.ts server/src/app.setup.ts \
  server/src/app.setup.spec.ts server/src/app.module.ts
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "feat(server): 建立环境校验与启动基线"
```

Expected: 单元测试、typecheck、build 均通过且未连接数据库。此时 Prisma schema 尚未建立，所以使用底层工具验证 Nest 基线；Task 3 建立 schema 后再验证所有公开 package scripts。

### Task 3：配置 Prisma PostgreSQL 基础设施

**Files:**

- Create: `server/prisma.config.ts`
- Create: `server/prisma/schema.prisma`
- Create: `server/src/infrastructure/database/prisma.service.spec.ts`
- Create: `server/src/infrastructure/database/prisma.service.ts`
- Create: `server/src/infrastructure/database/prisma.module.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1：建立不依赖在线数据库的 Prisma 生成配置**

`server/prisma/schema.prisma` 精确保持无业务模型：

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
}
```

`server/prisma.config.ts` 先 import `dotenv/config`，再使用 `defineConfig`；schema 指向 `prisma/schema.prisma`，migration 路径指向 `prisma/migrations`，datasource URL 读取 `process.env.DATABASE_URL!`。禁止使用会在配置求值时强制 URL 存在的 `env('DATABASE_URL')`。

运行：

```bash
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server prisma:generate
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server prisma:validate
```

Expected: 两个命令均成功，只在 ignored 的 `server/src/generated/prisma/` 生成代码，不连接 PostgreSQL。

- [ ] **Step 2：先写 Prisma 生命周期失败测试**

测试通过 spy 隔离真实网络，覆盖：

```ts
it('connects Prisma when the Nest module initializes', async () => {
  const service = createService()
  const connect = jest.spyOn(service, '$connect').mockResolvedValue()

  await service.onModuleInit()

  expect(connect).toHaveBeenCalledTimes(1)
})

it('closes the external pool even when Prisma disconnect fails', async () => {
  const service = createService()
  jest.spyOn(service, '$disconnect').mockRejectedValue(new Error('sensitive detail'))
  const end = jest.spyOn(Pool.prototype, 'end').mockResolvedValue()

  await expect(service.onModuleDestroy()).rejects.toThrow('Database shutdown failed')
  expect(end).toHaveBeenCalledTimes(1)
})
```

还要测试：

- Pool 的 `max`、`connectionTimeoutMillis`、`query_timeout` 都是显式的有限正整数。
- `$connect()` 失败时也必须尝试 `$disconnect()` 与 `pool.end()`，最终只抛出无 `cause` 的固定 `Database initialization failed`，因为此时 NestFactory 尚未向外返回可关闭的 application。
- 正常关闭时 `$disconnect()` 先于 `pool.end()`，两者各执行一次。
- `$disconnect()` 失败、`pool.end()` 失败、两者同时失败时，均尝试两个释放步骤，且最终只抛出无 `cause` 的固定 `Database shutdown failed`。
- Pool 的自有 idle-client error handler 只记录固定文本，不把传入的 `Error`、stack 或连接 URL 作为 Logger 参数。

运行：

```bash
pnpm -C server exec jest --runInBand prisma.service.spec.ts
```

Expected RED: `PrismaService` 尚不存在。

- [ ] **Step 3：实现 PrismaPg、Pool 与双重释放**

`PrismaService` 必须：

- 通过 `ConfigService.getOrThrow<string>('DATABASE_URL')` 获取连接串，不输出该值。
- 创建单一 `pg.Pool`，设置有限正整数 `max`、`connectionTimeoutMillis` 和 `query_timeout`；其中 `query_timeout` 是客户端等待上界，不承诺 PostgreSQL 服务端强制终止。
- 通过 `new PrismaPg(pool)` 注入 `new PrismaClient({ adapter })`。
- `onModuleInit()` 调用 `$connect()`；若初始化失败，服务自行尝试 `$disconnect()` 和 `pool.end()` 后，只抛出新建且无 `cause` 的固定 `Error('Database initialization failed')`。
- `onModuleDestroy()` 先 `$disconnect()`，无论结果如何都再尝试 `pool.end()`；任一步失败时只抛出新建且无 `cause` 的固定 `Error('Database shutdown failed')`，不向 Nest shutdown logger 传播底层详情。
- 为外部 Pool 注册 idle error handler，但日志只写固定安全消息。
- 不设置 `disposeExternalPool: true`，避免 Prisma `$disconnect()` 与显式 `pool.end()` 重复关闭。

`PrismaModule` 使用 `@Global()`，只提供并导出 `PrismaService`。`AppModule` 只导入该 module，不创建 Repository 或业务 service。

- [ ] **Step 4：运行 GREEN、全检查并提交**

```bash
pnpm -C server exec jest --runInBand prisma.service.spec.ts
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server check
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server build
test -d server/src/generated/prisma
git check-ignore -q server/src/generated/prisma/client.ts
! git ls-files --error-unmatch server/src/generated/prisma/client.ts
git add server/prisma.config.ts server/prisma/schema.prisma \
  server/src/infrastructure/database server/src/app.module.ts
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "feat(server): 配置 Prisma PostgreSQL 基础设施"
```

### Task 4：创建并验证空初始化 migration

**Files:**

- Create: `server/prisma/migrations/migration_lock.toml`
- Create: `server/prisma/migrations/*_init/migration.sql`（目录名由 Prisma CLI 生成）

- [ ] **Step 1：启动 migration 创建专用的临时 PostgreSQL 16**

使用 `umask 077`、`mktemp` 和 `openssl rand -hex 32` 生成临时密码文件，容器名包含当前 PID 和随机会话 ID。容器同时使用通用 label `qianshu-dms.temp=postgres-test` 和会话专属 label `qianshu-dms.session=<session-id>`，并通过 `--cidfile` 记录精确容器 ID。

端口使用 `--publish 127.0.0.1::5432/tcp` 由 Docker 在 IPv4 loopback 上原子分配高位端口，再从 `docker port <container-id> 5432/tcp` 读取；禁止固定复用 `15432`，因为本机已有无关的已停止容器保留该端口映射。容器配置：

```text
POSTGRES_USER=qianshu_test
POSTGRES_DB=qianshu_dms_test
POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password
image=postgres:16
```

使用容器内 `pg_isready` 等待就绪，再通过 `SHOW server_version_num` 确认实际 major 为 `16`。命令期间不得启用 `set -x`，不得打印密码或 `DATABASE_URL`。

每次临时数据库流程都必须在创建资源前安装同等语义的清理 trap；只清理本次生成的名称和目录：

```bash
set -euo pipefail
umask 077

session_id="migration-$$-$RANDOM"
pg_name="qianshu-dms-postgres-test-$session_id"
pg_id=""
pg_tmp=""

cleanup_postgres() {
  original_status=$?
  trap - EXIT INT TERM
  set +e
  cleanup_failed=0
  unset DATABASE_URL DOTENV_CONFIG_PATH DEBUG
  unset PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION

  if [ -z "${pg_id:-}" ] &&
    [ -n "${pg_tmp:-}" ] &&
    [ -s "$pg_tmp/container.cid" ]; then
    pg_id="$(<"$pg_tmp/container.cid")"
    case "$pg_id" in
      ''|*[!0-9a-f]*) pg_id="" ;;
    esac
  fi

  if [ -z "${pg_id:-}" ]; then
    candidates="$(
      docker ps -aq \
        --filter "label=qianshu-dms.session=$session_id" 2>/dev/null
    )" || cleanup_failed=1

    case "${candidates:-}" in
      "") ;;
      *$'\n'*) cleanup_failed=1 ;;
      *) pg_id="$candidates" ;;
    esac
  fi

  if [ -n "${pg_id:-}" ]; then
    docker rm --force --volumes "$pg_id" >/dev/null 2>&1 || cleanup_failed=1
  fi

  residual="$(
    docker ps -aq \
      --filter "label=qianshu-dms.session=$session_id" 2>/dev/null
  )" || cleanup_failed=1
  [ -z "${residual:-}" ] || cleanup_failed=1

  if [ -n "${pg_tmp:-}" ]; then
    rm -f "$pg_tmp/postgres-password" "$pg_tmp/container.cid" "$pg_tmp"/*.log
    rmdir "$pg_tmp" 2>/dev/null || cleanup_failed=1
  fi
  if [ "$cleanup_failed" -ne 0 ] && [ "$original_status" -eq 0 ]; then
    original_status=1
  fi
  exit "$original_status"
}

trap cleanup_postgres EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

pg_tmp="$(mktemp -d "${TMPDIR:-/tmp}/qianshu-dms-pg.XXXXXX")"
openssl rand -hex 32 > "$pg_tmp/postgres-password"
```

容器启动、URL 注入、migration 和断言都必须在该 trap 所在的同一 shell 中执行。清理只能使用 `pg_id` 或会话专属 label 找回唯一容器；不得使用通用 label 批量删除。通用 label 只用于最终残留审计。

Docker `--cidfile` 不保证文件带尾随换行，在 `set -e` 下必须使用 `pg_id="$(<"$pg_tmp/container.cid")"` 读取，不得直接使用可因 EOF 返回非零的 `read`。

- [ ] **Step 2：由 Prisma CLI 创建空 migration**

只在当前 shell 临时 export `DATABASE_URL` 后执行：

```bash
export DOTENV_CONFIG_PATH=/dev/null
unset DEBUG PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION
pnpm -C server exec prisma migrate dev --name init --create-only </dev/null
```

Expected: 生成一个唯一的 `*_init/migration.sql` 和 `migration_lock.toml`；`schema.prisma` 仍没有 `model`，SQL 除空白和 Prisma 说明性注释外不含可执行语句。Prisma 7.8 的 `--create-only` 可能在开发库中先创建空的 `_prisma_migrations` 元数据表，不能仅以该表是否存在判断新 migration 已应用；最终应用性以 Step 3 的全新库 deploy 和历史记录为准。该 migration 是新项目的空初始化 migration，不称为已有数据库 baseline。

生成完成后清理第一个容器、密码文件、连接变量和临时目录。后续 deploy 验收不得复用该数据库。

- [ ] **Step 3：在第二个全新数据库验证首次 deploy、二次幂等和历史记录**

使用一个全新、独立的 Bash 进程，在启动前重新注册上述 trap，重新生成随机密码并启动名称不同的全新 PostgreSQL 16 容器。两个流程不共享容器、密码、端口、volume 或 `DATABASE_URL`。确认部署前不存在 `_prisma_migrations` 且 public schema 无表，再执行：

```bash
pnpm -C server db:migrate:deploy
pnpm -C server db:migrate:deploy
pnpm -C server exec prisma migrate status
```

再通过容器内 `psql` 使用同一测试用户执行只读断言：

```sql
SELECT COUNT(*) = 1 AS exactly_one_record
     , COUNT(*) FILTER (
         WHERE finished_at IS NOT NULL
           AND rolled_back_at IS NULL
       ) = 1 AS exactly_one_finished_migration
FROM "_prisma_migrations";
```

Expected: 两次 deploy 均成功，第二次报告无待应用 migration，status 为 up to date，SQL 返回 `t`；除 `_prisma_migrations` 外不出现业务表。

- [ ] **Step 4：清理并提交不可变 migration**

无论任一步成功或失败，都必须 `unset DATABASE_URL`、使用精确容器 ID 强制删除两个临时容器和匿名卷、删除临时密码文件与目录。确认没有 `qianshu-dms.temp=postgres-test` 残留容器；若有残留，只报告，不按通用 label 批量删除。

```bash
git add server/prisma/migrations
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "feat(server): 添加空初始化数据库迁移"
```

提交后该 migration 不得修改或删除；后续 schema 变化必须追加新 migration，并再次获得 schema 修改确认。

### Task 5：添加数据库健康检查

**Files:**

- Create: `server/src/modules/health/database-health.indicator.spec.ts`
- Create: `server/src/modules/health/database-health.indicator.ts`
- Create: `server/src/modules/health/health.controller.ts`
- Create: `server/src/modules/health/health.module.ts`
- Create: `server/test/app.e2e-spec.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1：先写数据库 indicator 失败测试**

测试使用 fake Prisma 和 fake `HealthIndicatorService`，不得连接数据库：

```ts
it('reports the database as up after SELECT 1 succeeds', async () => {
  prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }])

  await expect(indicator.isHealthy('database'))
    .resolves.toEqual({ database: { status: 'up' } })
})

it('reports only a sanitized down status when SELECT 1 fails', async () => {
  prisma.$queryRaw.mockRejectedValue(
    new Error('postgresql://user:do-not-print@localhost/test'),
  )

  const result = await indicator.isHealthy('database')

  expect(result).toEqual({ database: { status: 'down' } })
  expect(JSON.stringify(result)).not.toContain('do-not-print')
})
```

unit 还必须精确检查以下调用契约：

- `$queryRaw` 只收到一个 `TemplateStringsArray`，`strings` 与 `strings.raw` 都严格等于 `['SELECT 1']`，没有插值 values。
- 查询成功时 `up()` 无参数调用一次，且不调用 `down()`。
- 查询失败时 `down()` 无参数调用一次，且不调用 `up()`；原始异常不得作为参数传给 health session。
- 失败路径不调用 Nest `Logger.error` 或 `console.error`，返回值不包含原始异常 canary。

运行：

```bash
pnpm -C server exec jest --runInBand database-health.indicator.spec.ts
```

Expected RED: indicator 尚不存在。

- [ ] **Step 2：实现 indicator 并运行 unit GREEN**

`DatabaseHealthIndicator.isHealthy('database')` 使用 Prisma tagged query 执行常量 `SELECT 1`，成功调用 `HealthIndicatorService.check(key).up()`，失败调用 `.down()`；catch 不记录原始异常。

本步骤只创建 `DatabaseHealthIndicator`，不提前创建 controller 或导入 `HealthModule`：

- 使用 Prisma tagged query 执行常量 `SELECT 1`。
- 成功调用 `HealthIndicatorService.check(key).up()`。
- 失败调用 `.down()`，catch 不记录原始异常。

```bash
pnpm -C server exec jest --runInBand database-health.indicator.spec.ts
```

Expected: 成功、失败与脱敏断言全部通过。

- [ ] **Step 3：先写 HTTP E2E 并验证 RED**

`server/test/app.e2e-spec.ts` 使用 `@nestjs/testing` 和 `supertest` 创建真实 `AppModule`，调用 `configureApplication(app)` 复用 production 的 `/api` 前缀、ValidationPipe 和 shutdown hooks 配置。启动 Task 4 的临时 PostgreSQL、应用 migration 后，测试必须断言：

E2E 必须把真实数据库和 fake 失败路径放入两个按文件顺序执行的 `describe`；每个 `describe` 各自拥有完整、异常安全的应用生命周期，前一个应用在后一个应用创建前已经关闭，任意时刻不得同时存活两个 Nest application：

```ts
let app: INestApplication | undefined

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  try {
    app = moduleRef.createNestApplication()
    configureApplication(app)
    await app.init()
  } catch (error) {
    // 清理失败不能覆盖原始初始化异常。
    await app?.close().catch(() => undefined)
    throw error
  }
})

afterAll(async () => {
  await app?.close()
})
```

Task 5 必须新建自己的临时 PostgreSQL，不能引用 Task 4 已清理的容器。容器在启动前安装 Task 4 的 trap；Jest 无论 RED、GREEN 或异常退出，外层 shell 都负责最终清理。

```ts
function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }
  return value
}
const databaseUrl = requireDatabaseUrl()
const databasePassword = new URL(databaseUrl).password
if (!databasePassword) {
  throw new Error('A database password is required for E2E tests')
}
const decodedDatabasePassword = decodeURIComponent(databasePassword)

return request(app.getHttpServer())
  .get('/api/health')
  .expect(200)
  .expect(({ body }) => {
    const serializedBody = JSON.stringify(body)
    const normalizedBody = serializedBody.toLowerCase()

    // 真实 URL 和密码只能参与布尔断言，绝不能成为 Jest matcher 的输出参数。
    expect(serializedBody.includes(databaseUrl)).toBe(false)
    expect(serializedBody.includes(databasePassword)).toBe(false)
    expect(serializedBody.includes(decodedDatabasePassword)).toBe(false)
    expect(normalizedBody.includes('postgresql://')).toBe(false)
    expect(normalizedBody.includes('postgres://')).toBe(false)
    expect(/[a-z][a-z\d+.-]*:\/\//i.test(serializedBody)).toBe(false)
    expect(body.status).toBe('ok')
    expect(body.info.database.status).toBe('up')
    expect(body).not.toHaveProperty('data')
  })
```

同一 E2E 还必须断言 `GET /health` 返回 `404`，证明全局 `/api` 前缀真实生效。

第二个 `describe` 创建独立 testing module，通过 `overrideProvider(PrismaService)` 注入只在 `$queryRaw` 抛出敏感 canary 的 fake；override 必须发生在 `compile()` 之前，确保失败路径不会实例化或连接真实 `PrismaService`。该失败应用也必须使用 `try/catch + app.close().catch(() => undefined)` 和 `afterAll` 管理生命周期。Jest 配置和命令不得使用 `--forceExit`，资源泄漏必须由测试生命周期真实解决。HTTP 回归必须先以 `.includes(...)` 的布尔断言验证脱敏，再断言完整 Terminus body：

```ts
return request(failedDatabaseApp.getHttpServer())
  .get('/api/health')
  .expect(503)
  .expect(({ body }) => {
    const normalizedBody = JSON.stringify(body).toLowerCase()

    expect(normalizedBody.includes('do-not-print')).toBe(false)
    expect(normalizedBody.includes('postgresql://')).toBe(false)
    expect(normalizedBody.includes('postgres://')).toBe(false)
    expect(/[a-z][a-z\d+.-]*:\/\//i.test(normalizedBody)).toBe(false)
    expect(normalizedBody.includes('database_url')).toBe(false)
    expect(normalizedBody.includes('password')).toBe(false)
    expect(normalizedBody.includes('select 1')).toBe(false)
    expect(normalizedBody.includes('stack')).toBe(false)
    expect(body).toEqual({
      status: 'error',
      info: {},
      error: { database: { status: 'down' } },
      details: { database: { status: 'down' } },
    })
    expect(body).not.toHaveProperty('data')
  })
```

该测试验证可提交的 HTTP 级 `503` 契约与脱敏；Task 7 仍必须补充真实运行中停库验证。fake provider 只用于失败路径，不得替代真实 PostgreSQL 的 `200` E2E。

运行：

```bash
pnpm -C server test:e2e
```

Expected RED: `GET /api/health` 返回 `404`，证明 E2E 能捕获缺失公共路由。不得通过改写期望值接受 `404`。

- [ ] **Step 4：实现 controller、module 和应用装配**

`HealthController`：

```ts
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.database.isHealthy('database'),
    ])
  }
}
```

`HealthModule` 导入 `TerminusModule.forRoot({ logger: false })`，避免健康探测失败时由 Terminus 记录 indicator 详情；module 提供 controller 与 indicator，`AppModule` 导入 `HealthModule`。

- [ ] **Step 5：使用临时 PostgreSQL 运行 E2E、全检查并提交**

按 Task 4 的相同安全容器流程启动全新 PostgreSQL，先执行 migration，再执行：

```bash
pnpm -C server test:e2e
pnpm -C server check
pnpm -C server build
```

Expected: `GET /api/health` 为 `200`，响应包含 `status: ok` 与 `database: up`，不含全局 `data` envelope 或 `DATABASE_URL`。完成后清理容器、密码文件和 shell 变量。

```bash
git add server/src/modules/health server/src/app.module.ts server/test/app.e2e-spec.ts
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "feat(server): 添加数据库健康检查"
```

### Task 6：补齐后端文档与根级现状

**Files:**

- Create: `docs/后端文档/后端架构.md`
- Create: `docs/后端文档/数据库迁移规范.md`
- Modify: `docs/文档索引.md`
- Modify: `docs/全局文档/项目工程组织方案.md`
- Modify: `README.md`
- Modify: `scripts/root-governance.test.mjs`

- [ ] **Step 1：先扩展根文档失败测试**

`scripts/root-governance.test.mjs` 新增断言：

- 阶段三计划、后端架构和数据库迁移规范都是真实文件。
- `docs/文档索引.md` 对三者都有相对链接。
- 根 README 不再包含“Web 待阶段二”或“Server 待阶段三初始化”。
- 工程方案“当前工程事实”反映 `web/apps/qsmds-arco`、`web/examples/*` 和已初始化 Server，不把初始审计快照写成当前事实。

运行：

```bash
node --test scripts/root-governance.test.mjs
```

Expected RED: 两份后端文档尚不存在，README 与工程方案仍含过期描述。

- [ ] **Step 2：编写中文后端文档**

`后端架构.md` 至少说明：

- 独立 package/lockfile 和根编排边界。
- CommonJS NestJS、模块职责与依赖方向。
- 配置校验、全局 `/api`、`422` ValidationPipe 和 shutdown hooks。
- Prisma Client 生成、`PrismaService`、外部 Pool 双重释放。
- `@prisma/adapter-pg` 的 debug namespace 可能输出底层 Pool 错误；生产环境保持 `DEBUG` 未设置，若启用其他 namespace 则必须显式排除 `prisma:*`。
- unit、integration、E2E 边界和 `GET /api/health`。
- 本阶段没有业务模型、统一成功 envelope、统一错误体或 OpenAPI。

`数据库迁移规范.md` 至少说明：

- `schema.prisma` 和 migrations 必须提交，generated client 不提交。
- 已应用 migration 不修改、不删除；变更只追加。
- 开发使用 `migrate dev`，测试/生产使用 `migrate deploy`。
- schema 变更前必须确认，禁止把 `db push` 用于共享或持久环境。
- 空库首次 deploy、二次幂等、status 与 `_prisma_migrations` 验证步骤。
- 凭据只通过环境注入，命令与日志不得泄露 URL。

- [ ] **Step 3：更新当前事实、索引和 README**

工程方案保留原始决策历史，但把“当前工程事实”更新为阶段三实际状态。README 描述根、Server、Web 都已可用，列出独立安装、无数据库检查、临时数据库 migration/E2E 的命令边界。

- [ ] **Step 4：运行 GREEN 并提交**

```bash
node --test scripts/root-governance.test.mjs
node --run test:root
git add docs/后端文档/后端架构.md docs/后端文档/数据库迁移规范.md \
  docs/文档索引.md docs/全局文档/项目工程组织方案.md \
  README.md scripts/root-governance.test.mjs
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "docs(server): 添加后端架构与迁移规范"
```

### Task 7：执行全链路与独立移植验收

**Files:**

- Modify: `docs/全局文档/阶段三Server初始化实施计划.md`

- [ ] **Step 1：验证无数据库工程链路**

不删除任何现有文件；在未设置 `DATABASE_URL` 且禁止 dotenv 读取本地文件的进程中执行：

```bash
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server install --frozen-lockfile
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server prisma:generate
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server check
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server build
node --run test:root
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null node --run check
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null node --run build
```

Expected: 全部成功；生成物均被 ignored，根目录没有依赖状态。

- [ ] **Step 2：验证真实 PostgreSQL、migration、E2E 和直接运行**

使用 Task 4 的独立临时 PostgreSQL 流程：

1. `db:migrate:deploy` 首次成功。
2. `db:migrate:deploy` 二次成功且无 pending migration。
3. `prisma migrate status` 为 up to date。
4. `_prisma_migrations` 只有一条成功记录。
5. `test:e2e` 通过。
6. `pnpm -C server start:prod` 启动后，`curl --fail --silent http://127.0.0.1:3000/api/health` 返回数据库 `up`。
7. 保持同一个 Server 进程运行并停止临时 PostgreSQL 后，重复请求返回 `503`；body 的 `error.database.status` 与 `details.database.status` 都为 `down`，响应和捕获日志都不包含 URL scheme、真实密码、`DATABASE_URL`、SQL、stack、canary 或底层异常。随后终止 Server 并确认 PID 回收、子进程清理和端口释放。
8. 重新启动一个全新临时数据库并应用 migration；`node --run dev:server` 可启动并响应，终止后无 Nest watch 或端口残留。
9. `node --run dev` 同时启动前后端；验证 Server health 与 Web HTTP 后发送一次 `SIGINT`，两个子进程和监听端口都被清理。Web 使用已提交模板或临时环境注入，不提交真实 `.env`。

不得打印 `DATABASE_URL`；所有退出路径都清理容器、变量、密码文件和临时目录。

production smoke 在启动进程前 `unset DEBUG`，并扩展 Task 4 的 trap，使其幂等终止并 `wait` 精确的 `server_pid`；若该进程派生子进程，也只按记录的父子 PID 清理，不使用名称或端口批量杀进程。首次 `200` 与停库后的 `503` 必须来自同一个 `server_pid`：停止 PostgreSQL 后先用 `kill -0 "$server_pid"` 确认 Server 仍存活，再确认原端口仍由该进程链监听。请求必须设置连接和总时限，避免数据库或 socket 故障令验收无限挂起。停库后的 `503` 不使用 `curl --fail`，而是分离 status 与 body：

```bash
health_status="$(curl --silent --show-error \
  --connect-timeout 2 \
  --max-time 10 \
  --output "$runtime_tmp/health-down.json" \
  --write-out '%{http_code}' \
  http://127.0.0.1:3000/api/health)"
test "$health_status" = "503"
node -e '
  const fs = require("node:fs")
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  if (body?.error?.database?.status !== "down") process.exit(1)
  if (body?.details?.database?.status !== "down") process.exit(1)
  if (/[a-z][a-z\d+.-]*:\/\/|DATABASE_URL|password|stack|SELECT 1/i.test(JSON.stringify(body))) process.exit(1)
' "$runtime_tmp/health-down.json"
if grep --fixed-strings --quiet -- "$pg_password" "$runtime_tmp/health-down.json"; then
  exit 1
fi
```

Server stdout/stderr 写入 `runtime_tmp` 下的日志文件。停库后再次断言同一 `server_pid` 存活且端口未释放，证明 `503` 是应用内健康降级而非进程重启或连接失败。结束时只终止记录的 PID，执行 `wait`，断言 PID、派生子进程和监听端口都已消失；随后扫描响应与日志，不得包含 `postgresql://`、`postgres://`、真实密码、密码 canary、`DATABASE_URL`、SQL、stack 或底层异常。正常 Nest 启动日志允许保留，但不得包含敏感值。

- [ ] **Step 3：验证 Server 独立复制**

从当前 `HEAD` 创建只含 Server 的 archive 到 `mktemp` 目录，而不是复制本地 `node_modules`：

```bash
git archive HEAD:server | tar -x -C "$server_copy"
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null \
  pnpm -C "$server_copy" install --offline --frozen-lockfile
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C "$server_copy" check
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C "$server_copy" build
```

然后使用一个全新 PostgreSQL 容器，把 Task 4 的 trap 扩展为同时清理 `server_copy` 和本次 `server_pid`。在同一 shell 中临时 export URL，执行独立副本的 `db:migrate:deploy`，再以空闲端口启动已构建产物：

```bash
pnpm -C "$server_copy" db:migrate:deploy
PORT=3010 pnpm -C "$server_copy" start:prod > "$server_copy/server.log" 2>&1 &
server_pid=$!
curl --fail --silent --show-error http://127.0.0.1:3010/api/health \
  > "$server_copy/health.json"
kill -TERM "$server_pid"
set +e
wait "$server_pid"
server_status=$?
set -e
server_pid=""
if [ "$server_status" -ne 0 ] && [ "$server_status" -ne 143 ]; then
  exit "$server_status"
fi
```

启动前先确认 `3010` 未被占用；通过有限重试等待 HTTP 就绪，不能用固定长 sleep。解析 `health.json` 断言数据库为 `up`，扫描 `server.log` 不含连接 URL 或密码。显式终止允许进程按 shutdown hooks 返回 `0`，也允许由 `SIGTERM` 映射出的 `143`；其他退出码仍失败。无论 install、migration、启动、curl 或断言在哪一步失败，trap 都必须终止精确 PID、以 `wait "$server_pid" || true` 回收进程且不覆盖原始退出码，再清理精确容器和临时目录。

Expected: 独立目录安装、检查、构建、migration、production start 和 health 全部通过；archive 初始内容不含 `.env`、`node_modules`、`dist`、coverage 或 generated client，运行后生成物仍只留在临时目录并最终被清理。

- [ ] **Step 4：执行安全、边界和 Git 审计**

```bash
test ! -e pnpm-workspace.yaml
test ! -e pnpm-lock.yaml
test ! -e node_modules
test -f server/pnpm-workspace.yaml
test ! -e server/package-lock.json
test ! -e server/yarn.lock
git ls-files | rg '(^|/)\.env($|\.)' | rg -v '\.example$'
git ls-files | rg '(^|/)(node_modules|dist|coverage|src/generated/prisma)(/|$)'
git diff --check
git status --short
```

Expected: 前六项满足；两次 tracked-artifact 扫描退出码 `1`；除计划完成记录外工作树干净。再扫描 staged/tracked 内容中的 private key、token、密码、credential、DSN 和 URL 内嵌凭据；测试 fixture 命中必须人工确认仅为明确的安全测试数据，不得放宽规则掩盖真实敏感信息。

- [ ] **Step 5：双重审查并记录阶段完成**

按 `requesting-code-review` 执行：

1. 规格审查逐项映射 `S3-R01..S3-R10`。
2. 代码质量审查关注类型、生命周期、资源清理、脱敏、测试真实性、YAGNI 和迁移不可变性。
3. 所有重要问题修复后重新运行受影响验证；未解决问题不得标记完成。

把本计划所有实际完成的 checkbox 改为 `[x]`，追加验证记录，写明命令、结果、临时数据库清理和已知非阻塞 warning。最后提交：

```bash
git add docs/全局文档/阶段三Server初始化实施计划.md
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "docs: 记录阶段三验证完成"
```

最终必须确认 `git status --short --branch` 无未提交修改，不 push。

## 阶段三完成判定

只有同时满足以下条件才能声称阶段三完成：

- `server/` 独立 frozen install、`check`、`build` 全部通过。
- 无 `DATABASE_URL` 的 generate、validate、check 和 build 全部通过且没有数据库连接尝试。
- 临时 PostgreSQL 16 上 migration 首次 deploy、二次 deploy、status 和历史记录全部通过。
- `GET /api/health` 的 unit、真实 E2E、production start 和根级 dev smoke 通过。
- 根 `test:root`、`check`、`build` 通过，且根目录没有 workspace 或依赖状态。
- 独立 Git archive 验证通过，没有依赖仓库外路径。
- 未提交真实 `.env`、敏感信息、Prisma Client、构建产物或数据库容器。
- 两阶段代码审查无未解决的重要问题，Git 工作树干净，提交序列完整且未 push。
