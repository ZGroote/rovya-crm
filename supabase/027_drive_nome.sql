-- Nome real da pasta do cliente no Drive (pedido da Sabrina, 22/11/2026). Quando ela usa uma pasta que já existia
-- ("Mônica - Optimer"), o cartão mostrava "CLIENTE_R002". Guardado ao criar ou escolher a pasta; nas já ligadas,
-- o CRM busca o nome no Drive na primeira vez que a ficha abre. Só acrescenta: nenhuma linha muda.
alter table public.crm_clientes add column if not exists drive_pasta_nome text;
