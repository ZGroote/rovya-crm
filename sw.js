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
