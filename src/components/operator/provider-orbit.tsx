import claudeLogo from "@/assets/claude-logo.png";
import openaiLogo from "@/assets/logos/openai.png";
import codexLogo from "@/assets/logos/codex.png";
import hermesLogo from "@/assets/hermes-face.png";
import "./brand-refinements.css";

const providers = [
  { id: "claude", logo: claudeLogo },
  { id: "openai", logo: openaiLogo },
  { id: "hermes", logo: hermesLogo },
  { id: "codex", logo: codexLogo },
];

/** Decorative identity, never an indicator of installed or connected providers. */
export function ProviderOrbit({ className = "" }: { className?: string }) {
  return (
    <span className={`ar-provider-rotation ${className}`} aria-hidden="true">
      {providers.map(({ id, logo }) => (
        <img
          key={id}
          className={`ar-brand-provider-image ar-brand-provider-image--${id}`}
          src={logo}
          alt=""
          width={34}
          height={34}
        />
      ))}
    </span>
  );
}
