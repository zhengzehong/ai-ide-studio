export function resolveWorkerEntryUrl(relativePathWithoutExtension: string, moduleUrl: string): URL {
  const extension = new URL(moduleUrl).pathname.endsWith('.ts') ? '.ts' : '.js'
  return new URL(`${relativePathWithoutExtension}${extension}`, moduleUrl)
}
