-- Correct the two temporary codes to the official Lavendish codes.
-- Run once before marketing_command_centre.sql.
do $$
begin
  if exists(select 1 from public.occupancy_profiles where hotel_code='TLK')
     and not exists(select 1 from public.occupancy_profiles where hotel_code='LTL') then
    update public.occupancy_profiles set hotel_code='LTL',updated_at=now() where hotel_code='TLK';
  end if;
  if exists(select 1 from public.occupancy_profiles where hotel_code='LBU')
     and not exists(select 1 from public.occupancy_profiles where hotel_code='LBR') then
    update public.occupancy_profiles set hotel_code='LBR',updated_at=now() where hotel_code='LBU';
  end if;
end $$;

update public.occupancy_profiles set hotel_name='Lavendish Tamarind Lifestyle',short_name='Lavendish Tamarind Lifestyle',updated_at=now() where hotel_code='LTL';
update public.occupancy_profiles set hotel_name='Lavendish Beach Resort',short_name='Lavendish Beach Resort',updated_at=now() where hotel_code='LBR';

update public.occupancy_user_access
set hotel_codes=array_replace(array_replace(hotel_codes,'TLK','LTL'),'LBU','LBR')
where 'TLK'=any(hotel_codes) or 'LBU'=any(hotel_codes);

update public.occupancy_aliases set hotel_code='LTL' where hotel_code='TLK';
update public.occupancy_aliases set hotel_code='LBR' where hotel_code='LBU';

do $$
begin
  if to_regclass('public.properties') is not null then
    update public.properties set legacy_hotel_code='LTL' where legacy_hotel_code='TLK';
    update public.properties set legacy_hotel_code='LBR' where legacy_hotel_code='LBU';
  end if;
end $$;
