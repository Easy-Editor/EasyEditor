const OPERATION_ORDER = ['insertNode', 'updateProps', 'moveNode', 'removeNode']

const uniqueCount = values => new Set(values).size

export const createAgentPlanSummary = preview => {
  const operations = []
  const affectedNodeIds = []

  for (const type of OPERATION_ORDER) {
    const effects = preview.effects.filter(effect => effect.type === type)
    if (effects.length === 0) continue
    const commandIndexes = effects.map(effect => effect.commandIndex)
    const operationNodeIds = effects.flatMap(effect => effect.nodeIds)
    affectedNodeIds.push(...operationNodeIds)
    operations.push(
      Object.freeze({
        affectedNodeCount: uniqueCount(operationNodeIds),
        commandCount: uniqueCount(commandIndexes),
        type,
      }),
    )
  }

  const destructive = operations.find(operation => operation.type === 'removeNode')
  return Object.freeze({
    affectedNodeCount: uniqueCount(affectedNodeIds),
    commandCount: preview.commandCount,
    destructiveCommandCount: destructive?.commandCount ?? 0,
    operations: Object.freeze(operations),
  })
}
