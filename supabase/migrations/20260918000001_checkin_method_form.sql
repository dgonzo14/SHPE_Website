-- =============================================================================
-- Attendance form: a check-in method of its own
--
-- Attendance that arrives through the public attendance form (added in
-- 20260918000002_attendance_form.sql) is recorded with check_in_method 'form',
-- so a roster can tell "typed the event code" from "filled in the form" from
-- "an officer added them".
--
-- On its own, in its own migration, because a value added to an enum cannot be
-- used in the transaction that adds it. Keeping it apart means the next
-- migration runs after this one has committed, whichever way the runner groups
-- statements.
-- =============================================================================

alter type public.checkin_method add value if not exists 'form';
