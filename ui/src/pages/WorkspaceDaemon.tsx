import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Play, Square, Loader2, Cpu, RefreshCw } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import { workspaceDaemonApi, type WorkspaceDaemonStatus, type AdapterInfo, type WorkspaceSession } from "../api/workspace-daemon";
import { queryKeys } from "../lib/queryKeys";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { cn } from "../lib/utils";

function WorkspaceDaemonStatusCard({
  status,
  isLoading,
}: {
  status: WorkspaceDaemonStatus | undefined;
  isLoading: boolean;
}) {
  const isRunning = status?.running ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Daemon Status</CardTitle>
      </CardHeader>
      <CardContent>
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
              {status?.adapterType && isRunning && (
                <Badge variant="secondary" className="text-xs">
                  {status.adapterType}
                </Badge>
              )}
            </div>
            {isRunning && (
              <p className="text-xs text-muted-foreground">
                Port {status?.port ?? "auto"} · Listening for ACP connections
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionRow({ session }: { session: WorkspaceSession }) {
  const statusColor = {
    running: "text-cyan-600",
    completed: "text-emerald-600",
    error: "text-red-600",
    stopped: "text-muted-foreground/50",
  }[session.status];

  return (
    <li>
      <Link
        to={`/workspace-daemon/session/${session.sessionId}`}
        className="flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {session.sessionId.slice(0, 8)}
            </span>
            <Badge variant="outline" className={cn("text-xs capitalize", statusColor)}>
              {session.status}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {session.agentId ? `Agent: ${session.agentId}` : "No agent"} · Created{" "}
            {new Date(session.createdAt).toLocaleString()}
          </div>
        </div>
      </Link>
    </li>
  );
}

export function WorkspaceDaemon() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const queryClient = useQueryClient();
  const [selectedAdapter, setSelectedAdapter] = useState<string>("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Workspace Daemon" }]);
  }, [setBreadcrumbs]);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["workspace-daemon-status"],
    queryFn: () => workspaceDaemonApi.getStatus(),
    refetchInterval: 5000,
  });

  const { data: adapters } = useQuery({
    queryKey: ["workspace-daemon-adapters"],
    queryFn: () => workspaceDaemonApi.getAdapters(),
  });

  const { data: sessions } = useQuery({
    queryKey: ["workspace-daemon-sessions"],
    queryFn: () => workspaceDaemonApi.getSessions(),
    refetchInterval: 10000,
  });

  const startMutation = useMutation({
    mutationFn: () =>
      workspaceDaemonApi.start({
        workspacePath: process.cwd(),
        adapterType: selectedAdapter || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-daemon-status"] });
      pushToast({ title: "Daemon started", tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to start daemon", body: err.message, tone: "error" });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => workspaceDaemonApi.stop(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-daemon-status"] });
      pushToast({ title: "Daemon stopped", tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to stop daemon", body: err.message, tone: "error" });
    },
  });

  const setAdapterMutation = useMutation({
    mutationFn: (adapterType: string) => workspaceDaemonApi.setAdapterType(adapterType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-daemon-status"] });
      pushToast({ title: "Adapter type set", tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to set adapter", body: err.message, tone: "error" });
    },
  });

  const isRunning = status?.running ?? false;
  const isPending = startMutation.isPending || stopMutation.isPending || setAdapterMutation.isPending;

  const availableAdapters = useMemo(() => adapters?.adapters ?? [], [adapters]);

  useEffect(() => {
    if (status?.adapterType && !selectedAdapter) {
      setSelectedAdapter(status.adapterType);
    }
  }, [status?.adapterType, selectedAdapter]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace Daemon</h1>
        <p className="text-sm text-muted-foreground">
          Manage the workspace daemon for ACP agent connections.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <WorkspaceDaemonStatusCard status={status} isLoading={statusLoading} />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Adapter Selection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              value={selectedAdapter}
              onValueChange={(value) => {
                setSelectedAdapter(value);
                if (isRunning) {
                  setAdapterMutation.mutate(value);
                }
              }}
              disabled={isPending || !availableAdapters.length}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select adapter type" />
              </SelectTrigger>
              <SelectContent>
                {availableAdapters.map((adapter: AdapterInfo) => (
                  <SelectItem key={adapter.type} value={adapter.type}>
                    {adapter.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              {isRunning ? (
                <Button
                  variant="outline"
                  onClick={() => stopMutation.mutate()}
                  disabled={isPending}
                >
                  <Square className="mr-2 h-4 w-4" />
                  Stop
                </Button>
              ) : (
                <Button
                  variant="default"
                  onClick={() => startMutation.mutate()}
                  disabled={isPending || !selectedAdapter}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Start
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions?.sessions.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No sessions yet. Start the daemon and connect agents to begin.
            </div>
          ) : (
            <ul className="divide-y rounded-md border bg-card">
              {sessions?.sessions.map((session) => (
                <SessionRow key={session.sessionId} session={session} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}