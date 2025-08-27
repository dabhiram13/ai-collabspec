/**
 * Authentication Routes
 * 
 * REST API endpoints for user authentication and management
 * optimized for distributed team collaboration.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { 
  authService, 
  LoginRequestSchema, 
  RegisterRequestSchema, 
  RefreshTokenRequestSchema 
} from '../services/AuthService';
import { 
  authenticate, 
  authRateLimit, 
  validateTimezone, 
  validateSession 
} from '../middleware/auth';
import { userRepository } from '../database/repositories/UserRepository';

const router = Router();

// Apply rate limiting to all auth routes
router.use(authRateLimit(5, 15 * 60 * 1000)); // 5 attempts per 15 minutes

/**
 * POST /api/auth/register
 * Register a new user account for distributed team collaboration
 */
router.post('/register', validateTimezone, async (req: Request, res: Response) => {
  try {
    console.log('📝 User registration attempt:', { email: req.body.email, role: req.body.role });

    // Validate request body
    const userData = RegisterRequestSchema.parse(req.body);

    // Register user and generate tokens
    const result = await authService.register(userData);

    console.log(`✅ User registered successfully: ${result.user.email}`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: result.user,
        tokens: result.tokens,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Registration failed:', error);

    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid registration data',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    if (error instanceof Error) {
      if (error.message === 'Email already registered') {
        res.status(409).json({
          error: {
            code: 'EMAIL_EXISTS',
            message: 'An account with this email already exists',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
    }

    res.status(500).json({
      error: {
        code: 'REGISTRATION_FAILED',
        message: 'Failed to register user',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate user login with timezone awareness
 */
router.post('/login', validateTimezone, async (req: Request, res: Response) => {
  try {
    console.log('🔐 User login attempt:', { email: req.body.email, timezone: req.body.timezone });

    // Validate request body
    const loginData = LoginRequestSchema.parse(req.body);

    // Authenticate user and generate tokens
    const result = await authService.login(loginData);

    console.log(`✅ User logged in successfully: ${result.user.email}`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: result.user,
        tokens: result.tokens,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Login failed:', error);

    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid login data',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    if (error instanceof Error) {
      if (error.message.includes('Invalid email or password') || 
          error.message.includes('Account is deactivated')) {
        res.status(401).json({
          error: {
            code: 'AUTHENTICATION_FAILED',
            message: 'Invalid email or password',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
    }

    res.status(500).json({
      error: {
        code: 'LOGIN_FAILED',
        message: 'Failed to authenticate user',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    console.log('🔄 Token refresh attempt');

    // Validate request body
    const refreshData = RefreshTokenRequestSchema.parse(req.body);

    // Refresh tokens
    const tokens = await authService.refreshToken(refreshData);

    console.log('✅ Token refreshed successfully');

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        tokens,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Token refresh failed:', error);

    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid refresh token data',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    res.status(401).json({
      error: {
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout user (client-side token removal)
 */
router.post('/logout', authenticate, validateSession, async (req: Request, res: Response) => {
  try {
    console.log(`👋 User logout: ${req.user?.email}`);

    // In a more advanced implementation, we could:
    // 1. Blacklist the current token
    // 2. Invalidate all sessions for the user
    // 3. Clear server-side session data

    res.json({
      success: true,
      message: 'Logout successful',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Logout failed:', error);

    res.status(500).json({
      error: {
        code: 'LOGOUT_FAILED',
        message: 'Failed to logout user',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile information
 */
router.get('/me', authenticate, validateSession, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Get full user profile from database
    const user = await userRepository.findById(req.user.id);
    
    if (!user) {
      res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User profile not found',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Get user availability for distributed team coordination
    const availability = await userRepository.getAvailability(user.id);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          timezone: user.timezone,
          avatarUrl: user.avatar_url,
          bio: user.bio,
          skills: user.skills,
          preferences: user.preferences,
          isActive: user.is_active,
          emailVerified: user.email_verified,
          lastSeen: user.last_seen,
          createdAt: user.created_at,
          availability,
        },
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Failed to get user profile:', error);

    res.status(500).json({
      error: {
        code: 'PROFILE_FETCH_FAILED',
        message: 'Failed to retrieve user profile',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

/**
 * PUT /api/auth/profile
 * Update user profile information
 */
router.put('/profile', authenticate, validateSession, validateTimezone, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Define allowed profile update fields
    const UpdateProfileSchema = z.object({
      name: z.string().min(1).max(100).optional(),
      timezone: z.string().optional(),
      avatarUrl: z.string().url().nullable().optional(),
      bio: z.string().max(1000).nullable().optional(),
      skills: z.array(z.string()).optional(),
      preferences: z.object({
        notifications: z.object({
          email: z.boolean().optional(),
          push: z.boolean().optional(),
          slack: z.boolean().optional(),
          quietHours: z.object({
            enabled: z.boolean().optional(),
            startTime: z.string().optional(),
            endTime: z.string().optional(),
          }).optional(),
        }).optional(),
        theme: z.enum(['light', 'dark']).optional(),
        language: z.string().optional(),
      }).optional(),
    });

    const updateData = UpdateProfileSchema.parse(req.body);

    // Update user profile
    const updatedUser = await userRepository.updateById(req.user.id, updateData);

    if (!updatedUser) {
      res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    console.log(`✅ Profile updated for user: ${updatedUser.email}`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          role: updatedUser.role,
          timezone: updatedUser.timezone,
          avatarUrl: updatedUser.avatar_url,
          bio: updatedUser.bio,
          skills: updatedUser.skills,
          preferences: updatedUser.preferences,
          isActive: updatedUser.is_active,
          emailVerified: updatedUser.email_verified,
          lastSeen: updatedUser.last_seen,
          createdAt: updatedUser.created_at,
          updatedAt: updatedUser.updated_at,
        },
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Profile update failed:', error);

    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid profile data',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    res.status(500).json({
      error: {
        code: 'PROFILE_UPDATE_FAILED',
        message: 'Failed to update profile',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

/**
 * PUT /api/auth/availability
 * Update user availability windows for distributed team coordination
 */
router.put('/availability', authenticate, validateSession, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Validate availability data
    const AvailabilitySchema = z.array(z.object({
      dayOfWeek: z.number().min(0).max(6),
      startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
      endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    }));

    const availability = AvailabilitySchema.parse(req.body.availability);

    // Update user availability
    await userRepository.setAvailability(req.user.id, availability);

    console.log(`✅ Availability updated for user: ${req.user.email} (${availability.length} windows)`);

    res.json({
      success: true,
      message: 'Availability updated successfully',
      data: {
        availability,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Availability update failed:', error);

    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid availability data',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    res.status(500).json({
      error: {
        code: 'AVAILABILITY_UPDATE_FAILED',
        message: 'Failed to update availability',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

/**
 * GET /api/auth/sessions
 * Get active sessions for security monitoring
 */
router.get('/sessions', authenticate, validateSession, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // In a more advanced implementation, we would:
    // 1. Track active sessions in Redis or database
    // 2. Show device information, IP addresses, locations
    // 3. Allow users to revoke specific sessions

    res.json({
      success: true,
      data: {
        sessions: [
          {
            id: req.user.sessionId,
            current: true,
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip,
          },
        ],
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Failed to get sessions:', error);

    res.status(500).json({
      error: {
        code: 'SESSIONS_FETCH_FAILED',
        message: 'Failed to retrieve sessions',
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export default router;