-- Create user table
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE users IS 'Application users';
COMMENT ON COLUMN users.id IS 'Unique user identifier';
COMMENT ON COLUMN users.email IS 'User email address (unique)';
COMMENT ON COLUMN users.created_at IS 'User registration timestamp';
COMMENT ON COLUMN users.updated_at IS 'Last update timestamp';

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Insert initial user records
INSERT INTO users (email) VALUES
  ('admin@ai.com'),
  ('user@ai.com'),
  ('guest@ai.com')
ON CONFLICT (email) DO NOTHING;
