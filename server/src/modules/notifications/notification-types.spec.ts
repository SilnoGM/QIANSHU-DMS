import {
  IMPLEMENTED_NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_EVENT_DYNAMIC_TARGET_LABELS,
} from './notification.types'

describe('notification dynamic target labels', () => {
  it('describes who receives every implemented event in COMMAND_TARGET mode', () => {
    for (const eventType of IMPLEMENTED_NOTIFICATION_EVENT_TYPES) {
      expect(NOTIFICATION_EVENT_DYNAMIC_TARGET_LABELS[eventType]?.trim().length).toBeGreaterThan(0)
    }
  })
})
