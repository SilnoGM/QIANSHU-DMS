/**
 * 只由通过 readProvisionInput 隔离边界校验的 Browser bootstrap 在自身事务内调用。
 * 函数正文会嵌入 Server 子进程，因此运行期依赖均在正文声明，根目录不加载 pg。
 */
export async function provisionBrowserShippingMarkFixtures(client, actorUserId) {
  const { createHash } = await import('node:crypto')
  async function createRule(ruleCode, name, segments) {
    const rule = await client.query(`
      INSERT INTO numbering_rules (rule_code, name, purpose)
      VALUES ($1, $2, 'SHIPPING_MARK') RETURNING id
    `, [ruleCode, name])
    const ruleId = rule.rows[0].id
    const configFingerprint = createHash('sha256').update(JSON.stringify({
      resetPolicy: 'NEVER', timezone: 'Asia/Shanghai', segments,
    })).digest('hex')
    const version = await client.query(`
      INSERT INTO numbering_rule_versions (rule_id, revision, reset_policy, config_fingerprint)
      VALUES ($1, 1, 'NEVER', $2) RETURNING id
    `, [ruleId, configFingerprint])
    const versionId = version.rows[0].id
    for (const [position, segment] of segments.entries()) {
      await client.query(`
        INSERT INTO numbering_rule_segments (
          version_id, position, type, fixed_value, separator_value,
          sequence_width, sequence_start_value, sequence_step,
          random_letter_length, random_digit_length, random_mode
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [versionId, position, segment.type,
        segment.type === 'FIXED' ? segment.value : null,
        segment.type === 'SEPARATOR' ? segment.value : null,
        segment.width ?? null, segment.startValue ?? null, segment.step ?? null,
        segment.letterLength ?? null, segment.digitLength ?? null, segment.mode ?? null,
      ])
    }
    await client.query(`
      UPDATE numbering_rule_versions SET status = 'ACTIVE', published_at = clock_timestamp()
      WHERE id = $1
    `, [versionId])
    await client.query(`
      UPDATE numbering_rules SET status = 'ENABLED', version = 3, updated_at = clock_timestamp()
      WHERE id = $1
    `, [ruleId])
    return { ruleId, versionId }
  }

  const browserRule = await createRule('BROWSER_MARK', 'Browser Supplier Mark Rule', [
    { type: 'FIXED', value: 'BRW' },
    { type: 'SEPARATOR', value: '-' },
    { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
  ])
  await createRule('CUSTOM_MARK', 'Browser Custom Mark Rule', [
    { type: 'FIXED', value: 'CUSTOM' },
    { type: 'SEPARATOR', value: '-' },
    { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
  ])
  await client.query(`
    INSERT INTO supplier_shipping_mark_rule_bindings (
      supplier_value, rule_id, created_by_user_id, updated_by_user_id
    ) VALUES ('BROWSER_SUPPLIER_EFFECTIVE', $1, $2, $2)
  `, [browserRule.ruleId, actorUserId])

  // MIXED 只供读取/付款/发货/取消展示回归；真正历史空关联和原文本由迁移专测覆盖。
  // ACTIVE/CANCEL 都是 6 位大写字母，属于该专属随机规则的合法可能输出。
  const mixedRule = await createRule('BROWSER_MIXED_FIXTURE', 'Browser Mixed Display Fixture', [
    { type: 'FIXED', value: 'BROWSER' }, { type: 'SEPARATOR', value: '-' },
    { type: 'FIXED', value: 'HISTORICAL' }, { type: 'SEPARATOR', value: '-' },
    { type: 'FIXED', value: 'MIXED' }, { type: 'SEPARATOR', value: '-' },
    { type: 'RANDOM', letterLength: 6, digitLength: 0, mode: 'LETTERS_THEN_DIGITS' },
    { type: 'SEPARATOR', value: '-' }, { type: 'FIXED', value: 'MARK' },
  ])
  await client.query(`
    INSERT INTO numbering_period_states (rule_id, period_key, used_count)
    VALUES ($1, 'ALL', 2)
  `, [mixedRule.ruleId])
  const issuanceIds = []
  for (const [state, key, fingerprint] of [['ACTIVE', 'a', 'b'], ['CANCEL', 'c', 'd']]) {
    const issuance = await client.query(`
      INSERT INTO numbering_issuances (
        rule_id, rule_version_id, period_key, generated_number, consumer_code,
        idempotency_key_hash, request_fingerprint_hash
      ) VALUES ($1, $2, 'ALL', $3, 'PURCHASE_ORDER.SHIPPING_MARK', $4, $5) RETURNING id
    `, [mixedRule.ruleId, mixedRule.versionId, `BROWSER-HISTORICAL-MIXED-${state}-MARK`,
      Buffer.from(key.repeat(64), 'hex'), Buffer.from(fingerprint.repeat(64), 'hex'),
    ])
    issuanceIds.push(issuance.rows[0].id)
  }
  return { mixedActiveIssuanceId: issuanceIds[0], mixedCancelableIssuanceId: issuanceIds[1] }
}
