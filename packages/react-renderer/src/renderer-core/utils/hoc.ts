import { createElement } from 'react'

import { forwardRef } from 'react'

const excludePropertyNames = [
  '$$typeof',
  'render',
  'defaultProps',
  'props',
  'length',
  'prototype',
  'name',
  'caller',
  'callee',
  'arguments',
]

export const cloneEnumerableProperty = (target: any, origin: any, excludes = excludePropertyNames) => {
  const compExtraPropertyNames = Object.keys(origin).filter(d => !excludes.includes(d))

  compExtraPropertyNames.forEach((d: string) => {
    ;(target as any)[d] = origin[d]
  })

  return target
}

export const createForwardRefHocElement = (Wrapper: any, Comp: any) => {
  const WrapperComponent = cloneEnumerableProperty(
    forwardRef((props: any, ref: any) => {
      return createElement(Wrapper, { ...props, forwardRef: ref })
    }),
    Comp,
  )
  WrapperComponent.displayName = Comp.displayName

  return WrapperComponent
}
