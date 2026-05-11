import { useEffect, useMemo, useState } from "react";
import { useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { tasksApi, type TaskDetail } from "@/api/tasks";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RunTranscriptView, type TranscriptMode, type TranscriptDensity } from "@/components/transcript/RunTranscriptView";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";
import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function convertTaskEntry(entry: { type: "stdout" | "stderr"; data: string; timestamp: string }): TranscriptEntry {
  return {
    kind: entry.type,
    ts: entry.timestamp,
    text: entry.data,
  };
}

export function TaskDetailView() {
  const { taskId } = useParams<{ taskId: string }>();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [transcriptMode] = useState<TranscriptMode>("raw");
  const [transcriptDensity] = useState<TranscriptDensity>("compact");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => tasksApi.get(taskId!),
    enabled: !!taskId,
    refetchInterval: 5000,
  });

  const task = data?.task;
  const transcript = data?.transcript ?? [];

  const entries = useMemo(
    () => transcript.map(convertTaskEntry),
    [transcript]
  );

  useEffect(() => {
    if (task) {
      setBreadcrumbs([
        { label: "Tasks", href: "/tasks" },
        { label: task.taskKey },
      ]);
    }
  }, [task, setBreadcrumbs]);

  if (isLoading) {
    return <PageSkeleton variant="detail" />;
  }

  if (error) {
    return (
      <div className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load task"}
      </div>
    );
  }

  if (!task) {
    return <div className="text-sm text-muted-foreground">Task not found</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {task.taskKey}
            </h1>
            <Badge variant="outline" className="font-mono text-xs">
              {task.adapterType}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={task.status} />
            {task.agentName && <span>· Agent: {task.agentName}</span>}
            <span>· Created {new Date(task.createdAt).toLocaleString()}</span>
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
          <CardTitle className="text-sm font-medium">Task Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Task ID:</span>
              <code className="text-xs">{task.id}</code>
            </div>
            {task.sessionDisplayId && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Session:</span>
                <code className="text-xs">{task.sessionDisplayId}</code>
              </div>
            )}
            {task.lastRunId && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Last Run:</span>
                <code className="text-xs">{task.lastRunId}</code>
              </div>
            )}
            {task.lastError && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground">Last Error:</span>
                <span className="text-red-600 text-xs">{task.lastError}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Output</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No output yet. Task may be initializing.
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <RunTranscriptView
                entries={entries}
                mode={transcriptMode}
                density={transcriptDensity}
                streaming={task.status === "running"}
                collapseStdout={true}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}