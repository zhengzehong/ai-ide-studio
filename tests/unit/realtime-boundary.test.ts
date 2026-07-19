import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

describe('Realtime process boundary', () => {
  it('does not import Core, Store, SQLite, or Gateway RPC modules', () => {
    const realtimeRoot = resolve(process.cwd(), 'src/realtime')
    const violations = sourceFiles(realtimeRoot).flatMap((file) =>
      importsOf(file)
        .filter(isForbiddenRealtimeImport)
        .map((moduleName) => `${relativePath(file)} -> ${moduleName}`),
    )

    expect(violations).toEqual([])
  })

  it('keeps the API event source independent from WebSocket implementations', () => {
    const eventSource = resolve(process.cwd(), 'src/gateway/realtime-event-source.ts')

    expect(importsOf(eventSource)).not.toContain('ws')
  })

  it('keeps the Realtime child independent from Hono and domain stores', () => {
    const childFiles = [
      resolve(process.cwd(), 'src/realtime/entry.ts'),
      resolve(process.cwd(), 'src/realtime/service.ts'),
    ]
    const violations = childFiles.flatMap((file) =>
      importsOf(file)
        .filter((moduleName) => moduleName === 'hono' || moduleName.includes('/store/'))
        .map((moduleName) => `${relativePath(file)} -> ${moduleName}`),
    )

    expect(violations).toEqual([])
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
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  return source.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return []
    return [statement.moduleSpecifier.text]
  })
}

function isForbiddenRealtimeImport(moduleName: string): boolean {
  return moduleName === 'better-sqlite3'
    || moduleName.includes('/core/')
    || moduleName.includes('/store/')
    || moduleName.includes('/gateway/rpc/')
}

function relativePath(file: string): string {
  return file.slice(process.cwd().length + 1).replaceAll('\\', '/')
}
