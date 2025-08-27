/**
 * Database Connection Tests
 * 
 * Tests database connection management, pooling, and error handling
 * for distributed team collaboration scenarios.
 */

import { DatabaseConnection } from '../connection';

// Mock pg module
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
  })),
}));

describe('DatabaseConnection', () => {
  let dbConnection: DatabaseConnection;
  let mockPool: any;

  beforeEach(() => {
    // Reset environment variables
    delete process.env.DATABASE_URL;
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;

    // Create new instance for each test
    dbConnection = new DatabaseConnection();
    
    // Get mock pool instance
    const { Pool } = require('pg');
    mockPool = new Pool();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration Parsing', () => {
    it('should parse DATABASE_URL correctly', () => {
      process.env.DATABASE_URL = 'postgresql://testuser:testpass@localhost:5432/testdb';
      
      const connection = new DatabaseConnection();
      expect(connection).toBeDefined();
    });

    it('should parse individual environment variables', () => {
      process.env.DB_HOST = 'localhost';
      process.env.DB_NAME = 'testdb';
      process.env.DB_USER = 'testuser';
      process.env.DB_PASSWORD = 'testpass';
      process.env.DB_PORT = '5432';

      const connection = new DatabaseConnection();
      expect(connection).toBeDefined();
    });

    it('should use default values for optional settings', () => {
      process.env.DATABASE_URL = 'postgresql://testuser:testpass@localhost:5432/testdb';
      
      const connection = new DatabaseConnection();
      expect(connection).toBeDefined();
    });

    it('should throw error for invalid configuration', () => {
      // Missing required fields
      expect(() => new DatabaseConnection()).toThrow();
    });
  });

  describe('Connection Management', () => {
    beforeEach(() => {
      process.env.DATABASE_URL = 'postgresql://testuser:testpass@localhost:5432/testdb';
    });

    it('should initialize connection pool successfully', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ current_time: new Date(), db_version: 'PostgreSQL 15.0' }] }),
        release: jest.fn(),
      };
      
      mockPool.connect.mockResolvedValue(mockClient);
      
      await dbConnection.connect();
      
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('SELECT NOW() as current_time, version() as db_version');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle connection errors gracefully', async () => {
      mockPool.connect.mockRejectedValue(new Error('Connection failed'));
      
      await expect(dbConnection.connect()).rejects.toThrow('Database connection failed');
    });

    it('should set up event handlers for monitoring', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ current_time: new Date(), db_version: 'PostgreSQL 15.0' }] }),
        release: jest.fn(),
      };
      
      mockPool.connect.mockResolvedValue(mockClient);
      
      await dbConnection.connect();
      
      expect(mockPool.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockPool.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockPool.on).toHaveBeenCalledWith('remove', expect.any(Function));
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      process.env.DATABASE_URL = 'postgresql://testuser:testpass@localhost:5432/testdb';
      
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ current_time: new Date(), db_version: 'PostgreSQL 15.0' }] }),
        release: jest.fn(),
      };
      
      mockPool.connect.mockResolvedValue(mockClient);
      await dbConnection.connect();
    });

    it('should execute queries successfully', async () => {
      const expectedResult = { rows: [{ id: 1, name: 'test' }] };
      mockPool.query.mockResolvedValue(expectedResult);
      
      const result = await dbConnection.query('SELECT * FROM users WHERE id = $1', [1]);
      
      expect(mockPool.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
      expect(result).toEqual(expectedResult);
    });

    it('should handle query errors', async () => {
      mockPool.query.mockRejectedValue(new Error('Query failed'));
      
      await expect(dbConnection.query('INVALID SQL')).rejects.toThrow('Failed to get database client');
    });

    it('should get client from pool', async () => {
      const mockClient = { query: jest.fn(), release: jest.fn() };
      mockPool.connect.mockResolvedValue(mockClient);
      
      const client = await dbConnection.getClient();
      
      expect(mockPool.connect).toHaveBeenCalled();
      expect(client).toBe(mockClient);
    });
  });

  describe('Transaction Management', () => {
    let mockClient: any;

    beforeEach(async () => {
      process.env.DATABASE_URL = 'postgresql://testuser:testpass@localhost:5432/testdb';
      
      mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ current_time: new Date(), db_version: 'PostgreSQL 15.0' }] }),
        release: jest.fn(),
      };
      
      mockPool.connect.mockResolvedValue(mockClient);
      await dbConnection.connect();
    });

    it('should execute transaction successfully', async () => {
      const callback = jest.fn().mockResolvedValue('success');
      
      const result = await dbConnection.transaction(callback);
      
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(callback).toHaveBeenCalledWith(mockClient);
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
      expect(result).toBe('success');
    });

    it('should rollback transaction on error', async () => {
      const callback = jest.fn().mockRejectedValue(new Error('Transaction failed'));
      
      await expect(dbConnection.transaction(callback)).rejects.toThrow('Transaction failed');
      
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Pool Statistics', () => {
    beforeEach(async () => {
      process.env.DATABASE_URL = 'postgresql://testuser:testpass@localhost:5432/testdb';
      
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ current_time: new Date(), db_version: 'PostgreSQL 15.0' }] }),
        release: jest.fn(),
      };
      
      mockPool.connect.mockResolvedValue(mockClient);
      await dbConnection.connect();
    });

    it('should return pool statistics', () => {
      const stats = dbConnection.getPoolStats();
      
      expect(stats).toEqual({
        totalCount: 5,
        idleCount: 3,
        waitingCount: 0,
      });
    });

    it('should return zero stats when pool not initialized', () => {
      const newConnection = new DatabaseConnection();
      const stats = newConnection.getPoolStats();
      
      expect(stats).toEqual({
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
      });
    });
  });

  describe('Cleanup', () => {
    beforeEach(async () => {
      process.env.DATABASE_URL = 'postgresql://testuser:testpass@localhost:5432/testdb';
      
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ current_time: new Date(), db_version: 'PostgreSQL 15.0' }] }),
        release: jest.fn(),
      };
      
      mockPool.connect.mockResolvedValue(mockClient);
      await dbConnection.connect();
    });

    it('should disconnect gracefully', async () => {
      await dbConnection.disconnect();
      
      expect(mockPool.end).toHaveBeenCalled();
    });

    it('should handle disconnect when not connected', async () => {
      const newConnection = new DatabaseConnection();
      
      // Should not throw error
      await expect(newConnection.disconnect()).resolves.toBeUndefined();
    });
  });
});