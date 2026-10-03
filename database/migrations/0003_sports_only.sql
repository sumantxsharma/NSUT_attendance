-- Scope change: the system covers sports personnel only (sports guest faculty and
-- sports coaches). Academic departments are removed; everyone is organised by
-- sport / activity, and coordinators are scoped to sports / activities.

-- Coordinator scopes: activity only.
DELETE FROM user_scopes WHERE department_id IS NOT NULL;
ALTER TABLE user_scopes DROP CONSTRAINT user_scopes_one_ck;
ALTER TABLE user_scopes DROP COLUMN department_id;
ALTER TABLE user_scopes ALTER COLUMN activity_id SET NOT NULL;

-- People: every person belongs to a sport / activity.
-- NOT VALID: enforced for new and updated rows; rows created before this change
-- are assigned a sport when they are next edited.
ALTER TABLE people DROP CONSTRAINT people_gf_dept_ck;
ALTER TABLE people DROP CONSTRAINT people_sc_activity_ck;
ALTER TABLE people ADD CONSTRAINT people_activity_ck CHECK (activity_id IS NOT NULL) NOT VALID;
ALTER TABLE people DROP COLUMN department_id;

ALTER TABLE activities DROP COLUMN department_id;
DROP TABLE departments;
