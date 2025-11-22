## для продакшна
в index html настроить безопасность
проверит все // for local use
Настроить конфиг nginx (флуд, редирект на httpS, https/2&3, hsts)


# private-gallery

// for local use - сменить на true

## libs:
### backend         ### frontend
express             react-router-dom
express-session     lucide-react
cors                three
dotenv              base64url
pg                  swiper
express-useragent   react-dom
connect-pg-simple
helmet
csurf
cookie-parser
express-rate-limit
@aws-sdk/client-s3
@aws-sdk/s3-request-presigner
sharp
multer
@simplewebauthn/server
base64url

eslint
prettier
eslint-config-prettier
eslint-plugin-prettier

## db for session 
CREATE TABLE "session" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");

CREATE INDEX "IDX_session_expire" ON "session" ("expire");



\c gallery
-- enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  used boolean DEFAULT false,
  used_at timestamptz
);

CREATE TABLE invite_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid REFERENCES invite_codes(id) NOT NULL,
  token_hash text NOT NULL,
  challenge text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer REFERENCES users(id) NOT NULL,
  credential_id bytea UNIQUE NOT NULL,
  public_key text NOT NULL,
  fmt text,
  sign_count bigint DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
