/**
 * Authentication Integration Tests
 * 
 * Comprehensive tests for authentication flows including registration,
 * login, token refresh, and role-based access control for distributed teams.
 */

import request from 'supertest';
import express from 'express';
import { authService } from '../services/AuthService';
import authRoutes from '../routes/auth';
import { authenticate, requireRole } from '../middleware/auth';

// Mock the database
jest.mock('../database/repositories/UserRepository', () => ({
  userRepository: {
    findByEmail: jest.fn(),
    create: jest.fn(),
    findById: jest.fn(),
    updateById: jest.fn(),
    updateLastSeen: jest.fn(),
    setAvailability: jest.fn(),
    getAvailability: jest.fn(),
  },
}));

// Mock environment variables
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key';

describe('Authentication Integration Tests', () => {
  let app: express.Application;
  let mockUserRepository: any;

  beforeAll(() => {
    // Setup Express app with auth routes
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    
    // Test route for authentication middleware
    app.get('/api/protected', authenticate, (req, res) => {
      res.json({ message: 'Protected route accessed', user: req.user });
    });

    // Test route for role-based access
    app.get('/api/admin', authenticate, requireRole('product-manager'), (req, res) => {
      res.json({ message: 'Admin route accessed' });
    });

    // Get mock repository
    mockUserRepository = require('../database/repositories/UserRepository').userRepository;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('User Registration', () => {
    const validRegistrationData = {
      name: 'John Doe',
      email: 'john.doe@example.com',
      password: 'SecurePassword123!',
      role: 'developer',
      timezone: 'America/New_York',
    };

    it('should register a new user successfully', async () => {
      // Mock user doesn't exist
      mockUserRepository.findByEmail.mockResolvedValue(null);
      
      // Mock user creation
      const mockUser = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ...validRegistrationData,
        password_hash: 'hashed_password',
        is_active: true,
        email_verified: false,
        created_at: new Date(),
        updated_at: new Date(),
        skills: [],
        preferences: {
          notifications: { email: true, push: true, slack: false },
          theme: 'light',
          language: 'en',
        },
        avatar_url: null,
        bio: null,
        last_seen: null,
      };
      
      mockUserRepository.create.mockResolvedValue(mockUser);
      mockUserRepository.updateLastSeen.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/register')
        .send(validRegistrationData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(validRegistrationData.email);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();
      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: validRegistrationData.name,
          email: validRegistrationData.email,
          role: validRegistrationData.role,
          timezone: validRegistrationData.timezone,
        })
      );
    });

    it('should reject registration with existing email', async () => {
      // Mock user already exists
      mockUserRepository.findByEmail.mockResolvedValue({ id: 'existing-user' });

      const response = await request(app)
        .post('/api/auth/register')
        .send(validRegistrationData)
        .expect(409);

      expect(response.body.error.code).toBe('EMAIL_EXISTS');
      expect(mockUserRepository.create).not.toHaveBeenCalled();
    });

    it('should validate registration data', async () => {
      const invalidData = {
        name: '', // Invalid: empty name
        email: 'invalid-email', // Invalid: not an email
        password: '123', // Invalid: too short
        role: 'invalid-role', // Invalid: not a valid role
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidData)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toBeInstanceOf(Array);
    });

    it('should validate timezone', async () => {
      const dataWithInvalidTimezone = {
        ...validRegistrationData,
        timezone: 'Invalid/Timezone',
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(dataWithInvalidTimezone)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_TIMEZONE');
    });
  });

  describe('User Login', () => {
    const validLoginData = {
      email: 'john.doe@example.com',
      password: 'SecurePassword123!',
      timezone: 'America/New_York',
    };

    const mockUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'John Doe',
      email: 'john.doe@example.com',
      password_hash: '$2b$12$hashedpassword', // This would be a real bcrypt hash
      role: 'developer',
      timezone: 'America/New_York',
      is_active: true,
      email_verified: true,
      created_at: new Date(),
      updated_at: new Date(),
      skills: [],
      preferences: {
        notifications: { email: true, push: true, slack: false },
        theme: 'light',
        language: 'en',
      },
      avatar_url: null,
      bio: null,
      last_seen: new Date(),
    };

    it('should login user successfully', async () => {
      // Mock user exists and password is correct
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.updateLastSeen.mockResolvedValue(undefined);
      
      // Mock bcrypt compare
      const bcrypt = require('bcryptjs');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      const response = await request(app)
        .post('/api/auth/login')
        .send(validLoginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(validLoginData.email);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();
    });

    it('should reject login with invalid credentials', async () => {
      // Mock user exists but password is incorrect
      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      
      const bcrypt = require('bcryptjs');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

      const response = await request(app)
        .post('/api/auth/login')
        .send(validLoginData)
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_FAILED');
    });

    it('should reject login for non-existent user', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/auth/login')
        .send(validLoginData)
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_FAILED');
    });

    it('should reject login for deactivated user', async () => {
      const deactivatedUser = { ...mockUser, is_active: false };
      mockUserRepository.findByEmail.mockResolvedValue(deactivatedUser);

      const response = await request(app)
        .post('/api/auth/login')
        .send(validLoginData)
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_FAILED');
    });

    it('should update timezone on login if different', async () => {
      const loginWithNewTimezone = {
        ...validLoginData,
        timezone: 'Europe/London',
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);
      mockUserRepository.updateById.mockResolvedValue({ ...mockUser, timezone: 'Europe/London' });
      mockUserRepository.updateLastSeen.mockResolvedValue(undefined);
      
      const bcrypt = require('bcryptjs');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginWithNewTimezone)
        .expect(200);

      expect(mockUserRepository.updateById).toHaveBeenCalledWith(
        mockUser.id,
        { timezone: 'Europe/London' }
      );
    });
  });

  describe('Token Refresh', () => {
    it('should refresh tokens successfully', async () => {
      // Create a valid refresh token
      const refreshTokenPayload = {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        sessionId: 'session-123',
        tokenVersion: 1,
      };

      const jwt = require('jsonwebtoken');
      const refreshToken = jwt.sign(refreshTokenPayload, process.env.JWT_REFRESH_SECRET, {
        expiresIn: '7d',
      });

      // Mock user exists
      mockUserRepository.findById.mockResolvedValue({
        id: refreshTokenPayload.userId,
        email: 'john.doe@example.com',
        role: 'developer',
        timezone: 'America/New_York',
        is_active: true,
      });
      mockUserRepository.updateLastSeen.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();
    });

    it('should reject invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should reject refresh token for non-existent user', async () => {
      const refreshTokenPayload = {
        userId: 'non-existent-user',
        sessionId: 'session-123',
        tokenVersion: 1,
      };

      const jwt = require('jsonwebtoken');
      const refreshToken = jwt.sign(refreshTokenPayload, process.env.JWT_REFRESH_SECRET, {
        expiresIn: '7d',
      });

      mockUserRepository.findById.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  describe('Authentication Middleware', () => {
    it('should allow access with valid token', async () => {
      // Create a valid access token
      const tokenPayload = {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        email: 'john.doe@example.com',
        role: 'developer',
        timezone: 'America/New_York',
        sessionId: 'session-123',
      };

      const jwt = require('jsonwebtoken');
      const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
        expiresIn: '15m',
      });

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.user.id).toBe(tokenPayload.userId);
      expect(response.body.user.email).toBe(tokenPayload.email);
    });

    it('should reject access without token', async () => {
      const response = await request(app)
        .get('/api/protected')
        .expect(401);

      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should reject access with invalid token', async () => {
      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('should reject access with expired token', async () => {
      const expiredTokenPayload = {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        email: 'john.doe@example.com',
        role: 'developer',
        timezone: 'America/New_York',
        sessionId: 'session-123',
      };

      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(expiredTokenPayload, process.env.JWT_SECRET, {
        expiresIn: '-1h', // Expired 1 hour ago
      });

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('Role-Based Access Control', () => {
    it('should allow access for users with sufficient role', async () => {
      // Product manager should have access to admin route
      const tokenPayload = {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        email: 'manager@example.com',
        role: 'product-manager',
        timezone: 'America/New_York',
        sessionId: 'session-123',
      };

      const jwt = require('jsonwebtoken');
      const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
        expiresIn: '15m',
      });

      const response = await request(app)
        .get('/api/admin')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.message).toBe('Admin route accessed');
    });

    it('should deny access for users with insufficient role', async () => {
      // Developer should not have access to admin route
      const tokenPayload = {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        email: 'dev@example.com',
        role: 'developer',
        timezone: 'America/New_York',
        sessionId: 'session-123',
      };

      const jwt = require('jsonwebtoken');
      const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
        expiresIn: '15m',
      });

      const response = await request(app)
        .get('/api/admin')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);

      expect(response.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
      expect(response.body.error.userRole).toBe('developer');
      expect(response.body.error.requiredRole).toBe('product-manager');
    });
  });

  describe('User Profile Management', () => {
    it('should get user profile successfully', async () => {
      const tokenPayload = {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        email: 'john.doe@example.com',
        role: 'developer',
        timezone: 'America/New_York',
        sessionId: 'session-123',
      };

      const jwt = require('jsonwebtoken');
      const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
        expiresIn: '15m',
      });

      const mockUser = {
        id: tokenPayload.userId,
        name: 'John Doe',
        email: tokenPayload.email,
        role: tokenPayload.role,
        timezone: tokenPayload.timezone,
        avatar_url: null,
        bio: null,
        skills: ['JavaScript', 'TypeScript'],
        preferences: {
          notifications: { email: true, push: true, slack: false },
          theme: 'light',
          language: 'en',
        },
        is_active: true,
        email_verified: true,
        last_seen: new Date(),
        created_at: new Date(),
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.updateLastSeen.mockResolvedValue(undefined);
      mockUserRepository.getAvailability.mockResolvedValue([
        { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
      ]);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.id).toBe(tokenPayload.userId);
      expect(response.body.data.user.availability).toHaveLength(1);
    });

    it('should update user profile successfully', async () => {
      const tokenPayload = {
        userId: '123e4567-e89b-12d3-a456-426614174000',
        email: 'john.doe@example.com',
        role: 'developer',
        timezone: 'America/New_York',
        sessionId: 'session-123',
      };

      const jwt = require('jsonwebtoken');
      const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
        expiresIn: '15m',
      });

      const updateData = {
        name: 'John Updated',
        bio: 'Updated bio',
        skills: ['JavaScript', 'TypeScript', 'React'],
      };

      const updatedUser = {
        id: tokenPayload.userId,
        ...updateData,
        email: tokenPayload.email,
        role: tokenPayload.role,
        timezone: tokenPayload.timezone,
        avatar_url: null,
        preferences: {
          notifications: { email: true, push: true, slack: false },
          theme: 'light',
          language: 'en',
        },
        is_active: true,
        email_verified: true,
        last_seen: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockUserRepository.findById.mockResolvedValue(updatedUser);
      mockUserRepository.updateById.mockResolvedValue(updatedUser);
      mockUserRepository.updateLastSeen.mockResolvedValue(undefined);

      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.name).toBe(updateData.name);
      expect(response.body.data.user.bio).toBe(updateData.bio);
      expect(mockUserRepository.updateById).toHaveBeenCalledWith(
        tokenPayload.userId,
        updateData
      );
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to auth endpoints', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      // Mock user not found to trigger authentication failure
      mockUserRepository.findByEmail.mockResolvedValue(null);

      // Make multiple failed login attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send(loginData)
          .expect(401);
      }

      // 6th attempt should be rate limited
      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(429);

      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.body.error.retryAfter).toBeGreaterThan(0);
    });
  });
});