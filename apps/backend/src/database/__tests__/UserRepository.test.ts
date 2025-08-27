/**
 * User Repository Tests
 * 
 * Tests user data operations with distributed team scenarios
 * including timezone management and availability tracking.
 */

import { UserRepository } from '../repositories/UserRepository';
import { UserRole } from '@collabspec/shared';

// Mock the database connection
jest.mock('../connection', () => ({
  db: {
    query: jest.fn(),
    transaction: jest.fn(),
  },
}));

describe('UserRepository', () => {
  let userRepository: UserRepository;
  let mockDb: any;

  beforeEach(() => {
    userRepository = new UserRepository();
    mockDb = require('../connection').db;
    jest.clearAllMocks();
  });

  describe('User Creation', () => {
    const validUserData = {
      name: 'John Doe',
      email: 'john.doe@example.com',
      password_hash: 'hashed_password_123',
      role: 'developer' as UserRole,
      timezone: 'America/New_York',
    };

    it('should create user successfully', async () => {
      const mockUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ...validUserData,
        is_active: true,
        email_verified: false,
        created_at: new Date(),
        updated_at: new Date(),
        skills: [],
        preferences: {
          notifications: {
            email: true,
            push: true,
            slack: false,
            quietHours: { enabled: false },
          },
          theme: 'light',
          language: 'en',
        },
        avatar_url: null,
        bio: null,
        last_seen: null,
      };

      mockDb.query.mockResolvedValue({ rows: [mockUser] });

      const result = await userRepository.create(validUserData);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO users'),
        expect.arrayContaining([
          validUserData.name,
          validUserData.email,
          validUserData.password_hash,
        ])
      );
      expect(result.id).toBe(mockUser.id);
      expect(result.email).toBe(validUserData.email);
    });

    it('should validate user data before creation', async () => {
      const invalidUserData = {
        name: '', // Invalid: empty name
        email: 'invalid-email', // Invalid: not an email
        password_hash: 'hash',
        role: 'developer' as UserRole,
      };

      await expect(userRepository.create(invalidUserData as any)).rejects.toThrow('Validation failed');
    });

    it('should handle database errors during creation', async () => {
      mockDb.query.mockRejectedValue(new Error('Database connection failed'));

      await expect(userRepository.create(validUserData)).rejects.toThrow('Database operation failed');
    });
  });

  describe('User Lookup Operations', () => {
    const mockUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'John Doe',
      email: 'john.doe@example.com',
      password_hash: 'hashed_password_123',
      role: 'developer',
      timezone: 'America/New_York',
      is_active: true,
      email_verified: true,
      created_at: new Date(),
      updated_at: new Date(),
      skills: ['JavaScript', 'TypeScript'],
      preferences: {
        notifications: { email: true, push: true, slack: false },
        theme: 'light',
        language: 'en',
      },
      avatar_url: null,
      bio: null,
      last_seen: new Date(),
    };

    it('should find user by email', async () => {
      mockDb.query.mockResolvedValue({ rows: [mockUser] });

      const result = await userRepository.findByEmail('john.doe@example.com');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE email = $1 AND is_active = true'),
        ['john.doe@example.com']
      );
      expect(result).toBeTruthy();
      expect(result?.email).toBe(mockUser.email);
    });

    it('should return null for non-existent email', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await userRepository.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('should check if email exists', async () => {
      mockDb.query.mockResolvedValue({ rows: [{ exists: true }] });

      const exists = await userRepository.emailExists('john.doe@example.com');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT 1 FROM users WHERE email = $1'),
        ['john.doe@example.com']
      );
      expect(exists).toBe(true);
    });

    it('should exclude user ID when checking email existence', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const exists = await userRepository.emailExists(
        'john.doe@example.com',
        '123e4567-e89b-12d3-a456-426614174000'
      );

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('AND id != $2'),
        ['john.doe@example.com', '123e4567-e89b-12d3-a456-426614174000']
      );
      expect(exists).toBe(false);
    });
  });

  describe('Distributed Team Features', () => {
    it('should find users by timezone', async () => {
      const mockUsers = [
        { id: '1', name: 'User 1', timezone: 'America/New_York' },
        { id: '2', name: 'User 2', timezone: 'America/New_York' },
      ];

      mockDb.query.mockResolvedValue({ rows: mockUsers });

      const result = await userRepository.findByTimezone('America/New_York');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE timezone = $1 AND is_active = true'),
        ['America/New_York']
      );
      expect(result).toHaveLength(2);
    });

    it('should find users by role', async () => {
      const mockDevelopers = [
        { id: '1', name: 'Dev 1', role: 'developer' },
        { id: '2', name: 'Dev 2', role: 'developer' },
      ];

      mockDb.query.mockResolvedValue({ rows: mockDevelopers });

      const result = await userRepository.findByRole('developer');

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE role = $1 AND is_active = true'),
        ['developer']
      );
      expect(result).toHaveLength(2);
    });

    it('should search users by name or email', async () => {
      const mockUsers = [
        { id: '1', name: 'John Doe', email: 'john@example.com' },
        { id: '2', name: 'Jane Doe', email: 'jane@example.com' },
      ];

      mockDb.query.mockResolvedValue({ rows: mockUsers });

      const result = await userRepository.searchUsers('Doe', 10);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE (name ILIKE $1 OR email ILIKE $1)'),
        ['%Doe%', 'Doe%', 10]
      );
      expect(result).toHaveLength(2);
    });

    it('should get online users', async () => {
      const mockOnlineUsers = [
        { id: '1', name: 'User 1', last_seen: new Date() },
        { id: '2', name: 'User 2', last_seen: new Date() },
      ];

      mockDb.query.mockResolvedValue({ rows: mockOnlineUsers });

      const result = await userRepository.getOnlineUsers();

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE last_seen > NOW() - INTERVAL '5 minutes'"),
        []
      );
      expect(result).toHaveLength(2);
    });
  });

  describe('User Availability Management', () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';
    const availability = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }, // Monday
      { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' }, // Tuesday
    ];

    it('should set user availability', async () => {
      const mockTransaction = jest.fn().mockImplementation(async (callback) => {
        const mockClient = {
          query: jest.fn().mockResolvedValue({ rows: [] }),
        };
        return await callback(mockClient);
      });

      mockDb.transaction = mockTransaction;

      await userRepository.setAvailability(userId, availability);

      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should get user availability', async () => {
      const mockAvailability = [
        { day_of_week: 1, start_time: '09:00', end_time: '17:00' },
        { day_of_week: 2, start_time: '09:00', end_time: '17:00' },
      ];

      mockDb.query.mockResolvedValue({ rows: mockAvailability });

      const result = await userRepository.getAvailability(userId);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM user_availability WHERE user_id = $1'),
        [userId]
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '17:00',
      });
    });
  });

  describe('User Status Management', () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000';

    it('should update last seen timestamp', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await userRepository.updateLastSeen(userId);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SET last_seen = NOW()'),
        [userId]
      );
    });

    it('should deactivate user account', async () => {
      mockDb.query.mockResolvedValue({ rows: [{ id: userId }] });

      const result = await userRepository.deactivateUser(userId);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SET is_active = false'),
        [userId]
      );
      expect(result).toBe(true);
    });

    it('should reactivate user account', async () => {
      mockDb.query.mockResolvedValue({ rows: [{ id: userId }] });

      const result = await userRepository.reactivateUser(userId);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SET is_active = true'),
        [userId]
      );
      expect(result).toBe(true);
    });

    it('should return false when user not found for deactivation', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const result = await userRepository.deactivateUser('nonexistent-id');

      expect(result).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      mockDb.query.mockRejectedValue(new Error('Connection timeout'));

      await expect(userRepository.findByEmail('test@example.com')).rejects.toThrow('Database operation failed');
    });

    it('should handle validation errors', async () => {
      const invalidData = {
        name: 'Valid Name',
        email: 'invalid-email-format',
        password_hash: 'hash',
        role: 'invalid-role' as any,
      };

      await expect(userRepository.create(invalidData)).rejects.toThrow('Validation failed');
    });
  });
});