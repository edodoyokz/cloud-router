export function resolveWorkspaceId() {
  const workspaceId = process.env.DEV_WORKSPACE_ID;
  if (!workspaceId) {
    const error = new Error('workspace could not be resolved');
    error.code = 'workspace_not_resolved';
    error.status = 401;
    throw error;
  }
  return workspaceId;
}
