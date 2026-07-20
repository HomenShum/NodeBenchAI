import { useEffect, useMemo, useState } from "react";

type DeferredInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function getStandaloneState() {
  if (typeof window === "undefined") return false;
  const isIosStandalone = typeof navigator !== "undefined" && (navigator as any).standalone === true;
  const isDisplayStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches === true;
  return isIosStandalone || isDisplayStandalone;
}

export function usePwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() => getStandaloneState());

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as DeferredInstallPromptEvent);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const canInstall = useMemo(() => Boolean(deferredPrompt) && !isInstalled, [deferredPrompt, isInstalled]);

  const promptToInstall = async () => {
    if (!deferredPrompt) return { outcome: "dismissed" as const };
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (choice?.outcome === "accepted") {
      setIsInstalled(true);
      return { outcome: "accepted" as const };
    }
    return { outcome: "dismissed" as const };
  };

  return {
    canInstall,
    isInstalled,
    promptToInstall,
  };
}

export default usePwaInstallPrompt;
