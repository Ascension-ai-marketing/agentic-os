import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { operatorRequest } from "./operator";
import type { PublicProfileLink } from "./workspace-profile-links";

/** Keep untouched defaults and stale snapshots out of partial profile saves. */
export function profileChanges<T extends object>(base: T, draft: T): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(draft) as Array<keyof T>) {
    const sameArray =
      Array.isArray(base[key]) &&
      Array.isArray(draft[key]) &&
      JSON.stringify(base[key]) === JSON.stringify(draft[key]);
    if (!Object.is(base[key], draft[key]) && !sameArray) patch[key] = draft[key];
  }
  return patch;
}

export interface WorkspaceProfile {
  name: string;
  role: string;
  about: string;
  responsePreferences: string;
  timeZone: string;
  currency: string;
  avatar: string;
  hourlyRate: number | null;
  publicProfiles: PublicProfileLink[];
  tools: string[];
  city: string;
  onboardingFlowVersion: 2;
  onboardingStep: number;
  onboardingCompletedAt?: string;
  updatedAt?: string;
}
const empty: WorkspaceProfile = {
  name: "",
  role: "",
  about: "",
  responsePreferences: "",
  timeZone: "UTC",
  currency: "USD",
  avatar: "",
  hourlyRate: null,
  publicProfiles: [],
  tools: [],
  city: "",
  onboardingFlowVersion: 2,
  onboardingStep: 0,
};
export function useWorkspaceProfile() {
  const qc = useQueryClient();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const query = useQuery<WorkspaceProfile>({
    enabled: hydrated,
    queryKey: ["workspace-profile"],
    queryFn: () => operatorRequest("/profile"),
    staleTime: 30000,
    retry: 1,
  });
  async function save(patch: Partial<WorkspaceProfile> & { complete?: boolean }) {
    const profile = await operatorRequest<WorkspaceProfile>("/profile", patch);
    qc.setQueryData(["workspace-profile"], profile);
    await qc.invalidateQueries({ queryKey: ["operator-state"] });
    window.dispatchEvent(new Event("operator:profile"));
    return profile;
  }
  return {
    ...query,
    data: hydrated ? query.data : undefined,
    profile: hydrated ? query.data || empty : empty,
    isLoading: !hydrated || query.isLoading,
    save,
    refresh: () => qc.invalidateQueries({ queryKey: ["workspace-profile"] }),
  };
}
