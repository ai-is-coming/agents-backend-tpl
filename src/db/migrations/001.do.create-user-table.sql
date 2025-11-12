-- Create user table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Insert initial user records
INSERT INTO users (email) VALUES
  ('admin@ai.com'),
  ('user@ai.com'),
  ('guest@ai.com')
ON CONFLICT (email) DO NOTHING;
