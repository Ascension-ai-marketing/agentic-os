import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import { useEffect, useState } from "react";

import operatorCss from "../operator.css?url";
import { FloatingOracle } from "@/components/floating-oracle";
import { JarvisWake } from "@/components/jev/jarvis-wake";
import { MessageSquare, AudioLines } from "lucide-react";
import { askOperator } from "@/lib/operator";
import appCss from "../styles.css?url";
import { AppSidebar, MobileNav } from "@/components/app-sidebar";
import { HermesStatusPill } from "@/components/hermes-status-pill";
import { VersionPill } from "@/components/version-pill";
import { ThemeToggle } from "@/components/theme-toggle";
import { OperatorJobs } from "@/components/operator-jobs";
import { AccountsHub } from "@/components/operator/accounts-hub";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Agentic OS — Your workspace" },
      {
        name: "description",
        content: "Your business, calendar, inbox and memory in one workspace.",
      },
      { property: "og:title", content: "Agentic OS — Your workspace" },
      { name: "twitter:title", content: "Agentic OS — Your workspace" },
      {
        property: "og:description",
        content: "Your business, calendar, inbox and memory in one workspace.",
      },
      {
        name: "twitter:description",
        content: "Your business, calendar, inbox and memory in one workspace.",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: operatorCss },
      // Hermes section uses Fraunces as a free, expressive stand-in for
      // Mondwest (the Nous Research site display font).
      // Fraunces is a variable serif with sharp contrast + retro-futurist
      // character — closest free Google Font to Mondwest's confident
      // display weight. Courier Prime matches the upstream's mono.
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,400..900,0..100,0..1&family=Courier+Prime:ital,wght@0,400;0,700;1,400&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the stored theme before first paint — dark is the default — and follow it when
            another page changes it. Every page has this, including the header-less Workbench frames. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("theme")!=="light")document.documentElement.classList.add("dark")}catch(e){}' +
              'addEventListener("storage",function(e){if(e.key==="theme"&&e.newValue)document.documentElement.classList.toggle("dark",e.newValue==="dark")});',
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const setupWorkspace = useRouterState({
    select: (state) => state.location.pathname === "/setup",
  });
  const websiteWorkspace = useRouterState({
    select: (state) => state.location.pathname === "/websites",
  });

  // A page shown inside the Workbench's frame: the page alone, with no sidebar, header, voice or wake listener of its own.
  // The address says so on first load; the frame's name keeps it so when a link inside the frame is followed.
  const embedAddress = useRouterState({
    select: (state) => new URLSearchParams(state.location.searchStr).get("embed") === "1",
  });
  // Unknown until the browser has been asked, so the voice and wake listeners never start inside a frame, even briefly.
  const [framed, setFramed] = useState<boolean | null>(null);
  useEffect(() => setFramed(window.name.startsWith("os-embed")), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AccountsHub />
      {embedAddress || framed ? (
        <main className="min-h-screen overflow-x-hidden bg-background p-4 text-foreground md:p-6">
          <Outlet />
        </main>
      ) : setupWorkspace ? (
        <main className="ws-fullscreen-route">
          <Outlet />
        </main>
      ) : (
        <div className="operator-shell flex min-h-screen w-full bg-background text-foreground">
          <AppSidebar />
          <div className="flex flex-1 min-w-0 flex-col">
            {
              <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur-md md:px-6">
                <div className="flex items-center gap-2 text-sm min-w-0">
                  <MobileNav />
                  {/* On mobile the sidebar drawer already shows Operator/local
                  in its identity block, so we hide this redundant crumb
                  to keep room for the right-side pills. */}
                  <span className="hidden sm:inline font-medium tracking-tight">Agentic</span>
                  <span className="hidden sm:inline text-muted-foreground/50">/</span>
                  <span className="hidden sm:inline text-muted-foreground tracking-tight">
                    {import.meta.env.VITE_WORKSTREAM_LABEL || "local"}
                  </span>
                  <span className="op-local-dot" title="This workspace runs on your computer" />
                </div>
                <div className="flex items-center gap-2.5">
                  {/* Hermes online pill — visible from every route. Click goes
                  to /agents/hermes. Renders nothing when Hermes isn't
                  installed so the bar stays clean for users without it. */}
                  <button className="op-header-ask" onClick={() => askOperator()}>
                    <MessageSquare size={14} /> Chat
                  </button>
                  {/* Voice opens Chat in voice mode: the orb strip on top, the
                  same conversation below. The old memory-core overlay is no
                  longer opened here. */}
                  <button
                    type="button"
                    className="op-header-ask vc-header-trigger"
                    onClick={() => window.dispatchEvent(new CustomEvent("operator:voice"))}
                  >
                    <AudioLines size={15} /> Voice
                  </button>
                  <OperatorJobs />
                  <ThemeToggle />
                </div>
              </header>
            }
            <div className="ar-workspace-layout">
              <main
                className={
                  websiteWorkspace
                    ? "op-website-main flex-1 min-h-0"
                    : "flex-1 overflow-x-hidden p-4 md:p-6"
                }
              >
                <Outlet />
              </main>
              {framed === false && <FloatingOracle enabled />}
              {framed === false && <JarvisWake />}
            </div>
          </div>
        </div>
      )}
    </QueryClientProvider>
  );
}
