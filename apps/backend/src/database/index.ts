/**
 * Database Module Entry Point
 * 
 * Exports all database-related functionality for the CollabSpec backend
 * including connection management, repositories, and migrations.
 */

// Connection management
export { db, DatabaseConnection } from './connection';

// Migration system
export { migrationManager } from './migrations';

// Repository pattern
export { BaseRepository } from './repositories/BaseRepository';
export { UserRepository, userRepository } from './repositories/UserRepository';
export { SpecificationRepository, specificationRepository } from './repositories/SpecificationRepository';

// Types
export type { PaginationOptions, PaginatedResult, QueryOptions } from './repositories/BaseRepository';

/**
 * Initialize database system
 * Sets up connection, runs migrations, and prepares repositories
 */
export async function initializeDatabase(): Promise<void> {
  console.log('🔧 Initializing CollabSpec database system...');
  
  try {
    // Connect to database
    await db.connect();
    console.log('✅ Database connection established');
    
    // Run pending migrations
    console.log('📋 Checking for pending migrations...');
    await migrationManager.migrate();
    console.log('✅ Database schema up to date');
    
    // Verify repositories are working
    const poolStats = db.getPoolStats();
    console.log('📊 Database pool status:', poolStats);
    
    console.log('🎉 Database system initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize database system:', error);
    throw error;
  }
}

/**
 * Gracefully shutdown database system
 * Closes connections and cleans up resources
 */
export async function shutdownDatabase(): Promise<void> {
  console.log('🔌 Shutting down database system...');
  
  try {
    await db.disconnect();
    console.log('✅ Database connections closed');
  } catch (error) {
    console.error('❌ Error during database shutdown:', error);
    throw error;
  }
}

/**
 * Health check for database system
 * Returns status information for monitoring
 */
export async function getDatabaseHealth(): Promise<{
  status: 'healthy' | 'unhealthy';
  connection: boolean;
  poolStats: {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  };
  migrationStatus?: {
    total: number;
    executed: number;
    pending: number;
  };
}> {
  try {
    // Test database connection
    await db.testConnection();
    
    // Get pool statistics
    const poolStats = db.getPoolStats();
    
    // Get migration status
    const migrationStatus = await migrationManager.getStatus();
    
    return {
      status: 'healthy',
      connection: true,
      poolStats,
      migrationStatus,
    };
  } catch (error) {
    console.error('❌ Database health check failed:', error);
    
    return {
      status: 'unhealthy',
      connection: false,
      poolStats: { totalCount: 0, idleCount: 0, waitingCount: 0 },
    };
  }
}