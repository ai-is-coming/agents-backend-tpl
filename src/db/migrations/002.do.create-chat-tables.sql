-- Chat sessions table
CREATE TABLE IF NOT EXISTS chat_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGSERIAL NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'New Chat',
  status SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE chat_sessions IS 'Chat conversation sessions';
COMMENT ON COLUMN chat_sessions.id IS 'Unique session identifier';
COMMENT ON COLUMN chat_sessions.user_id IS 'User who owns this session';
COMMENT ON COLUMN chat_sessions.title IS 'Session title or name';
COMMENT ON COLUMN chat_sessions.status IS 'Session status: 1=active, 0=archived';
COMMENT ON COLUMN chat_sessions.created_at IS 'Session creation timestamp';
COMMENT ON COLUMN chat_sessions.updated_at IS 'Last update timestamp';

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
ON chat_sessions(user_id, updated_at DESC);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGSERIAL NOT NULL,
  role VARCHAR(16) NOT NULL,
  trace_id CHAR(32) NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE chat_messages IS 'Individual messages within chat sessions';
COMMENT ON COLUMN chat_messages.id IS 'Unique message identifier';
COMMENT ON COLUMN chat_messages.session_id IS 'Associated chat session ID';
COMMENT ON COLUMN chat_messages.role IS 'Message role: user, assistant, system, or tool';
COMMENT ON COLUMN chat_messages.trace_id IS 'Trace ID for observability';
COMMENT ON COLUMN chat_messages.content IS 'Message content in JSON format';
COMMENT ON COLUMN chat_messages.created_at IS 'Message creation timestamp';
COMMENT ON COLUMN chat_messages.updated_at IS 'Last update timestamp';

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
ON chat_messages(session_id, id);
