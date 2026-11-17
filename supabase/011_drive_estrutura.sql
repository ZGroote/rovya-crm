-- A Sabrina edita a estrutura do Drive pelo CRM (incluir e tirar áreas).
-- Cada linha de crm_drive passa a ser uma área da estrutura; folder_id fica vazio até ela clicar em "Conferir estrutura".
alter table public.crm_drive alter column folder_id drop not null;

-- as 18 áreas do Manual Mestre (as que já existem no Drive ficam como estão)
insert into public.crm_drive(chave, nome) values
  ('00','00 — Central de Controle'), ('01','01 — Direção e Estratégia'), ('02','02 — Administrativo e Jurídico'),
  ('03','03 — Financeiro e Contabilidade'), ('04','04 — Comercial e Prospecção'), ('05','05 — Propostas e Negociações'),
  ('06','06 — Contratos e Documentação'), ('07','07 — Clientes e Onboarding'), ('08','08 — Catálogo de Serviços'),
  ('09','09 — Projetos e Operações'), ('10','10 — Produção e Criação'), ('11','11 — Marketing ROVYA'),
  ('12','12 — Identidade Visual e Branding'), ('13','13 — Processos e Procedimentos'), ('14','14 — Relatórios e Inteligência'),
  ('15','15 — Tecnologia e Sistemas'), ('16','16 — Biblioteca e Recursos'), ('17','17 — Arquivo e Histórico')
on conflict (chave) do nothing;
