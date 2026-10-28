-- =============================================================================
-- Confirm the accounts left unconfirmed when email confirmation was turned off
--
-- The first accounts were made while Supabase Auth still asked new members to
-- confirm their address, and the confirmation emails were being removed by
-- WashU's mail filtering (see 20260910000001). Some of those accounts were
-- never confirmed. Turning confirmation off did not confirm them: the setting
-- decides what happens to new signups, and a row with email_confirmed_at null
-- stays that way.
--
-- An account in that state is worse off than one that was never made. Both of
-- these are read from Supabase Auth's source (internal/api/token.go and
-- internal/api/signup.go):
--
--   * Its owner can't sign in. The password grant refuses any unconfirmed
--     user with "Email not confirmed", whatever the confirmation setting, and
--     the email that would fix it is the one that never arrived. Registering
--     again with the same address signs them in once but keeps the old
--     password, so the next sign-in fails as well. The way out people find is
--     a second account under another address, and then the chapter has two
--     records for one person: the address on the old one is the real one, and
--     anything sent or matched to it (the attendance form, the officer board)
--     goes to the account nobody can open.
--
--   * Anyone can take it. With confirmation off, signing up with the address
--     of an existing unconfirmed account confirms that account and returns a
--     session for it, without checking the password. These accounts predate
--     the join code, so they were created 'active' and may already hold
--     attendance and points.
--
-- Confirming them closes both. It is what Supabase Auth's own User.Confirm()
-- does -- set email_confirmed_at, clear confirmation_token -- and it claims
-- nothing about the address that a signup today doesn't: with confirmation
-- off, every new account is confirmed the moment it is made. Afterwards a
-- signup with one of these addresses gets "User already registered", and the
-- owner can sign in with their original password or an admin's reset link.
--
-- Each account confirmed here gets an audit row, so an officer can see whose
-- account this touched. If one of them turns out to be a duplicate of an
-- account the person made later, private.merge_member_accounts() (next
-- migration) folds it into that one.
-- =============================================================================

do $$
declare
  v_account record;
begin
  for v_account in
    update auth.users u
       set email_confirmed_at = now(),
           confirmation_token = '',
           updated_at         = now()
     where u.email_confirmed_at is null
       and u.email is not null
       and u.deleted_at is null
    returning u.id, u.email
  loop
    perform public.write_audit_log(
      null, 'member.email_confirmed', 'member', v_account.id,
      jsonb_build_object(
        'display_name', (select btrim(p.first_name || ' ' || p.last_name)
                           from public.profiles p where p.id = v_account.id),
        'email',        v_account.email,
        'reason',       'Left unconfirmed when email confirmation was turned off'
      )
    );
  end loop;
end;
$$;
