-- ============================================================================
-- 0005_storage.sql — private bucket for driver loading photos + policies
--
-- Bucket is PRIVATE: the app only ever reads photos through short-lived
-- signed URLs (createSignedUrl, 1h TTL). Public URLs are impossible.
-- Object path convention:  {delivery_id}/{timestamp}.jpg
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'delivery-photos',
  'delivery-photos',
  false,                       -- PRIVATE
  1048576,                     -- 1 MB hard cap per photo (client compresses to ~150 KB)
  array['image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Upload: only an active DRIVER, only into a folder named after a delivery
-- that is still PENDING. A driver cannot dump files elsewhere in the bucket,
-- and cannot overwrite proof after the delivery is loaded.
create policy "driver uploads loading photo"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'delivery-photos'
  and public.is_active_user()
  and public.get_my_role() = 'driver'
  and exists (
    select 1 from public.deliveries d
    where d.id::text = (storage.foldername(name))[1]
      and d.status = 'PENDING'
  )
);

-- Driver may replace their photo while the delivery is still PENDING.
create policy "driver replaces pending photo"
on storage.objects for update to authenticated
using (
  bucket_id = 'delivery-photos'
  and public.is_active_user()
  and public.get_my_role() = 'driver'
  and exists (
    select 1 from public.deliveries d
    where d.id::text = (storage.foldername(name))[1]
      and d.status = 'PENDING'
  )
);

create policy "driver deletes pending photo"
on storage.objects for delete to authenticated
using (
  bucket_id = 'delivery-photos'
  and public.is_active_user()
  and public.get_my_role() = 'driver'
  and exists (
    select 1 from public.deliveries d
    where d.id::text = (storage.foldername(name))[1]
      and d.status = 'PENDING'
  )
);

-- Read (via signed URL generation): manager/superadmin/driver, and the PIC
-- of the store the delivery belongs to. Nobody else.
create policy "read delivery photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'delivery-photos'
  and public.is_active_user()
  and (
    public.get_my_role() in ('manager', 'superadmin', 'driver')
    or (
      public.get_my_role() = 'pic'
      and exists (
        select 1 from public.deliveries d
        where d.id::text = (storage.foldername(name))[1]
          and d.store_id = public.get_my_store_id()
      )
    )
  )
);
