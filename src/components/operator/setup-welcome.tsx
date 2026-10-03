import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check } from "lucide-react";
import { useWorkspaceProfile } from "@/lib/workspace-profile";
import { SourceBrand } from "./source-brand";
import { AmbientVideo } from "../business/ambient-video";
import "./setup-welcome.css";
/** Original implementation informed by 21st.dev's video + onboarding checklist pattern. */
export function SetupWelcome() {
  const { profile, isLoading } = useWorkspaceProfile();
  if (isLoading || profile.onboardingCompletedAt) return null;
  return (
    <section className="os-setup-invitation" aria-labelledby="setup-invitation-title">
      <div className="os-setup-invitation-copy">
        <span className="os-setup-kicker">START WITH YOUR WORLD</span>
        <h2 id="setup-invitation-title">
          Set up your Agentic OS<span>.</span>
        </h2>
        <p>Bring your world into focus. Start with what you already use.</p>
        <div className="os-setup-stages" aria-label="Your setup">
          {["Your profile", "Your memory", "Your tools"].map((title, i) => (
            <span key={title} className={i * 2 < profile.onboardingStep ? "done" : ""}>
              <i>{i * 2 < profile.onboardingStep ? <Check size={10} /> : i + 1}</i>
              {title}
            </span>
          ))}
        </div>
        <div className="os-setup-bottom">
          <Link to="/setup">
            {profile.onboardingStep ? "Continue your setup" : "Make it yours"}
            <ArrowUpRight size={15} />
          </Link>
          <div className="os-setup-brands" aria-label="Bring your existing tools">
            {["codex", "claude", "chatgpt", "notion"].map((id) => (
              <SourceBrand key={id} id={id} size={20} />
            ))}
          </div>
        </div>
      </div>
      <div className="os-setup-film">
        <AmbientVideo
          src="/onboarding/context-crystal-loop.mp4"
          poster="/onboarding/context-crystal-poster.jpg"
          label="Rotating crystal obelisks"
          controls={false}
        />
      </div>
    </section>
  );
}
