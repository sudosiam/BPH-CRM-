import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles.css";

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.dispatchEvent(new Event("bph-sw-update"));
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const check = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      void registration.update().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", check);
    window.setInterval(check, 60 * 1000);
  },
});

window.addEventListener("bph-apply-update", () => {
  void updateSW(true);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
