-- ════════════════════════════════════════════════════════════════════════
-- RegulaPro — Migração inicial
-- Cria todo o schema, políticas de RLS, triggers e o bucket de storage
-- usados pela aplicação. Rode este arquivo uma vez no SQL Editor do seu
-- projeto Supabase (ou via `supabase db push` com a CLI).
-- ════════════════════════════════════════════════════════════════════════

-- ── Extensões ──
create extension if not exists "pgcrypto";

-- ════════════════════════════════════════════════════════════════════════
-- 1. PROFILES — perfil de cada usuário autenticado (vinculado a auth.users)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  username    text not null,
  nome        text not null,
  ini         text not null default '??',
  role        text not null default 'member' check (role in ('admin','member')),
  colab_key   text,          -- opcional: vincula o usuário a um analista fixo (ana/bea/car/dan/eli/fab)
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Perfil de cada usuário autenticado do RegulaPro (papel, nome, iniciais).';

-- ════════════════════════════════════════════════════════════════════════
-- 2. PRODUCTS — Painel de Produtos (DATA no app original)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.products (
  id               double precision primary key,
  nome             text not null,
  colab            text not null default 'inbox',
  marca            text default '',
  linha            text default '',
  tipo             text default '',
  prioridade       boolean not null default false,
  ag_esgotamento   boolean not null default false,
  is_kit           boolean not null default false,
  kit_items        jsonb not null default '[]',
  etapas           jsonb not null default '{}',
  realoc_history   jsonb not null default '[]',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.products is 'Produtos do Painel de Produtos — espelha a estrutura de "etapas" usada no front-end (validação, rotulagem, arte, ANVISA, pós-ANVISA).';

-- ════════════════════════════════════════════════════════════════════════
-- 3. MATERIA_PRIMA — Painel Biodiversidade
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.materia_prima (
  id          text primary key,
  nome        text not null,
  ged         text default '',
  status      text not null default 'backlog' check (status in ('backlog','andamento','incompleto','concluido')),
  pendencia   text default '',
  criado_em   timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════════
-- 4. REUNIOES — Painel de Reuniões
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.reunioes (
  id             text primary key,
  nome           text not null,
  data           date,
  inicio         text,
  fim            text,
  notas          text default '',
  responsaveis   jsonb not null default '[]',
  concluida      boolean not null default false,
  criado_em      timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════════
-- 5. AGENDA_EVENTOS — Agenda (reuniões/treinamentos legados)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.agenda_eventos (
  id          text primary key,
  tipo        text not null check (tipo in ('reuniao','treinamento')),
  titulo      text not null,
  data        date,
  horario     text,
  notas       text default '',
  attendees   jsonb not null default '[]',
  concluida   boolean not null default false
);

-- ════════════════════════════════════════════════════════════════════════
-- 6. LISTS — listas editáveis (marcas, linhas, tipos)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.lists (
  key    text primary key,
  items  jsonb not null default '[]'
);

-- ════════════════════════════════════════════════════════════════════════
-- 7. CHECKLIST_BASE — checklist editável por etapa
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.checklist_base (
  etapa_key  text primary key,
  items      jsonb not null default '[]'
);

-- ════════════════════════════════════════════════════════════════════════
-- 8. SLA_CONFIG — configuração de SLA (linha única)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.sla_config (
  id   smallint primary key default 1 check (id = 1),
  val  int not null default 5,
  rot  int not null default 3,
  art  int not null default 3,
  anv  int not null default 10,
  pos  int not null default 5
);

-- ════════════════════════════════════════════════════════════════════════
-- 9. FERIADOS — feriados e pontes usados no cálculo de SLA
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.feriados (
  data  date primary key,
  nome  text not null default 'Feriado/Ponte'
);

-- ════════════════════════════════════════════════════════════════════════
-- 10. APP_SETTINGS — pares chave/valor genéricos (ex: controle de backup)
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.app_settings (
  key    text primary key,
  value  jsonb not null default '{}'
);

-- ════════════════════════════════════════════════════════════════════════
-- FUNÇÕES AUXILIARES
-- ════════════════════════════════════════════════════════════════════════

-- Retorna true se o usuário autenticado atual é admin
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Cria automaticamente um perfil ao criar um novo usuário de autenticação.
-- O primeiro usuário cadastrado no sistema vira admin automaticamente;
-- os demais entram como 'member' (podem ser promovidos depois por um admin).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
  meta_nome text;
begin
  select not exists(select 1 from public.profiles) into is_first;
  meta_nome := coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1));

  insert into public.profiles (id, email, username, nome, ini, role)
  values (
    new.id,
    new.email,
    split_part(new.email, '@', 1),
    meta_nome,
    upper(left(regexp_replace(meta_nome, '[^A-Za-zÀ-ÿ]', '', 'g'), 2)),
    case when is_first then 'admin' else 'member' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mantém updated_at de products em dia
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Modelo: aplicação de uso interno por uma única equipe — qualquer usuário
-- autenticado pode ler/gravar os dados de negócio. A tabela `profiles` tem
-- regras extras (qualquer autenticado lê; só o próprio usuário ou um admin
-- edita; só admin altera o campo `role`).
-- ════════════════════════════════════════════════════════════════════════

alter table public.profiles       enable row level security;
alter table public.products       enable row level security;
alter table public.materia_prima  enable row level security;
alter table public.reunioes       enable row level security;
alter table public.agenda_eventos enable row level security;
alter table public.lists          enable row level security;
alter table public.checklist_base enable row level security;
alter table public.sla_config     enable row level security;
alter table public.feriados       enable row level security;
alter table public.app_settings   enable row level security;

-- profiles
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.uid() is not null);

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles
  for update using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- Tabelas de negócio: qualquer usuário autenticado tem acesso total.
drop policy if exists "authenticated_all" on public.products;
create policy "authenticated_all" on public.products
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "authenticated_all" on public.materia_prima;
create policy "authenticated_all" on public.materia_prima
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "authenticated_all" on public.reunioes;
create policy "authenticated_all" on public.reunioes
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "authenticated_all" on public.agenda_eventos;
create policy "authenticated_all" on public.agenda_eventos
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "authenticated_all" on public.lists;
create policy "authenticated_all" on public.lists
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "authenticated_all" on public.checklist_base;
create policy "authenticated_all" on public.checklist_base
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "authenticated_all" on public.sla_config;
create policy "authenticated_all" on public.sla_config
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "authenticated_all" on public.feriados;
create policy "authenticated_all" on public.feriados
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "authenticated_all" on public.app_settings;
create policy "authenticated_all" on public.app_settings
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ════════════════════════════════════════════════════════════════════════
-- STORAGE — bucket privado para backups JSON diários
-- ════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

drop policy if exists "backups_authenticated_all" on storage.objects;
create policy "backups_authenticated_all" on storage.objects
  for all using (bucket_id = 'backups' and auth.uid() is not null)
  with check (bucket_id = 'backups' and auth.uid() is not null);

-- ════════════════════════════════════════════════════════════════════════
-- SEED — dados padrão (listas, checklist base e config de SLA)
-- Só insere se as tabelas ainda estiverem vazias, para não sobrescrever
-- customizações em migrações futuras.
-- ════════════════════════════════════════════════════════════════════════

insert into public.sla_config (id, val, rot, art, anv, pos)
values (1, 5, 3, 3, 10, 5)
on conflict (id) do nothing;

insert into public.lists (key, items) values
  ('marcas', '["CARE","GRANADO","PHEBO","PUIG","LELI"]'::jsonb),
  ('linhas', '["ÁGUAS DE PHEBO","ANTISSÉPTICA","AROMÁTICOS","BARBEARIA","BEBÊ","CARE","FRUTAS","GLICERINA","ÍCONES PHEBO","LELI SCENTS","MEDICAMENTOS","ORIGENS","PERFUMARIA PHEBO","PET","PINK","TEMPEROS DA CULINÁRIA","TERRAPEUTICS","TRADICIONAL PHEBO","TRATAMENTO","VINTAGE"]'::jsonb),
  ('tipos', '["ÁGUA DE LIMPEZA","BALM LABIAL","BALM PÓS-BARBA","BATOM","BLUSH","BOUNCE","BRUMA","CERA CABELOS","CERA UNHAS","CICACARE","COLÔNIA","COLÔNIA ROLL-ON","CONDICIONADOR","CORRETIVO","CREME MÃOS","CREME CAPILAR","CREME DE ASSADURAS","CREME PARA CUTÍCULAS","DEO COLÔNIA","DESODORANTE","DESODORANTE PARA PÉS","DIFUSOR","EAU DE TOILETTE","EAU DE TOILETTE ROLL-ON","ESFOLIANTE","ESMALTES","ESPUMA BARBEAR","EXTRATO DE PERFUME","GEL DE BANHO","GEL PARA PÉS E PERNAS CANSADAS","GEL PROTETOR DE CALOS E BOLHAS","GEL RELAXANTE ANTI-CANSAÇO","GLOSS","HAND SANITIZER","HIDRATANTE","ILUMINADOR","KIT","LEITE DE IMERSÃO","LENÇO UMEDECIDO","MANTEIGA","MÁSC. CÍLIOS","MÁSCARA CAPILAR","ÓLEO CAPILAR","ÓLEO CORPORAL","ÓLEO DE BARBA","ÓLEO FORTALECEDOR DE UNHAS","PERFUME","PERFUME ROLL-ON","POLVILHO ANTISSÉPTICO","PROTETOR SOLAR","REMOVEDOR DE ESMALTE","REPARADOR DE CALCANHARES","REPELENTE","SABONETE BARRA","SABONETE DE BARBEAR","SABONETE LÍQUIDO","SACHET ESCALDA PÉS","SAIS DE BANHO","SÉRUM","SHAMPOO","SILKY LIPS","SKINDROPS","SOS CUTICULAS PERFEITAS","SPRAY AMBIENTE","SPRAY CORPO E CABELO","SUPOSITÓRIO DE GLICERINA","TALCO","VELA"]'::jsonb)
on conflict (key) do nothing;

insert into public.checklist_base (etapa_key, items) values
  ('val', '[{"id":"v1","text":"Verificar documentação técnica completa"},{"id":"v2","text":"Conferir fórmula aprovada e laudos"},{"id":"v3","text":"Validar ingredientes e concentrações regulatórias"},{"id":"v4","text":"Confirmar categoria do produto (notificação/registro)"},{"id":"v5","text":"Revisar claims e restrições de uso"}]'::jsonb),
  ('rot', '[{"id":"r1","text":"Verificar dados obrigatórios no rótulo (INCI, validade, lote)"},{"id":"r2","text":"Confirmar idioma e tradução do rótulo"},{"id":"r3","text":"Revisar tamanho da fonte e legibilidade"},{"id":"r4","text":"Checar embalagem primária vs. secundária"},{"id":"r5","text":"Validar número de registro/notificação no rótulo"}]'::jsonb),
  ('art', '[{"id":"a1","text":"Conferir arte final vs. rótulo aprovado"},{"id":"a2","text":"Verificar cores, logo e identidade visual"},{"id":"a3","text":"Validar textos regulatórios na arte"},{"id":"a4","text":"Confirmar aprovação com equipe de MKT"}]'::jsonb),
  ('anv', '[{"id":"n1","text":"Acessar sistema ANVISA (SINARC/SINEP)"},{"id":"n2","text":"Preencher formulário de notificação corretamente"},{"id":"n3","text":"Anexar documentação técnica obrigatória"},{"id":"n4","text":"Confirmar protocolo e número de notificação gerado"},{"id":"n5","text":"Arquivar comprovante no dossiê do produto"}]'::jsonb),
  ('pos', '[{"id":"p1","text":"Confirmar número ANVISA ativo e válido"},{"id":"p2","text":"Comunicar liberação para equipe de logística/PCP"},{"id":"p3","text":"Atualizar planilha de controle de registros"},{"id":"p4","text":"Arquivar dossiê completo do produto"}]'::jsonb)
on conflict (etapa_key) do nothing;
