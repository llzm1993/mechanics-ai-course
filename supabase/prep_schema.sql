-- =====================================================================
-- 《力学》AI 智慧课程 · 课前预习结果统计
-- 预习时长 + 3D 翻转闪卡自检（掌握/模糊/不会）统计
-- 目标项目：yvsgpmoudmorjmukbxgu（与课程登录/积分游戏共用）
-- 用途：前端 anon 公钥只通过两个 SECURITY DEFINER 函数访问：
--       submit_prep_record() 写入（支持重复提交 upsert）
--       get_prep_heatmap()    读取聚合结果
--       表本身对 anon/authenticated 无任何权限，个体原始记录完全不可见。
-- =====================================================================

-- 1) 主表：每行 = 一名学习者（user_id 或 session_tag）对某章的一次预习提交
create table if not exists public.prep_records (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  chapter       smallint    not null check (chapter between 1 and 12),
  user_id       uuid        null,                                   -- 登录用户；游客为 null
  session_tag   text        not null,                                -- 稳定标识：'u:'+uuid 或 'g:'+随机
  prep_seconds  integer     not null default 0,                      -- 实际预习时长（秒）
  card_results  jsonb       not null default '{}'::jsonb,            -- {"1":2,"2":0,...} 卡序(1-based)→掌握度(0/1/2)
  constraint prep_records_session_chapter_uniq unique (session_tag, chapter)
);

-- 2) 索引（加速聚合）
create index if not exists prep_records_chapter_idx on public.prep_records (chapter);

-- 3) 行级安全：开启后默认禁止一切。以下策略作为纵深防御保留；
--    实际前端访问在第 6 步被表级 revoke 完全关闭，只走 SECURITY DEFINER 函数。
--    注意：绝不创建 SELECT 策略。
alter table public.prep_records enable row level security;

-- 纵深防御：仅授权「写」：INSERT 与 UPDATE，但**绝不**授权 SELECT。
drop policy if exists "prep anon insert" on public.prep_records;
create policy "prep anon insert"
  on public.prep_records
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "prep anon update" on public.prep_records;
create policy "prep anon update"
  on public.prep_records
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- 注意：未创建任何 SELECT 策略 → anon 无法直接读取原始行，个体数据默认不可见；
--       聚合只读通过下方 SECURITY DEFINER 函数 get_prep_heatmap() 暴露。

-- 4) 聚合函数（SECURITY DEFINER）：返回热力图所需全部数据，anon 可执行
--    返回结构：
--    {
--      "chapters": [ {chapter, submissions, avg_seconds, learners,
--                     cells: { "1": {total, weak, not_mastered, weak_rate}, ... } }, ... ],
--      "max_card": <最大卡序>
--    }
--    掌握度：0=需重来(不会) 1=模糊 2=已掌握；weak = 0 或 1（即未掌握）
create or replace function public.get_prep_heatmap()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with expanded as (
    select
      chapter,
      (e.key)::int   as card_idx,
      (e.value)::int as mastery
    from public.prep_records,
         lateral jsonb_each_text(card_results) e
  ),
  cell as (
    select
      chapter,
      card_idx,
      count(*)                                                  as total,
      count(*) filter (where mastery < 2)                        as weak,
      count(*) filter (where mastery = 0)                        as not_mastered,
      round((count(*) filter (where mastery < 2))::numeric
            / nullif(count(*), 0), 3)                            as weak_rate
    from expanded
    group by chapter, card_idx
  ),
  chap as (
    select
      chapter,
      count(*) filter (where prep_seconds > 0)                    as submissions,
      round(avg(prep_seconds))::int                              as avg_seconds,
      count(distinct coalesce(user_id::text, session_tag))        as learners
    from public.prep_records
    group by chapter
  ),
  maxcard as ( select coalesce(max(card_idx), 0) as m from expanded )
  select jsonb_build_object(
    'chapters', coalesce((
      select jsonb_agg(c order by (c->>'chapter')::int)
      from (
        select jsonb_build_object(
          'chapter',      chap.chapter,
          'submissions',  coalesce(chap.submissions, 0),
          'avg_seconds',  coalesce(chap.avg_seconds, 0),
          'learners',     coalesce(chap.learners, 0),
          'cells', coalesce((
            select jsonb_object_agg(cell.card_idx, jsonb_build_object(
              'total',         cell.total,
              'weak',          cell.weak,
              'not_mastered',  cell.not_mastered,
              'weak_rate',     cell.weak_rate
            ))
            from cell where cell.chapter = chap.chapter
          ), '{}'::jsonb)
        ) as c
        from chap
      ) x
    ), '[]'::jsonb),
    'max_card', coalesce((select m from maxcard), 0)
  );
$$;

grant execute on function public.get_prep_heatmap() to anon, authenticated;

-- 5) 写入函数（SECURITY DEFINER）：前端唯一写入入口，支持重复提交
--    PostgREST 的 upsert 需要附带 SELECT 做冲突检测，而本表刻意不开放 SELECT，
--    因此改由 SECURITY DEFINER 函数在服务端完成 upsert，避免 RLS 冲突。
create or replace function public.submit_prep_record(
  p_chapter       smallint,
  p_session_tag   text,
  p_prep_seconds  integer,
  p_card_results  jsonb,
  p_user_id       uuid default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_chapter is null or p_chapter not between 1 and 12 then
    raise exception 'invalid chapter';
  end if;
  if p_session_tag is null or length(p_session_tag) < 3 or length(p_session_tag) > 120 then
    raise exception 'invalid session_tag';
  end if;
  if p_prep_seconds is null or p_prep_seconds < 0 or p_prep_seconds > 86400 then
    p_prep_seconds := 0;
  end if;
  if p_card_results is null or jsonb_typeof(p_card_results) <> 'object' then
    p_card_results := '{}'::jsonb;
  end if;

  insert into public.prep_records (chapter, session_tag, prep_seconds, card_results, user_id, updated_at)
  values (p_chapter, p_session_tag, p_prep_seconds, p_card_results, p_user_id, now())
  on conflict (session_tag, chapter) do update set
    prep_seconds = excluded.prep_seconds,
    card_results = excluded.card_results,
    user_id      = coalesce(excluded.user_id, public.prep_records.user_id),
    updated_at   = now();
end;
$$;

revoke all on function public.submit_prep_record(smallint,text,integer,jsonb,uuid) from public;
grant execute on function public.submit_prep_record(smallint,text,integer,jsonb,uuid) to anon, authenticated;

-- 6) 收紧表权限：匿名 / 登录用户不能直接读写原始表，只能走上述两个 RPC
--    （RLS 策略保留作为纵深防御；service_role 仍保留全部权限用于管理）
revoke insert, update, select, delete on public.prep_records from anon, authenticated;

-- 7) （可选）清理/诊断用：删除全部数据（仅管理员在 SQL 编辑器执行）
--    truncate table public.prep_records restart identity;
