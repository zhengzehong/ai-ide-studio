import { useMemo, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight, Clock, FileCode, User } from 'lucide-react';
import type { ActionType, Agent, AgentType, Session } from '../../types';

interface SessionTimelineProps {
  session: Session;
  agent: Agent;
}

const c = {
  bg0: 'var(--bg-0)',
  bg1: 'var(--bg-1)',
  bg2: 'var(--bg-2)',
  bg3: 'var(--bg-3)',
  bg4: 'var(--bg-4)',
  border: 'var(--border)',
  text1: 'var(--text-1)',
  text2: 'var(--text-2)',
  text3: 'var(--text-3)',
  blue: 'var(--blue)',
  green: 'var(--green)',
  yellow: 'var(--yellow)',
  red: 'var(--red)',
  purple: 'var(--purple)',
  orange: 'var(--orange)',
  gold: '#e3b341',
} as const;

const AGENT_COLORS: Record<AgentType, string> = {
  dev: c.blue,
  test: c.green,
  ops: c.orange,
  security: c.red,
  architect: c.purple,
  pm: c.purple,
};

interface ActionMeta {
  dotColor: string;
  icon: string;
  label: string;
}

const ACTION_META: Record<ActionType, ActionMeta> = {
  code_write: { dotColor: c.green, icon: '📝', label: 'Code Write' },
  reasoning: { dotColor: c.blue, icon: '🧠', label: 'Reasoning' },
  human_interaction: { dotColor: c.purple, icon: '💬', label: 'Human Interaction' },
  tool_call: { dotColor: c.orange, icon: '⚡', label: 'Tool Call' },
  notification: { dotColor: c.text3, icon: '📨', label: 'Notification' },
  milestone: { dotColor: c.gold, icon: '✅', label: 'Milestone' },
  error: { dotColor: c.red, icon: '❌', label: 'Error' },
  start: { dotColor: c.text3, icon: '🚀', label: 'Start' },
};


export default function SessionTimeline({ session, agent }: SessionTimelineProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const fileCount = useMemo(() => {
    const files = new Set<string>();
    for (const action of session.actions) {
      action.files?.forEach((f) => files.add(f));
    }
    return files.size;
  }, [session.actions]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const agentColor = AGENT_COLORS[agent.type] ?? c.blue;

  const summaryStyle: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 16,
    padding: '14px 16px',
    background: c.bg2,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    marginBottom: 20,
  };

  return (
    <div style={{ padding: 16, color: c.text1 }}>
      {/* Summary bar */}
      <div style={summaryStyle}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{session.taskName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: c.text2 }}>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: agentColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                fontWeight: 700,
                color: c.bg0,
              }}
            >
              {agent.avatar}
            </div>
            <User size={12} />
            <span>{agent.name}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.text2 }}>
          <Clock size={14} />
          <span>{session.duration}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.text2 }}>
          <FileCode size={14} />
          <span>{fileCount} files</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: c.text2 }}>
          <span style={{ padding: '2px 8px', borderRadius: 4, background: c.bg2, fontWeight: 500 }}>
            {session.stage}
          </span>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ position: 'relative' }}>
        {session.actions.map((action, index) => {
          const meta = ACTION_META[action.type];
          const isExpanded = expandedIds.has(action.id);
          const hasDetails = Boolean(action.details);
          const isLast = index === session.actions.length - 1;

          return (
            <div
              key={action.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '48px 20px 1fr',
                gap: '0 12px',
                position: 'relative',
                paddingBottom: isLast ? 0 : 16,
              }}
            >
              {/* Vertical connector line */}
              {!isLast && (
                <div
                  style={{
                    position: 'absolute',
                    left: 68,
                    top: 22,
                    bottom: 0,
                    width: 2,
                    background: c.bg4,
                    zIndex: 0,
                  }}
                />
              )}

              {/* Time */}
              <div
                style={{
                  fontSize: 11,
                  color: c.text3,
                  fontFamily: 'ui-monospace, monospace',
                  paddingTop: 4,
                  textAlign: 'right',
                }}
              >
                {action.time}
              </div>

              {/* Dot */}
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 6, position: 'relative', zIndex: 1 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: meta.dotColor,
                    boxShadow: `0 0 0 3px ${c.bg0}`,
                    flexShrink: 0,
                  }}
                />
              </div>

              {/* Content card */}
              <button
                type="button"
                onClick={() => hasDetails && toggleExpand(action.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: c.bg2,
                  border: `1px solid ${isExpanded ? meta.dotColor : c.border}`,
                  borderRadius: 8,
                  cursor: hasDetails ? 'pointer' : 'default',
                  color: c.text1,
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                  boxShadow: isExpanded ? `0 0 0 1px ${meta.dotColor}33` : 'none',
                }}
                onMouseEnter={(e) => {
                  if (hasDetails) {
                    e.currentTarget.style.borderColor = meta.dotColor;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isExpanded) {
                    e.currentTarget.style.borderColor = c.border;
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 14, lineHeight: 1.2, flexShrink: 0 }}>{meta.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          color: meta.dotColor,
                        }}
                      >
                        {meta.label}
                      </span>
                      {hasDetails &&
                        (isExpanded ? (
                          <ChevronDown size={12} color={c.text3} />
                        ) : (
                          <ChevronRight size={12} color={c.text3} />
                        ))}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.5, color: c.text1 }}>{action.content}</div>

                    {action.files && action.files.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                        {action.files.map((file) => (
                          <span
                            key={file}
                            style={{
                              fontSize: 10,
                              fontFamily: 'ui-monospace, monospace',
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: c.bg3,
                              color: c.blue,
                              border: `1px solid ${c.border}`,
                            }}
                          >
                            {file}
                          </span>
                        ))}
                      </div>
                    )}

                    {isExpanded && action.details && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: '8px 10px',
                          background: c.bg3,
                          borderRadius: 6,
                          fontSize: 12,
                          color: c.text2,
                          lineHeight: 1.5,
                          fontFamily: 'ui-monospace, monospace',
                          borderLeft: `3px solid ${meta.dotColor}`,
                        }}
                      >
                        {action.details}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
