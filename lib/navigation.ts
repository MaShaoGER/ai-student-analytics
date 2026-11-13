export type WorkspaceView = "overview" | "analysis" | "reports" | "admin" | "account";
export type WorkspacePrimary = "explore" | "conversation";

const paths: Record<WorkspaceView, string> = {
  overview: "/explore",
  analysis: "/chat",
  reports: "/reports",
  admin: "/admin",
  account: "/settings",
};

/** Subordinate pages only need an origin when it differs from their default. */
export function workspaceHref(view: WorkspaceView, primary: WorkspacePrimary): string {
  const defaultPrimary = view === "reports" ? "conversation" : "explore";
  return view !== "overview" && view !== "analysis" && primary !== defaultPrimary
    ? `${paths[view]}?primary=${primary}`
    : paths[view];
}

/** Resolve public paths and existing bookmarks at the single navigation boundary.
 * Append rather than overwrite: a conflicting query stays ambiguous and is rejected
 * by the caller, never silently reinterpreted as another page or data scope.
 */
export function workspaceParams(input: string): URLSearchParams {
  const url = new URL(input, "http://workspace.local");
  const params = url.searchParams;
  const path = url.pathname.replace(/\/$/, "");
  const view = (Object.keys(paths) as WorkspaceView[]).find(key => paths[key] === path);
  if (view) params.append("workspace", view);
  else if (path === "/explore/course" || path === "/explore/metric") params.append("workspace", "overview");
  if (path === "/explore") params.append("browse", "home");
  else if (path === "/explore/course") params.append("browse", "course");
  else if (path === "/explore/metric") params.append("browse", "metric");
  return params;
}
