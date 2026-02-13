set -euo pipefail

: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"
: "${APP_INIT_USERNAME:?}"

emails_sql="ARRAY[]::text[]"
if [ -n "${APP_INIT_EMAIL:-}" ]; then
  IFS=',' read -r -a _emails <<< "$APP_INIT_EMAIL"
  emails_sql="ARRAY["
  first=true
  for e in "${_emails[@]}"; do
    e_esc=$(printf "%s" "$e" | sed "s/'/''/g")
    if [ "$first" = true ]; then
      emails_sql="${emails_sql}'${e_esc}'"
      first=false
    else
      emails_sql="${emails_sql},'${e_esc}'"
    fi
  done
  emails_sql="${emails_sql}]::text[]"
fi

if [ -n "${APP_INIT_IS_ACTIVE:-}" ]; then
  is_active_sql="'${APP_INIT_IS_ACTIVE}'::boolean"
else
  is_active_sql="NULL"
fi

role="${APP_INIT_ROLE:-user}"
telegramID="${APP_INIT_TG_ID:-}"

role_esc=$(printf "%s" "$role" | sed "s/'/''/g")
telegramID_esc=$(printf "%s" "$telegramID" | sed "s/'/''/g")
username_esc=$(printf "%s" "$APP_INIT_USERNAME" | sed "s/'/''/g")

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-SQL
INSERT INTO public.users (username, email, created_at, is_active, role, telegramID)
VALUES (
  '${username_esc}',
  ${emails_sql},
  now(),
  ${is_active_sql},
  '${role_esc}',
  '${telegramID_esc}'
)
ON CONFLICT (username) DO UPDATE
  SET email = EXCLUDED.email,
      is_active = COALESCE(EXCLUDED.is_active, public.users.is_active),
      role = EXCLUDED.role,
      telegramID = EXCLUDED.telegramID;
SQL
