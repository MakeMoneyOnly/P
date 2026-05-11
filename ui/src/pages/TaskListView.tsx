import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@/lib/router";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import { tasksApi, type Task } from "@/api/tasks";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function statusColor(status: string) {
  const colors = {
    running: "text-cyan-600",
    completed: "text-emerald-600",
    error: "text-red-600",
    pending: "text-amber-600",
    paused: "text-muted-foreground",
    stopped: "text-muted-foreground/50",
  };
  return colors[status as keyof typeof colors] ?? "text-muted-foreground";
}

function TaskRow({ task }: { task: Task }) {
  return (
    <li>
      <Link
        to={`/tasks/${task.id}`}
        className="flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{task.taskKey}</span>
            <Badge variant="outline" className="text-xs">
              {task.adapterType}
            </Badge>
            <Badge
              variant="outline"
              className={cn("text-xs capitalize", statusColor(task.status))}
            >
              {task.status}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {task.agentName ? `Agent: ${task.agentName}` : "No agent"} · Updated{" "}
            {new Date(task.updatedAt).toLocaleString()}
          </div>
        </div>
      </Link>
    </li>
  );
}

export function TaskListView() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();

  useEffect(() => {
    setBreadcrumbs([{ label: "Tasks" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.list(),
    refetchInterval: 10000,
  });

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (error) {
    pushToast({
      title: "Failed to load tasks",
      body: error instanceof Error ? error.message : "Unknown error",
      tone: "error",
    });
    return <div className="text-sm text-destructive">Failed to load tasks</div>;
  }

  const tasks = data?.tasks ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          View agent task sessions and their execution status.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Task Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No tasks yet. Tasks are created when agents execute work.
            </div>
          ) : (
            <ul className="divide-y rounded-md border bg-card">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}