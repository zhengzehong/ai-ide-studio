export type LoadRecoveryChoice = 'retry' | 'edit' | 'quit'

export interface LoadRecoveryOptions {
  isClosed: () => boolean
  choose: (errorMessage: string) => Promise<LoadRecoveryChoice>
  reload: () => Promise<void>
  editConnection: () => Promise<'saved' | 'cancelled'>
  quit: () => void
}

export async function runLoadRecovery(
  initialError: string,
  options: LoadRecoveryOptions,
): Promise<void> {
  let errorMessage = initialError
  while (!options.isClosed()) {
    const choice = await options.choose(errorMessage)
    if (choice === 'quit') {
      options.quit()
      return
    }
    if (choice === 'retry') {
      try {
        await options.reload()
        return
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error)
      }
      continue
    }
    try {
      if (await options.editConnection() === 'saved') return
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    }
  }
}
