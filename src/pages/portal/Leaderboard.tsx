import { PageHeader } from "@/components/shared/states";
import { PointsLeaderboard } from "@/features/leaderboard/PointsLeaderboard";
import { usePageMeta } from "@/hooks/usePageMeta";

export function Leaderboard() {
  usePageMeta({ title: "Leaderboard | My SHPE", noindex: true });

  return (
    <>
      <PageHeader
        title="Leaderboard"
        description="SHPE points across the chapter, updated once a day."
      />
      <PointsLeaderboard />
    </>
  );
}
