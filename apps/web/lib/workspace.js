import { randomBytes } from 'crypto';
import { getAuthenticatedUser } from './auth.js';
import { supabaseInsert, supabaseSelect } from './supabase-admin.js';

export async function resolveWorkspaceId(request) {
  const authUser = await getAuthenticatedUser(request);
  if (authUser) {
    const appUser = await ensureInternalUser(authUser);
    const workspace = await ensurePersonalWorkspace(appUser, authUser.email);
    return workspace.id;
  }

  const workspaceId = process.env.DEV_WORKSPACE_ID;
  if (!workspaceId) {
    const error = new Error('workspace could not be resolved');
    error.code = 'workspace_not_resolved';
    error.status = 401;
    throw error;
  }
  return workspaceId;
}

export async function requireAuthenticatedWorkspaceId(request) {
  const authUser = await getAuthenticatedUser(request);
  if (!authUser) {
    throw Object.assign(new Error('authentication is required'), { status: 401, code: 'authentication_required' });
  }
  const appUser = await ensureInternalUser(authUser);
  const workspace = await ensurePersonalWorkspace(appUser, authUser.email);
  return workspace.id;
}

export async function ensureInternalUser(authUser) {
  const query = `?auth_provider=eq.supabase&auth_provider_id=eq.${encodeURIComponent(authUser.id)}&select=*`;
  const existing = await supabaseSelect('users', query);
  if (existing.length > 0) return existing[0];

  const [created] = await supabaseInsert('users', [{
    email: authUser.email,
    auth_provider: 'supabase',
    auth_provider_id: authUser.id
  }]);
  return created;
}

export async function ensurePersonalWorkspace(appUser, email) {
  const membershipQuery = `?user_id=eq.${encodeURIComponent(appUser.id)}&select=workspace_id,role&limit=1`;
  const memberships = await supabaseSelect('workspace_members', membershipQuery);
  if (memberships.length > 0) {
    return { id: memberships[0].workspace_id };
  }

  const [workspace] = await supabaseInsert('workspaces', [{
    owner_user_id: appUser.id,
    name: personalWorkspaceName(email),
    slug: personalWorkspaceSlug(email)
  }]);

  await supabaseInsert('workspace_members', [{
    workspace_id: workspace.id,
    user_id: appUser.id,
    role: 'owner'
  }]);

  return workspace;
}

export function personalWorkspaceName(email) {
  const prefix = String(email || 'User').split('@')[0] || 'User';
  return `${prefix}'s Workspace`;
}

export function personalWorkspaceSlug(email) {
  const prefix = String(email || 'workspace')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
  return `${prefix}-${randomBytes(3).toString('hex')}`;
}
