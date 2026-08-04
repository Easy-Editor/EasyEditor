import { type CSSProperties, type Ref, forwardRef, useEffect, useMemo, useState } from 'react'

export type DateTimeMode = 'date' | 'time' | 'datetime'
export type DateTimeLocale = 'zh-CN' | 'en-US'
export type DateTimeStyle = 'full' | 'long' | 'medium' | 'short'
export type DateTimeDateFormat = 'localized' | 'dot' | 'dash' | 'slash'
export type DateTimeTimeFormat = 'localized' | 'hm' | 'hms'
export type DateTimeTimeZone = 'local' | 'Asia/Shanghai' | 'UTC'
export type DateTimeUpdateInterval = 'second' | 'minute'

export interface DateTimeProps {
  color?: string
  dateFormat?: DateTimeDateFormat
  dateStyle?: DateTimeStyle
  fontSize?: number
  fontWeight?: CSSProperties['fontWeight']
  hour12?: boolean
  letterSpacing?: number
  locale?: DateTimeLocale
  mode?: DateTimeMode
  style?: CSSProperties
  textAlign?: 'left' | 'center' | 'right'
  timeFormat?: DateTimeTimeFormat
  timeStyle?: DateTimeStyle
  timeZone?: DateTimeTimeZone
  updateInterval?: DateTimeUpdateInterval
}

const finiteNumber = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export const getDateTimeRefreshInterval = (updateInterval: DateTimeUpdateInterval) =>
  updateInterval === 'minute' ? 60_000 : 1_000

export const startDateTimeTicker = (onTick: () => void, updateInterval: DateTimeUpdateInterval) => {
  const timer = globalThis.setInterval(onTick, getDateTimeRefreshInterval(updateInterval))
  return () => globalThis.clearInterval(timer)
}

const resolvedTimeZone = (timeZone: DateTimeTimeZone) => (timeZone === 'local' ? undefined : timeZone)

const formatNumericDate = (
  value: Date,
  locale: DateTimeLocale,
  timeZone: DateTimeTimeZone,
  dateFormat: Exclude<DateTimeDateFormat, 'localized'>,
) => {
  const parts = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    timeZone: resolvedTimeZone(timeZone),
    year: 'numeric',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const separator = dateFormat === 'dot' ? '.' : dateFormat === 'dash' ? '-' : '/'
  return [values.year, values.month, values.day].join(separator)
}

const formatClockTime = (
  value: Date,
  locale: DateTimeLocale,
  timeZone: DateTimeTimeZone,
  hour12: boolean,
  timeFormat: Exclude<DateTimeTimeFormat, 'localized'>,
) =>
  new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    hour12,
    minute: '2-digit',
    second: timeFormat === 'hms' ? '2-digit' : undefined,
    timeZone: resolvedTimeZone(timeZone),
  }).format(value)

export const formatDateTime = (
  value: Date,
  {
    dateFormat = 'localized',
    dateStyle = 'medium',
    hour12 = false,
    locale = 'zh-CN',
    mode = 'datetime',
    timeFormat = 'localized',
    timeStyle = 'medium',
    timeZone = 'local',
  }: Pick<
    DateTimeProps,
    'dateFormat' | 'dateStyle' | 'hour12' | 'locale' | 'mode' | 'timeFormat' | 'timeStyle' | 'timeZone'
  >,
) => {
  if (dateFormat !== 'localized' || timeFormat !== 'localized') {
    const date =
      mode === 'time'
        ? ''
        : dateFormat === 'localized'
          ? new Intl.DateTimeFormat(locale, {
              dateStyle,
              timeZone: resolvedTimeZone(timeZone),
            }).format(value)
          : formatNumericDate(value, locale, timeZone, dateFormat)
    const time =
      mode === 'date'
        ? ''
        : timeFormat === 'localized'
          ? new Intl.DateTimeFormat(locale, {
              hour12,
              timeStyle,
              timeZone: resolvedTimeZone(timeZone),
            }).format(value)
          : formatClockTime(value, locale, timeZone, hour12, timeFormat)
    return [date, time].filter(Boolean).join(' ')
  }

  const options: Intl.DateTimeFormatOptions = {}

  if (mode === 'date' || mode === 'datetime') options.dateStyle = dateStyle
  if (mode === 'time' || mode === 'datetime') {
    options.timeStyle = timeStyle
    options.hour12 = hour12
  }
  options.timeZone = resolvedTimeZone(timeZone)

  return new Intl.DateTimeFormat(locale, options).format(value)
}

const DateTime = forwardRef((props: DateTimeProps, ref: Ref<HTMLTimeElement>) => {
  const {
    color = '#1f2937',
    dateFormat = 'localized',
    dateStyle = 'medium',
    fontSize = 24,
    fontWeight = 600,
    hour12 = false,
    letterSpacing = 0,
    locale = 'zh-CN',
    mode = 'datetime',
    style,
    textAlign = 'left',
    timeFormat = 'localized',
    timeStyle = 'medium',
    timeZone = 'local',
    updateInterval = 'second',
  } = props
  const [now, setNow] = useState(() => new Date())

  useEffect(() => startDateTimeTicker(() => setNow(new Date()), updateInterval), [updateInterval])

  const formattedValue = useMemo(
    () => formatDateTime(now, { dateFormat, dateStyle, hour12, locale, mode, timeFormat, timeStyle, timeZone }),
    [dateFormat, dateStyle, hour12, locale, mode, now, timeFormat, timeStyle, timeZone],
  )
  const justifyContent = textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start'

  return (
    <time
      ref={ref}
      aria-atomic='true'
      aria-label={formattedValue}
      aria-live='off'
      dateTime={now.toISOString()}
      role='timer'
      style={{
        alignItems: 'center',
        color,
        display: 'flex',
        fontSize: Math.max(1, finiteNumber(fontSize, 24)),
        fontWeight,
        height: '100%',
        justifyContent,
        letterSpacing: finiteNumber(letterSpacing, 0),
        lineHeight: 1.2,
        overflow: 'hidden',
        textAlign,
        whiteSpace: 'nowrap',
        width: '100%',
        ...style,
      }}
    >
      {formattedValue}
    </time>
  )
})

DateTime.displayName = 'DateTime'

export default DateTime
