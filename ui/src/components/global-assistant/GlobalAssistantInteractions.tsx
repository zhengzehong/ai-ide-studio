import { useState } from 'react'
import type { ElicitationRequestInfo, PermissionRequestInfo } from '../../stores/session-events'
import { toolSummary } from '../../pages/workspace/helpers'
import { permissionOptionLabel } from '../../utils/permission'
import {
  getElicitationOptions,
  getInitialElicitationValues,
  validateElicitationValues,
  type ElicitationSchema,
  type ElicitationValue,
} from '../../utils/elicitation-form'

type ElicitationContent = Record<string, string | number | boolean | string[]>

export function InteractionPanel({
  permission,
  elicitation,
  onRespondPermission,
  onRespondElicitation,
}: {
  permission?: PermissionRequestInfo
  elicitation?: ElicitationRequestInfo
  onRespondPermission: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
  onRespondElicitation: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: ElicitationContent) => Promise<void>
}) {
  if (permission) return <PermissionCard request={permission} onRespond={onRespondPermission} />
  if (elicitation) return <ElicitationCard request={elicitation} onRespond={onRespondElicitation} />
  return null
}

function PermissionCard({
  request,
  onRespond,
}: {
  request: PermissionRequestInfo
  onRespond: (requestId: string, optionId?: string, cancelled?: boolean) => Promise<void>
}) {
  const [submitting, setSubmitting] = useState(false)
  const respond = async (optionId?: string, cancelled?: boolean) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onRespond(request.id, optionId, cancelled)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="global-assistant-interaction-card">
      <strong>需要确认工具调用</strong>
      <span>{toolSummary(request.toolCall)}</span>
      <div className="global-assistant-interaction-actions">
        {request.options.map((option) => (
          <button key={option.optionId} type="button" disabled={submitting} onClick={() => { void respond(option.optionId) }}>
            {permissionOptionLabel(option)}
          </button>
        ))}
        <button type="button" disabled={submitting} onClick={() => { void respond(undefined, true) }}>取消本次</button>
      </div>
    </div>
  )
}

function ElicitationCard({
  request,
  onRespond,
}: {
  request: ElicitationRequestInfo
  onRespond: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: ElicitationContent) => Promise<void>
}) {
  const schema = request.requestedSchema as ElicitationSchema | undefined
  const props = schema?.properties || {}
  const [values, setValues] = useState<Record<string, ElicitationValue>>(() => getInitialElicitationValues(schema))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const submit = async () => {
    const result = validateElicitationValues(schema, values)
    setErrors(result.errors)
    if (result.ok) await onRespond(request.id, 'accept', values)
  }

  return (
    <div className="global-assistant-interaction-card">
      <strong>AI 提问</strong>
      {request.message && <span>{request.message}</span>}
      {Object.entries(props).map(([key, prop]) => {
        const options = getElicitationOptions(prop)
        return (
          <label key={key}>
            <span>{prop.title || key}{schema?.required?.includes(key) ? ' *' : ''}</span>
            {options.length > 0 ? (
              <select value={String(values[key] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}>
                <option value="">请选择</option>
                {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : (
              <input value={String(values[key] ?? '')} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} />
            )}
            {errors[key] && <small className="global-assistant-error">{errors[key]}</small>}
          </label>
        )
      })}
      <div className="global-assistant-interaction-actions">
        <button type="button" onClick={() => { void submit() }}>提交</button>
        <button type="button" onClick={() => { void onRespond(request.id, 'decline') }}>拒绝</button>
        <button type="button" onClick={() => { void onRespond(request.id, 'cancel') }}>取消</button>
      </div>
    </div>
  )
}
