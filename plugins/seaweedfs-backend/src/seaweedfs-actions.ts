import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';
import { AuthService, DiscoveryService, UserInfoService } from '@backstage/backend-plugin-api';
import { seaweedfsAdminFetch, seaweedfsPublicUrl } from './seaweedfsClient';
import { CallerInfo, callerInfo } from './ownership';
import { forgetOwnershipRemote, ownerOfRemote, recordOwnershipRemote } from './ownershipClient';

interface ActionOptions {
  config: Config;
  userInfo: UserInfoService;
  auth: AuthService;
  discovery: DiscoveryService;
}

// ---------------------------------------------------------------------------
// Buckets — native `owner` field (weed/admin/dash/bucket_management.go).
// Setting `owner` alone isn't enough to make the bucket USABLE by its
// creator afterward: the File Browser's own bucket_authz.go is
// deny-by-default for non-admins (a policy attached to a bucket_authz.go
// "/buckets/..." path is required, not just an `owner` label). So creation
// also: creates a bucket-scoped policy granting the creator full access to
// just this bucket, ensures the creator has a SeaweedFS Identity (JIT
// native-OIDC login already creates one on first login; this call is
// idempotent-safe if it already exists), and attaches the policy to that
// Identity (PolicyNames is a full-replace field on PUT /api/users/{u} — a
// real read-then-write, not additive).
// ---------------------------------------------------------------------------

function ownerPolicyName(bucket: string): string {
  return `S3Bucket-${bucket}-OwnerPolicy`;
}

function ownerPolicyDocument(bucket: string) {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:ListBucket', 's3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
      },
    ],
  };
}

async function ensureIdentityExists(config: Config, username: string): Promise<void> {
  const res = await seaweedfsAdminFetch(config, '/api/users', {
    method: 'POST',
    body: JSON.stringify({ username, generate_key: false }),
  });
  if (res.ok) return;
  const body = await res.text();
  // CreateObjectStoreUser returns a plain 500 with this message for an
  // already-existing identity (credential.ErrUserAlreadyExists) — the
  // common case for anyone who's already logged into SeaweedFS natively.
  if (body.includes('already exists')) return;
  throw new Error(`Failed to ensure SeaweedFS identity for "${username}": ${res.status} ${body}`);
}

async function attachPolicyToIdentity(config: Config, username: string, policyName: string): Promise<void> {
  const getRes = await seaweedfsAdminFetch(config, `/api/users/${encodeURIComponent(username)}`);
  if (!getRes.ok) {
    throw new Error(`Failed to look up SeaweedFS identity "${username}": ${getRes.status} ${await getRes.text()}`);
  }
  const details = (await getRes.json()) as { policy_names?: string[] };
  const current = details.policy_names ?? [];
  if (current.includes(policyName)) return;
  const putRes = await seaweedfsAdminFetch(config, `/api/users/${encodeURIComponent(username)}`, {
    method: 'PUT',
    body: JSON.stringify({ policy_names: [...current, policyName] }),
  });
  if (!putRes.ok) {
    throw new Error(`Failed to attach policy "${policyName}" to "${username}": ${putRes.status} ${await putRes.text()}`);
  }
}

async function createOwnerPolicyForBucket(config: Config, caller: CallerInfo, bucket: string): Promise<void> {
  const policyName = ownerPolicyName(bucket);
  const createRes = await seaweedfsAdminFetch(config, '/api/object-store/policies', {
    method: 'POST',
    body: JSON.stringify({ name: policyName, document: ownerPolicyDocument(bucket) }),
  });
  if (!createRes.ok && createRes.status !== 409) {
    throw new Error(`Failed to create owner policy for bucket "${bucket}": ${createRes.status} ${await createRes.text()}`);
  }
  await ensureIdentityExists(config, caller.username);
  await attachPolicyToIdentity(config, caller.username, policyName);
}

interface CreateBucketInput {
  name: string;
  versioningEnabled?: boolean;
  quotaSize?: number;
  quotaUnit?: string;
}

export function createSeaweedfsBucketAction(options: ActionOptions) {
  const { config, userInfo } = options;
  return createTemplateAction<CreateBucketInput>({
    id: 'seaweedfs:create-bucket',
    description:
      'Creates an S3 bucket in SeaweedFS. Open to any signed-in user — you become the owner and ' +
      'are automatically granted full access to it; only you (or backstage-admin) can see or use it ' +
      'afterward, in Backstage or in the SeaweedFS Admin UI\'s own File Browser.',
    schema: {
      input: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { title: 'Bucket name', type: 'string' },
          versioningEnabled: { title: 'Enable object versioning', type: 'boolean', default: false },
          quotaSize: { title: 'Quota size (MB, 0 = unlimited)', type: 'number', default: 0 },
        },
      },
      output: { type: 'object', properties: { name: { type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const quotaSize = ctx.input.quotaSize ?? 0;
      const res = await seaweedfsAdminFetch(config, '/api/s3/buckets', {
        method: 'POST',
        body: JSON.stringify({
          name: ctx.input.name,
          owner: caller.username,
          versioning_enabled: ctx.input.versioningEnabled ?? false,
          quota_enabled: quotaSize > 0,
          quota_size: quotaSize,
          quota_unit: 'MB',
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create SeaweedFS bucket: ${res.status} ${await res.text()}`);
      }
      await createOwnerPolicyForBucket(config, caller, ctx.input.name);
      ctx.logger.info(`Created SeaweedFS bucket ${ctx.input.name}, owner ${caller.username}`);
      ctx.output('name', ctx.input.name);
    },
  });
}

export function createSeaweedfsDeleteBucketAction(options: ActionOptions) {
  const { config, userInfo } = options;
  return createTemplateAction<{ name: string }>({
    id: 'seaweedfs:delete-bucket',
    description: 'Deletes a SeaweedFS bucket. Only the owner or backstage-admin may run this.',
    schema: {
      input: { type: 'object', required: ['name'], properties: { name: { title: 'Bucket name', type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const getRes = await seaweedfsAdminFetch(config, `/api/s3/buckets/${encodeURIComponent(ctx.input.name)}`);
      if (!getRes.ok) {
        throw new Error(`SeaweedFS bucket "${ctx.input.name}" not found: ${getRes.status} ${await getRes.text()}`);
      }
      const bucket = (await getRes.json()) as { bucket?: { owner?: string } };
      if (!caller.isAdmin && bucket.bucket?.owner !== caller.username) {
        throw new Error(
          `Forbidden: ${caller.entityRef} may not delete bucket "${ctx.input.name}" ` +
            `(owner: ${bucket.bucket?.owner || 'none'}).`,
        );
      }
      const delRes = await seaweedfsAdminFetch(config, `/api/s3/buckets/${encodeURIComponent(ctx.input.name)}`, {
        method: 'DELETE',
      });
      if (!delRes.ok) {
        throw new Error(`Failed to delete SeaweedFS bucket: ${delRes.status} ${await delRes.text()}`);
      }
      ctx.logger.info(`Deleted SeaweedFS bucket ${ctx.input.name}`);
    },
  });
}

// ---------------------------------------------------------------------------
// Table Buckets — also a native owner field (weed/admin/dash/
// s3tables_management.go's SetTableBucketOwner, stored as OwnerAccountID
// despite the name — verified it's a free-text field, not a real S3
// account id). Table buckets live under a different filer path namespace
// (s3tables.TablesPath) that bucket_authz.go's CanAccessPath doesn't cover
// at all, so there's no File-Browser-deny-by-default concern here the way
// there is for regular buckets — owner alone is sufficient.
// ---------------------------------------------------------------------------

export function createSeaweedfsTableBucketAction(options: ActionOptions) {
  const { config, userInfo } = options;
  return createTemplateAction<{ name: string }>({
    id: 'seaweedfs:create-table-bucket',
    description:
      'Creates an S3 Table Bucket in SeaweedFS. Open to any signed-in user — you become the owner.',
    schema: {
      input: { type: 'object', required: ['name'], properties: { name: { title: 'Table bucket name', type: 'string' } } },
      output: { type: 'object', properties: { name: { type: 'string' }, arn: { type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const res = await seaweedfsAdminFetch(config, '/api/s3tables/buckets', {
        method: 'POST',
        body: JSON.stringify({ name: ctx.input.name, owner: caller.username }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create SeaweedFS table bucket: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { arn: string };
      ctx.logger.info(`Created SeaweedFS table bucket ${ctx.input.name}, owner ${caller.username}`);
      ctx.output('name', ctx.input.name);
      ctx.output('arn', body.arn);
    },
  });
}

export function createSeaweedfsDeleteTableBucketAction(options: ActionOptions) {
  const { config, userInfo } = options;
  return createTemplateAction<{ arn: string }>({
    id: 'seaweedfs:delete-table-bucket',
    description:
      'Deletes a SeaweedFS table bucket (identify it by ARN, shown in the Seaweedfs Manager page). ' +
      'Only the owner or backstage-admin may run this.',
    schema: {
      input: { type: 'object', required: ['arn'], properties: { arn: { title: 'Table bucket ARN', type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const listRes = await seaweedfsAdminFetch(config, '/api/s3tables/buckets');
      if (!listRes.ok) {
        throw new Error(`Failed to list SeaweedFS table buckets: ${listRes.status} ${await listRes.text()}`);
      }
      const list = (await listRes.json()) as { buckets?: Array<{ arn: string; name: string; ownerAccountId?: string }> };
      const found = list.buckets?.find(b => b.arn === ctx.input.arn);
      if (!found) {
        throw new Error(`SeaweedFS table bucket with ARN "${ctx.input.arn}" not found`);
      }
      if (!caller.isAdmin && found.ownerAccountId !== caller.username) {
        throw new Error(
          `Forbidden: ${caller.entityRef} may not delete table bucket "${found.name}" ` +
            `(owner: ${found.ownerAccountId || 'none'}).`,
        );
      }
      const delRes = await seaweedfsAdminFetch(
        config,
        `/api/s3tables/buckets?bucket=${encodeURIComponent(ctx.input.arn)}`,
        { method: 'DELETE' },
      );
      if (!delRes.ok) {
        throw new Error(`Failed to delete SeaweedFS table bucket: ${delRes.status} ${await delRes.text()}`);
      }
      ctx.logger.info(`Deleted SeaweedFS table bucket ${found.name}`);
    },
  });
}

// ---------------------------------------------------------------------------
// Groups & Policies — bolted-on ownership via Backstage's own database (see
// ownership.ts). SeaweedFS's Group/Policy objects have no owner field to
// set at all.
// ---------------------------------------------------------------------------

export function createSeaweedfsGroupAction(options: ActionOptions) {
  const { config, userInfo, auth, discovery } = options;
  return createTemplateAction<{ name: string }>({
    id: 'seaweedfs:create-group',
    description:
      'Creates a SeaweedFS IAM group. Open to any signed-in user — you become the owner, visible ' +
      'only to you (or backstage-admin) in the Seaweedfs Manager page.',
    schema: {
      input: { type: 'object', required: ['name'], properties: { name: { title: 'Group name', type: 'string' } } },
      output: { type: 'object', properties: { name: { type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const res = await seaweedfsAdminFetch(config, '/api/groups', {
        method: 'POST',
        body: JSON.stringify({ name: ctx.input.name }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create SeaweedFS group: ${res.status} ${await res.text()}`);
      }
      await recordOwnershipRemote({ auth, discovery }, 'group', ctx.input.name, caller.username);
      ctx.logger.info(`Created SeaweedFS group ${ctx.input.name}, owner ${caller.username}`);
      ctx.output('name', ctx.input.name);
    },
  });
}

export function createSeaweedfsDeleteGroupAction(options: ActionOptions) {
  const { config, userInfo, auth, discovery } = options;
  return createTemplateAction<{ name: string }>({
    id: 'seaweedfs:delete-group',
    description: 'Deletes a SeaweedFS group. Only the owner or backstage-admin may run this.',
    schema: {
      input: { type: 'object', required: ['name'], properties: { name: { title: 'Group name', type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const owner = await ownerOfRemote({ auth, discovery }, 'group', ctx.input.name);
      if (!caller.isAdmin && owner !== caller.username) {
        throw new Error(
          `Forbidden: ${caller.entityRef} may not delete group "${ctx.input.name}" (owner: ${owner || 'none'}).`,
        );
      }
      const res = await seaweedfsAdminFetch(config, `/api/groups/${encodeURIComponent(ctx.input.name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error(`Failed to delete SeaweedFS group: ${res.status} ${await res.text()}`);
      }
      await forgetOwnershipRemote({ auth, discovery }, 'group', ctx.input.name);
      ctx.logger.info(`Deleted SeaweedFS group ${ctx.input.name}`);
    },
  });
}

export function createSeaweedfsPolicyAction(options: ActionOptions) {
  const { config, userInfo, auth, discovery } = options;
  return createTemplateAction<{ name: string; documentJson: string }>({
    id: 'seaweedfs:create-policy',
    description:
      'Creates a SeaweedFS IAM policy from a raw policy document (same JSON shape as AWS IAM: ' +
      '{Version, Statement:[{Effect,Action,Resource}]}). Open to any signed-in user — you become ' +
      "the owner, and it's the only kind of policy you'll see offered when attaching one to a group " +
      "you own (unless you're backstage-admin).",
    schema: {
      input: {
        type: 'object',
        required: ['name', 'documentJson'],
        properties: {
          name: { title: 'Policy name', type: 'string' },
          documentJson: {
            title: 'Policy document (JSON)',
            description: 'e.g. {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject"],"Resource":["arn:aws:s3:::my-bucket/*"]}]}',
            type: 'string',
          },
        },
      },
      output: { type: 'object', properties: { name: { type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      let document: unknown;
      try {
        document = JSON.parse(ctx.input.documentJson);
      } catch (e) {
        throw new Error(`"Policy document" must be valid JSON: ${(e as Error).message}`);
      }
      const res = await seaweedfsAdminFetch(config, '/api/object-store/policies', {
        method: 'POST',
        body: JSON.stringify({ name: ctx.input.name, document }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create SeaweedFS policy: ${res.status} ${await res.text()}`);
      }
      await recordOwnershipRemote({ auth, discovery }, 'policy', ctx.input.name, caller.username);
      ctx.logger.info(`Created SeaweedFS policy ${ctx.input.name}, owner ${caller.username}`);
      ctx.output('name', ctx.input.name);
    },
  });
}

export function createSeaweedfsDeletePolicyAction(options: ActionOptions) {
  const { config, userInfo, auth, discovery } = options;
  return createTemplateAction<{ name: string }>({
    id: 'seaweedfs:delete-policy',
    description: 'Deletes a SeaweedFS policy. Only the owner or backstage-admin may run this.',
    schema: {
      input: { type: 'object', required: ['name'], properties: { name: { title: 'Policy name', type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const owner = await ownerOfRemote({ auth, discovery }, 'policy', ctx.input.name);
      if (!caller.isAdmin && owner !== caller.username) {
        throw new Error(
          `Forbidden: ${caller.entityRef} may not delete policy "${ctx.input.name}" (owner: ${owner || 'none'}).`,
        );
      }
      const res = await seaweedfsAdminFetch(config, `/api/object-store/policies/${encodeURIComponent(ctx.input.name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error(`Failed to delete SeaweedFS policy: ${res.status} ${await res.text()}`);
      }
      await forgetOwnershipRemote({ auth, discovery }, 'policy', ctx.input.name);
      ctx.logger.info(`Deleted SeaweedFS policy ${ctx.input.name}`);
    },
  });
}

export { seaweedfsPublicUrl };
