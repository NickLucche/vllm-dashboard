import { Suspense } from "react";
import ForceMergesContent from "./force-merges-content";

function ForceMergesFallback() {
  return (
    <div className="flex h-64 items-center justify-center text-zinc-400">
      Loading force-merge data...
    </div>
  );
}

export default function ForceMergesPage() {
  return (
    <Suspense fallback={<ForceMergesFallback />}>
      <ForceMergesContent />
    </Suspense>
  );
}
