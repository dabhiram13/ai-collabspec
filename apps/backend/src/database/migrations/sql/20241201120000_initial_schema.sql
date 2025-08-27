-- Initial CollabSpec Database Schema
-- Optimized for distributed team collaboration and 100+ concurrent users

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search
CREATE EXTENSION IF NOT EXISTS "btree_gin"; -- For composite indexes

-- Create custom enum types for better type safety and performance
CREATE TYPE user_role AS ENUM ('developer', 'designer', 'product-manager', 'stakeholder');
CREATE TYPE spec_status AS ENUM ('draft', 'review', 'approved', 'implemented');
CREATE TYPE conversation_category AS ENUM ('feature', 'bug', 'enhancement', 'architecture', 'process');
CREATE TYPE integration_type AS ENUM ('github', 'slack', 'jira');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE workflow_status AS ENUM ('pending', 'active', 'paused', 'completed', 'failed');
CREATE TYPE message_type AS ENUM ('text', 'code', 'file', 'link', 'decision', 'question');

-- Users table with distributed team optimization
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(254) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'developer',
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    avatar_url VARCHAR(500),
    bio TEXT,
    skills JSONB DEFAULT '[]'::jsonb,
    preferences JSONB DEFAULT '{
        "notifications": {
            "email": true,
            "push": true,
            "slack": false,
            "quietHours": {
                "enabled": false,
                "startTime": "22:00",
                "endTime": "08:00"
            }
        },
        "theme": "light",
        "language": "en"
    }'::jsonb,
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    last_seen TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User availability windows for async collaboration
CREATE TABLE user_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, day_of_week, start_time, end_time)
);

-- Projects for organizing specifications and teams
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    settings JSONB DEFAULT '{
        "defaultTimezone": "UTC",
        "workingHours": {
            "start": "09:00",
            "end": "17:00"
        },
        "integrations": {
            "github": {"enabled": false},
            "slack": {"enabled": false},
            "jira": {"enabled": false}
        }
    }'::jsonb,
    created_by UUID NOT NULL REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    archived_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Project team members with role-based access
CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'developer',
    permissions JSONB DEFAULT '{
        "canEditSpecs": true,
        "canDeleteSpecs": false,
        "canManageIntegrations": false,
        "canInviteMembers": false
    }'::jsonb,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    left_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(project_id, user_id)
);

-- Living specifications with version control
CREATE TABLE specifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    content JSONB NOT NULL DEFAULT '{
        "userStories": [],
        "acceptanceCriteria": [],
        "technicalRequirements": [],
        "metadata": {}
    }'::jsonb,
    status spec_status DEFAULT 'draft',
    version VARCHAR(50) DEFAULT '1.0.0',
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    stakeholders UUID[] DEFAULT ARRAY[]::UUID[],
    linked_code_changes TEXT[] DEFAULT ARRAY[]::TEXT[],
    parent_id UUID REFERENCES specifications(id), -- For version history
    created_by UUID NOT NULL REFERENCES users(id),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Conversations and context management
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(500),
    category conversation_category DEFAULT 'feature',
    participants UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    linked_specifications UUID[] DEFAULT ARRAY[]::UUID[],
    linked_code_changes TEXT[] DEFAULT ARRAY[]::TEXT[],
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    metadata JSONB DEFAULT '{}'::jsonb,
    is_archived BOOLEAN DEFAULT false,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages within conversations
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    type message_type DEFAULT 'text',
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    mentions UUID[] DEFAULT ARRAY[]::UUID[],
    reactions JSONB DEFAULT '[]'::jsonb,
    thread_id UUID REFERENCES messages(id), -- For threaded replies
    edited_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Decision records for audit trails
CREATE TABLE decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_option UUID,
    rationale TEXT,
    impact VARCHAR(20) DEFAULT 'medium' CHECK (impact IN ('low', 'medium', 'high', 'critical')),
    stakeholders UUID[] DEFAULT ARRAY[]::UUID[],
    decided_by UUID REFERENCES users(id),
    decided_at TIMESTAMP WITH TIME ZONE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Integration configurations
CREATE TABLE integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type integration_type NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('active', 'inactive', 'error', 'pending')),
    last_sync_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    is_active BOOLEAN DEFAULT true,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(project_id, type)
);

-- Integration events for webhook processing
CREATE TABLE integration_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    source integration_type NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    processing_status VARCHAR(20) DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    processed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    related_entities UUID[] DEFAULT ARRAY[]::UUID[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Workflows for async orchestration
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    status workflow_status DEFAULT 'pending',
    config JSONB DEFAULT '{
        "tasks": [],
        "handoffs": [],
        "scheduling": {
            "timezone": "UTC",
            "workingHours": {"start": "09:00", "end": "17:00"}
        }
    }'::jsonb,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    estimated_duration INTEGER, -- Minutes
    actual_duration INTEGER, -- Minutes
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tasks within workflows
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    assigned_to UUID REFERENCES users(id),
    priority task_priority DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'blocked', 'completed', 'cancelled')),
    dependencies UUID[] DEFAULT ARRAY[]::UUID[], -- Task IDs
    estimated_duration INTEGER, -- Minutes
    due_date TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit log for tracking all changes
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for optimal query performance with 100+ concurrent users
-- User indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = true;
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_timezone ON users(timezone);

-- Project indexes
CREATE INDEX idx_projects_active ON projects(is_active) WHERE is_active = true;
CREATE INDEX idx_projects_created_by ON projects(created_by);
CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);

-- Specification indexes
CREATE INDEX idx_specifications_project ON specifications(project_id);
CREATE INDEX idx_specifications_status ON specifications(status);
CREATE INDEX idx_specifications_created_by ON specifications(created_by);
CREATE INDEX idx_specifications_updated_at ON specifications(updated_at);
CREATE INDEX idx_specifications_tags ON specifications USING GIN(tags);
CREATE INDEX idx_specifications_stakeholders ON specifications USING GIN(stakeholders);
CREATE INDEX idx_specifications_content ON specifications USING GIN(content);

-- Conversation indexes
CREATE INDEX idx_conversations_project ON conversations(project_id);
CREATE INDEX idx_conversations_category ON conversations(category);
CREATE INDEX idx_conversations_participants ON conversations USING GIN(participants);
CREATE INDEX idx_conversations_last_activity ON conversations(last_activity_at);
CREATE INDEX idx_conversations_tags ON conversations USING GIN(tags);

-- Message indexes
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_thread ON messages(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX idx_messages_content_search ON messages USING GIN(to_tsvector('english', content));

-- Integration indexes
CREATE INDEX idx_integrations_project_type ON integrations(project_id, type);
CREATE INDEX idx_integrations_status ON integrations(status);
CREATE INDEX idx_integration_events_integration ON integration_events(integration_id);
CREATE INDEX idx_integration_events_status ON integration_events(processing_status);
CREATE INDEX idx_integration_events_created_at ON integration_events(created_at);

-- Workflow indexes
CREATE INDEX idx_workflows_project ON workflows(project_id);
CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_tasks_workflow ON tasks(workflow_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date) WHERE due_date IS NOT NULL;

-- Audit log indexes
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

-- Create updated_at trigger function for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_specifications_updated_at BEFORE UPDATE ON specifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to update conversation last_activity_at when messages are added
CREATE OR REPLACE FUNCTION update_conversation_activity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations 
    SET last_activity_at = NOW() 
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_conversation_activity_trigger 
    AFTER INSERT ON messages 
    FOR EACH ROW EXECUTE FUNCTION update_conversation_activity();

-- Create function for full-text search across specifications and conversations
CREATE OR REPLACE FUNCTION search_content(search_term TEXT, project_uuid UUID DEFAULT NULL)
RETURNS TABLE(
    id UUID,
    type TEXT,
    title TEXT,
    content TEXT,
    rank REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id,
        'specification'::TEXT as type,
        s.title,
        s.description as content,
        ts_rank(to_tsvector('english', s.title || ' ' || s.description), plainto_tsquery('english', search_term)) as rank
    FROM specifications s
    WHERE 
        (project_uuid IS NULL OR s.project_id = project_uuid)
        AND to_tsvector('english', s.title || ' ' || s.description) @@ plainto_tsquery('english', search_term)
    
    UNION ALL
    
    SELECT 
        c.id,
        'conversation'::TEXT as type,
        COALESCE(c.title, 'Untitled Conversation') as title,
        string_agg(m.content, ' ') as content,
        ts_rank(to_tsvector('english', string_agg(m.content, ' ')), plainto_tsquery('english', search_term)) as rank
    FROM conversations c
    JOIN messages m ON c.id = m.conversation_id
    WHERE 
        (project_uuid IS NULL OR c.project_id = project_uuid)
        AND to_tsvector('english', m.content) @@ plainto_tsquery('english', search_term)
    GROUP BY c.id, c.title
    
    ORDER BY rank DESC;
END;
$$ LANGUAGE plpgsql;

-- DOWN
-- Rollback script for development and emergency rollbacks

DROP FUNCTION IF EXISTS search_content(TEXT, UUID);
DROP FUNCTION IF EXISTS update_conversation_activity();
DROP FUNCTION IF EXISTS update_updated_at_column();

DROP TRIGGER IF EXISTS update_conversation_activity_trigger ON messages;
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
DROP TRIGGER IF EXISTS update_workflows_updated_at ON workflows;
DROP TRIGGER IF EXISTS update_integrations_updated_at ON integrations;
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
DROP TRIGGER IF EXISTS update_specifications_updated_at ON specifications;
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS workflows;
DROP TABLE IF EXISTS integration_events;
DROP TABLE IF EXISTS integrations;
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS specifications;
DROP TABLE IF EXISTS project_members;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS user_availability;
DROP TABLE IF EXISTS users;

DROP TYPE IF EXISTS message_type;
DROP TYPE IF EXISTS workflow_status;
DROP TYPE IF EXISTS task_priority;
DROP TYPE IF EXISTS integration_type;
DROP TYPE IF EXISTS conversation_category;
DROP TYPE IF EXISTS spec_status;
DROP TYPE IF EXISTS user_role;

DROP EXTENSION IF EXISTS btree_gin;
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS "uuid-ossp";