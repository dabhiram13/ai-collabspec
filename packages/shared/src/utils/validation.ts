import { z } from 'zod';

// Common validation schemas for API requests
export const PaginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationParams = z.infer<typeof PaginationSchema>;

// UUID validation helper
export const UUIDSchema = z.string().uuid();

// Email validation with additional business rules
export const EmailSchema = z.string().email().max(254);

// Password validation for security requirements
export const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

// Timezone validation using IANA timezone identifiers
export const TimezoneSchema = z.string().refine(
  (tz) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid timezone identifier' }
);

// URL validation for integration endpoints
export const URLSchema = z.string().url().max(2048);

// Generic error response schema
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
    timestamp: z.date(),
    requestId: z.string().uuid(),
    retryable: z.boolean().default(false),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// Success response wrapper
export const SuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    meta: z
      .object({
        pagination: PaginationSchema.optional(),
        timestamp: z.date(),
        requestId: z.string().uuid(),
      })
      .optional(),
  });

// Validation helper functions
export const validateOrThrow = <T>(schema: z.ZodSchema<T>, data: unknown): T => {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`Validation failed: ${result.error.message}`);
  }
  return result.data;
};

export const validateAsync = async <T>(
  schema: z.ZodSchema<T>,
  data: unknown
): Promise<{ success: true; data: T } | { success: false; error: z.ZodError }> => {
  const result = await schema.safeParseAsync(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
};