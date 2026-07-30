export interface DesktopSetupResult {
  ok: boolean
  error?: string
}

type DesktopSetupSubmit = (input: unknown) => Promise<DesktopSetupResult>

export async function runDesktopSetupSubmission(
  submit: DesktopSetupSubmit | undefined,
  input: unknown,
  timeoutMs = 10_000,
): Promise<DesktopSetupResult> {
  if (!submit) return { ok: false, error: '桌面连接组件加载失败，请重新启动客户端' }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<DesktopSetupResult>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve({ ok: false, error: '连接检查超时，请确认服务器地址后重试' })
      }, timeoutMs)
    })
    return await Promise.race([submit(input), timeout])
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
