export type AgentType = 'dev' | 'test' | 'ops' | 'security' | 'architect' | 'pm';
export type AgentStatus = 'busy' | 'idle' | 'standby';
export type SessionStatus = 'active' | 'waiting' | 'suspended' | 'completed';
export type TaskStatus = 'backlog' | 'planning' | 'executing' | 'blocked' | 'reviewing' | 'completed' | 'cancelled';
export type TaskSource = 'human' | 'agent' | 'event' | 'schedule';
export type PermissionLevel = 0 | 1 | 2 | 3 | 4;
export type MessageRole = 'agent' | 'human' | 'system';
export type ActionType = 'code_write' | 'reasoning' | 'human_interaction' | 'tool_call' | 'notification' | 'milestone' | 'error' | 'start';

export interface Agent {
  id: string;
  type: AgentType;
  name: string;
  avatar: string;
  focusAreas: string[];
  status: AgentStatus;
  permissionLevel: PermissionLevel;
  activeSessions: Session[];
  taskCount: number;
  todayCompleted: number;
  memory: string[];
  behaviors: Behavior[];
}

export interface Session {
  id: string;
  agentId: string;
  taskId?: string;
  taskName: string;
  status: SessionStatus;
  stage: string;
  startedAt: string;
  duration: string;
  currentAction: string;
  actions: SessionAction[];
}

export interface SessionAction {
  id: string;
  time: string;
  type: ActionType;
  content: string;
  files?: string[];
  details?: string;
}

export interface Task {
  id: string;
  title: string;
  source: TaskSource;
  status: TaskStatus;
  stage: string;
  assignedAgents: { agentId: string; role: 'primary' | 'collaborator' }[];
  subtasks?: SubTask[];
  sessionIds: string[];
  createdAt: string;
}

export interface SubTask {
  id: string;
  title: string;
  status: 'done' | 'in_progress' | 'waiting';
  assignedAgentId: string;
}

export interface Behavior {
  id: string;
  trigger: string;
  triggerType: 'schedule' | 'event';
  action: string;
  description: string;
  agentId: string;
  permissionLevel: PermissionLevel;
  enabled: boolean;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  agentId?: string;
  sessionId?: string;
  content: string;
  timestamp: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  decision?: Decision;
  actions?: string[];
}

export interface ToolCall {
  name: string;
  args: string;
  result?: string;
  status: 'running' | 'done' | 'error';
}

export interface Decision {
  question: string;
  options: string[];
  chosen?: string;
  decidedBy?: 'human' | 'agent';
}

export interface Notification {
  id: string;
  type: 'decision' | 'complete' | 'error' | 'info';
  title: string;
  description: string;
  agentId: string;
  taskId?: string;
  timestamp: string;
  read: boolean;
}
