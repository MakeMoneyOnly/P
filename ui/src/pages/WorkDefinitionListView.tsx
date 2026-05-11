import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import { workspaceDaemonApi, type WorkDefinition, type WorkTaskStatus } from "@/api/workspace-daemon";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const statusColors: Record<WorkTaskStatus, string> = {
  pending: "text-amber-600",
  running: "text-cyan-600",
  completed: "text-emerald-600",
  failed: "text-red-600",
};

const priorityColors = {
  low: "text-muted-foreground",
  medium: "text-blue-600",
  high: "text-orange-600",
  critical: "text-red-600",
};

function WorkDefinitionRow({ workDef }: { workDef: WorkDefinition }) {
  const statusColor = statusColors[workDef.status];
  const priorityColor = priorityColors[workDef.priority];

  return (
    <li>
      <Link
        to={`/work-definitions/${workDef.id}`}
        className="flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{workDef.id}</span>
            <Badge variant="outline" className="text-xs capitalize">
              {workDef.type}
            </Badge>
            <Badge variant="outline" className={cn("text-xs capitalize", statusColor)}>
              {workDef.status}
            </Badge>
            <Badge variant="outline" className={cn("text-xs capitalize", priorityColor)}>
              {workDef.priority}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {workDef.assignedTo ? `Assigned to: ${workDef.assignedTo}` : "Unassigned"} · Updated{" "}
            {new Date(workDef.metadata.updatedAt).toLocaleString()}
          </div>
        </div>
      </Link>
    </li>
  );
}

export function WorkDefinitionListView() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const [statusFilter, setStatusFilter] = useState<WorkTaskStatus | "all">("all");
  const [workspaceIdFilter, setWorkspaceIdFilter] = useState<string>("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Work Definitions" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["work-definitions", statusFilter, workspaceIdFilter],
    queryFn: () =>
      workspaceDaemonApi.getWorkDefinitions(
        statusFilter !== "all" ? statusFilter : undefined,
        workspaceIdFilter || undefined
      ),
    refetchInterval: 10000,
  });

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (error) {
    pushToast({
      title: "Failed to load work definitions",
      body: error instanceof Error ? error.message : "Unknown error",
      tone: "error",
    });
    return <div className="text-sm text-destructive">Failed to load work definitions</div>;
  }

  const workDefinitions = data?.workDefinitions ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Work Definitions</h1>
        <p className="text-sm text-muted-foreground">
          View ACP work definitions from the workspace daemon.
        </p>
      </div>

      <div className="flex gap-4">
        <div className="w-48">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as WorkTaskStatus | "all")}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-64">
          <input
            type="text"
            placeholder="Filter by workspace ID"
            value={workspaceIdFilter}
            onChange={(e) => setWorkspaceIdFilter(e.target.value)}
            className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Work Definitions</CardTitle>
        </CardHeader>
        <CardContent>
          {workDefinitions.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No work definitions found. Work definitions are created when agents execute tasks.
            </div>
          ) : (
            <ul className="divide-y rounded-md border bg-card">
              {workDefinitions.map((workDef) => (
                <WorkDefinitionRow key={workDef.id} workDef={workDef} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}