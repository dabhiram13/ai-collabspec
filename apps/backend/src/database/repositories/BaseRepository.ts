/**
 * Base Repository Pattern Implementation
 * 
 * Provides common database operations with type safety and error handling
 * optimized for distributed team collaboration scenarios.
 */

import { PoolClient } from 'pg';
import { db } from '../connection';
import { z } from 'zod';

export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface QueryOptions {
  client?: PoolClient;
  timeout?: number;
}

/**
 * Base repository class providing common CRUD operations
 * with comprehensive error handling and type safety
 */
export abstract class BaseRepository<T, CreateInput, UpdateInput> {
  protected abstract tableName: string;
  protected abstract schema: z.ZodSchema<T>;
  protected abstract createSchema: z.ZodSchema<CreateInput>;
  protected abstract updateSchema: z.ZodSchema<UpdateInput>;

  /**
   * Execute query with optional client (for transactions)
   * and comprehensive error handling
   */
  protected async executeQuery(
    query: string,
    params: any[] = [],
    options: QueryOptions = {}
  ): Promise<any> {
    const { client, timeout = 10000 } = options;
    
    try {
      if (client) {
        // Use provided client (transaction context)
        return await client.query(query, params);
      } else {
        // Use connection pool
        return await db.query(query, params);
      }
    } catch (error) {
      console.error(`❌ Database query failed on table ${this.tableName}:`, {
        query: query.substring(0, 100) + '...',
        params: params.length > 0 ? '[PARAMS_HIDDEN]' : [],
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Database operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate data against schema with detailed error messages
   */
  protected validateData<S>(schema: z.ZodSchema<S>, data: unknown): S {
    try {
      return schema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(err => 
          `${err.path.join('.')}: ${err.message}`
        ).join(', ');
        throw new Error(`Validation failed: ${errorMessages}`);
      }
      throw error;
    }
  }

  /**
   * Build WHERE clause from filters with proper parameterization
   */
  protected buildWhereClause(
    filters: Record<string, any>,
    startParamIndex: number = 1
  ): { whereClause: string; params: any[]; nextParamIndex: number } {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = startParamIndex;

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          // Handle array filters (IN clause)
          const placeholders = value.map(() => `$${paramIndex++}`).join(', ');
          conditions.push(`${key} = ANY(ARRAY[${placeholders}])`);
          params.push(...value);
        } else if (typeof value === 'string' && value.includes('%')) {
          // Handle LIKE queries
          conditions.push(`${key} ILIKE $${paramIndex++}`);
          params.push(value);
        } else {
          // Handle exact matches
          conditions.push(`${key} = $${paramIndex++}`);
          params.push(value);
        }
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, params, nextParamIndex: paramIndex };
  }

  /**
   * Build ORDER BY clause with validation
   */
  protected buildOrderClause(
    sortBy?: string,
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    allowedSortFields: string[] = ['created_at', 'updated_at']
  ): string {
    if (!sortBy || !allowedSortFields.includes(sortBy)) {
      return 'ORDER BY created_at DESC';
    }
    return `ORDER BY ${sortBy} ${sortOrder}`;
  }

  /**
   * Create a new record with validation and error handling
   */
  async create(data: CreateInput, options: QueryOptions = {}): Promise<T> {
    const validatedData = this.validateData(this.createSchema, data);
    
    const fields = Object.keys(validatedData as any);
    const values = Object.values(validatedData as any);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    
    const query = `
      INSERT INTO ${this.tableName} (${fields.join(', ')})
      VALUES (${placeholders})
      RETURNING *
    `;

    try {
      const result = await this.executeQuery(query, values, options);
      return this.validateData(this.schema, result.rows[0]);
    } catch (error) {
      console.error(`❌ Failed to create record in ${this.tableName}:`, error);
      throw error;
    }
  }

  /**
   * Find record by ID with type safety
   */
  async findById(id: string, options: QueryOptions = {}): Promise<T | null> {
    const query = `SELECT * FROM ${this.tableName} WHERE id = $1`;
    
    try {
      const result = await this.executeQuery(query, [id], options);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return this.validateData(this.schema, result.rows[0]);
    } catch (error) {
      console.error(`❌ Failed to find record by ID in ${this.tableName}:`, error);
      throw error;
    }
  }

  /**
   * Find multiple records with filtering and pagination
   */
  async findMany(
    filters: Record<string, any> = {},
    pagination?: PaginationOptions,
    options: QueryOptions = {}
  ): Promise<PaginatedResult<T>> {
    const { whereClause, params } = this.buildWhereClause(filters);
    
    // Count total records for pagination
    const countQuery = `SELECT COUNT(*) FROM ${this.tableName} ${whereClause}`;
    const countResult = await this.executeQuery(countQuery, params, options);
    const total = parseInt(countResult.rows[0].count);

    // Build main query with pagination
    let query = `SELECT * FROM ${this.tableName} ${whereClause}`;
    
    if (pagination) {
      const orderClause = this.buildOrderClause(pagination.sortBy, pagination.sortOrder);
      query += ` ${orderClause}`;
      
      const offset = (pagination.page - 1) * pagination.limit;
      query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(pagination.limit, offset);
    }

    try {
      const result = await this.executeQuery(query, params, options);
      const data = result.rows.map((row: any) => this.validateData(this.schema, row));
      
      // Calculate pagination metadata
      const paginationMeta = pagination ? {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
        hasNext: pagination.page * pagination.limit < total,
        hasPrev: pagination.page > 1,
      } : {
        page: 1,
        limit: data.length,
        total,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      };

      return {
        data,
        pagination: paginationMeta,
      };
    } catch (error) {
      console.error(`❌ Failed to find records in ${this.tableName}:`, error);
      throw error;
    }
  }

  /**
   * Update record by ID with validation
   */
  async updateById(
    id: string,
    data: Partial<UpdateInput>,
    options: QueryOptions = {}
  ): Promise<T | null> {
    const validatedData = this.validateData(this.updateSchema.partial(), data);
    
    const fields = Object.keys(validatedData as any);
    const values = Object.values(validatedData as any);
    
    if (fields.length === 0) {
      throw new Error('No valid fields provided for update');
    }
    
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    const query = `
      UPDATE ${this.tableName} 
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    try {
      const result = await this.executeQuery(query, [id, ...values], options);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return this.validateData(this.schema, result.rows[0]);
    } catch (error) {
      console.error(`❌ Failed to update record in ${this.tableName}:`, error);
      throw error;
    }
  }

  /**
   * Delete record by ID (soft delete if supported)
   */
  async deleteById(id: string, options: QueryOptions = {}): Promise<boolean> {
    // Check if table supports soft delete (has deleted_at or is_active column)
    const softDeleteQuery = `
      UPDATE ${this.tableName} 
      SET is_active = false, updated_at = NOW()
      WHERE id = $1 AND is_active = true
      RETURNING id
    `;
    
    const hardDeleteQuery = `DELETE FROM ${this.tableName} WHERE id = $1 RETURNING id`;

    try {
      // Try soft delete first
      let result = await this.executeQuery(softDeleteQuery, [id], options);
      
      if (result.rows.length === 0) {
        // Fallback to hard delete if soft delete not supported or record not found
        result = await this.executeQuery(hardDeleteQuery, [id], options);
      }
      
      return result.rows.length > 0;
    } catch (error) {
      // If soft delete fails (column doesn't exist), try hard delete
      try {
        const result = await this.executeQuery(hardDeleteQuery, [id], options);
        return result.rows.length > 0;
      } catch (hardDeleteError) {
        console.error(`❌ Failed to delete record in ${this.tableName}:`, error);
        throw error;
      }
    }
  }

  /**
   * Execute custom query with validation
   */
  async executeCustomQuery(
    query: string,
    params: any[] = [],
    options: QueryOptions = {}
  ): Promise<T[]> {
    try {
      const result = await this.executeQuery(query, params, options);
      return result.rows.map((row: any) => this.validateData(this.schema, row));
    } catch (error) {
      console.error(`❌ Failed to execute custom query on ${this.tableName}:`, error);
      throw error;
    }
  }

  /**
   * Check if record exists by ID
   */
  async exists(id: string, options: QueryOptions = {}): Promise<boolean> {
    const query = `SELECT 1 FROM ${this.tableName} WHERE id = $1 LIMIT 1`;
    
    try {
      const result = await this.executeQuery(query, [id], options);
      return result.rows.length > 0;
    } catch (error) {
      console.error(`❌ Failed to check existence in ${this.tableName}:`, error);
      throw error;
    }
  }

  /**
   * Get total count with optional filters
   */
  async count(filters: Record<string, any> = {}, options: QueryOptions = {}): Promise<number> {
    const { whereClause, params } = this.buildWhereClause(filters);
    const query = `SELECT COUNT(*) FROM ${this.tableName} ${whereClause}`;
    
    try {
      const result = await this.executeQuery(query, params, options);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error(`❌ Failed to count records in ${this.tableName}:`, error);
      throw error;
    }
  }
}