-- ============================================================
-- 약국 VMD 시뮬레이터 - Supabase 초기 설정 SQL
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- ============================================================

-- 1) 테이블: 제품/POSM 라이브러리, 프로젝트(약국별 진열)
create table if not exists public.items (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.projects (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.fixtures (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);

-- 2) RLS 활성화
alter table public.items enable row level security;
alter table public.projects enable row level security;
alter table public.fixtures enable row level security;

-- 3) 접근 정책
--    [간단 버전] 익명(anon) 키로 읽기/쓰기 모두 허용 — 사내 비공개 도구용.
--    URL을 아는 사람은 누구나 수정 가능하니, 외부 노출이 걱정되면 아래 '로그인 버전' 참고.
create policy "anon all items" on public.items
  for all to anon using (true) with check (true);
create policy "anon all projects" on public.projects
  for all to anon using (true) with check (true);
create policy "anon all fixtures" on public.fixtures
  for all to anon using (true) with check (true);

-- ── (선택) 로그인 버전: 위 두 policy 대신 아래를 쓰고, 앱에 Supabase Auth를 붙이세요.
-- create policy "auth all items" on public.items
--   for all to authenticated using (true) with check (true);
-- create policy "auth all projects" on public.projects
--   for all to authenticated using (true) with check (true);

-- ============================================================
-- 4) 이미지 스토리지 버킷
--    대시보드 > Storage > New bucket 으로 'vmd-images' 생성 + Public 체크가 가장 쉽습니다.
--    SQL로 만들려면 아래 실행:
insert into storage.buckets (id, name, public)
values ('vmd-images', 'vmd-images', true)
on conflict (id) do nothing;

-- 업로드/조회 허용(anon). 외부 노출이 걱정되면 'authenticated'로 변경.
create policy "anon read images" on storage.objects
  for select to anon using (bucket_id = 'vmd-images');
create policy "anon upload images" on storage.objects
  for insert to anon with check (bucket_id = 'vmd-images');
