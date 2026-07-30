import { normalizeRemoteOrigin } from './desktop-connection.js'

interface DesktopInfoResponse {
  product: string
  protocolVersion: string
}

export async function probeDesktopConnection(
  originValue: string,
  tokenValue: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ origin: string; protocolVersion: string }> {
  const origin = normalizeRemoteOrigin(originValue)
  const token = tokenValue.trim()
  if (!token) throw new Error('请输入远程服务器访问密钥')

  let response: Response
  try {
    response = await fetchImpl(`${origin}/api/v1/desktop-info`, {
      headers: { Accept: 'application/json', 'x-ai-ide-token': token },
      signal: AbortSignal.timeout(8_000),
    })
  } catch (error) {
    throw new Error('无法连接远程服务器', { cause: error })
  }
  if (response.status === 401) throw new Error('访问密钥无效')
  if (!response.ok) throw new Error(`远程服务器检测失败（HTTP ${response.status}）`)
  const body = await response.json().catch(() => null) as DesktopInfoResponse | null
  if (body?.product !== 'ai-ide-studio' || body.protocolVersion !== '1') {
    throw new Error('远程服务器版本不兼容')
  }
  return { origin, protocolVersion: body.protocolVersion }
}
