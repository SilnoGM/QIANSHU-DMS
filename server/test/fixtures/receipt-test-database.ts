import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

/** 收款是不可变事实，套件使用自己的数据库，避免清理时删账或污染其他套件的初始余额。 */
export async function createReceiptTestDatabase() {
  const input = process.env.DATABASE_URL
  if (!input) throw new Error('Isolated receipt database requires DATABASE_URL')
  const url = new URL(input)
  if (!['localhost','127.0.0.1'].includes(url.hostname) || !['/qianshu_ci','/receipt_test'].includes(url.pathname)) {
    throw new Error('Receipt test database is outside the isolated boundary')
  }
  const name = `receipt_case_${randomUUID().replaceAll('-', '')}`
  const administrator = new Client({ connectionString: input })
  await administrator.connect()
  await administrator.query(`CREATE DATABASE "${name}"`)
  url.pathname = `/${name}`
  const databaseUrl = url.toString()
  const connection = new Client({ connectionString: databaseUrl })
  try {
    await connection.connect()
    const root = resolve(__dirname, '../../prisma/migrations')
    for (const directory of readdirSync(root).filter(value => /^\d/u.test(value)).sort()) {
      await connection.query(readFileSync(resolve(root, directory, 'migration.sql'),'utf8'))
    }
  } catch (error) {
    await connection.end()
    await administrator.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await administrator.end()
    throw error
  }
  await connection.end()
  return { databaseUrl, async close() {
    await administrator.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await administrator.end()
  } }
}
