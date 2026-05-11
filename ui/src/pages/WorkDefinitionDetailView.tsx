import { useEffect } from "react";
import { useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { workspaceDaemonApi, type WorkDefinition } from "@/api/workspace-daemon";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { RefreshCw, FileText, Folder } from "lucide-react";

export function WorkDefinitionDetailView() {
  const { workDefinitionId } = useParams<{ workDefinitionId: string }>();
  const { setBreadcrumbs } = useBreadcrumbs();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["work-definition", workDefinitionId],
    queryFn: () => workspaceDaemonApi.getWorkDefinition(workDefinitionId!),
    enabled: !!workDefinitionId,
    refetchInterval: 5000,
  });

  const workDef = data?.workDefinition;

  useEffect(() => {
    if (workDef) {
      setBreadcrumbs([
        { label: "Work Definitions", href: "/work-definitions" },
        { label: workDef.id },
      ]);
    }
  }, [workDef, setBreadcrumbs]);

  if (isLoading) {
    return <PageSkeleton variant="detail" />;
  }

  if (error) {
    return (
      <div className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Failed to load work definition"}
      </div>
    );
  }

  if (!workDef) {
    return <div className="text-sm text-muted-foreground">Work definition not found</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{workDef.id}</h1>
            <Badge variant="outline" className="font-mono text-xs">
              {workDef.type}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={workDef.status} />
            <Badge variant="outline" className="text-xs capitalize">
              {workDef.priority}
            </Badge>
            <span>· Created {new Date(workDef.metadata.createdAt).toLocaleString()}</span>
            <span>· Updated {new Date(workDef.metadata.updatedAt).toLocaleString()}</span>
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
          <CardTitle className="text-sm font-medium">Work Definition Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Type:</span>
              <span className="capitalize">{workDef.type}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Status:</span>
              <StatusBadge status={workDef.status} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Priority:</span>
              <Badge variant="outline" className="capitalize">
                {workDef.priority}
              </Badge>
            </div>
            {workDef.assignedTo && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Assigned To:</span>
                <span>{workDef.assignedTo}</span>
              </div>
            )}
            {workDef.deadline && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Deadline:</span>
                <span>{new Date(workDef.deadline).toLocaleString()}</span>
              </div>
            )}
            {workDef.dependencies.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground">Dependencies:</span>
                <div className="flex flex-wrap gap-1">
                  {workDef.dependencies.map((dep) => (
                    <code key={dep} className="text-xs bg-muted px-1 rounded">
                      {dep}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {workDef.workSpec && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Work Spec</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {workDef.workSpec.command && (
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">Command:</span>
                <code className="block text-xs bg-muted p-2 rounded">{workDef.workSpec.command}</code>
              </div>
            )}
            {workDef.workSpec.cwd && (
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">Working Directory:</span>
                <code className="block text-xs bg-muted p-2 rounded">{workDef.workSpec.cwd}</code>
              </div>
            )}
            {workDef.workSpec.prompt && (
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">Prompt:</span>
                <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">{workDef.workSpec.prompt}</pre>
              </div>
            )}
            {workDef.workSpec.files && workDef.workSpec.files.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Folder className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground text-xs font-medium">Files Affected</span>
                </div>
                <ul className="space-y-1">
                  {workDef.workSpec.files.map((file) => (
                    <li key={file} className="text-xs font-mono bg-muted px-2 py-1 rounded">
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {workDef.workSpec.env && Object.keys(workDef.workSpec.env).length > 0 && (
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">Environment:</span>
                <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap">
                  {JSON.stringify(workDef.workSpec.env, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Output</CardTitle>
        </CardHeader>
        <CardContent>
          {workDef.result ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Exit Code:</span>
                  <Badge variant={workDef.result.exitCode === 0 ? "default" : "destructive"}>
                    {workDef.result.exitCode}
                  </Badge>
                </div>
                {workDef.result.cost && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Cost:</span>
                    <span>
                      {workDef.result.cost.inputTokens} → {workDef.result.cost.outputTokens} tokens
                    </span>
                    <span className="text-muted-foreground">
                      (${(workDef.result.cost.costCents / 100).toFixed(2)})
                    </span>
                  </div>
                )}
              </div>

              {workDef.result.stdout && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground text-xs font-medium">stdout</span>
                  </div>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto max-h-[300px] overflow-y-auto">
                    {workDef.result.stdout}
                  </pre>
                </div>
              )}

              {workDef.result.stderr && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground text-xs font-medium">stderr</span>
                  </div>
                  <pre className="text-xs bg-muted p-3 rounded overflow-x-auto max-h-[300px] overflow-y-auto text-red-600">
                    {workDef.result.stderr}
                  </pre>
                </div>
              )}

              {workDef.result.artifacts && workDef.result.artifacts.length > 0 && (
                <div className="space-y-1">
                  <span className="text-muted-foreground text-xs font-medium">Artifacts:</span>
                  <ul className="space-y-1">
                    {workDef.result.artifacts.map((artifact) => (
                      <li key={artifact} className="text-xs font-mono bg-muted px-2 py-1 rounded">
                        {artifact}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No output yet. Work definition may be pending or running.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="pt-4">
        <Link to="/work-definitions" className="text-sm text-primary hover:underline">
          ← Back to Work Definitions
        </Link>
      </div>
    </div>
  );
}