export const DASHBOARD_CAPABILITY_REGISTRY_SCHEMA_VERSION = 1
export const DASHBOARD_CAPABILITY_REGISTRY_REVISION = 'dashboard-capability-registry/3'
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
const safeDataId = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }
const safeDataReference = { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' }
const nullableNonEmptyString = { type: ['string', 'null'], minLength: 1 }
const stringArray = { type: 'array', items: nonEmptyString, uniqueItems: true }
const jsonValue = {}
const operationId = { type: 'string', minLength: 1, maxLength: 256 }
const safePath = { type: 'array', maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 128 } }
const dataTransform = {
  type: 'array',
  maxItems: 32,
  items: {
    oneOf: [
      strictObject({ op: { const: 'select' }, path: safePath }, ['op', 'path']),
      strictObject(
        {
          op: { const: 'project' },
          fields: { type: 'object', minProperties: 1, maxProperties: 128, additionalProperties: safePath },
        },
        ['op', 'fields'],
      ),
      strictObject(
        {
          op: { const: 'filter' },
          path: safePath,
          operator: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] },
          value: { type: ['boolean', 'number', 'string', 'null'] },
        },
        ['op', 'path', 'operator', 'value'],
      ),
      strictObject({ op: { const: 'sort' }, path: safePath, direction: { type: 'string', enum: ['asc', 'desc'] } }, [
        'op',
        'path',
      ]),
      strictObject({ op: { const: 'take' }, count: { type: 'integer', minimum: 0, maximum: 500 } }, ['op', 'count']),
      strictObject({ op: { const: 'limit' }, count: { type: 'integer', minimum: 0, maximum: 500 } }, ['op', 'count']),
    ],
  },
}
const publicDataRequest = strictObject(
  {
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    method: { const: 'GET' },
  },
  ['url', 'method'],
)
const credentialedDataRequest = strictObject(
  {
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    method: { type: 'string', enum: ['GET', 'POST'] },
    body: jsonValue,
  },
  ['url', 'method'],
)
const safeDataDescriptor = {
  oneOf: [
    strictObject(
      {
        schemaVersion: { const: 1 },
        id: safeDataId,
        kind: { const: 'static' },
        value: jsonValue,
        transform: dataTransform,
      },
      ['schemaVersion', 'id', 'kind', 'value'],
    ),
    strictObject(
      {
        schemaVersion: { const: 1 },
        id: safeDataId,
        kind: { const: 'mock' },
        fixture: jsonValue,
        transform: dataTransform,
      },
      ['schemaVersion', 'id', 'kind', 'fixture'],
    ),
    strictObject(
      {
        schemaVersion: { const: 1 },
        id: safeDataId,
        kind: { const: 'public-http-json' },
        request: publicDataRequest,
        transform: dataTransform,
      },
      ['schemaVersion', 'id', 'kind', 'request'],
    ),
    strictObject(
      {
        schemaVersion: { const: 1 },
        id: safeDataId,
        kind: { const: 'credentialed-http-json' },
        providerId: safeDataId,
        credentialRef: safeDataReference,
        request: credentialedDataRequest,
        transform: dataTransform,
      },
      ['schemaVersion', 'id', 'kind', 'providerId', 'credentialRef', 'request'],
    ),
  ],
}
const dataSourceSummary = strictObject(
  {
    schemaVersion: { const: 1 },
    id: safeDataId,
    kind: { type: 'string', enum: ['static', 'mock', 'public-http-json', 'credentialed-http-json'] },
    hasTransform: { type: 'boolean' },
    providerId: safeDataId,
    destination: strictObject({ url: nonEmptyString, method: { type: 'string', enum: ['GET', 'POST'] } }, [
      'url',
      'method',
    ]),
  },
  ['schemaVersion', 'id', 'kind', 'hasTransform'],
)
const pageDataScope = strictObject({ kind: { const: 'page' }, documentId: nonEmptyString }, ['kind', 'documentId'])

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
  {
    schemaVersion: 1,
    capability: 'data.inspect',
    revision: 'data.inspect/1',
    availability: 'available',
    input: strictObject({ schemaVersion: { const: 1 }, sourceId: safeDataId }, ['schemaVersion']),
    output: strictObject(
      {
        schemaVersion: { const: 1 },
        scope: pageDataScope,
        sources: { type: 'array', maxItems: 100, items: dataSourceSummary },
      },
      ['schemaVersion', 'scope', 'sources'],
    ),
  },
  {
    schemaVersion: 1,
    capability: 'data.preview',
    revision: 'data.preview/1',
    availability: 'available',
    input: {
      ...strictObject({ schemaVersion: { const: 1 }, sourceId: safeDataId, descriptor: safeDataDescriptor }, [
        'schemaVersion',
      ]),
      oneOf: [{ required: ['sourceId'] }, { required: ['descriptor'] }],
    },
    output: strictObject(
      {
        schemaVersion: { const: 1 },
        scope: pageDataScope,
        source: dataSourceSummary,
        preview: strictObject(
          {
            kind: { type: 'string', enum: ['rows', 'object', 'scalar'] },
            rowCount: { type: 'integer', minimum: 0, maximum: 500 },
            keys: { type: 'array', maxItems: 100, items: nonEmptyString },
            sample: jsonValue,
          },
          ['kind', 'sample'],
        ),
      },
      ['schemaVersion', 'scope', 'source', 'preview'],
    ),
  },
  {
    schemaVersion: 1,
    capability: 'data.upsert',
    revision: 'data.upsert/1',
    availability: 'available',
    input: strictObject({ schemaVersion: { const: 1 }, descriptor: safeDataDescriptor }, [
      'schemaVersion',
      'descriptor',
    ]),
    output: strictObject(),
  },
  {
    schemaVersion: 1,
    capability: 'data.bind',
    revision: 'data.bind/1',
    availability: 'available',
    input: strictObject(
      {
        schemaVersion: { const: 1 },
        nodeId: safeDataId,
        field: { type: 'string', enum: ['text', 'data'] },
        binding: strictObject({ sourceId: safeDataId, transform: dataTransform }, ['sourceId']),
      },
      ['schemaVersion', 'nodeId', 'field', 'binding'],
    ),
    output: strictObject(),
  },
]

const futureCapabilityNames = [
  'artifact.createOnline',
  'artifact.promoteLocal',
  'artifact.reviseOnline',
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
  'sha256:ff263fbba1d0f171176ef6f118884881bcae29c3ea36265e4dc8cf4323419352'

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
