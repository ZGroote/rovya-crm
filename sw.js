// Sem internet: o CRM abre com o que ficou salvo neste aparelho.
// Rede primeiro; se a rede falha (ou demora mais de 5 s e já existe cópia), entrega a última cópia.
// Cada tela aberta com internet atualiza a cópia, então o aparelho guarda sempre a última versão vista dos dados.
const CACHE = 'rovya-v1'; // o app.js apaga este mesmo nome ao sair
const ESTATICOS = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// arquivos do próprio CRM: sem o ?v=12 (fica a última versão baixada); consultas: URL + tipo de resposta (lista ou objeto)
function chave(url, req, corpo) {
  if (url.origin === location.origin) return url.origin + url.pathname;
  const u = new URL(url);
  if (req && u.pathname.includes('/rest/v1/')) u.searchParams.set('__accept', req.headers.get('Accept') || '');
  if (corpo) u.searchParams.set('__corpo', corpo);
  return u.href;
}

async function redeOuCopia(req, k) {
  const c = await caches.open(CACHE);
  const rede = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(k, r.clone()).catch(() => { }); return r; });
  const copia = await c.match(k, { ignoreVary: true });
  if (!copia) return rede;
  return Promise.race([rede, new Promise(ok => setTimeout(ok, 5000, copia))]).catch(() => copia);
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (url.pathname.includes('/auth/v1/') || url.pathname.includes('/storage/v1/')) return; // login e anexos: sempre pela rede
  if (req.method === 'GET' && (url.origin === location.origin || url.pathname.includes('/rest/v1/') || ESTATICOS.test(req.url)))
    return e.respondWith(redeOuCopia(req, chave(url, req)));
  // agenda: guarda a última lista de compromissos vista ("fresco" = conferência do envio, nunca da cópia)
  if (req.method === 'POST' && url.pathname.endsWith('/functions/v1/crm-google'))
    e.respondWith(req.clone().text().then(corpo => /"acao":"listar"/.test(corpo) && !/"fresco":true/.test(corpo) ? redeOuCopia(req, chave(url, req, corpo)) : fetch(req)));
});

// o app manda a lista do que a tela carregou (scripts, estilos, fontes) para já ficar salvo
self.addEventListener('message', e => {
  if (!e.data?.guardar) return;
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(e.data.guardar.map(async u => {
    const url = new URL(u, location.href);
    if (url.origin !== location.origin && !ESTATICOS.test(url.href)) return;
    const k = chave(url);
    if (await c.match(k)) return;
    try { const r = await fetch(url.href); if (r.ok) await c.put(k, r); } catch { }
  }))));
});

// Recebe as notificações do CRM e abre o Assistente ao tocar.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Rovya', {
    body: d.body || '', icon: 'img/icon-192.png', badge: 'img/favicon.png', data: { url: d.url || 'app.html#/assistente' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || 'app.html#/assistente', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(abertas => {
    const j = abertas.find(c => c.url.startsWith(self.registration.scope));
    return j ? j.navigate(url).then(c => (c || j).focus()) : clients.openWindow(url);
  }));
});
