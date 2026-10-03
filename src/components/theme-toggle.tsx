import { useEffect, useState } from "react";
import { SkyToggle } from "@/components/ui/sky-toggle";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("theme");
    } catch {
      /* In-memory theme still works. */
    }
    const dark = stored ? stored === "dark" : true;
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key !== "theme" || !event.newValue) return;
      document.documentElement.classList.toggle("dark", event.newValue === "dark");
    };
    window.addEventListener("storage", syncStoredTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", syncStoredTheme);
    };
  }, []);

  const toggle = (next: boolean) => {
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* Storage can be unavailable. */
    }
  };

  return (
    <SkyToggle
      checked={isDark}
      onCheckedChange={toggle}
      aria-label="OS dark mode"
      title={isDark ? "Switch OS to light mode" : "Switch OS to dark mode"}
    />
  );
}
