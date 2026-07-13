import 'dotenv/config'

import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // 直接读取 process.env，避免 generate/validate 在无需连接数据库时被 env() 提前阻断。
    url: process.env.DATABASE_URL!,
  },
})
