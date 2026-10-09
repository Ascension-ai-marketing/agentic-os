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
    // A change made in another page arrives through the root's storage listener (__root.tsx) as a class change.
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
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
