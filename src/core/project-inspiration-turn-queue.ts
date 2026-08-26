const projectTurnTails = new Map<string, Promise<void>>()

export function enqueueProjectInspirationTurn<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  const previous = projectTurnTails.get(projectId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(work)
  const tail = current.then(() => undefined, () => undefined)
  projectTurnTails.set(projectId, tail)
  void tail.then(() => {
    if (projectTurnTails.get(projectId) === tail) projectTurnTails.delete(projectId)
  })
  return current
}
