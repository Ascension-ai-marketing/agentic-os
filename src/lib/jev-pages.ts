// Every page Jev can take you to, by voice or in Chat. Import-free so the
// server (scripts/) and the UI share one list. Opening a page is the only
// thing a "no AI" pick may do.

export type JevPage = { path: string; label: string; criteria: string };

export const JEV_PAGES: Record<string, JevPage> = {
  dashboard: { path: "/business", label: "Dashboard", criteria: "Dashboard: the business overview, revenue, money, goals and the morning brief" },
  inbox: { path: "/inbox", label: "Inbox", criteria: "Inbox: email and messages" },
  chat: { path: "/chat", label: "Chat", criteria: "Chat: the conversation page" },
  calendar: { path: "/calendar", label: "Calendar", criteria: "Calendar: events, meetings and the schedule" },
  memory: { path: "/memory", label: "Memory", criteria: "Memory: saved notes, knowledge and what the OS has learned" },
  design: { path: "/design", label: "Design", criteria: "Design studio: images, brand and visuals" },
  reels: { path: "/design?mode=reels", label: "Reels", criteria: "Reels in Design: short vertical videos" },
  motion: { path: "/design?mode=motion", label: "Motion", criteria: "Motion library in Design: animation styles" },
  library: { path: "/design?mode=library", label: "Design library", criteria: "Design library: saved designs and assets" },
  build: { path: "/design?mode=build", label: "Design build", criteria: "Design build room: turning designs into pages" },
  website: { path: "/websites", label: "Website", criteria: "Website: the site builder and published sites" },
  hermes: { path: "/agents/hermes", label: "Hermes", criteria: "Hermes: the Hermes agent page" },
  settings: { path: "/settings", label: "Settings", criteria: "Settings: connections, keys and preferences" },
};

export const jevPage = (id: string | undefined): JevPage | undefined => (id && Object.hasOwn(JEV_PAGES, id) ? JEV_PAGES[id] : undefined);
