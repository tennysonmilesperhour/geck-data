-- Remove the remaining per-row auth calls and duplicate permissive policy
-- groups in the consolidated geck_data schema. Restrict owner and admin
-- policies to authenticated callers while preserving the existing access
-- model.

drop policy if exists "owner read delivery attempts" on geck_data.alert_delivery_attempts;
create policy "owner read delivery attempts"
  on geck_data.alert_delivery_attempts
  for select
  to authenticated
  using (
    exists (
      select 1
      from geck_data.alert_matches m
      join geck_data.alerts a on a.id = m.alert_id
      where m.id = alert_delivery_attempts.match_id
        and a.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owner read alert_matches" on geck_data.alert_matches;
create policy "owner read alert_matches"
  on geck_data.alert_matches
  for select
  to authenticated
  using (
    exists (
      select 1
      from geck_data.alerts a
      where a.id = alert_matches.alert_id
        and a.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owner read alerts" on geck_data.alerts;
drop policy if exists "owner insert alerts" on geck_data.alerts;
drop policy if exists "owner update alerts" on geck_data.alerts;
drop policy if exists "owner delete alerts" on geck_data.alerts;

create policy "owner read alerts"
  on geck_data.alerts for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "owner insert alerts"
  on geck_data.alerts for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "owner update alerts"
  on geck_data.alerts for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "owner delete alerts"
  on geck_data.alerts for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "owner crud breeding_pairs" on geck_data.breeding_pairs;
drop policy if exists "admin read breeding_pairs" on geck_data.breeding_pairs;

create policy "owner or admin read breeding_pairs"
  on geck_data.breeding_pairs for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (select geck_data.is_admin())
  );
create policy "owner insert breeding_pairs"
  on geck_data.breeding_pairs for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "owner update breeding_pairs"
  on geck_data.breeding_pairs for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "owner delete breeding_pairs"
  on geck_data.breeding_pairs for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "owner crud clutches" on geck_data.clutches;
drop policy if exists "admin read clutches" on geck_data.clutches;

create policy "owner or admin read clutches"
  on geck_data.clutches for select to authenticated
  using (
    exists (
      select 1
      from geck_data.breeding_pairs p
      where p.id = clutches.pair_id
        and p.owner_id = (select auth.uid())
    )
    or (select geck_data.is_admin())
  );
create policy "owner insert clutches"
  on geck_data.clutches for insert to authenticated
  with check (
    exists (
      select 1
      from geck_data.breeding_pairs p
      where p.id = clutches.pair_id
        and p.owner_id = (select auth.uid())
    )
  );
create policy "owner update clutches"
  on geck_data.clutches for update to authenticated
  using (
    exists (
      select 1
      from geck_data.breeding_pairs p
      where p.id = clutches.pair_id
        and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from geck_data.breeding_pairs p
      where p.id = clutches.pair_id
        and p.owner_id = (select auth.uid())
    )
  );
create policy "owner delete clutches"
  on geck_data.clutches for delete to authenticated
  using (
    exists (
      select 1
      from geck_data.breeding_pairs p
      where p.id = clutches.pair_id
        and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owner crud hatchlings" on geck_data.hatchlings;
drop policy if exists "admin read hatchlings" on geck_data.hatchlings;

create policy "owner or admin read hatchlings"
  on geck_data.hatchlings for select to authenticated
  using (
    exists (
      select 1
      from geck_data.clutches c
      join geck_data.breeding_pairs p on p.id = c.pair_id
      where c.id = hatchlings.clutch_id
        and p.owner_id = (select auth.uid())
    )
    or (select geck_data.is_admin())
  );
create policy "owner insert hatchlings"
  on geck_data.hatchlings for insert to authenticated
  with check (
    exists (
      select 1
      from geck_data.clutches c
      join geck_data.breeding_pairs p on p.id = c.pair_id
      where c.id = hatchlings.clutch_id
        and p.owner_id = (select auth.uid())
    )
  );
create policy "owner update hatchlings"
  on geck_data.hatchlings for update to authenticated
  using (
    exists (
      select 1
      from geck_data.clutches c
      join geck_data.breeding_pairs p on p.id = c.pair_id
      where c.id = hatchlings.clutch_id
        and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from geck_data.clutches c
      join geck_data.breeding_pairs p on p.id = c.pair_id
      where c.id = hatchlings.clutch_id
        and p.owner_id = (select auth.uid())
    )
  );
create policy "owner delete hatchlings"
  on geck_data.hatchlings for delete to authenticated
  using (
    exists (
      select 1
      from geck_data.clutches c
      join geck_data.breeding_pairs p on p.id = c.pair_id
      where c.id = hatchlings.clutch_id
        and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists "owner read profile" on geck_data.profiles;
drop policy if exists "admin read profiles" on geck_data.profiles;
drop policy if exists "admin update profiles" on geck_data.profiles;

create policy "owner or admin read profiles"
  on geck_data.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select geck_data.is_admin())
  );
create policy "admin update profiles"
  on geck_data.profiles for update to authenticated
  using ((select geck_data.is_admin()))
  with check ((select geck_data.is_admin()));

drop policy if exists "owner read channels" on geck_data.user_notification_channels;
drop policy if exists "owner insert channels" on geck_data.user_notification_channels;
drop policy if exists "owner update channels" on geck_data.user_notification_channels;
drop policy if exists "owner delete channels" on geck_data.user_notification_channels;

create policy "owner read channels"
  on geck_data.user_notification_channels for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "owner insert channels"
  on geck_data.user_notification_channels for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "owner update channels"
  on geck_data.user_notification_channels for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "owner delete channels"
  on geck_data.user_notification_channels for delete to authenticated
  using (owner_id = (select auth.uid()));
