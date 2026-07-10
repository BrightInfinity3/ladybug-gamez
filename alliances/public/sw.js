/*
 * Alliances service worker — exists solely to receive push notifications
 * ("your turn", "a pact is offered") when the game tab is closed.
 * No caching, no offline logic: the game is live-multiplayer by nature.
 */
"use strict";

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  var payload = { title: "Alliances", body: "Something is happening in your war room." };
  try {
    if (e.data) payload = e.data.json();
  } catch (err) { /* keep the fallback copy */ }
  e.waitUntil(self.registration.showNotification(payload.title || "Alliances", {
    body: payload.body || "",
    tag: "alliances", // collapse repeats instead of stacking
    data: { url: self.registration.scope }
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (tabs) {
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].url.indexOf(self.registration.scope) === 0 && "focus" in tabs[i]) return tabs[i].focus();
    }
    return self.clients.openWindow(url);
  }));
});
