import { useQuery, useQueryClient } from "@tanstack/react-query";
import { operatorRequest } from "./operator";
export { demoAudience, demoBrief } from "./business-demo-data";

export type BusinessDemoState = { enabled: boolean; requested?: boolean; liveData?: boolean };
/**
 * `enabled` is the effective state: the server switches demo numbers off as soon as
 * any live balances or audience observations exist, even if the flag is stale.
 * `liveData` says whether real records exist; `requested` is the raw saved flag.
 */
export function useBusinessDemo() {
  const qc = useQueryClient();
  const query = useQuery<BusinessDemoState>({ queryKey: ["business-demo"], queryFn: () => operatorRequest("/business/demo"), staleTime: 5000, refetchOnWindowFocus: true });
  return { enabled: query.data?.enabled === true, liveData: query.data?.liveData === true, requested: query.data?.requested === true, loaded: query.data !== undefined, async setEnabled(enabled: boolean) {
    const saved = await operatorRequest<BusinessDemoState>("/business/demo", { enabled });
    qc.setQueryData(["business-demo"], saved);
    await qc.invalidateQueries({ queryKey: ["business-brief"] });
  } };
}
