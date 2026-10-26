import type { CalendarDate } from '@internationalized/date'

export type QsDateTimePrecision = 'date' | 'minute' | 'second'

export interface QsTimeParts {
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly millisecond: number
}

export interface QsDateTimeParts extends QsTimeParts {
  readonly date: CalendarDate
}

export interface QsDateTimeBounds {
  readonly maxDate: CalendarDate | undefined
  readonly maxIsNow: boolean
  readonly maxTime: QsTimeParts | undefined
  readonly minDate: CalendarDate | undefined
  readonly minTime: QsTimeParts | undefined
  readonly today: CalendarDate
}

export type QsDateTimeValidationError
  = 'AFTER_MAX' | 'BEFORE_MIN' | 'FUTURE' | null
