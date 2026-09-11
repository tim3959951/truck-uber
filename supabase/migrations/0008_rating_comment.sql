-- 0008: 評分可留文字意見
alter table public.orders add column if not exists rating_comment text not null default '';
-- the old 3-arg signature would be ambiguous with the new default parameter
drop function if exists public.rate_order(uuid, integer, text[]);

create or replace function public.rate_order(p_order uuid, p_stars integer, p_tags text[] default '{}', p_comment text default '')
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order and customer_id = auth.uid() for update;
  if o.id is null then raise exception 'order not found'; end if;
  if o.status <> 'completed' then raise exception 'order not completed'; end if;
  if o.rating is not null then return o; end if;
  update public.orders set rating = p_stars, rating_tags = p_tags, rating_comment = left(coalesce(p_comment, ''), 500) where id = p_order returning * into o;
  update public.drivers d
     set rating = round(((d.rating * d.rating_count) + p_stars) / (d.rating_count + 1.0), 2),
         rating_count = d.rating_count + 1
   where d.id = o.driver_id;
  perform public.log_event(p_order, 'rated', auth.uid(), null, null, jsonb_build_object('stars', p_stars, 'tags', p_tags, 'comment', left(coalesce(p_comment, ''), 500)));
  return o;
end $$;
grant execute on function public.rate_order(uuid, integer, text[], text) to authenticated;
