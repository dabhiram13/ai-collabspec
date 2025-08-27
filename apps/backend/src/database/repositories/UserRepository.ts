/**
 * User Repository
 * 
 * Handles user data operations with distributed team optimization
 * including timezone management and availability tracking.
 */

import { z } from 'zod';
import { BaseRepository, QueryOptions } from './BaseRepository';
import { TeamMember, UserRole, AvailabilityWindow, NotificationPreferences } from '@collabspec/shared';

// Database entity schemas (matching PostgreSQL structure)
const UserEntitySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  password_hash: z.string(),
  role: z.nativeEnum({
    developer: 'developer',
    designer: 'designer',
    'product-manager': 'product-manager',
    stakeholder: 'stakeholder',
  } as const),
  timezone: z.string(),
  avatar_url: z.string().nullable(),
  bio: z.string().nullable(),
  skills: z.array(z.string()).default([]),
  preferences: z.object({
    notifications: NotificationPreferences,
    theme: z.enum(['light', 'dark']).default('light'),
    language: z.string().default('en'),
  }),
  is_active: z.boolean(),
  email_verified: z.boolean(),
  last_seen: z.date().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(254),
  password_hash: z.string().min(1),
  role: z.nativeEnum({
    developer: 'developer',
    designer: 'designer',
    'product-manager': 'product-manager',
    stakeholder: 'stakeholder',
  } as const).default('developer'),
  timezone: z.string().default('UTC'),
  avatar_url: z.string().url().optional(),
  bio: z.string().max(1000).optional(),
  skills: z.array(z.string()).default([]),
  preferences: z.object({
    notifications: NotificationPreferences.default({}),
    theme: z.enum(['light', 'dark']).default('light'),
    language: z.string().default('en'),
  }).default({}),
});

const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.nativeEnum({
    developer: 'developer',
    designer: 'designer',
    'product-manager': 'product-manager',
    stakeholder: 'stakeholder',
  } as const).optional(),
  timezone: z.string().optional(),
  avatar_url: z.string().url().nullable().optional(),
  bio: z.string().max(1000).nullable().optional(),
  skills: z.array(z.string()).optional(),
  preferences: z.object({
    notifications: NotificationPreferences.optional(),
    theme: z.enum(['light', 'dark']).optional(),
    language: z.string().optional(),
  }).optional(),
  email_verified: z.boolean().optional(),
  last_seen: z.date().optional(),
});

const UserAvailabilitySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  day_of_week: z.number().min(0).max(6),
  start_time: z.string(),
  end_time: z.string(),
  is_active: z.boolean(),
  created_at: z.date(),
});

type UserEntity = z.infer<typeof UserEntitySchema>;
type CreateUserInput = z.infer<typeof CreateUserSchema>;
type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
type UserAvailability = z.infer<typeof UserAvailabilitySchema>;

export class UserRepository extends BaseRepository<UserEntity, CreateUserInput, UpdateUserInput> {
  protected tableName = 'users';
  protected schema = UserEntitySchema;
  protected createSchema = CreateUserSchema;
  protected updateSchema = UpdateUserSchema;

  /**
   * Find user by email for authentication
   * Critical for login and security operations
   */
  async findByEmail(email: string, options: QueryOptions = {}): Promise<UserEntity | null> {
    const query = `
      SELECT * FROM ${this.tableName} 
      WHERE email = $1 AND is_active = true
    `;

    try {
      const result = await this.executeQuery(query, [email.toLowerCase()], options);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return this.validateData(this.schema, result.rows[0]);
    } catch (error) {
      console.error('❌ Failed to find user by email:', error);
      throw error;
    }
  }

  /**
   * Check if email is already registered
   * Prevents duplicate accounts
   */
  async emailExists(email: string, excludeUserId?: string, options: QueryOptions = {}): Promise<boolean> {
    let query = `SELECT 1 FROM ${this.tableName} WHERE email = $1`;
    const params = [email.toLowerCase()];

    if (excludeUserId) {
      query += ` AND id != $2`;
      params.push(excludeUserId);
    }

    try {
      const result = await this.executeQuery(query, params, options);
      return result.rows.length > 0;
    } catch (error) {
      console.error('❌ Failed to check email existence:', error);
      throw error;
    }
  }

  /**
   * Update user's last seen timestamp for presence tracking
   * Important for distributed team awareness
   */
  async updateLastSeen(userId: string, options: QueryOptions = {}): Promise<void> {
    const query = `
      UPDATE ${this.tableName} 
      SET last_seen = NOW() 
      WHERE id = $1 AND is_active = true
    `;

    try {
      await this.executeQuery(query, [userId], options);
    } catch (error) {
      console.error('❌ Failed to update last seen:', error);
      throw error;
    }
  }

  /**
   * Get users by timezone for distributed team coordination
   * Helps with scheduling and handoff optimization
   */
  async findByTimezone(timezone: string, options: QueryOptions = {}): Promise<UserEntity[]> {
    const query = `
      SELECT * FROM ${this.tableName} 
      WHERE timezone = $1 AND is_active = true
      ORDER BY name ASC
    `;

    try {
      const result = await this.executeQuery(query, [timezone], options);
      return result.rows.map(row => this.validateData(this.schema, row));
    } catch (error) {
      console.error('❌ Failed to find users by timezone:', error);
      throw error;
    }
  }

  /**
   * Get users by role for team organization
   */
  async findByRole(role: UserRole, options: QueryOptions = {}): Promise<UserEntity[]> {
    const query = `
      SELECT * FROM ${this.tableName} 
      WHERE role = $1 AND is_active = true
      ORDER BY name ASC
    `;

    try {
      const result = await this.executeQuery(query, [role], options);
      return result.rows.map(row => this.validateData(this.schema, row));
    } catch (error) {
      console.error('❌ Failed to find users by role:', error);
      throw error;
    }
  }

  /**
   * Search users by name or email for team member discovery
   */
  async searchUsers(searchTerm: string, limit: number = 10, options: QueryOptions = {}): Promise<UserEntity[]> {
    const query = `
      SELECT * FROM ${this.tableName} 
      WHERE (name ILIKE $1 OR email ILIKE $1) 
        AND is_active = true
      ORDER BY 
        CASE 
          WHEN name ILIKE $2 THEN 1
          WHEN email ILIKE $2 THEN 2
          ELSE 3
        END,
        name ASC
      LIMIT $3
    `;

    const searchPattern = `%${searchTerm}%`;
    const exactPattern = `${searchTerm}%`;

    try {
      const result = await this.executeQuery(query, [searchPattern, exactPattern, limit], options);
      return result.rows.map(row => this.validateData(this.schema, row));
    } catch (error) {
      console.error('❌ Failed to search users:', error);
      throw error;
    }
  }

  /**
   * Set user availability windows for async collaboration
   */
  async setAvailability(
    userId: string, 
    availability: AvailabilityWindow[], 
    options: QueryOptions = {}
  ): Promise<void> {
    const client = options.client;
    
    if (!client) {
      // Execute in transaction if no client provided
      return await this.executeInTransaction(async (transactionClient) => {
        return this.setAvailability(userId, availability, { ...options, client: transactionClient });
      });
    }

    try {
      // Clear existing availability
      await client.query('DELETE FROM user_availability WHERE user_id = $1', [userId]);

      // Insert new availability windows
      if (availability.length > 0) {
        const values = availability.map((window, index) => {
          const baseIndex = index * 4;
          return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4})`;
        }).join(', ');

        const params = availability.flatMap(window => [
          userId,
          window.dayOfWeek,
          window.startTime,
          window.endTime,
        ]);

        const insertQuery = `
          INSERT INTO user_availability (user_id, day_of_week, start_time, end_time)
          VALUES ${values}
        `;

        await client.query(insertQuery, params);
      }

      console.log(`✅ Updated availability for user ${userId}: ${availability.length} windows`);
    } catch (error) {
      console.error('❌ Failed to set user availability:', error);
      throw error;
    }
  }

  /**
   * Get user availability windows
   */
  async getAvailability(userId: string, options: QueryOptions = {}): Promise<AvailabilityWindow[]> {
    const query = `
      SELECT day_of_week, start_time, end_time
      FROM user_availability 
      WHERE user_id = $1 AND is_active = true
      ORDER BY day_of_week, start_time
    `;

    try {
      const result = await this.executeQuery(query, [userId], options);
      return result.rows.map(row => ({
        dayOfWeek: row.day_of_week,
        startTime: row.start_time,
        endTime: row.end_time,
      }));
    } catch (error) {
      console.error('❌ Failed to get user availability:', error);
      throw error;
    }
  }

  /**
   * Get online users (active within last 5 minutes)
   * For real-time collaboration presence
   */
  async getOnlineUsers(options: QueryOptions = {}): Promise<UserEntity[]> {
    const query = `
      SELECT * FROM ${this.tableName} 
      WHERE last_seen > NOW() - INTERVAL '5 minutes' 
        AND is_active = true
      ORDER BY last_seen DESC
    `;

    try {
      const result = await this.executeQuery(query, [], options);
      return result.rows.map(row => this.validateData(this.schema, row));
    } catch (error) {
      console.error('❌ Failed to get online users:', error);
      throw error;
    }
  }

  /**
   * Execute operation within transaction
   * Helper method for complex operations
   */
  private async executeInTransaction<T>(
    callback: (client: any) => Promise<T>
  ): Promise<T> {
    const { db } = await import('../connection');
    return await db.transaction(callback);
  }

  /**
   * Deactivate user account (soft delete)
   * Preserves data for audit trails
   */
  async deactivateUser(userId: string, options: QueryOptions = {}): Promise<boolean> {
    const query = `
      UPDATE ${this.tableName} 
      SET is_active = false, updated_at = NOW()
      WHERE id = $1 AND is_active = true
      RETURNING id
    `;

    try {
      const result = await this.executeQuery(query, [userId], options);
      return result.rows.length > 0;
    } catch (error) {
      console.error('❌ Failed to deactivate user:', error);
      throw error;
    }
  }

  /**
   * Reactivate user account
   */
  async reactivateUser(userId: string, options: QueryOptions = {}): Promise<boolean> {
    const query = `
      UPDATE ${this.tableName} 
      SET is_active = true, updated_at = NOW()
      WHERE id = $1 AND is_active = false
      RETURNING id
    `;

    try {
      const result = await this.executeQuery(query, [userId], options);
      return result.rows.length > 0;
    } catch (error) {
      console.error('❌ Failed to reactivate user:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const userRepository = new UserRepository();