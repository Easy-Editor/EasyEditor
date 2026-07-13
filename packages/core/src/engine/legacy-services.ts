import EventEmitter from 'events'
import { Config } from '../config'
import { Clipboard } from '../designer/clipboard'
import { LoadingStateManager } from '../remote/state/loading-state'
import { ResourceRegistry } from '../remote/state/resource-registry'
import { EventBus } from '../utils/event-bus'

export const config = new Config()
export const clipboard = new Clipboard()
export const commonEvent = new EventBus(new EventEmitter())
export const loadingState = new LoadingStateManager()
export const resourceRegistry = new ResourceRegistry()
