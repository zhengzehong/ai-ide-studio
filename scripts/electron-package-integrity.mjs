import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

// Parse emitted JavaScript, never execute main/preload code during the build check.
export function validateElectronModules(directory, { exclude = [] } = {}) {
  const files = collectModules(directory).filter((file) => !exclude.includes(file.slice(resolve(directory).length + 1)))
  if (!files.length) throw new Error(`Missing Electron modules: ${directory}`)
  for (const file of files) validateModule(file)
  return files.length
}

function validateModule(file) {
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const visit = (node) => {
    let specifier
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      specifier = node.arguments[0]
    if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith('.')) {
      const target = resolve(dirname(file), specifier.text)
      if (!existsSync(target) || !statSync(target).isFile()) {
        throw new Error(`Missing Electron dependency: ${file} -> ${specifier.text}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
}

export function validatePackagedElectron(unpackedDirectory, compiledDirectory) {
  const packaged = join(unpackedDirectory, 'resources', 'app', 'electron', 'dist')
  // Also covers preload entry points referenced by paths rather than JS imports.
  for (const file of collectModules(compiledDirectory)) {
    const relative = file.slice(resolve(compiledDirectory).length + 1)
    const target =
      relative === 'backend-main.js'
        ? join(unpackedDirectory, 'resources', 'app', 'electron', relative)
        : join(packaged, relative)
    if (!existsSync(target)) throw new Error(`Missing packaged Electron module: ${relative}`)
    if (!readFileSync(file).equals(readFileSync(target))) throw new Error(`Stale packaged Electron module: ${relative}`)
    if (relative === 'backend-main.js') validateModule(target)
  }
  return validateElectronModules(packaged)
}

export function validatePackagedDependencies(appDirectory) {
  const root = resolve(appDirectory)
  const visited = new Set()
  const inspect = (directory) => {
    if (visited.has(directory)) return
    visited.add(directory)
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      let cursor = directory
      let found
      while (true) {
        const candidate = join(cursor, 'node_modules', name)
        if (existsSync(join(candidate, 'package.json'))) { found = candidate; break }
        if (cursor === root) break
        cursor = dirname(cursor)
      }
      if (!found) {
        if (name in (manifest.optionalDependencies ?? {})) continue
        throw new Error(`Missing packaged dependency: ${manifest.name ?? directory} -> ${name}`)
      }
      inspect(found)
    }
  }
  inspect(root)
  return visited.size
}

function collectModules(directory) {
  if (!existsSync(directory)) throw new Error(`Missing Electron directory: ${directory}`)
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name)
    return entry.isDirectory() ? collectModules(file) : /\.(?:c|m)?js$/.test(entry.name) ? [file] : []
  })
}
