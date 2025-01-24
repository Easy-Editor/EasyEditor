import { throttle } from 'lodash-es'
import { useEffect } from 'react'

export const useResizeObserver = ({
  elem,
  onResize,
  throttleTime = 300,
}: {
  elem: React.RefObject<HTMLDivElement | null>
  onResize: (entries: ResizeObserverEntry[]) => void
  throttleTime?: number
}) => {
  useEffect(() => {
    if (elem.current) {
      const observer = new ResizeObserver(throttle((entries: ResizeObserverEntry[]) => onResize(entries), throttleTime))
      observer.observe(elem.current)
      return () => observer.disconnect()
    }
  }, [elem])
}
