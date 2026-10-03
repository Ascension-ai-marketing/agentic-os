import { MotionLibrary } from "@/components/motion/motion-library";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

type Search = { style?: string; stress?: number };

export const Route = createFileRoute("/motion")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    style:
      typeof search.style === "string" && /^[a-z0-9-]{1,64}$/.test(search.style)
        ? search.style
        : undefined,
    // ?stress=120 repeats the wall to test smoothness at wave-2 size.
    stress:
      Number.isInteger(Number(search.stress)) && Number(search.stress) > 0
        ? Math.min(240, Number(search.stress))
        : undefined,
  }),
  head: () => ({
    meta: [{ title: "Motion Library · Agentic" }],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    ],
  }),
  component: MotionStudioPage,
});

function MotionStudioPage() {
  const { style, stress } = Route.useSearch();
  const navigate = useNavigate({ from: "/motion" });
  return (
    <MotionLibrary
      selected={style}
      stress={stress}
      onSelect={(id) =>
        void navigate({
          search: (prev) => ({ ...prev, style: id }),
          resetScroll: false,
        })
      }
    />
  );
}
