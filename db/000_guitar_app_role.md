# Operator step: the `guitar_app` login role

Run once as `postgres`, before `001_guitar_schema.sql`, with a freshly generated password supplied
out-of-band (preferably as a `SCRAM-SHA-256$...` verifier so the plain password never reaches SQL logs):

```sql
CREATE ROLE guitar_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 5 PASSWORD '<SCRAM verifier>';
ALTER ROLE guitar_app SET search_path = guitar, pg_catalog;
ALTER ROLE guitar_app SET statement_timeout = '10s';
ALTER ROLE guitar_app SET idle_in_transaction_session_timeout = '15s';
```

The role has no memberships, cannot bypass RLS, and is granted only USAGE on schema `guitar`
and DML on its tables (see `001_guitar_schema.sql`).
