"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const isLocalhost =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

    const clearPwaCaches = async () => {
      if (!("caches" in window)) return;

      const cacheKeys = await window.caches.keys();
      await Promise.all(
        cacheKeys
          .filter((key) => key.startsWith("bolo-de-mae-jp-pwa"))
          .map((key) => window.caches.delete(key))
      );
    };

    const unregisterExistingWorkers = async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    };

    const syncPwaState = async () => {
      try {
        if (isLocalhost) {
          await unregisterExistingWorkers();
          await clearPwaCaches();
          return;
        }

        await navigator.serviceWorker.register("/sw.js");
      } catch (error) {
        console.error("Nao foi possivel configurar o service worker do app.", error);
      }
    };

    syncPwaState();
  }, []);

  return null;
}
