import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'

const PROCESS_DIRECTORIES = [
  'src/runtime/service',
  'src/runtime/actors',
  'src/runtime/streams',
  'src/runtime/resources',
]

describe('Runtime process boundary', () => {
  test('does not import API domain, database, Gateway, or Data Worker modules', () => {
    const violations = PROCESS_DIRECTORIES.flatMap((directory) => sourceFiles(resolve(process.cwd(), directory)))
      .flatMap((file) => importsOf(file)
        .filter(isForbiddenRuntimeImport)
        .map((moduleName) => `${relativePath(file)} -> ${moduleName}`))

    expect(violations).toEqual([])
  })

  test('keeps Store access in API-side snapshot and embedded adapters', () => {
    const runtimeFiles = sourceFiles(resolve(process.cwd(), 'src/runtime'))
    const storeImporters = runtimeFiles
      .filter((file) => importsOf(file).some((moduleName) => moduleName.includes('/store/')))
      .map(relativePath)

    expect(new Set(storeImporters)).toEqual(new Set([
      'src/runtime/api/runtime-snapshot.ts',
    ]))
  })

  test('uses the shared process-safe logger in Runtime child modules', () => {
    const childFiles = sourceFiles(resolve(process.cwd(), 'src/runtime/service'))
    const forbiddenLoggerImports = childFiles.flatMap((file) => importsOf(file)
      .filter((moduleName) => moduleName.includes('/core/logger'))
      .map((moduleName) => `${relativePath(file)} -> ${moduleName}`))

    expect(forbiddenLoggerImports).toEqual([])
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

function importsOf(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return []
    return [statement.moduleSpecifier.text]
  })
}

function isForbiddenRuntimeImport(moduleName: string): boolean {
  return moduleName === 'better-sqlite3'
    || moduleName === 'hono'
    || moduleName.includes('/store/')
    || moduleName.includes('/core/')
    || moduleName.includes('/gateway/')
    || moduleName.includes('/data-worker/')
    || moduleName.endsWith('/acp/host.js')
}

function relativePath(file: string): string {
  return file.slice(process.cwd().length + 1).replaceAll('\\', '/')
}
