-- Uploaded files (photos, leave documents, logo) live in the database so the app
-- can run on hosts without a persistent disk (e.g. Vercel). The existing
-- *_path / logoPath columns now hold the key of a row in this table.
-- Files are small (≤ 5 MB, validated by content), so bytea is adequate.

CREATE TABLE stored_files (
  key        text PRIMARY KEY,
  mime       text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'application/pdf')),
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
