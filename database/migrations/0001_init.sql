-- NSUT Attendance & Presence — initial schema
-- Source of truth for the database. Applied in order by apps/api/src/db/migrate.ts
-- and tracked in the schema_migrations table.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------- enums
CREATE TYPE user_role        AS ENUM ('SUPER_ADMIN', 'OFFICER', 'COORDINATOR', 'STAFF');
CREATE TYPE record_status    AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE person_type      AS ENUM ('GUEST_FACULTY', 'SPORTS_COACH');
CREATE TYPE attendance_status AS ENUM ('PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY', 'HOLIDAY');
CREATE TYPE marking_method   AS ENUM ('SELF', 'MANUAL', 'LEAVE_SYNC', 'SYSTEM');
CREATE TYPE leave_type       AS ENUM ('CASUAL', 'MEDICAL', 'DUTY', 'PERSONAL', 'OTHER');
CREATE TYPE leave_status     AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE correction_status AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- org
CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text NOT NULL,
  status      record_status NOT NULL DEFAULT 'ACTIVE',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_code_uq UNIQUE (code),
  CONSTRAINT departments_name_uq UNIQUE (name)
);
CREATE TRIGGER departments_updated BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  category       text NOT NULL,
  department_id  uuid REFERENCES departments(id) ON DELETE SET NULL,
  status         record_status NOT NULL DEFAULT 'ACTIVE',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activities_name_uq UNIQUE (name)
);
CREATE TRIGGER activities_updated BEFORE UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- people
CREATE TABLE people (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_id          text NOT NULL,
  full_name       text NOT NULL,
  photo_path      text,
  type            person_type NOT NULL,
  department_id   uuid REFERENCES departments(id) ON DELETE RESTRICT,
  activity_id     uuid REFERENCES activities(id) ON DELETE RESTRICT,
  designation     text,
  specialization  text,
  email           citext,
  phone           text,
  joining_date    date,
  contract_start  date,
  contract_end    date,
  assigned_hours  numeric(5,2) CHECK (assigned_hours IS NULL OR (assigned_hours >= 0 AND assigned_hours <= 80)),
  status          record_status NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT people_ref_uq UNIQUE (ref_id),
  CONSTRAINT people_contract_ck CHECK (contract_end IS NULL OR contract_start IS NULL OR contract_end >= contract_start),
  CONSTRAINT people_gf_dept_ck CHECK (type <> 'GUEST_FACULTY' OR department_id IS NOT NULL),
  CONSTRAINT people_sc_activity_ck CHECK (type <> 'SPORTS_COACH' OR activity_id IS NOT NULL)
);
CREATE TRIGGER people_updated BEFORE UPDATE ON people FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX people_type_status_idx ON people (type, status) WHERE deleted_at IS NULL;
CREATE INDEX people_department_idx ON people (department_id);
CREATE INDEX people_activity_idx ON people (activity_id);
CREATE INDEX people_name_idx ON people (lower(full_name));

-- ---------------------------------------------------------------- users & auth
CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  email                citext NOT NULL,
  phone                text,
  password_hash        text,
  auth_provider        text NOT NULL DEFAULT 'local' CHECK (auth_provider IN ('local', 'sso')),
  external_id          text,
  role                 user_role NOT NULL,
  status               record_status NOT NULL DEFAULT 'ACTIVE',
  person_id            uuid REFERENCES people(id) ON DELETE SET NULL,
  failed_login_count   integer NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  last_login           timestamptz,
  password_changed_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  CONSTRAINT users_email_uq UNIQUE (email),
  CONSTRAINT users_person_uq UNIQUE (person_id),
  CONSTRAINT users_local_pw_ck CHECK (auth_provider <> 'local' OR password_hash IS NOT NULL),
  CONSTRAINT users_staff_person_ck CHECK (role <> 'STAFF' OR person_id IS NOT NULL)
);
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Coordinator scope: which departments / activities a coordinator may see.
CREATE TABLE user_scopes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id  uuid REFERENCES departments(id) ON DELETE CASCADE,
  activity_id    uuid REFERENCES activities(id) ON DELETE CASCADE,
  CONSTRAINT user_scopes_one_ck CHECK ((department_id IS NULL) <> (activity_id IS NULL))
);
CREATE UNIQUE INDEX user_scopes_dept_uq ON user_scopes (user_id, department_id) WHERE department_id IS NOT NULL;
CREATE UNIQUE INDEX user_scopes_act_uq ON user_scopes (user_id, activity_id) WHERE activity_id IS NOT NULL;

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  csrf_token    text NOT NULL,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- leave
CREATE TABLE leaves (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id         uuid NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  from_date         date NOT NULL,
  to_date           date NOT NULL,
  leave_type        leave_type NOT NULL,
  reason            text NOT NULL,
  document_path     text,
  document_name     text,
  status            leave_status NOT NULL DEFAULT 'PENDING',
  submitted_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  reviewer_remarks  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leaves_range_ck CHECK (to_date >= from_date),
  -- No two active (pending/approved) leave requests may overlap for one person.
  CONSTRAINT leaves_no_overlap EXCLUDE USING gist (
    person_id WITH =,
    daterange(from_date, to_date, '[]') WITH &&
  ) WHERE (status IN ('PENDING', 'APPROVED'))
);
CREATE TRIGGER leaves_updated BEFORE UPDATE ON leaves FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX leaves_status_idx ON leaves (status, submitted_at DESC);
CREATE INDEX leaves_person_idx ON leaves (person_id, from_date);

-- ---------------------------------------------------------------- attendance
CREATE TABLE attendance (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id         uuid NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  date              date NOT NULL,
  status            attendance_status NOT NULL,
  check_in_at       timestamptz,
  check_out_at      timestamptz,
  duration_minutes  integer,
  marking_method    marking_method NOT NULL,
  remarks           text,
  marked_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  leave_id          uuid REFERENCES leaves(id) ON DELETE SET NULL,
  client_ip         inet,
  client_agent      text,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- One attendance record per person per date.
  CONSTRAINT attendance_person_date_uq UNIQUE (person_id, date),
  -- No checkout without check-in, and no checkout before check-in.
  CONSTRAINT attendance_checkout_ck CHECK (check_out_at IS NULL OR check_in_at IS NOT NULL),
  CONSTRAINT attendance_order_ck CHECK (check_out_at IS NULL OR check_out_at >= check_in_at),
  CONSTRAINT attendance_duration_ck CHECK (
    (check_out_at IS NULL AND duration_minutes IS NULL) OR
    (check_out_at IS NOT NULL AND duration_minutes = floor(extract(epoch FROM (check_out_at - check_in_at)) / 60))
  ),
  -- Times only make sense for days the person attended.
  CONSTRAINT attendance_times_status_ck CHECK (check_in_at IS NULL OR status IN ('PRESENT', 'HALF_DAY', 'ABSENT')),
  CONSTRAINT attendance_leave_link_ck CHECK (leave_id IS NULL OR status = 'LEAVE')
);
CREATE TRIGGER attendance_updated BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX attendance_date_idx ON attendance (date, status);
CREATE INDEX attendance_open_idx ON attendance (date) WHERE check_in_at IS NOT NULL AND check_out_at IS NULL;

-- Attendance corrections (always recorded; may require approval per rules).
CREATE TABLE attendance_corrections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id   uuid REFERENCES attendance(id) ON DELETE SET NULL,
  person_id       uuid NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  date            date NOT NULL,
  previous_value  jsonb,
  proposed_value  jsonb NOT NULL,
  reason          text NOT NULL,
  status          correction_status NOT NULL,
  requested_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  review_remarks  text
);
CREATE INDEX attendance_corrections_person_idx ON attendance_corrections (person_id, date DESC);
CREATE UNIQUE INDEX attendance_corrections_one_pending ON attendance_corrections (person_id, date) WHERE status = 'PENDING';

-- ---------------------------------------------------------------- settings & holidays
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- notifications
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  channel     text NOT NULL DEFAULT 'in_app',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Outbox for future email/SMS/WhatsApp delivery workers.
CREATE TABLE notification_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  recipient     text NOT NULL,
  subject       text,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);

-- ---------------------------------------------------------------- audit log (append-only)
CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  user_name    text,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text,
  summary      text,
  old_value    jsonb,
  new_value    jsonb,
  reason       text,
  ip           inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
