/**
 * Specification Repository
 * 
 * Handles living specification data operations with version control
 * and real-time synchronization for distributed teams.
 */

import { z } from 'zod';
import { BaseRepository, QueryOptions, PaginatedResult } from './BaseRepository';
import { 
  Specification, 
  SpecificationStatus, 
  UserStory, 
  AcceptanceCriteria, 
  TechnicalRequirement 
} from '@collabspec/shared';

// Database entity schema (matching PostgreSQL structure)
const SpecificationEntitySchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  content: z.object({
    userStories: z.array(UserStory).default([]),
    acceptanceCriteria: z.array(AcceptanceCriteria).default([]),
    technicalRequirements: z.array(TechnicalRequirement).default([]),
    metadata: z.record(z.any()).default({}),
  }),
  status: z.nativeEnum({
    draft: 'draft',
    review: 'review',
    approved: 'approved',
    implemented: 'implemented',
  } as const),
  version: z.string(),
  tags: z.array(z.string()),
  stakeholders: z.array(z.string().uuid()),
  linked_code_changes: z.array(z.string()),
  parent_id: z.string().uuid().nullable(),
  created_by: z.string().uuid(),
  last_synced_at: z.date().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

const CreateSpecificationSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  content: z.object({
    userStories: z.array(UserStory).default([]),
    acceptanceCriteria: z.array(AcceptanceCriteria).default([]),
    technicalRequirements: z.array(TechnicalRequirement).default([]),
    metadata: z.record(z.any()).default({}),
  }).default({}),
  status: z.nativeEnum({
    draft: 'draft',
    review: 'review',
    approved: 'approved',
    implemented: 'implemented',
  } as const).default('draft'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  tags: z.array(z.string()).default([]),
  stakeholders: z.array(z.string().uuid()).default([]),
  parent_id: z.string().uuid().optional(),
  created_by: z.string().uuid(),
});

const UpdateSpecificationSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  content: z.object({
    userStories: z.array(UserStory).optional(),
    acceptanceCriteria: z.array(AcceptanceCriteria).optional(),
    technicalRequirements: z.array(TechnicalRequirement).optional(),
    metadata: z.record(z.any()).optional(),
  }).optional(),
  status: z.nativeEnum({
    draft: 'draft',
    review: 'review',
    approved: 'approved',
    implemented: 'implemented',
  } as const).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  tags: z.array(z.string()).optional(),
  stakeholders: z.array(z.string().uuid()).optional(),
  linked_code_changes: z.array(z.string()).optional(),
  last_synced_at: z.date().optional(),
});

type SpecificationEntity = z.infer<typeof SpecificationEntitySchema>;
type CreateSpecificationInput = z.infer<typeof CreateSpecificationSchema>;
type UpdateSpecificationInput = z.infer<typeof UpdateSpecificationSchema>;

export interface SpecificationFilters {
  project_id?: string;
  status?: SpecificationStatus;
  created_by?: string;
  stakeholder?: string;
  tags?: string[];
  search?: string;
  updated_since?: Date;
}

export class SpecificationRepository extends BaseRepository<
  SpecificationEntity, 
  CreateSpecificationInput, 
  UpdateSpecificationInput
> {
  protected tableName = 'specifications';
  protected schema = SpecificationEntitySchema;
  protected createSchema = CreateSpecificationSchema;
  protected updateSchema = UpdateSpecificationSchema;

  /**
   * Find specifications by project with advanced filtering
   * Optimized for distributed team collaboration
   */
  async findByProject(
    projectId: string,
    filters: Omit<SpecificationFilters, 'project_id'> = {},
    pagination?: { page: number; limit: number; sortBy?: string; sortOrder?: 'ASC' | 'DESC' },
    options: QueryOptions = {}
  ): Promise<PaginatedResult<SpecificationEntity>> {
    const allFilters = { ...filters, project_id: projectId };
    return this.findMany(allFilters, pagination, options);
  }

  /**
   * Find specifications by stakeholder for personalized views
   */
  async findByStakeholder(
    stakeholderId: string,
    filters: Omit<SpecificationFilters, 'stakeholder'> = {},
    pagination?: { page: number; limit: number; sortBy?: string; sortOrder?: 'ASC' | 'DESC' },
    options: QueryOptions = {}
  ): Promise<PaginatedResult<SpecificationEntity>> {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE $1 = ANY(stakeholders)
      ${filters.project_id ? 'AND project_id = $2' : ''}
      ${filters.status ? `AND status = $${filters.project_id ? 3 : 2}` : ''}
      ORDER BY ${pagination?.sortBy || 'updated_at'} ${pagination?.sortOrder || 'DESC'}
      ${pagination ? `LIMIT $${filters.project_id && filters.status ? 4 : filters.project_id || filters.status ? 3 : 2} OFFSET $${filters.project_id && filters.status ? 5 : filters.project_id || filters.status ? 4 : 3}` : ''}
    `;

    const params = [stakeholderId];
    if (filters.project_id) params.push(filters.project_id);
    if (filters.status) params.push(filters.status);
    if (pagination) {
      params.push(pagination.limit, (pagination.page - 1) * pagination.limit);
    }

    try {
      const result = await this.executeQuery(query, params, options);
      const data = result.rows.map(row => this.validateData(this.schema, row));

      // Get total count for pagination
      const countQuery = `
        SELECT COUNT(*) FROM ${this.tableName}
        WHERE $1 = ANY(stakeholders)
        ${filters.project_id ? 'AND project_id = $2' : ''}
        ${filters.status ? `AND status = $${filters.project_id ? 3 : 2}` : ''}
      `;
      const countParams = [stakeholderId];
      if (filters.project_id) countParams.push(filters.project_id);
      if (filters.status) countParams.push(filters.status);

      const countResult = await this.executeQuery(countQuery, countParams, options);
      const total = parseInt(countResult.rows[0].count);

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

      return { data, pagination: paginationMeta };
    } catch (error) {
      console.error('❌ Failed to find specifications by stakeholder:', error);
      throw error;
    }
  }

  /**
   * Search specifications with full-text search
   * Enables quick discovery across distributed teams
   */
  async searchSpecifications(
    searchTerm: string,
    projectId?: string,
    limit: number = 20,
    options: QueryOptions = {}
  ): Promise<SpecificationEntity[]> {
    const query = `
      SELECT s.*, 
             ts_rank(to_tsvector('english', s.title || ' ' || COALESCE(s.description, '')), 
                     plainto_tsquery('english', $1)) as rank
      FROM ${this.tableName} s
      WHERE to_tsvector('english', s.title || ' ' || COALESCE(s.description, '')) @@ plainto_tsquery('english', $1)
      ${projectId ? 'AND s.project_id = $2' : ''}
      ORDER BY rank DESC, s.updated_at DESC
      LIMIT $${projectId ? 3 : 2}
    `;

    const params = [searchTerm];
    if (projectId) params.push(projectId);
    params.push(limit);

    try {
      const result = await this.executeQuery(query, params, options);
      return result.rows.map(row => this.validateData(this.schema, row));
    } catch (error) {
      console.error('❌ Failed to search specifications:', error);
      throw error;
    }
  }

  /**
   * Create new version of specification
   * Supports version control for living documentation
   */
  async createVersion(
    specificationId: string,
    updates: Partial<UpdateSpecificationInput>,
    newVersion: string,
    userId: string,
    options: QueryOptions = {}
  ): Promise<SpecificationEntity> {
    const client = options.client;
    
    if (!client) {
      const { db } = await import('../connection');
      return await db.transaction(async (transactionClient) => {
        return this.createVersion(specificationId, updates, newVersion, userId, { 
          ...options, 
          client: transactionClient 
        });
      });
    }

    try {
      // Get current specification
      const current = await this.findById(specificationId, { client });
      if (!current) {
        throw new Error('Specification not found');
      }

      // Create new version with updates
      const newSpec: CreateSpecificationInput = {
        project_id: current.project_id,
        title: updates.title || current.title,
        description: updates.description !== undefined ? updates.description : current.description,
        content: updates.content ? { ...current.content, ...updates.content } : current.content,
        status: updates.status || current.status,
        version: newVersion,
        tags: updates.tags || current.tags,
        stakeholders: updates.stakeholders || current.stakeholders,
        parent_id: current.id, // Link to previous version
        created_by: userId,
      };

      return await this.create(newSpec, { client });
    } catch (error) {
      console.error('❌ Failed to create specification version:', error);
      throw error;
    }
  }

  /**
   * Get version history for a specification
   */
  async getVersionHistory(
    specificationId: string,
    options: QueryOptions = {}
  ): Promise<SpecificationEntity[]> {
    const query = `
      WITH RECURSIVE version_tree AS (
        -- Base case: start with the given specification
        SELECT *, 0 as depth
        FROM ${this.tableName}
        WHERE id = $1
        
        UNION ALL
        
        -- Recursive case: find all versions that have this as parent
        SELECT s.*, vt.depth + 1
        FROM ${this.tableName} s
        INNER JOIN version_tree vt ON s.parent_id = vt.id
      )
      SELECT * FROM version_tree
      ORDER BY created_at DESC
    `;

    try {
      const result = await this.executeQuery(query, [specificationId], options);
      return result.rows.map(row => this.validateData(this.schema, row));
    } catch (error) {
      console.error('❌ Failed to get version history:', error);
      throw error;
    }
  }

  /**
   * Link specification to code changes
   * Critical for living documentation synchronization
   */
  async linkCodeChanges(
    specificationId: string,
    codeChanges: string[],
    options: QueryOptions = {}
  ): Promise<SpecificationEntity | null> {
    const query = `
      UPDATE ${this.tableName}
      SET linked_code_changes = array_cat(linked_code_changes, $2::text[]),
          last_synced_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    try {
      const result = await this.executeQuery(query, [specificationId, codeChanges], options);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return this.validateData(this.schema, result.rows[0]);
    } catch (error) {
      console.error('❌ Failed to link code changes:', error);
      throw error;
    }
  }

  /**
   * Find specifications that need synchronization
   * Identifies specs that haven't been synced recently
   */
  async findOutdatedSpecs(
    maxAge: number = 24, // hours
    options: QueryOptions = {}
  ): Promise<SpecificationEntity[]> {
    const query = `
      SELECT * FROM ${this.tableName}
      WHERE (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '${maxAge} hours')
        AND status IN ('approved', 'implemented')
      ORDER BY updated_at DESC
    `;

    try {
      const result = await this.executeQuery(query, [], options);
      return result.rows.map(row => this.validateData(this.schema, row));
    } catch (error) {
      console.error('❌ Failed to find outdated specifications:', error);
      throw error;
    }
  }

  /**
   * Get specifications by status for workflow management
   */
  async findByStatus(
    status: SpecificationStatus,
    projectId?: string,
    options: QueryOptions = {}
  ): Promise<SpecificationEntity[]> {
    let query = `SELECT * FROM ${this.tableName} WHERE status = $1`;
    const params = [status];

    if (projectId) {
      query += ` AND project_id = $2`;
      params.push(projectId);
    }

    query += ` ORDER BY updated_at DESC`;

    try {
      const result = await this.executeQuery(query, params, options);
      return result.rows.map(row => this.validateData(this.schema, row));
    } catch (error) {
      console.error('❌ Failed to find specifications by status:', error);
      throw error;
    }
  }

  /**
   * Update specification status with audit trail
   */
  async updateStatus(
    specificationId: string,
    newStatus: SpecificationStatus,
    userId: string,
    options: QueryOptions = {}
  ): Promise<SpecificationEntity | null> {
    const client = options.client;
    
    if (!client) {
      const { db } = await import('../connection');
      return await db.transaction(async (transactionClient) => {
        return this.updateStatus(specificationId, newStatus, userId, { 
          ...options, 
          client: transactionClient 
        });
      });
    }

    try {
      // Get current specification for audit
      const current = await this.findById(specificationId, { client });
      if (!current) {
        return null;
      }

      // Update status
      const updated = await this.updateById(specificationId, { status: newStatus }, { client });

      // Log status change in audit log
      await client.query(`
        INSERT INTO audit_log (user_id, action, resource_type, resource_id, old_values, new_values)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        userId,
        'status_change',
        'specification',
        specificationId,
        JSON.stringify({ status: current.status }),
        JSON.stringify({ status: newStatus }),
      ]);

      return updated;
    } catch (error) {
      console.error('❌ Failed to update specification status:', error);
      throw error;
    }
  }

  /**
   * Get specifications requiring review
   * Helps with distributed team workflow management
   */
  async findPendingReviews(
    stakeholderId?: string,
    projectId?: string,
    options: QueryOptions = {}
  ): Promise<SpecificationEntity[]> {
    let query = `
      SELECT * FROM ${this.tableName}
      WHERE status = 'review'
    `;
    const params: any[] = [];

    if (stakeholderId) {
      query += ` AND $${params.length + 1} = ANY(stakeholders)`;
      params.push(stakeholderId);
    }

    if (projectId) {
      query += ` AND project_id = $${params.length + 1}`;
      params.push(projectId);
    }

    query += ` ORDER BY created_at ASC`; // Oldest first for FIFO review

    try {
      const result = await this.executeQuery(query, params, options);
      return result.rows.map(row => this.validateData(this.schema, row));
    } catch (error) {
      console.error('❌ Failed to find pending reviews:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const specificationRepository = new SpecificationRepository();