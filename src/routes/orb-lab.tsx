import { createFileRoute } from "@tanstack/react-router";
import { OrbLab } from "@/components/jev/orb-lab";

// Temporary comparison page for the voice orb backdrop.
export const Route = createFileRoute("/orb-lab")({
  head: () => ({ meta: [{ title: "Orb lab · Agentic OS" }] }),
  component: OrbLab,
});
