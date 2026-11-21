-- Serviços com planos (Essencial / Intermediária / Avançada…) e documentos.
-- planos:   [{nome, preco, a_partir, itens, documento}]  (itens: um por linha; documento: texto com ## título, **negrito**)
-- arquivos: [{nome, caminho, tamanho}]  (bucket crm-anexos, pasta servicos/<id>/)
-- Só acrescenta colunas: nada do que já está cadastrado muda. A política do crm_servicos (admin + MFA) já cobre as colunas novas.
alter table public.crm_servicos add column if not exists planos jsonb not null default '[]';
alter table public.crm_servicos add column if not exists arquivos jsonb not null default '[]';
