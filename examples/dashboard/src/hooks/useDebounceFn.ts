import { useCallback, useEffect, useRef } from 'react'

interface Options {
  wait: number
}

export function useDebounceFn<T extends (...args: any[]) => any>(fn: T, options: Options = { wait: 400 }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fnRef = useRef(fn)

  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const run = useCallback(
    (...args: Parameters<T>) => {
      cancel()
      timerRef.current = setTimeout(() => {
        fnRef.current(...args)
      }, options.wait)
    },
    [cancel, options.wait],
  )

  useEffect(() => {
    return cancel
  }, [cancel])

  return {
    run,
    cancel,
  }
}
