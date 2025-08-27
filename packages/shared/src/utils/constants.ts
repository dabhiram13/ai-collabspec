// API endpoints and configuration constants
export const API_ENDPOINTS = {
  AUTH: '/api/auth',
  USERS: '/api/users',
  SPECIFICATIONS: '/api/specifications',
  CONVERSATIONS: '/api/conversations',
  INTEGRATIONS: '/api/integrations',
  WORKFLOWS: '/api/workflows',
  WEBSOCKET: '/socket.io',
} as const;

// WebSocket event types for real-time collaboration
export const WEBSOCKET_EVENTS = {
  // Connection events
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  
  // Specification events
  SPEC_UPDATED: 'specification:updated',
  SPEC_CREATED: 'specification:created',
  SPEC_DELETED: 'specification:deleted',
  
  // Collaboration events
  USER_JOINED: 'user:joined',
  USER_LEFT: 'user:left',
  USER_TYPING: 'user:typing',
  
  // Conversation events
  MESSAGE_SENT: 'conversation:message',
  CONVERSATION_CREATED: 'conversation:created',
  
  // Integration events
  GITHUB_SYNC: 'integration:github:sync',
  SLACK_MESSAGE: 'integration:slack:message',
  JIRA_UPDATE: 'integration:jira:update',
} as const;

// Performance and scaling constants
export const PERFORMANCE_LIMITS = {
  MAX_CONCURRENT_USERS: 100,
  WEBSOCKET_TIMEOUT: 30000, // 30 seconds
  API_RATE_LIMIT: 1000, // requests per minute
  MAX_MESSAGE_LENGTH: 10000,
  MAX_SPEC_SIZE: 1000000, // 1MB
  REAL_TIME_UPDATE_DELAY: 500, // 500ms max latency requirement
} as const;

// Security constants
export const SECURITY = {
  JWT_EXPIRY: '24h',
  REFRESH_TOKEN_EXPIRY: '7d',
  PASSWORD_MIN_LENGTH: 8,
  SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
} as const;

// Integration service constants
export const INTEGRATIONS = {
  GITHUB: {
    API_VERSION: '2022-11-28',
    WEBHOOK_EVENTS: ['push', 'pull_request', 'issues'],
  },
  SLACK: {
    API_VERSION: 'v1',
    SCOPES: ['channels:read', 'chat:write', 'users:read'],
  },
  JIRA: {
    API_VERSION: '3',
    WEBHOOK_EVENTS: ['jira:issue_created', 'jira:issue_updated'],
  },
} as const;