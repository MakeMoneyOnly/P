import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workspaceDaemonApi, type WorkspaceDaemonStatus } from "../api/workspace-daemon";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Loader2, Play, Square } from "lucide-react";
import { cn } from "../lib/utils";

function WorkspaceDaemonStatusWidget() {
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<WorkspaceDaemonStatus>({
    queryKey: ["workspace-daemon-status"],
    queryFn: () => workspaceDaemonApi.getStatus(),
    refetchInterval: 5000,
  });

  const startMutation = useMutation({
    mutationFn: () => workspaceDaemonApi.start({ workspacePath: process.cwd() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace-daemon-status"] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => workspaceDaemonApi.stop(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace-daemon-status"] }),
  });

  const isRunning = status?.running ?? false;
  const adapterType = status?.adapterType;
  const port = status?.port;
  const isPending = startMutation.isPending || stopMutation.isPending;

  const handleStart = () => startMutation.mutate();
  const handleStop = () => stopMutation.mutate();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Workspace Daemon</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <span
                className={cn(
                  "inline-flex h-2.5 w-2.5 rounded-full",
                  isRunning ? "bg-emerald-500" : "bg-muted-foreground/35"
                )}
              />
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {isLoading ? "Checking..." : isRunning ? "Running" : "Stopped"}
                </span>
                {adapterType && isRunning && (
                  <Badge variant="secondary" className="text-xs">
                    {adapterType}
                  </Badge>
                )}
              </div>
              {isRunning && (
                <p className="text-xs text-muted-foreground">
                  Port {port ?? "auto"} · Listening for ACP connections
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStop}
                disabled={isPending}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                Stop
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleStart}
                disabled={isPending}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export { WorkspaceDaemonStatusWidget };
export default WorkspaceDaemonStatusWidget;