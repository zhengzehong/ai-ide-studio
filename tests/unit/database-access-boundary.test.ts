import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ALLOWED_DIRECT_GET_DB_IMPORTS = new Set([
  'src/core/persistence/local-write-data-port.ts',
  'src/core/timeline.ts',
  'src/data-worker/query-worker/operations.ts',
  'src/gateway/rpc/widget.ts',
  'src/model-capture/classify.ts',
  'src/tools/registry/context-registry.ts',
  'src/tools/runtime/audit-service.ts',
  'src/tools/seed.ts',
])

describe('database access boundary', () => {
  it('does not add a new direct getDb caller outside the recorded compatibility boundary', () => {
    const root = resolve(process.cwd(), 'src')
    const directImports = sourceFiles(root)
      .filter((file) => importsGetDb(file))
      .map((file) => normalizeRelative(file))

    expect(new Set(directImports)).toEqual(ALLOWED_DIRECT_GET_DB_IMPORTS)
  })
})

function sourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(directory)) {
    const path = resolve(directory, name)
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path))
    else if (name.endsWith('.ts')) files.push(path)
  }
  return files
}

function importsGetDb(file: string): boolean {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  return source.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false
    if (!statement.moduleSpecifier.text.endsWith('/store/db.js') && statement.moduleSpecifier.text !== '../../store/db.js') {
      return false
    }
    const bindings = statement.importClause?.namedBindings
    return !!bindings
      && ts.isNamedImports(bindings)
      && bindings.elements.some((element) => element.name.text === 'getDb')
  })
}

function normalizeRelative(file: string): string {
  return file.slice(process.cwd().length + 1).replaceAll('\\', '/')
}
