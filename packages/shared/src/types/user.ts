import { z } from 'zod';

// User role definitions for distributed teams
export const UserRole = z.enum(['developer', 'designer', 'product-manager', 'stakeholder']);
export type UserRole = z.infer<typeof UserRole>;

// Timezone and availability for async collaboration
export const AvailabilityWindow = z.object({
  dayOfWeek: z.number().min(0).max(6), // 0 = Sunday, 6 = Saturday
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/), // HH:MM format
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
});
export type AvailabilityWindow = z.infer<typeof AvailabilityWindow>;

// Notification preferences for distributed team coordination
export const NotificationPreferences = z.object({
  email: z.boolean().default(true),
  push: z.boolean().default(true),
  slack: z.boolean().default(false),
  quietHours: z.object({
    enabled: z.boolean().default(false),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
  }).optional(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

// Team member schema optimized for remote collaboration
export const TeamMember = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: UserRole,
  timezone: z.string(), // IANA timezone identifier (e.g., 'America/New_York')
  availability: z.array(AvailabilityWindow).default([]),
  skills: z.array(z.string()).default([]),
  preferences: NotificationPreferences.default({}),
  isActive: z.boolean().default(true),
  lastSeen: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type TeamMember = z.infer<typeof TeamMember>;

// User authentication and session management
export const UserSession = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  timezone: z.string(),
  expiresAt: z.date(),
  createdAt: z.date(),
});
export type UserSession = z.infer<typeof UserSession>;