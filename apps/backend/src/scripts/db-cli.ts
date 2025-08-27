#!/usr/bin/env ts-node

/**
 * Database CLI Tool
 * 
 * Command-line interface for managing CollabSpec database operations
 * including migrations, seeding, and maintenance tasks.
 */

import { Command } from 'commander';
import dotenv from 'dotenv';
import { db, migrationManager, getDatabaseHealth } from '../database';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('db-cli')
  .description('CollabSpec Database Management CLI')
  .version('1.0.0');

// Migration commands
const migrationCmd = program
  .command('migration')
  .alias('migrate')
  .description('Database migration operations');

migrationCmd
  .command('run')
  .description('Run pending migrations')
  .action(async () => {
    try {
      console.log('🚀 Running database migrations...');
      await db.connect();
      await migrationManager.migrate();
      console.log('✅ Migrations completed successfully');
    } catch (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    } finally {
      await db.disconnect();
    }
  });

migrationCmd
  .command('rollback')
  .description('Rollback the last migration')
  .action(async () => {
    try {
      console.log('🔄 Rolling back last migration...');
      await db.connect();
      await migrationManager.rollback();
      console.log('✅ Rollback completed successfully');
    } catch (error) {
      console.error('❌ Rollback failed:', error);
      process.exit(1);
    } finally {
      await db.disconnect();
    }
  });

migrationCmd
  .command('status')
  .description('Show migration status')
  .action(async () => {
    try {
      await db.connect();
      const status = await migrationManager.getStatus();
      
      console.log('📋 Migration Status:');
      console.log(`   Total migrations: ${status.total}`);
      console.log(`   Executed: ${status.executed}`);
      console.log(`   Pending: ${status.pending}`);
      
      if (status.lastMigration) {
        console.log(`   Last migration: ${status.lastMigration.name} (${status.lastMigration.executed_at})`);
      }
    } catch (error) {
      console.error('❌ Failed to get migration status:', error);
      process.exit(1);
    } finally {
      await db.disconnect();
    }
  });

// Database health and status commands
program
  .command('health')
  .description('Check database health and connection')
  .action(async () => {
    try {
      console.log('🏥 Checking database health...');
      await db.connect();
      
      const health = await getDatabaseHealth();
      
      console.log('📊 Database Health Report:');
      console.log(`   Status: ${health.status}`);
      console.log(`   Connection: ${health.connection ? '✅ Connected' : '❌ Disconnected'}`);
      console.log(`   Pool Stats:`);
      console.log(`     Total connections: ${health.poolStats.totalCount}`);
      console.log(`     Idle connections: ${health.poolStats.idleCount}`);
      console.log(`     Waiting connections: ${health.poolStats.waitingCount}`);
      
      if (health.migrationStatus) {
        console.log(`   Migration Status:`);
        console.log(`     Total: ${health.migrationStatus.total}`);
        console.log(`     Executed: ${health.migrationStatus.executed}`);
        console.log(`     Pending: ${health.migrationStatus.pending}`);
      }
      
    } catch (error) {
      console.error('❌ Health check failed:', error);
      process.exit(1);
    } finally {
      await db.disconnect();
    }
  });

// Database seeding commands
const seedCmd = program
  .command('seed')
  .description('Database seeding operations');

seedCmd
  .command('dev')
  .description('Seed database with development data')
  .action(async () => {
    try {
      console.log('🌱 Seeding database with development data...');
      await db.connect();
      
      // TODO: Implement development data seeding
      // This would create sample users, projects, specifications, etc.
      console.log('⚠️  Development seeding not yet implemented');
      
    } catch (error) {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    } finally {
      await db.disconnect();
    }
  });

seedCmd
  .command('test')
  .description('Seed database with test data')
  .action(async () => {
    try {
      console.log('🧪 Seeding database with test data...');
      await db.connect();
      
      // TODO: Implement test data seeding
      console.log('⚠️  Test seeding not yet implemented');
      
    } catch (error) {
      console.error('❌ Test seeding failed:', error);
      process.exit(1);
    } finally {
      await db.disconnect();
    }
  });

// Database reset commands
program
  .command('reset')
  .description('Reset database (WARNING: This will delete all data)')
  .option('--force', 'Skip confirmation prompt')
  .action(async (options) => {
    try {
      if (!options.force) {
        console.log('⚠️  WARNING: This will delete ALL data in the database!');
        console.log('   Use --force flag to skip this confirmation.');
        process.exit(1);
      }
      
      console.log('🔄 Resetting database...');
      await db.connect();
      
      // Drop all tables and recreate schema
      await db.query('DROP SCHEMA public CASCADE');
      await db.query('CREATE SCHEMA public');
      await db.query('GRANT ALL ON SCHEMA public TO public');
      
      // Run migrations to recreate tables
      await migrationManager.migrate();
      
      console.log('✅ Database reset completed');
      
    } catch (error) {
      console.error('❌ Database reset failed:', error);
      process.exit(1);
    } finally {
      await db.disconnect();
    }
  });

// Connection testing
program
  .command('test-connection')
  .description('Test database connection')
  .action(async () => {
    try {
      console.log('🔌 Testing database connection...');
      await db.connect();
      await db.testConnection();
      console.log('✅ Database connection successful');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      process.exit(1);
    } finally {
      await db.disconnect();
    }
  });

// Query execution
program
  .command('query <sql>')
  .description('Execute a SQL query')
  .option('--json', 'Output results as JSON')
  .action(async (sql: string, options) => {
    try {
      console.log('📝 Executing query...');
      await db.connect();
      
      const result = await db.query(sql);
      
      if (options.json) {
        console.log(JSON.stringify(result.rows, null, 2));
      } else {
        console.table(result.rows);
      }
      
      console.log(`✅ Query executed successfully (${result.rowCount} rows)`);
      
    } catch (error) {
      console.error('❌ Query execution failed:', error);
      process.exit(1);
    } finally {
      await db.disconnect();
    }
  });

// Error handling
program.exitOverride();

try {
  program.parse();
} catch (error) {
  console.error('❌ CLI error:', error);
  process.exit(1);
}

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}