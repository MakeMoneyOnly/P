import { useEffect, useMemo, useState } from "react";
import { useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { workspaceDaemonApi, type WorkspaceSession, type DaemonTranscriptEntry } from "@/api/workspace-daemon";
import type { TranscriptEntry } from "@paperclipai/adapter-utils";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RunTranscriptView, type TranscriptMode, type TranscriptDensity } from "@/components/transcript/RunTranscriptView";
import { cn } from "@/lib/utils";
import { normalizeTranscript } from "@/components/transcript/RunTranscriptView";
import { RefreshCw } from "lucide-react";

function convertDaemonEntry(entry: DaemonTranscriptEntry): TranscriptEntry {
  return {
    kind: entry.type,
    ts: entry.timestamp,
    text: entry.data,
  };
}

export function WorkspaceSessionView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [transcriptMode] = useState<TranscriptMode>("raw");
  const [transcriptDensity] = useState<TranscriptDensity>("compact");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["workspace-daemon-session", sessionId],
    queryFn: () => workspaceDaemonApi.getSessionDetail(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 5000,
  });

  const session = data?.session;
  const daemonEntries = data?.entries ?? [];

  const entries = useMemo(
    () => daemonEntries.map(convertDaemonEntry),
    [daemonEntries]
  );

  useEffect(() => {
    if (session) {
      setBreadcrumbs([
        { label: "Workspace Daemon", href: "/workspace-daemon" },
        { label: `Session ${session.sessionId.slice(0, 8)}` },
      ]);
    }
  }, [session, setBreadcrumbs]);

  const normalizedBlocks = useMemo(
    () => normalizeTranscript(entries, session?.status === "running"),
    [entries, session?.status]
  );

  if (isLoading) {
    return <PageSkeleton variant="detail" />;
  }

  if (error) {
    return (
      <div className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load session"}
      </div>
    );
  }

  if (!session) {
    return <div className="text-sm text-muted-foreground">Session not found</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Session {session.sessionId.slice(0, 8)}
            </h1>
            <Badge variant="outline" className="font-mono text-xs">
              {session.sessionId}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={session.status} />
            {session.agentId && <span>· Agent: {session.agentId}</span>}
            <span>· Created {new Date(session.createdAt).toLocaleString()}</span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No output yet. Session may be initializing.
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <RunTranscriptView
                entries={entries}
                mode={transcriptMode}
                density={transcriptDensity}
                streaming={session.status === "running"}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}