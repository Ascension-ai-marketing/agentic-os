import type { Lane } from "../src/lib/model-lane";
import type { TurnOutcome } from "../src/lib/turn-watchdog";

const HARNESS_FAILURE =
  /^\s*(API Error\b|Error from provider|Provider returned error|Error:\s|Credit balance|Invalid API key|OAuth(?:\s+(?:session|token)|Error)|Failed to authenticate|Authentication failed|Unauthorized\b|Not (?:logged|signed) in\b|Login required\b|You've hit your limit\b|Rate limit (?:reached|exceeded)|There's an issue with the selected model)/i;
const AUTH_FAILURE =
  /\b(401|403)\b|invalid[_ ](?:token|api[_ ]key)|unauthorized|authentication[_ ]failed|failed to authenticate|not (?:logged|signed) in|login required|OAuth|could not be refreshed|re-?authenticate/i;

/** Supplied-context Chat is one explicit attempt on the user's selected provider.
 * Native agent panes retain their existing recovery and text behavior. */
export function createChatTurnPolicy(providedContext: boolean, lane: Lane) {
  let attempts = 0;
  let failed = false;
  let failureText = "";
  const provider = lane === "codex" ? "Codex" : lane === "ccr" ? "OpenRouter" : "Claude Code";
  const recordFailure = (message: string) => {
    if (!providedContext) return;
    failed = true;
    failureText = `${failureText}\n${message}`.slice(0, 8_000);
  };

  return {
    canRecover: !providedContext,
    claimAttempt() {
      if (providedContext && attempts > 0) return false;
      attempts += 1;
      return true;
    },
    recordFailure,
    acceptAssistantText(text: string) {
      if (!providedContext) return true;
      if (HARNESS_FAILURE.test(text)) recordFailure(text);
      // A later success line cannot erase a provider failure in the same stream.
      return !failed;
    },
    finish<T extends TurnOutcome>(result: T, cancelled = false): T {
      if (!providedContext || cancelled) return result;
      if (
        !failed &&
        result.ok &&
        result.reachedResult &&
        result.sawAssistantText &&
        !result.resultIsError &&
        !result.harnessError &&
        !result.interrupted &&
        !result.flatlined
      )
        return result;

      const evidence = `${failureText}\n${result.stderr}\n${result.errorText}`;
      let errorText: string;
      if (AUTH_FAILURE.test(evidence)) {
        errorText =
          lane === "ccr"
            ? "OpenRouter rejected authentication. Reconnect OpenRouter in Connections, then retry this message."
            : `${provider} sign-in expired or was rejected. Sign in to ${provider} again, then retry this message.`;
      } else if (
        /unknown option|unexpected argument|unrecognized (?:option|argument)/i.test(evidence)
      ) {
        errorText = `The installed ${provider} CLI does not support the required Chat options. Update it, then retry this message.`;
      } else if (/binary not found|ENOENT|not installed/i.test(evidence)) {
        errorText = `${provider} is unavailable. Check its installation and sign-in in Connections, then retry this message.`;
      } else if (
        /\b(402|429)\b|credits|credit balance|insufficient balance|rate.?limit|quota|key limit|hit your limit/i.test(
          evidence,
        )
      ) {
        errorText = `${provider} rejected this request because of an account or usage limit. Check that provider's limits, then retry this message.`;
      } else if (
        /issue with the selected model|model.{0,80}(?:not found|not supported|does not exist)|not a valid model/i.test(
          evidence,
        )
      ) {
        errorText = `${provider} could not use the selected model. Check your model access or choose another model, then retry this message.`;
      } else {
        errorText = `${provider} did not complete this reply. Check the connection and retry this message.`;
      }
      // Raw CLI errors can contain account details; only bounded guidance is public.
      return { ...result, ok: false, errorText };
    },
  };
}
