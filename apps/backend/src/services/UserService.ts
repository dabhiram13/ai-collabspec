/**
 * User Management Service
 * 
 * Handles user management operations beyond authentication
 * optimized for distributed team collaboration.
 */

import { z } from 'zod';
import { userRepository } from '../database/repositories/UserRepository';
import { UserRole, AvailabilityWindow } from '@collabspec/shared';

// User search and filtering schemas
export const UserSearchSchema = z.object({
  query: z.string().min(1).max(100).optional(),
  role: z.nativeEnum({
    developer: 'developer',
    designer: 'designer',
    'product-manager': 'product-manager',
    stakeholder: 'stakeholder',
  } as const).optional(),
  timezone: z.string().optional(),
  skills: z.array(z.string()).optional(),
  isOnline: z.boolean().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export const TeamMemberInviteSchema = z.object({
  email: z.string().email().max(254),
  role: z.nativeEnum({
    developer: 'developer',
    designer: 'designer',
    'product-manager': 'product-manager',
    stakeholder: 'stakeholder',
  } as const).default('developer'),
  name: z.string().min(1).max(100),
  timezone: z.string().default('UTC'),
  message: z.string().max(500).optional(),
});

export type UserSearchParams = z.infer<typeof UserSearchSchema>;
export type TeamMemberInvite = z.infer<typeof TeamMemberInviteSchema>;

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  timezone: string;
  avatarUrl: string | null;
  bio: string | null;
  skills: string[];
  isOnline: boolean;
  lastSeen: Date | null;
  availability: AvailabilityWindow[];
  createdAt: Date;
}

export class UserService {
  /**
   * Search users across the platform for team discovery
   * Optimized for distributed team member finding
   */
  async searchUsers(params: UserSearchParams, requestingUserId?: string): Promise<{
    users: UserProfile[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const validatedParams = UserSearchSchema.parse(params);
      
      let users: any[] = [];
      let total = 0;

      if (validatedParams.query) {
        // Search by name or email
        users = await userRepository.searchUsers(
          validatedParams.query,
          validatedParams.limit + 1 // Get one extra to check if there are more
        );
        total = users.length;
      } else if (validatedParams.role) {
        // Filter by role
        users = await userRepository.findByRole(validatedParams.role);
        total = users.length;
      } else if (validatedParams.timezone) {
        // Filter by timezone for distributed team coordination
        users = await userRepository.findByTimezone(validatedParams.timezone);
        total = users.length;
      } else if (validatedParams.isOnline) {
        // Get online users for real-time collaboration
        users = await userRepository.getOnlineUsers();
        total = users.length;
      } else {
        // Get all users with pagination
        const result = await userRepository.findMany(
          { is_active: true },
          {
            page: Math.floor(validatedParams.offset / validatedParams.limit) + 1,
            limit: validatedParams.limit + 1,
            sortBy: 'name',
            sortOrder: 'ASC',
          }
        );
        users = result.data;
        total = result.pagination.total;
      }

      // Apply additional filters
      if (validatedParams.skills && validatedParams.skills.length > 0) {
        users = users.filter(user => 
          validatedParams.skills!.some(skill => 
            user.skills.some((userSkill: string) => 
              userSkill.toLowerCase().includes(skill.toLowerCase())
            )
          )
        );
      }

      // Apply pagination
      const hasMore = users.length > validatedParams.limit;
      if (hasMore) {
        users = users.slice(0, validatedParams.limit);
      }

      // Get availability for each user
      const userProfiles = await Promise.all(
        users.map(async (user) => {
          const availability = await userRepository.getAvailability(user.id);
          return this.mapToUserProfile(user, availability);
        })
      );

      console.log(`🔍 User search completed: ${userProfiles.length} users found`);

      return {
        users: userProfiles,
        total: Math.max(total, userProfiles.length),
        hasMore,
      };
    } catch (error) {
      console.error('❌ User search failed:', error);
      throw error;
    }
  }

  /**
   * Get user profile by ID with availability information
   */
  async getUserProfile(userId: string, requestingUserId?: string): Promise<UserProfile | null> {
    try {
      const user = await userRepository.findById(userId);
      
      if (!user || !user.is_active) {
        return null;
      }

      const availability = await userRepository.getAvailability(userId);
      
      return this.mapToUserProfile(user, availability);
    } catch (error) {
      console.error('❌ Failed to get user profile:', error);
      throw error;
    }
  }

  /**
   * Get users by timezone for distributed team coordination
   */
  async getUsersByTimezone(timezone: string): Promise<UserProfile[]> {
    try {
      const users = await userRepository.findByTimezone(timezone);
      
      const userProfiles = await Promise.all(
        users.map(async (user) => {
          const availability = await userRepository.getAvailability(user.id);
          return this.mapToUserProfile(user, availability);
        })
      );

      console.log(`🌍 Found ${userProfiles.length} users in timezone: ${timezone}`);
      
      return userProfiles;
    } catch (error) {
      console.error('❌ Failed to get users by timezone:', error);
      throw error;
    }
  }

  /**
   * Get online users for real-time collaboration
   */
  async getOnlineUsers(): Promise<UserProfile[]> {
    try {
      const users = await userRepository.getOnlineUsers();
      
      const userProfiles = await Promise.all(
        users.map(async (user) => {
          const availability = await userRepository.getAvailability(user.id);
          return this.mapToUserProfile(user, availability);
        })
      );

      console.log(`👥 Found ${userProfiles.length} online users`);
      
      return userProfiles;
    } catch (error) {
      console.error('❌ Failed to get online users:', error);
      throw error;
    }
  }

  /**
   * Get users by role for team organization
   */
  async getUsersByRole(role: UserRole): Promise<UserProfile[]> {
    try {
      const users = await userRepository.findByRole(role);
      
      const userProfiles = await Promise.all(
        users.map(async (user) => {
          const availability = await userRepository.getAvailability(user.id);
          return this.mapToUserProfile(user, availability);
        })
      );

      console.log(`👔 Found ${userProfiles.length} users with role: ${role}`);
      
      return userProfiles;
    } catch (error) {
      console.error('❌ Failed to get users by role:', error);
      throw error;
    }
  }

  /**
   * Update user availability for distributed team coordination
   */
  async updateUserAvailability(
    userId: string,
    availability: AvailabilityWindow[]
  ): Promise<void> {
    try {
      await userRepository.setAvailability(userId, availability);
      
      console.log(`📅 Updated availability for user ${userId}: ${availability.length} windows`);
    } catch (error) {
      console.error('❌ Failed to update user availability:', error);
      throw error;
    }
  }

  /**
   * Get team members who are available now
   * Useful for finding who can collaborate right now
   */
  async getAvailableNow(timezone?: string): Promise<UserProfile[]> {
    try {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
      const currentTime = now.toTimeString().substring(0, 5); // HH:MM format

      // Get all active users
      const allUsers = await userRepository.findMany({ is_active: true });
      const availableUsers: UserProfile[] = [];

      for (const user of allUsers.data) {
        // Skip if timezone filter is specified and doesn't match
        if (timezone && user.timezone !== timezone) {
          continue;
        }

        // Get user's availability
        const availability = await userRepository.getAvailability(user.id);
        
        // Check if user is available now
        const isAvailableNow = availability.some(window => 
          window.dayOfWeek === dayOfWeek &&
          window.startTime <= currentTime &&
          window.endTime >= currentTime
        );

        if (isAvailableNow) {
          availableUsers.push(this.mapToUserProfile(user, availability));
        }
      }

      console.log(`⏰ Found ${availableUsers.length} users available now${timezone ? ` in ${timezone}` : ''}`);
      
      return availableUsers;
    } catch (error) {
      console.error('❌ Failed to get available users:', error);
      throw error;
    }
  }

  /**
   * Deactivate user account (soft delete)
   */
  async deactivateUser(userId: string, requestingUserId: string): Promise<boolean> {
    try {
      // TODO: Add permission check - only admins or the user themselves
      const success = await userRepository.deactivateUser(userId);
      
      if (success) {
        console.log(`🚫 User ${userId} deactivated by ${requestingUserId}`);
      }
      
      return success;
    } catch (error) {
      console.error('❌ Failed to deactivate user:', error);
      throw error;
    }
  }

  /**
   * Reactivate user account
   */
  async reactivateUser(userId: string, requestingUserId: string): Promise<boolean> {
    try {
      // TODO: Add permission check - only admins
      const success = await userRepository.reactivateUser(userId);
      
      if (success) {
        console.log(`✅ User ${userId} reactivated by ${requestingUserId}`);
      }
      
      return success;
    } catch (error) {
      console.error('❌ Failed to reactivate user:', error);
      throw error;
    }
  }

  /**
   * Get user statistics for admin dashboard
   */
  async getUserStatistics(): Promise<{
    total: number;
    active: number;
    online: number;
    byRole: Record<UserRole, number>;
    byTimezone: Record<string, number>;
  }> {
    try {
      const [
        totalUsers,
        activeUsers,
        onlineUsers,
        developers,
        designers,
        productManagers,
        stakeholders,
      ] = await Promise.all([
        userRepository.count({}),
        userRepository.count({ is_active: true }),
        userRepository.getOnlineUsers(),
        userRepository.findByRole('developer'),
        userRepository.findByRole('designer'),
        userRepository.findByRole('product-manager'),
        userRepository.findByRole('stakeholder'),
      ]);

      // Get timezone distribution
      const allActiveUsers = await userRepository.findMany({ is_active: true });
      const byTimezone: Record<string, number> = {};
      
      allActiveUsers.data.forEach(user => {
        byTimezone[user.timezone] = (byTimezone[user.timezone] || 0) + 1;
      });

      const statistics = {
        total: totalUsers,
        active: activeUsers,
        online: onlineUsers.length,
        byRole: {
          developer: developers.length,
          designer: designers.length,
          'product-manager': productManagers.length,
          stakeholder: stakeholders.length,
        } as Record<UserRole, number>,
        byTimezone,
      };

      console.log('📊 User statistics generated:', statistics);
      
      return statistics;
    } catch (error) {
      console.error('❌ Failed to get user statistics:', error);
      throw error;
    }
  }

  /**
   * Map database user to user profile
   */
  private mapToUserProfile(user: any, availability: AvailabilityWindow[]): UserProfile {
    const isOnline = user.last_seen && 
      (new Date().getTime() - new Date(user.last_seen).getTime()) < 5 * 60 * 1000; // 5 minutes

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      timezone: user.timezone,
      avatarUrl: user.avatar_url,
      bio: user.bio,
      skills: user.skills || [],
      isOnline: !!isOnline,
      lastSeen: user.last_seen,
      availability,
      createdAt: user.created_at,
    };
  }
}

// Export singleton instance
export const userService = new UserService();