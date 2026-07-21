import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

describe('public Edge process boundary', () => {
  it('keeps Edge modules outside domain, database, and runtime implementations', () => {
    const edgeRoot = resolve(process.cwd(), 'src/edge')
    const violations = sourceFiles(edgeRoot).flatMap((file) => importsOf(file)
      .filter((moduleName) => isForbiddenEdgeImport(file, moduleName))
      .map((moduleName) => `${relativePath(file)} -> ${moduleName}`))

    expect(violations).toEqual([])
  })

  it('loads the monolithic application only through the API child entry', () => {
    const edgeRoot = resolve(process.cwd(), 'src/edge')
    const appImporters = sourceFiles(edgeRoot)
      .filter((file) => importsOf(file).includes('../app.js'))
      .map(relativePath)

    expect(appImporters).toEqual(['src/edge/api-entry.ts'])
  })

  it('does not statically import the application from the production entry', () => {
    const imports = importsOf(resolve(process.cwd(), 'src/entry.ts'))

    expect(imports).not.toContain('./app.js')
  })
})

function isForbiddenEdgeImport(file: string, moduleName: string): boolean {
  if (moduleName === '../app.js') return !file.endsWith('api-entry.ts')
  if (moduleName === '../core/config.js') return false
  return moduleName === 'better-sqlite3'
    || moduleName === 'hono'
    || moduleName.includes('/store/')
    || moduleName.includes('/gateway/')
    || moduleName.includes('/acp/')
    || moduleName.includes('/runtime/')
    || moduleName.includes('/realtime/')
    || moduleName.includes('/data-worker/')
    || (moduleName.includes('/core/') && moduleName !== '../core/config.js')
}

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

function relativePath(file: string): string {
  return file.slice(process.cwd().length + 1).replaceAll('\\', '/')
}
