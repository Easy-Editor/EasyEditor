import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const workspaceDirectory = join(testDirectory, '../src/pages/editor/AgentWorkspace')

const sourceFileNames = (await readdir(workspaceDirectory))
  .filter(fileName => fileName.endsWith('.ts') && !fileName.endsWith('.d.ts'))
  .sort()
const testFileNames = sourceFileNames.filter(fileName => fileName.endsWith('.test.ts'))

if (testFileNames.length === 0) throw new Error('AgentWorkspace has no discoverable TypeScript unit tests')

const loadNativeTypeScriptTests = async () => {
  for (const fileName of testFileNames) {
    await import(pathToFileURL(join(workspaceDirectory, fileName)).href)
  }
}

const loadTranspiledTypeScriptTests = async () => {
  const { default: typescript } = await import('typescript')
  const outputDirectory = await mkdtemp(join(testDirectory, '.agent-workspace-tests-'))

  try {
    await writeFile(join(outputDirectory, 'package.json'), '{"type":"module"}\n')

    for (const fileName of sourceFileNames) {
      const source = await readFile(join(workspaceDirectory, fileName), 'utf8')
      const result = typescript.transpileModule(source, {
        fileName,
        reportDiagnostics: true,
        compilerOptions: {
          esModuleInterop: true,
          module: typescript.ModuleKind.ESNext,
          rewriteRelativeImportExtensions: true,
          target: typescript.ScriptTarget.ES2022,
        },
      })
      const errors = result.diagnostics?.filter(
        diagnostic => diagnostic.category === typescript.DiagnosticCategory.Error,
      )
      if (errors?.length) {
        throw new Error(
          typescript.formatDiagnostics(errors, {
            getCanonicalFileName: fileName => fileName,
            getCurrentDirectory: () => workspaceDirectory,
            getNewLine: () => '\n',
          }),
        )
      }
      await writeFile(join(outputDirectory, fileName.replace(/\.ts$/, '.js')), result.outputText)
    }

    for (const fileName of testFileNames) {
      await import(pathToFileURL(join(outputDirectory, fileName.replace(/\.ts$/, '.js'))).href)
    }
  } finally {
    await rm(outputDirectory, { force: true, recursive: true })
  }
}

if (process.features.typescript) {
  await loadNativeTypeScriptTests()
} else {
  await loadTranspiledTypeScriptTests()
}
