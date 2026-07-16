export const DASHBOARD_CAPABILITY_REGISTRY_SCHEMA_VERSION = 1
export const DASHBOARD_CAPABILITY_REGISTRY_REVISION = 'dashboard-capability-registry/2'
export const DASHBOARD_FUTURE_CAPABILITY_UNAVAILABLE_REASON = 'not-yet-available'

export const DASHBOARD_CAPABILITY_ERROR_CODE = Object.freeze({
  invalidRequest: 'INVALID_CAPABILITY_REQUEST',
  unavailable: 'CAPABILITY_UNAVAILABLE',
  unknown: 'UNKNOWN_CAPABILITY',
})

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const entry of Object.values(value)) deepFreeze(entry)
  }
  return value
}

const strictObject = (properties = {}, required = []) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
})

const nonEmptyString = { type: 'string', minLength: 1 }
const nullableNonEmptyString = { type: ['string', 'null'], minLength: 1 }
const stringArray = { type: 'array', items: nonEmptyString, uniqueItems: true }
const jsonValue = {}
const operationId = { type: 'string', minLength: 1, maxLength: 256 }

const relativePosition = {
  oneOf: [
    strictObject({ place: { const: 'first' } }, ['place']),
    strictObject({ place: { const: 'last' } }, ['place']),
    strictObject({ place: { const: 'before' }, siblingId: nonEmptyString }, ['place', 'siblingId']),
    strictObject({ place: { const: 'after' }, siblingId: nonEmptyString }, ['place', 'siblingId']),
  ],
}

const screenOperation = {
  oneOf: [
    strictObject(
      { opId: operationId, type: { const: 'set' }, nodeId: nonEmptyString, fieldId: nonEmptyString, value: jsonValue },
      ['opId', 'type', 'nodeId', 'fieldId', 'value'],
    ),
    strictObject({ opId: operationId, type: { const: 'unset' }, nodeId: nonEmptyString, fieldId: nonEmptyString }, [
      'opId',
      'type',
      'nodeId',
      'fieldId',
    ]),
    strictObject(
      {
        opId: operationId,
        type: { const: 'resize' },
        nodeId: nonEmptyString,
        rect: strictObject(
          {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number', minimum: 0 },
            height: { type: 'number', minimum: 0 },
          },
          ['x', 'y', 'width', 'height'],
        ),
      },
      ['opId', 'type', 'nodeId', 'rect'],
    ),
    strictObject(
      {
        opId: operationId,
        type: { const: 'insert' },
        parentId: nonEmptyString,
        componentName: nonEmptyString,
        position: relativePosition,
        fields: { type: 'object', maxProperties: 512, additionalProperties: jsonValue },
      },
      ['opId', 'type', 'parentId', 'componentName'],
    ),
    strictObject(
      {
        opId: operationId,
        type: { const: 'move' },
        nodeId: nonEmptyString,
        parentId: nonEmptyString,
        position: relativePosition,
      },
      ['opId', 'type', 'nodeId', 'parentId'],
    ),
    strictObject(
      { opId: operationId, type: { const: 'reorder' }, nodeId: nonEmptyString, position: relativePosition },
      ['opId', 'type', 'nodeId', 'position'],
    ),
    strictObject({ opId: operationId, type: { const: 'remove' }, nodeId: nonEmptyString }, ['opId', 'type', 'nodeId']),
  ],
}

const availableDescriptors = [
  {
    schemaVersion: 1,
    capability: 'material.describe',
    revision: 'material.describe/1',
    availability: 'available',
    input: strictObject({ componentName: nonEmptyString }, ['componentName']),
    output: strictObject(
      {
        materialRegistryVersion: nonEmptyString,
        material: strictObject(
          {
            materialId: nonEmptyString,
            componentName: nonEmptyString,
            title: nonEmptyString,
            readiness: { type: 'string', enum: ['ready', 'unsupported'] },
            fields: {
              type: 'array',
              items: strictObject(
                {
                  fieldId: nonEmptyString,
                  access: { type: 'string', enum: ['read-only', 'read-write', 'unsupported'] },
                  valueSchema: { type: 'object' },
                },
                ['fieldId', 'access'],
              ),
            },
            diagnostics: stringArray,
          },
          ['materialId', 'componentName', 'title', 'readiness', 'fields', 'diagnostics'],
        ),
      },
      ['materialRegistryVersion', 'material'],
    ),
  },
  {
    schemaVersion: 1,
    capability: 'material.search',
    revision: 'material.search/1',
    availability: 'available',
    input: strictObject(
      {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      ['query'],
    ),
    output: strictObject(
      {
        materialRegistryVersion: nonEmptyString,
        matches: {
          type: 'array',
          items: strictObject(
            {
              materialId: nonEmptyString,
              componentName: nonEmptyString,
              title: nonEmptyString,
              categories: stringArray,
              readiness: { type: 'string', enum: ['ready', 'unsupported'] },
            },
            ['materialId', 'componentName', 'title', 'categories', 'readiness'],
          ),
        },
      },
      ['materialRegistryVersion', 'matches'],
    ),
  },
  {
    schemaVersion: 1,
    capability: 'screen.inspect',
    revision: 'screen.inspect/1',
    availability: 'available',
    input: strictObject({ nodeIds: { ...stringArray, maxItems: 200 } }),
    output: strictObject(
      {
        revision: nonEmptyString,
        nodes: {
          type: 'array',
          items: strictObject(
            {
              id: nonEmptyString,
              parentId: nullableNonEmptyString,
              index: { type: 'integer', minimum: 0 },
              componentName: nonEmptyString,
              title: nonEmptyString,
              rect: strictObject(
                {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  width: { type: 'number', minimum: 0 },
                  height: { type: 'number', minimum: 0 },
                },
                ['x', 'y', 'width', 'height'],
              ),
            },
            ['id', 'parentId', 'index', 'componentName', 'title', 'rect'],
          ),
        },
      },
      ['revision', 'nodes'],
    ),
  },
  {
    schemaVersion: 1,
    capability: 'screen.applyChangeSet',
    revision: 'screen.applyChangeSet/1',
    availability: 'available',
    input: strictObject(
      {
        schemaVersion: { const: 1 },
        documentId: nonEmptyString,
        operations: { type: 'array', minItems: 1, maxItems: 100, items: screenOperation },
      },
      ['schemaVersion', 'documentId', 'operations'],
    ),
    output: strictObject(),
  },
  {
    schemaVersion: 1,
    capability: 'task.compensate',
    revision: 'task.compensate/1',
    availability: 'available',
    input: strictObject({ schemaVersion: { const: 1 }, targetTaskId: nonEmptyString }, [
      'schemaVersion',
      'targetTaskId',
    ]),
    output: strictObject(),
  },
]

const futureCapabilityNames = [
  'artifact.createOnline',
  'artifact.promoteLocal',
  'artifact.reviseOnline',
  'data.bind',
  'data.inspect',
  'data.preview',
  'data.upsert',
  'project.checkpoint',
]

const unavailableDescriptors = futureCapabilityNames.map(capability => ({
  schemaVersion: 1,
  capability,
  revision: `${capability}/1`,
  availability: 'unavailable',
  unavailableReason: DASHBOARD_FUTURE_CAPABILITY_UNAVAILABLE_REASON,
  input: strictObject(),
  output: strictObject(),
}))

const compareCapabilities = (left, right) =>
  left.capability < right.capability ? -1 : left.capability > right.capability ? 1 : 0

const descriptors = [...availableDescriptors, ...unavailableDescriptors].sort(compareCapabilities)

export const DASHBOARD_CAPABILITY_DESCRIPTORS = deepFreeze(descriptors)

export const DASHBOARD_CAPABILITY_NAMES = Object.freeze(
  DASHBOARD_CAPABILITY_DESCRIPTORS.map(descriptor => descriptor.capability),
)

export const DASHBOARD_CAPABILITY_REGISTRY_HASH =
  'sha256:508e0617c7acf53e6e25fea25eebe6fcec09625d2cdc30e3a501fef0d3e70417'

export const DASHBOARD_CAPABILITY_REGISTRY_SNAPSHOT = deepFreeze({
  schemaVersion: DASHBOARD_CAPABILITY_REGISTRY_SCHEMA_VERSION,
  revision: DASHBOARD_CAPABILITY_REGISTRY_REVISION,
  hash: DASHBOARD_CAPABILITY_REGISTRY_HASH,
  capabilities: DASHBOARD_CAPABILITY_DESCRIPTORS,
})

const descriptorByName = new Map(
  DASHBOARD_CAPABILITY_DESCRIPTORS.map(descriptor => [descriptor.capability, descriptor]),
)

const capabilitySchemas = new Map(
  DASHBOARD_CAPABILITY_DESCRIPTORS.map(descriptor => [
    descriptor.capability,
    deepFreeze({
      schemaVersion: descriptor.schemaVersion,
      capability: descriptor.capability,
      revision: descriptor.revision,
      input: descriptor.input,
      output: descriptor.output,
    }),
  ]),
)

const errorMessage = (code, capability, reason) => {
  if (code === DASHBOARD_CAPABILITY_ERROR_CODE.unknown) return `Unknown capability: ${capability}`
  if (code === DASHBOARD_CAPABILITY_ERROR_CODE.unavailable) {
    return `Capability is unavailable: ${capability} (${reason})`
  }
  return `Invalid capability request: ${reason}`
}

export class DashboardCapabilityRegistryError extends Error {
  constructor(code, { capability = null, reason }) {
    super(errorMessage(code, capability, reason))
    this.name = 'DashboardCapabilityRegistryError'
    this.code = code
    this.capability = capability
    this.reason = reason
  }

  toJSON() {
    return {
      schemaVersion: DASHBOARD_CAPABILITY_REGISTRY_SCHEMA_VERSION,
      code: this.code,
      capability: this.capability,
      reason: this.reason,
    }
  }
}

const rejectInvalidRequest = (request, reason) => {
  const capability =
    request && typeof request === 'object' && typeof request.capability === 'string' ? request.capability : null
  throw new DashboardCapabilityRegistryError(DASHBOARD_CAPABILITY_ERROR_CODE.invalidRequest, {
    capability,
    reason,
  })
}

const validateDescribeRequest = request => {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    rejectInvalidRequest(request, 'request-must-be-an-object')
  }

  const requiredFields = ['branchId', 'capability', 'projectId', 'schemaVersion']
  const actualFields = Object.keys(request).sort()
  if (
    actualFields.length !== requiredFields.length ||
    actualFields.some((field, index) => field !== requiredFields[index])
  ) {
    rejectInvalidRequest(request, 'request-fields-must-match-contract')
  }
  if (request.schemaVersion !== DASHBOARD_CAPABILITY_REGISTRY_SCHEMA_VERSION) {
    rejectInvalidRequest(request, 'unsupported-schema-version')
  }
  for (const field of ['projectId', 'branchId', 'capability']) {
    if (typeof request[field] !== 'string' || request[field].length === 0) {
      rejectInvalidRequest(request, `${field}-must-be-a-non-empty-string`)
    }
  }
}

export const getDashboardCapabilityDescriptor = capability => {
  const descriptor = descriptorByName.get(capability)
  if (!descriptor) {
    throw new DashboardCapabilityRegistryError(DASHBOARD_CAPABILITY_ERROR_CODE.unknown, {
      capability,
      reason: 'unknown-capability',
    })
  }
  return descriptor
}

export const assertDashboardCapabilityAvailable = capability => {
  const descriptor = getDashboardCapabilityDescriptor(capability)
  if (descriptor.availability !== 'available') {
    throw new DashboardCapabilityRegistryError(DASHBOARD_CAPABILITY_ERROR_CODE.unavailable, {
      capability,
      reason: descriptor.unavailableReason,
    })
  }
  return descriptor
}

export const describeDashboardCapability = async request => {
  validateDescribeRequest(request)
  getDashboardCapabilityDescriptor(request.capability)
  return capabilitySchemas.get(request.capability)
}

export const listDashboardCapabilities = () => DASHBOARD_CAPABILITY_DESCRIPTORS

export const getDashboardCapabilityRegistrySnapshot = () => DASHBOARD_CAPABILITY_REGISTRY_SNAPSHOT

export const dashboardCapabilityRegistry = Object.freeze({
  assertAvailable: assertDashboardCapabilityAvailable,
  describeCapability: describeDashboardCapability,
  getDescriptor: getDashboardCapabilityDescriptor,
  listCapabilities: listDashboardCapabilities,
  snapshot: getDashboardCapabilityRegistrySnapshot,
})
