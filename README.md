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
cors
dotenv
pg
express-useragent
connect-pg-simple

## db for session 
CREATE TABLE "session" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");

CREATE INDEX "IDX_session_expire" ON "session" ("expire");