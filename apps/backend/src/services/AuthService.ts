/**
 * Authentication Service
 * 
 * Handles JWT-based authentication with refresh tokens optimized for
 * distributed teams with timezone-aware session management.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { userRepository } from '../database/repositories/UserRepository';
import { UserRole } from '@collabspec/shared';

// JWT payload schema for type safety
const JWTPayloadSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  role: z.nativeEnum({
    developer: 'developer',
    designer: 'designer',
    'product-manager': 'product-manager',
    stakeholder: 'stakeholder',
  } as const),
  timezone: z.string(),
  sessionId: z.string().uuid(),
  iat: z.number(),
  exp: z.number(),
});

const RefreshTokenPayloadSchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  tokenVersion: z.number(),
  iat: z.number(),
  exp: z.number(),
});

type JWTPayload = z.infer<typeof JWTPayloadSchema>;
type RefreshTokenPayload = z.infer<typeof RefreshTokenPayloadSchema>;

// Authentication request/response schemas
export const LoginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1),
  timezone: z.string().optional(),
  rememberMe: z.boolean().default(false),
});

export const RegisterRequestSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  role: z.nativeEnum({
    developer: 'developer',
    designer: 'designer',
    'product-manager': 'product-manager',
    stakeholder: 'stakeholder',
  } as const).default('developer'),
  timezone: z.string().default('UTC'),
});

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  timezone: string;
  isActive: boolean;
  emailVerified: boolean;
  lastSeen: Date | null;
  createdAt: Date;
}

export class AuthService {
  private readonly JWT_SECRET: string;
  private readonly JWT_REFRESH_SECRET: string;
  private readonly JWT_EXPIRES_IN: string;
  private readonly JWT_REFRESH_EXPIRES_IN: string;
  private readonly BCRYPT_ROUNDS: number;

  constructor() {
    // Validate required environment variables
    this.JWT_SECRET = process.env.JWT_SECRET;
    this.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    
    if (!this.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }

    this.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
    this.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
    this.BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12');

    console.log('🔐 AuthService initialized with secure configuration');
  }

  /**
   * Register a new user with comprehensive validation
   * Optimized for distributed team onboarding
   */
  async register(userData: RegisterRequest): Promise<{
    user: AuthenticatedUser;
    tokens: AuthTokens;
  }> {
    try {
      // Validate input data
      const validatedData = RegisterRequestSchema.parse(userData);

      // Check if email already exists
      const existingUser = await userRepository.findByEmail(validatedData.email);
      if (existingUser) {
        throw new Error('Email already registered');
      }

      // Hash password with secure rounds
      const passwordHash = await bcrypt.hash(validatedData.password, this.BCRYPT_ROUNDS);

      // Create user in database
      const newUser = await userRepository.create({
        name: validatedData.name,
        email: validatedData.email.toLowerCase(),
        password_hash: passwordHash,
        role: validatedData.role,
        timezone: validatedData.timezone,
      });

      // Generate session ID for token tracking
      const sessionId = this.generateSessionId();

      // Generate authentication tokens
      const tokens = await this.generateTokens({
        userId: newUser.id,
        email: newUser.email,
        role: newUser.role as UserRole,
        timezone: newUser.timezone,
        sessionId,
      });

      // Update last seen for presence tracking
      await userRepository.updateLastSeen(newUser.id);

      console.log(`✅ User registered successfully: ${newUser.email} (${newUser.role})`);

      return {
        user: this.mapToAuthenticatedUser(newUser),
        tokens,
      };
    } catch (error) {
      console.error('❌ User registration failed:', error);
      throw error;
    }
  }

  /**
   * Authenticate user login with timezone awareness
   * Supports distributed team collaboration
   */
  async login(loginData: LoginRequest): Promise<{
    user: AuthenticatedUser;
    tokens: AuthTokens;
  }> {
    try {
      // Validate input data
      const validatedData = LoginRequestSchema.parse(loginData);

      // Find user by email
      const user = await userRepository.findByEmail(validatedData.email);
      if (!user) {
        throw new Error('Invalid email or password');
      }

      // Check if user account is active
      if (!user.is_active) {
        throw new Error('Account is deactivated');
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(validatedData.password, user.password_hash);
      if (!isPasswordValid) {
        throw new Error('Invalid email or password');
      }

      // Update timezone if provided (for mobile/travel scenarios)
      if (validatedData.timezone && validatedData.timezone !== user.timezone) {
        await userRepository.updateById(user.id, {
          timezone: validatedData.timezone,
        });
        user.timezone = validatedData.timezone;
      }

      // Generate session ID for token tracking
      const sessionId = this.generateSessionId();

      // Generate authentication tokens
      const tokens = await this.generateTokens({
        userId: user.id,
        email: user.email,
        role: user.role as UserRole,
        timezone: user.timezone,
        sessionId,
      }, validatedData.rememberMe);

      // Update last seen for presence tracking
      await userRepository.updateLastSeen(user.id);

      console.log(`✅ User logged in successfully: ${user.email} from ${user.timezone}`);

      return {
        user: this.mapToAuthenticatedUser(user),
        tokens,
      };
    } catch (error) {
      console.error('❌ User login failed:', error);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   * Maintains session continuity for distributed teams
   */
  async refreshToken(refreshTokenData: RefreshTokenRequest): Promise<AuthTokens> {
    try {
      // Validate input
      const validatedData = RefreshTokenRequestSchema.parse(refreshTokenData);

      // Verify refresh token
      const payload = jwt.verify(
        validatedData.refreshToken,
        this.JWT_REFRESH_SECRET
      ) as RefreshTokenPayload;

      // Validate payload structure
      const validatedPayload = RefreshTokenPayloadSchema.parse(payload);

      // Get user from database to ensure they still exist and are active
      const user = await userRepository.findById(validatedPayload.userId);
      if (!user || !user.is_active) {
        throw new Error('Invalid refresh token');
      }

      // Generate new tokens with same session ID
      const tokens = await this.generateTokens({
        userId: user.id,
        email: user.email,
        role: user.role as UserRole,
        timezone: user.timezone,
        sessionId: validatedPayload.sessionId,
      });

      // Update last seen for presence tracking
      await userRepository.updateLastSeen(user.id);

      console.log(`🔄 Token refreshed for user: ${user.email}`);

      return tokens;
    } catch (error) {
      console.error('❌ Token refresh failed:', error);
      throw new Error('Invalid refresh token');
    }
  }

  /**
   * Verify and decode JWT access token
   * Used by authentication middleware
   */
  async verifyAccessToken(token: string): Promise<JWTPayload> {
    try {
      const payload = jwt.verify(token, this.JWT_SECRET) as JWTPayload;
      return JWTPayloadSchema.parse(payload);
    } catch (error) {
      console.error('❌ Token verification failed:', error);
      throw new Error('Invalid access token');
    }
  }

  /**
   * Generate JWT tokens (access + refresh)
   * Optimized for distributed team security
   */
  private async generateTokens(
    payload: {
      userId: string;
      email: string;
      role: UserRole;
      timezone: string;
      sessionId: string;
    },
    longLived: boolean = false
  ): Promise<AuthTokens> {
    const now = Math.floor(Date.now() / 1000);
    
    // Access token payload
    const accessTokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      timezone: payload.timezone,
      sessionId: payload.sessionId,
    };

    // Refresh token payload
    const refreshTokenPayload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
      userId: payload.userId,
      sessionId: payload.sessionId,
      tokenVersion: 1, // For token invalidation if needed
    };

    // Generate tokens
    const accessToken = jwt.sign(accessTokenPayload, this.JWT_SECRET, {
      expiresIn: this.JWT_EXPIRES_IN,
    });

    const refreshTokenExpiry = longLived ? '30d' : this.JWT_REFRESH_EXPIRES_IN;
    const refreshToken = jwt.sign(refreshTokenPayload, this.JWT_REFRESH_SECRET, {
      expiresIn: refreshTokenExpiry,
    });

    // Calculate expiration time in seconds
    const accessTokenDecoded = jwt.decode(accessToken) as any;
    const expiresIn = accessTokenDecoded.exp - now;

    return {
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer',
    };
  }

  /**
   * Generate unique session ID for tracking
   */
  private generateSessionId(): string {
    return require('crypto').randomUUID();
  }

  /**
   * Hash password with secure settings
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.BCRYPT_ROUNDS);
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Map database user to authenticated user response
   */
  private mapToAuthenticatedUser(user: any): AuthenticatedUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      timezone: user.timezone,
      isActive: user.is_active,
      emailVerified: user.email_verified,
      lastSeen: user.last_seen,
      createdAt: user.created_at,
    };
  }

  /**
   * Validate user permissions for role-based access control
   */
  hasPermission(userRole: UserRole, requiredRole: UserRole): boolean {
    const roleHierarchy: Record<UserRole, number> = {
      stakeholder: 1,
      'product-manager': 2,
      designer: 3,
      developer: 4,
    };

    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
  }

  /**
   * Check if user can access resource based on role and ownership
   */
  canAccessResource(
    userRole: UserRole,
    userId: string,
    resourceOwnerId: string,
    requiredRole?: UserRole
  ): boolean {
    // Owner can always access their own resources
    if (userId === resourceOwnerId) {
      return true;
    }

    // Check role-based permissions if specified
    if (requiredRole) {
      return this.hasPermission(userRole, requiredRole);
    }

    return false;
  }
}

// Export singleton instance
export const authService = new AuthService();