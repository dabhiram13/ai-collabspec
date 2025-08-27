/**
 * Authentication Middleware
 * 
 * JWT-based authentication middleware with role-based access control
 * optimized for distributed team collaboration.
 */

import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/AuthService';
import { UserRole } from '@collabspec/shared';

// Extend Express Request type to include user information
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: UserRole;
        timezone: string;
        sessionId: string;
      };
    }
  }
}

/**
 * Extract JWT token from Authorization header
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return null;
  }

  // Support both "Bearer token" and "token" formats
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return authHeader;
}

/**
 * Authentication middleware - verifies JWT token
 * Adds user information to request object for downstream handlers
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      res.status(401).json({
        error: {
          code: 'MISSING_TOKEN',
          message: 'Authentication token is required',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Verify token and extract payload
    const payload = await authService.verifyAccessToken(token);

    // Add user information to request
    req.user = {
      id: payload.userId,
      email: payload.email,
      role: payload.role,
      timezone: payload.timezone,
      sessionId: payload.sessionId,
    };

    // Log authentication for distributed team monitoring
    console.log(`🔐 Authenticated user: ${payload.email} (${payload.role}) from ${payload.timezone}`);

    next();
  } catch (error) {
    console.error('❌ Authentication failed:', error);
    
    res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired authentication token',
        timestamp: new Date().toISOString(),
      },
    });
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token
 * Useful for endpoints that work for both authenticated and anonymous users
 */
export const optionalAuthenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractToken(req);
    
    if (token) {
      const payload = await authService.verifyAccessToken(token);
      req.user = {
        id: payload.userId,
        email: payload.email,
        role: payload.role,
        timezone: payload.timezone,
        sessionId: payload.sessionId,
      };
    }

    next();
  } catch (error) {
    // Continue without authentication for optional endpoints
    console.warn('⚠️ Optional authentication failed, continuing without auth:', error);
    next();
  }
};

/**
 * Role-based authorization middleware factory
 * Ensures user has required role for distributed team access control
 */
export const requireRole = (requiredRole: UserRole) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required for this endpoint',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const hasPermission = authService.hasPermission(req.user.role, requiredRole);
    
    if (!hasPermission) {
      console.warn(`🚫 Access denied: ${req.user.email} (${req.user.role}) attempted to access ${requiredRole} resource`);
      
      res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `This action requires ${requiredRole} role or higher`,
          timestamp: new Date().toISOString(),
          userRole: req.user.role,
          requiredRole,
        },
      });
      return;
    }

    console.log(`✅ Role authorization passed: ${req.user.email} (${req.user.role}) accessing ${requiredRole} resource`);
    next();
  };
};

/**
 * Resource ownership middleware factory
 * Ensures user can access resource based on ownership or role
 */
export const requireOwnershipOrRole = (
  getResourceOwnerId: (req: Request) => string | Promise<string>,
  fallbackRole?: UserRole
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required for this endpoint',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    try {
      const resourceOwnerId = await getResourceOwnerId(req);
      
      const canAccess = authService.canAccessResource(
        req.user.role,
        req.user.id,
        resourceOwnerId,
        fallbackRole
      );

      if (!canAccess) {
        console.warn(`🚫 Resource access denied: ${req.user.email} attempted to access resource owned by ${resourceOwnerId}`);
        
        res.status(403).json({
          error: {
            code: 'RESOURCE_ACCESS_DENIED',
            message: 'You do not have permission to access this resource',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }

      console.log(`✅ Resource access granted: ${req.user.email} accessing resource`);
      next();
    } catch (error) {
      console.error('❌ Resource ownership check failed:', error);
      
      res.status(500).json({
        error: {
          code: 'AUTHORIZATION_ERROR',
          message: 'Failed to verify resource access permissions',
          timestamp: new Date().toISOString(),
        },
      });
    }
  };
};

/**
 * Rate limiting middleware for authentication endpoints
 * Prevents brute force attacks on distributed team accounts
 */
export const authRateLimit = (maxAttempts: number = 5, windowMs: number = 15 * 60 * 1000) => {
  const attempts = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const clientId = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    // Clean up expired entries
    for (const [key, value] of attempts.entries()) {
      if (now > value.resetTime) {
        attempts.delete(key);
      }
    }

    const clientAttempts = attempts.get(clientId);
    
    if (!clientAttempts) {
      // First attempt
      attempts.set(clientId, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }

    if (now > clientAttempts.resetTime) {
      // Reset window
      attempts.set(clientId, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }

    if (clientAttempts.count >= maxAttempts) {
      console.warn(`🚫 Rate limit exceeded for client: ${clientId}`);
      
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many authentication attempts. Please try again later.',
          timestamp: new Date().toISOString(),
          retryAfter: Math.ceil((clientAttempts.resetTime - now) / 1000),
        },
      });
      return;
    }

    // Increment attempt count
    clientAttempts.count++;
    next();
  };
};

/**
 * Timezone validation middleware
 * Ensures timezone information is valid for distributed team coordination
 */
export const validateTimezone = (req: Request, res: Response, next: NextFunction): void => {
  const timezone = req.body.timezone || req.query.timezone;
  
  if (timezone) {
    try {
      // Validate timezone using Intl API
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch (error) {
      res.status(400).json({
        error: {
          code: 'INVALID_TIMEZONE',
          message: 'Invalid timezone identifier',
          timestamp: new Date().toISOString(),
          providedTimezone: timezone,
        },
      });
      return;
    }
  }

  next();
};

/**
 * Session validation middleware
 * Ensures session is still valid for distributed team security
 */
export const validateSession = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) {
    next();
    return;
  }

  try {
    // Check if user still exists and is active
    const { userRepository } = await import('../database/repositories/UserRepository');
    const user = await userRepository.findById(req.user.id);
    
    if (!user || !user.is_active) {
      console.warn(`🚫 Invalid session: User ${req.user.id} not found or inactive`);
      
      res.status(401).json({
        error: {
          code: 'INVALID_SESSION',
          message: 'Session is no longer valid',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Update last seen for presence tracking
    await userRepository.updateLastSeen(user.id);
    
    next();
  } catch (error) {
    console.error('❌ Session validation failed:', error);
    
    res.status(500).json({
      error: {
        code: 'SESSION_VALIDATION_ERROR',
        message: 'Failed to validate session',
        timestamp: new Date().toISOString(),
      },
    });
  }
};