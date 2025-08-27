/**
 * Database Connection Management
 * 
 * Handles PostgreSQL connection pooling optimized for distributed teams
 * with support for 100+ concurrent users and proper error handling.
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { z } from 'zod';

// Database configuration schema with validation
const DatabaseConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.coerce.number().default(5432),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(1),
  ssl: z.boolean().default(false),
  // Connection pool settings optimized for distributed teams
  max: z.coerce.number().default(20), // Maximum connections for 100+ users
  min: z.coerce.number().default(5),  // Minimum connections for availability
  idleTimeoutMillis: z.coerce.number().default(30000), // 30 seconds
  connectionTimeoutMillis: z.coerce.number().default(10000), // 10 seconds
});

type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

class DatabaseConnection {
  private pool: Pool | null = null;
  private config: DatabaseConfig;

  constructor() {
    // Parse and validate database configuration from environment
    this.config = this.parseConfig();
  }

  /**
   * Parse database configuration from environment variables
   * with comprehensive validation for production readiness
   */
  private parseConfig(): DatabaseConfig {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (databaseUrl) {
      // Parse DATABASE_URL format: postgresql://user:password@host:port/database
      const url = new URL(databaseUrl);
      return DatabaseConfigSchema.parse({
        host: url.hostname,
        port: url.port || 5432,
        database: url.pathname.slice(1), // Remove leading slash
        user: url.username,
        password: url.password,
        ssl: process.env.NODE_ENV === 'production',
        max: process.env.DB_POOL_MAX,
        min: process.env.DB_POOL_MIN,
        idleTimeoutMillis: process.env.DB_IDLE_TIMEOUT,
        connectionTimeoutMillis: process.env.DB_CONNECTION_TIMEOUT,
      });
    }

    // Fallback to individual environment variables
    return DatabaseConfigSchema.parse({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true',
      max: process.env.DB_POOL_MAX,
      min: process.env.DB_POOL_MIN,
      idleTimeoutMillis: process.env.DB_IDLE_TIMEOUT,
      connectionTimeoutMillis: process.env.DB_CONNECTION_TIMEOUT,
    });
  }

  /**
   * Initialize database connection pool with error handling
   * and health monitoring for distributed team reliability
   */
  async connect(): Promise<void> {
    try {
      const poolConfig: PoolConfig = {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
        max: this.config.max,
        min: this.config.min,
        idleTimeoutMillis: this.config.idleTimeoutMillis,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis,
      };

      this.pool = new Pool(poolConfig);

      // Set up connection pool event handlers for monitoring
      this.pool.on('connect', (client: PoolClient) => {
        console.log('📊 Database client connected');
      });

      this.pool.on('error', (err: Error) => {
        console.error('💥 Database pool error:', err);
        // TODO: Send alert to monitoring system for distributed team awareness
      });

      this.pool.on('remove', () => {
        console.log('🔌 Database client removed from pool');
      });

      // Test the connection
      await this.testConnection();
      
      console.log('✅ Database connection pool initialized successfully');
      console.log(`📈 Pool configuration: max=${this.config.max}, min=${this.config.min}`);
      
    } catch (error) {
      console.error('❌ Failed to initialize database connection:', error);
      throw new Error(`Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Test database connection health
   * Critical for 99.9% uptime requirement
   */
  async testConnection(): Promise<void> {
    if (!this.pool) {
      throw new Error('Database pool not initialized');
    }

    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW() as current_time, version() as db_version');
      client.release();
      
      console.log('🏥 Database health check passed:', {
        timestamp: result.rows[0].current_time,
        version: result.rows[0].db_version.split(' ')[0], // Just PostgreSQL version
      });
    } catch (error) {
      throw new Error(`Database health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get database client from pool
   * Used by repositories for data operations
   */
  async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error('Database pool not initialized. Call connect() first.');
    }

    try {
      return await this.pool.connect();
    } catch (error) {
      console.error('❌ Failed to get database client:', error);
      throw new Error(`Failed to get database client: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute query with automatic client management
   * Provides convenient interface for simple queries
   */
  async query(text: string, params?: any[]): Promise<any> {
    const client = await this.getClient();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
  }

  /**
   * Execute transaction with automatic rollback on error
   * Essential for data consistency in collaborative environment
   */
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('🔄 Transaction rolled back due to error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get connection pool statistics for monitoring
   * Helps track performance for distributed team usage
   */
  getPoolStats(): {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  } {
    if (!this.pool) {
      return { totalCount: 0, idleCount: 0, waitingCount: 0 };
    }

    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  /**
   * Gracefully close database connection pool
   * Important for clean shutdown in production
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      console.log('🔌 Closing database connection pool...');
      await this.pool.end();
      this.pool = null;
      console.log('✅ Database connection pool closed');
    }
  }
}

// Export singleton instance for application-wide use
export const db = new DatabaseConnection();

// Export types for use in other modules
export type { DatabaseConfig };
export { DatabaseConnection };