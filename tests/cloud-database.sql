-- Run with a database administrator against PhotoBatch. NO auth users, real
-- counters or reservations are created/modified. Every object is temporary.
-- Exercise the deployed function bodies on copies without foreign keys, then
-- roll back. Real table grants, RLS and function grants are checked separately.
begin;
create temporary table counters (like public.counters including all);
create temporary table number_reservations (like public.number_reservations including all);
do $$
declare source text;
begin
  foreach source in array array[
    pg_get_functiondef('photobatch_private.sync_counters(bigint,bigint)'::regprocedure),
    pg_get_functiondef('photobatch_private.reserve_numbers(uuid,text,bigint,bigint)'::regprocedure)
  ] loop
    source := replace(replace(replace(source,'photobatch_private.','pg_temp.'),
      'public.counters','pg_temp.counters'),'public.number_reservations','pg_temp.number_reservations');
    execute source;
  end loop;
end $$;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); request uuid := gen_random_uuid(); result jsonb;
begin
  perform set_config('request.jwt.claim.sub',a::text,true);
  result:=pg_temp.sync_counters(1699,14098);
  assert result='{"photo":1699,"video":14098}'::jsonb,'initial floor';
  result:=pg_temp.reserve_numbers(request,'photo',1700,1799);
  assert result->>'photo'='1799','range reserved';
  result:=pg_temp.reserve_numbers(request,'photo',1700,1799);
  assert (select count(*) from pg_temp.number_reservations)=1,'retry idempotent';
  begin
    perform pg_temp.reserve_numbers(request,'photo',1800,1899);
    raise exception 'TEST_FAILED: changed retry accepted';
  exception when raise_exception then
    if sqlerrm like 'TEST_FAILED:%' then raise; end if;
  end;
  begin
    perform pg_temp.reserve_numbers(gen_random_uuid(),'photo',1700,1799);
    raise exception 'TEST_FAILED: stale range accepted';
  exception when raise_exception then
    if sqlerrm like 'TEST_FAILED:%' then raise; end if;
  end;
  result:=pg_temp.sync_counters(1500,14098);
  assert result->>'photo'='1799','old PC cannot rewind';
  result:=pg_temp.sync_counters(2499,14500);
  assert result='{"photo":2499,"video":14500}'::jsonb,'higher PC imported';
  result:=pg_temp.reserve_numbers(gen_random_uuid(),'video',14501,14520);
  assert result->>'photo'='2499' and result->>'video'='14520','separate counters';
  perform set_config('request.jwt.claim.sub',b::text,true);
  result:=pg_temp.sync_counters(-1,14098);
  assert result='{"photo":-1,"video":14098}'::jsonb,'second account independent';
  result:=pg_temp.reserve_numbers(request,'photo',1700,1799);
  assert result->>'photo'='1799','request scoped to owner';
  assert (select photo_last from pg_temp.counters where user_id=a)=2499,'first account untouched';
  begin
    perform pg_temp.sync_counters(null,14098);
    raise exception 'TEST_FAILED: null accepted';
  exception when raise_exception then
    if sqlerrm like 'TEST_FAILED:%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform pg_temp.sync_counters(-1,14098);
    raise exception 'TEST_FAILED: anonymous sync accepted';
  exception when insufficient_privilege then null;
  end;
  assert not has_function_privilege('anon','public.reserve_numbers(uuid,text,bigint,bigint)','EXECUTE'),'anonymous RPC denied';
  assert not has_table_privilege('authenticated','public.counters','UPDATE'),'direct write denied';
  assert not has_table_privilege('authenticated','public.number_reservations','DELETE'),'reservation delete denied';
end $$;
rollback;
select 'PASS: deployed logic on temporary tables; all test objects rolled back' as result;
