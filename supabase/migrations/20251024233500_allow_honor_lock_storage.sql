do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'honor-lock'
  ) then
    insert into storage.buckets (id, name, public)
    values ('honor-lock', 'honor-lock', false);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'honor-lock objects insert'
  ) then
    execute $policy$
      create policy "honor-lock objects insert"
        on storage.objects
        for insert
        to public
        with check (bucket_id = 'honor-lock');
    $policy$;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'honor-lock objects update'
  ) then
    execute $policy$
      create policy "honor-lock objects update"
        on storage.objects
        for update
        to public
        using (bucket_id = 'honor-lock')
        with check (bucket_id = 'honor-lock');
    $policy$;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'honor-lock objects select'
  ) then
    execute $policy$
      create policy "honor-lock objects select"
        on storage.objects
        for select
        to public
        using (bucket_id = 'honor-lock');
    $policy$;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'honor-lock objects delete'
  ) then
    execute $policy$
      create policy "honor-lock objects delete"
        on storage.objects
        for delete
        to public
        using (bucket_id = 'honor-lock');
    $policy$;
  end if;
end $$;
