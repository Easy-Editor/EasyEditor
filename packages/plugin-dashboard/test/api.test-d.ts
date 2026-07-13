import type { Designer } from '@easy-editor/core'
import type DashboardPlugin from '../src/index.js'

export type DashboardPluginFactory = typeof DashboardPlugin

declare const marquee: Designer['marqueeSelection']
marquee.dispose()
// @ts-expect-error Engine teardown policy is not part of the public helper API.
marquee.dispose({ restoreDetecting: false })

type DisposeMarqueeBinding = ReturnType<Designer['marqueeSelection']['from']>
declare const disposeMarqueeBinding: DisposeMarqueeBinding
disposeMarqueeBinding()
// @ts-expect-error Binding cleanup cannot bypass detecting restoration.
disposeMarqueeBinding({ restoreDetecting: false })
