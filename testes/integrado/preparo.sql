-- SÓ PARA O BANCO DE TESTE (Supabase temporário do GitHub Actions). Roda antes das migrações do CRM.
-- Em produção, a tabela admins e a função is_admin() vêm do projeto das figurinhas (rovya-stickers),
-- por isso não estão nas migrações do CRM. Aqui recriamos as duas iguais às de produção.
create table if not exists public.admins(email text primary key);
alter table public.admins enable row level security; -- sem política: só a função abaixo (security definer) lê

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where email = (auth.jwt() ->> 'email'))
$$;

-- capturador de avisos: a crm-assistente de teste grava aqui em vez de mandar notificação ao celular
create table if not exists public.teste_avisos(
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  titulo text, corpo text, url text);
alter table public.teste_avisos enable row level security; -- só o service role (o teste) lê

-- capturador de e-mails: a crm-google de teste grava aqui em vez de mandar pelo Gmail
create table if not exists public.teste_emails(
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  para text, assunto text, texto text);
alter table public.teste_emails enable row level security;
