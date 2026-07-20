export type RuntimeControlRequestResponse =
  | { result: unknown }
  | { error: string }

export async function runRuntimeControlRequest(input: {
  execute: () => Promise<unknown>
  reply: (response: RuntimeControlRequestResponse) => Promise<void>
  isStopping: () => boolean
}): Promise<void> {
  let response: RuntimeControlRequestResponse
  try {
    response = { result: await input.execute() }
  } catch (error) {
    response = { error: errorMessage(error) }
  }
  if (input.isStopping()) return
  await input.reply(response)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
