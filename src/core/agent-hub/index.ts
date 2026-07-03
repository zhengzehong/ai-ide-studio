export { agentHubService } from './connection-manager.js'
export { getOrCreateMachineId, getMachineLabel, resetCachedMachineIdForTest } from './machine-id.js'
export { loadAgentHubConfig, type AgentHubConfig } from './config.js'
export { buildHubNaming, type AgentInfo, type NamingInput, type NamingResult } from './naming.js'
export { SseClient, type TaskEventData, type ResultEventData } from './sse-client.js'
export { hubClient, type RegisterResponse, type SearchAgentResult } from './hub-client.js'
export {
  formatInboundPrompt,
  extractResultText,
  handleInboundTask,
  handleOutboundResult,
  buildSseHandlers,
  type HubConnection,
  type OutboundTask,
  type InboundTask,
} from './task-relay.js'
