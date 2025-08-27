/**
 * CollabSpec Backend Server Entry Point
 * 
 * This is the main entry point for the CollabSpec backend API server.
 * It sets up Express, WebSocket connections, database connectivity,
 * and all necessary middleware for distributed team collaboration.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import { initializeDatabase, shutdownDatabase, getDatabaseHealth } from './database';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint with database status
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await getDatabaseHealth();
    
    res.status(dbHealth.status === 'healthy' ? 200 : 503).json({
      status: dbHealth.status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      database: {
        connected: dbHealth.connection,
        poolStats: dbHealth.poolStats,
        migrations: dbHealth.migrationStatus,
      },
      uptime: process.uptime(),
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

// Import routes
import authRoutes from './routes/auth';

// Basic API routes
app.get('/api', (req, res) => {
  res.json({
    message: 'CollabSpec API Server',
    version: '1.0.0',
    documentation: '/api/docs',
    features: [
      'Living Specifications',
      'Real-time Collaboration',
      'Cross-functional Translation',
      'Distributed Team Optimization',
    ],
  });
});

// Authentication routes
app.use('/api/auth', authRoutes);

// Database status endpoint for monitoring
app.get('/api/database/status', async (req, res) => {
  try {
    const dbHealth = await getDatabaseHealth();
    res.json(dbHealth);
  } catch (error) {
    console.error('❌ Database status check failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to check database status',
    });
  }
});

// WebSocket connection handling for real-time collaboration
io.on('connection', (socket) => {
  console.log(`👤 User connected: ${socket.id}`);
  
  // Handle user joining a project room for distributed collaboration
  socket.on('join-project', (projectId: string) => {
    if (!projectId || typeof projectId !== 'string') {
      socket.emit('error', { message: 'Invalid project ID' });
      return;
    }
    
    socket.join(`project:${projectId}`);
    socket.to(`project:${projectId}`).emit('user-joined', {
      userId: socket.id,
      timestamp: new Date().toISOString(),
    });
    
    console.log(`📋 User ${socket.id} joined project: ${projectId}`);
  });
  
  // Handle user leaving a project room
  socket.on('leave-project', (projectId: string) => {
    if (!projectId || typeof projectId !== 'string') {
      socket.emit('error', { message: 'Invalid project ID' });
      return;
    }
    
    socket.leave(`project:${projectId}`);
    socket.to(`project:${projectId}`).emit('user-left', {
      userId: socket.id,
      timestamp: new Date().toISOString(),
    });
    
    console.log(`📋 User ${socket.id} left project: ${projectId}`);
  });
  
  // Handle real-time specification updates
  socket.on('spec-update', (data: { projectId: string; specId: string; changes: any }) => {
    if (!data.projectId || !data.specId) {
      socket.emit('error', { message: 'Invalid specification update data' });
      return;
    }
    
    // Broadcast specification changes to other users in the project
    socket.to(`project:${data.projectId}`).emit('spec-updated', {
      specId: data.specId,
      changes: data.changes,
      updatedBy: socket.id,
      timestamp: new Date().toISOString(),
    });
    
    console.log(`📝 Specification ${data.specId} updated in project ${data.projectId}`);
  });
  
  // Handle typing indicators for collaborative editing
  socket.on('typing', (data: { projectId: string; specId: string; isTyping: boolean }) => {
    if (!data.projectId || !data.specId) {
      return;
    }
    
    socket.to(`project:${data.projectId}`).emit('user-typing', {
      userId: socket.id,
      specId: data.specId,
      isTyping: data.isTyping,
      timestamp: new Date().toISOString(),
    });
  });
  
  // Handle disconnection with cleanup
  socket.on('disconnect', (reason) => {
    console.log(`👤 User disconnected: ${socket.id}, reason: ${reason}`);
    
    // Notify all rooms that this user has disconnected
    socket.rooms.forEach(room => {
      if (room !== socket.id && room.startsWith('project:')) {
        socket.to(room).emit('user-left', {
          userId: socket.id,
          timestamp: new Date().toISOString(),
          reason: 'disconnect',
        });
      }
    });
  });
  
  // Handle errors
  socket.on('error', (error) => {
    console.error(`🔥 Socket error for user ${socket.id}:`, error);
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('🔥 Express error:', err);
  res.status(500).json({
    error: {
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || 'unknown',
    },
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: {
      message: 'Route not found',
      path: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
    },
  });
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, starting graceful shutdown...');
  await gracefulShutdown();
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, starting graceful shutdown...');
  await gracefulShutdown();
});

async function gracefulShutdown(): Promise<void> {
  try {
    console.log('🔌 Closing server connections...');
    
    // Close HTTP server
    server.close(() => {
      console.log('✅ HTTP server closed');
    });
    
    // Close WebSocket connections
    io.close(() => {
      console.log('✅ WebSocket server closed');
    });
    
    // Close database connections
    await shutdownDatabase();
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Initialize and start server
async function startServer(): Promise<void> {
  try {
    console.log('🚀 Starting CollabSpec Backend Server...');
    
    // Initialize database system
    await initializeDatabase();
    
    // Start HTTP server
    server.listen(PORT, () => {
      console.log('🎉 CollabSpec Backend Server started successfully!');
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🔌 WebSocket server ready for real-time collaboration`);
      console.log(`📋 API documentation: http://localhost:${PORT}/api`);
      console.log(`🗄️  Database status: http://localhost:${PORT}/api/database/status`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`⏰ Started at: ${new Date().toISOString()}`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer().catch((error) => {
  console.error('💥 Unhandled error during server startup:', error);
  process.exit(1);
});