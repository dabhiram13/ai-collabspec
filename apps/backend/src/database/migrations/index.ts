/**
 * Database Migration System
 * 
 * Manages database schema evolution for CollabSpec platform
 * with support for distributed team development and rollbacks.
 */

import { PoolClient } from 'pg';
import { db } from '../connection';
import fs from 'fs/promises';
import path from 'path';

interface Migration {
  id: string;
  name: string;
  up: string;
  down: string;
  timestamp: Date;
}

interface MigrationRecord {
  id: string;
  name: string;
  executed_at: Date;
  checksum: string;
}

class MigrationManager {
  private migrationsPath: string;

  constructor() {
    this.migrationsPath = path.join(__dirname, 'sql');
  }

  /**
   * Initialize migration tracking table
   * Creates the schema_migrations table if it doesn't exist
   */
  async initializeMigrationTable(): Promise<void> {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        checksum VARCHAR(64) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_executed_at 
      ON schema_migrations(executed_at);
    `;

    try {
      await db.query(createTableQuery);
      console.log('✅ Migration tracking table initialized');
    } catch (error) {
      console.error('❌ Failed to initialize migration table:', error);
      throw error;
    }
  }

  /**
   * Load migration files from the migrations directory
   * Supports both .sql files and TypeScript migration objects
   */
  async loadMigrations(): Promise<Migration[]> {
    try {
      const files = await fs.readdir(this.migrationsPath);
      const migrations: Migration[] = [];

      for (const file of files.sort()) {
        if (file.endsWith('.sql')) {
          const filePath = path.join(this.migrationsPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          
          // Parse migration file format: timestamp_name.sql
          const match = file.match(/^(\d{14})_(.+)\.sql$/);
          if (!match) {
            console.warn(`⚠️ Skipping invalid migration file: ${file}`);
            continue;
          }

          const [, timestamp, name] = match;
          const migrationDate = this.parseTimestamp(timestamp);

          // Split up and down migrations (separated by -- DOWN)
          const parts = content.split('-- DOWN');
          const up = parts[0].trim();
          const down = parts[1]?.trim() || '';

          migrations.push({
            id: timestamp,
            name: name.replace(/_/g, ' '),
            up,
            down,
            timestamp: migrationDate,
          });
        }
      }

      return migrations.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    } catch (error) {
      console.error('❌ Failed to load migrations:', error);
      throw error;
    }
  }

  /**
   * Parse timestamp from migration filename
   * Format: YYYYMMDDHHMMSS
   */
  private parseTimestamp(timestamp: string): Date {
    const year = parseInt(timestamp.substr(0, 4));
    const month = parseInt(timestamp.substr(4, 2)) - 1; // Month is 0-indexed
    const day = parseInt(timestamp.substr(6, 2));
    const hour = parseInt(timestamp.substr(8, 2));
    const minute = parseInt(timestamp.substr(10, 2));
    const second = parseInt(timestamp.substr(12, 2));

    return new Date(year, month, day, hour, minute, second);
  }

  /**
   * Get list of executed migrations from database
   */
  async getExecutedMigrations(): Promise<MigrationRecord[]> {
    try {
      const result = await db.query(`
        SELECT id, name, executed_at, checksum 
        FROM schema_migrations 
        ORDER BY executed_at ASC
      `);
      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get executed migrations:', error);
      throw error;
    }
  }

  /**
   * Calculate checksum for migration content
   * Used to detect changes in migration files
   */
  private calculateChecksum(content: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Execute pending migrations
   * Runs all migrations that haven't been executed yet
   */
  async migrate(): Promise<void> {
    console.log('🚀 Starting database migration...');

    try {
      await this.initializeMigrationTable();
      
      const allMigrations = await this.loadMigrations();
      const executedMigrations = await this.getExecutedMigrations();
      const executedIds = new Set(executedMigrations.map(m => m.id));

      const pendingMigrations = allMigrations.filter(m => !executedIds.has(m.id));

      if (pendingMigrations.length === 0) {
        console.log('✅ No pending migrations to execute');
        return;
      }

      console.log(`📋 Found ${pendingMigrations.length} pending migrations`);

      for (const migration of pendingMigrations) {
        await this.executeMigration(migration);
      }

      console.log('🎉 All migrations completed successfully');
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  /**
   * Execute a single migration within a transaction
   * Ensures atomicity and proper error handling
   */
  private async executeMigration(migration: Migration): Promise<void> {
    console.log(`⚡ Executing migration: ${migration.id} - ${migration.name}`);

    await db.transaction(async (client: PoolClient) => {
      try {
        // Execute the migration SQL
        await client.query(migration.up);

        // Record the migration as executed
        const checksum = this.calculateChecksum(migration.up);
        await client.query(
          `INSERT INTO schema_migrations (id, name, checksum) VALUES ($1, $2, $3)`,
          [migration.id, migration.name, checksum]
        );

        console.log(`✅ Migration completed: ${migration.id}`);
      } catch (error) {
        console.error(`❌ Migration failed: ${migration.id}`, error);
        throw error;
      }
    });
  }

  /**
   * Rollback the last migration
   * Useful for development and emergency rollbacks
   */
  async rollback(): Promise<void> {
    console.log('🔄 Starting migration rollback...');

    try {
      const executedMigrations = await this.getExecutedMigrations();
      
      if (executedMigrations.length === 0) {
        console.log('ℹ️ No migrations to rollback');
        return;
      }

      const lastMigration = executedMigrations[executedMigrations.length - 1];
      const allMigrations = await this.loadMigrations();
      const migrationToRollback = allMigrations.find(m => m.id === lastMigration.id);

      if (!migrationToRollback) {
        throw new Error(`Migration file not found for rollback: ${lastMigration.id}`);
      }

      if (!migrationToRollback.down) {
        throw new Error(`No rollback script found for migration: ${lastMigration.id}`);
      }

      await this.rollbackMigration(migrationToRollback);
      console.log('✅ Migration rollback completed');
    } catch (error) {
      console.error('❌ Migration rollback failed:', error);
      throw error;
    }
  }

  /**
   * Execute rollback for a single migration
   */
  private async rollbackMigration(migration: Migration): Promise<void> {
    console.log(`🔄 Rolling back migration: ${migration.id} - ${migration.name}`);

    await db.transaction(async (client: PoolClient) => {
      try {
        // Execute the rollback SQL
        await client.query(migration.down);

        // Remove the migration record
        await client.query(
          `DELETE FROM schema_migrations WHERE id = $1`,
          [migration.id]
        );

        console.log(`✅ Rollback completed: ${migration.id}`);
      } catch (error) {
        console.error(`❌ Rollback failed: ${migration.id}`, error);
        throw error;
      }
    });
  }

  /**
   * Get migration status for monitoring
   * Shows which migrations have been executed
   */
  async getStatus(): Promise<{
    total: number;
    executed: number;
    pending: number;
    lastMigration?: MigrationRecord;
  }> {
    try {
      const allMigrations = await this.loadMigrations();
      const executedMigrations = await this.getExecutedMigrations();
      
      return {
        total: allMigrations.length,
        executed: executedMigrations.length,
        pending: allMigrations.length - executedMigrations.length,
        lastMigration: executedMigrations[executedMigrations.length - 1],
      };
    } catch (error) {
      console.error('❌ Failed to get migration status:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const migrationManager = new MigrationManager();

// Export types
export type { Migration, MigrationRecord };