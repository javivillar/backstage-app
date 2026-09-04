import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';
import { UserInfoService } from '@backstage/backend-plugin-api';
import { supersetAdminFetch } from './supersetClient';
import {
  CallerInfo,
  callerInfo,
  callerSupersetOwnerId,
  listSupersetObjects,
  requireOwnerOrAdmin,
} from './ownership';

interface SupersetOwner {
  id?: number;
  first_name?: string;
  last_name?: string;
}

function parseExtraJson(raw: string | undefined, label: string): string {
  const text = raw?.trim() || '{}';
  try {
    JSON.parse(text);
  } catch (e) {
    throw new Error(`"${label}" must be valid JSON: ${(e as Error).message}`);
  }
  return text;
}

async function findOwnedByName(
  config: Config,
  resource: 'database' | 'dataset',
  nameField: 'database_name' | 'table_name',
  name: string,
  caller: CallerInfo,
): Promise<{ id: number; owners?: SupersetOwner[] }> {
  const items = await listSupersetObjects<{ id: number; owners?: SupersetOwner[] } & Record<string, unknown>>(
    config,
    resource,
    caller,
  );
  const match = items.find(i => i[nameField] === name);
  if (!match) {
    throw new Error(
      `Superset ${resource} "${name}" not found among ${caller.isAdmin ? 'all' : 'your'} ${resource}s ` +
        `(check the Superset Manager page in Backstage for the exact name).`,
    );
  }
  return match;
}

async function getById(
  config: Config,
  resource: 'database' | 'dataset' | 'chart' | 'dashboard',
  id: number,
): Promise<Record<string, unknown>> {
  const res = await supersetAdminFetch(config, `/api/v1/${resource}/${id}`);
  if (!res.ok) {
    throw new Error(`Superset ${resource} ${id} not found: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { result: Record<string, unknown> };
  return body.result;
}

// ---------------------------------------------------------------------------
// Connections (Superset "Database" objects)
// ---------------------------------------------------------------------------

interface ConnectionInput {
  databaseName: string;
  sqlalchemyUri: string;
  allowCtas?: boolean;
  allowCvas?: boolean;
  allowDml?: boolean;
  allowFileUpload?: boolean;
  exposeInSqllab?: boolean;
  impersonateUser?: boolean;
  cacheTimeout?: number;
  sshTunnelServerAddress?: string;
  sshTunnelServerPort?: number;
  sshTunnelUsername?: string;
  sshTunnelPassword?: string;
  extraJson?: string;
}

const connectionInputSchema = {
  type: 'object' as const,
  required: ['databaseName', 'sqlalchemyUri'],
  properties: {
    databaseName: { title: 'Connection name', type: 'string' },
    sqlalchemyUri: {
      title: 'SQLAlchemy URI',
      description: 'e.g. postgresql://user:pass@host:5432/dbname',
      type: 'string',
    },
    allowCtas: { title: 'Allow CREATE TABLE AS', type: 'boolean', default: false },
    allowCvas: { title: 'Allow CREATE VIEW AS', type: 'boolean', default: false },
    allowDml: { title: 'Allow DML (INSERT/UPDATE/DELETE)', type: 'boolean', default: false },
    allowFileUpload: { title: 'Allow file upload', type: 'boolean', default: false },
    exposeInSqllab: { title: 'Expose in SQL Lab', type: 'boolean', default: true },
    impersonateUser: { title: 'Impersonate logged-in user', type: 'boolean', default: false },
    cacheTimeout: { title: 'Cache timeout (seconds)', type: 'number' },
    sshTunnelServerAddress: { title: 'SSH tunnel server address', type: 'string' },
    sshTunnelServerPort: { title: 'SSH tunnel server port', type: 'number' },
    sshTunnelUsername: { title: 'SSH tunnel username', type: 'string' },
    sshTunnelPassword: { title: 'SSH tunnel password', type: 'string', 'ui:widget': 'password' },
    extraJson: {
      title: 'Advanced (Extra, raw JSON)',
      description:
        'Passed through verbatim as Superset\'s "Extra" field — engine_params, metadata_params, ' +
        'schemas_allowed_for_file_upload, cost-estimate flags, etc. Leave empty for {}.',
      type: 'string',
    },
  },
};

function buildConnectionPayload(input: ConnectionInput, ownerId: number) {
  const payload: Record<string, unknown> = {
    database_name: input.databaseName,
    sqlalchemy_uri: input.sqlalchemyUri,
    configuration_method: 'sqlalchemy_form',
    allow_ctas: input.allowCtas ?? false,
    allow_cvas: input.allowCvas ?? false,
    allow_dml: input.allowDml ?? false,
    allow_file_upload: input.allowFileUpload ?? false,
    expose_in_sqllab: input.exposeInSqllab ?? true,
    impersonate_user: input.impersonateUser ?? false,
    extra: parseExtraJson(input.extraJson, 'Advanced (Extra, raw JSON)'),
    owners: [ownerId],
  };
  if (input.cacheTimeout !== undefined) payload.cache_timeout = input.cacheTimeout;
  if (input.sshTunnelServerAddress) {
    payload.ssh_tunnel = {
      server_address: input.sshTunnelServerAddress,
      server_port: input.sshTunnelServerPort,
      username: input.sshTunnelUsername,
      password: input.sshTunnelPassword,
    };
  }
  return payload;
}

export function createSupersetConnectionAction(options: { config: Config; userInfo: UserInfoService }) {
  const { config, userInfo } = options;
  return createTemplateAction<ConnectionInput>({
    id: 'superset:create-connection',
    description:
      'Creates a database connection in Superset. Open to any signed-in user — you become the ' +
      'owner and only you (or backstage-admin) can edit/delete it later, and only you can build ' +
      'datasets on top of it.',
    schema: { input: connectionInputSchema, output: { type: 'object', properties: { id: { type: 'number' }, databaseName: { type: 'string' } } } },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const ownerId = await callerSupersetOwnerId(config, caller);
      const res = await supersetAdminFetch(config, '/api/v1/database/', {
        method: 'POST',
        body: JSON.stringify(buildConnectionPayload(ctx.input, ownerId)),
      });
      if (!res.ok) {
        throw new Error(`Failed to create Superset connection: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { id: number };
      ctx.logger.info(`Created Superset connection ${ctx.input.databaseName} (${body.id})`);
      ctx.output('id', body.id);
      ctx.output('databaseName', ctx.input.databaseName);
    },
  });
}

export function createSupersetUpdateConnectionAction(options: { config: Config; userInfo: UserInfoService }) {
  const { config, userInfo } = options;
  return createTemplateAction<ConnectionInput & { currentDatabaseName: string }>({
    id: 'superset:update-connection',
    description:
      'Updates an existing Superset database connection. Only the owner or backstage-admin may run this.',
    schema: {
      input: {
        type: 'object',
        required: ['currentDatabaseName', 'databaseName', 'sqlalchemyUri'],
        properties: {
          currentDatabaseName: {
            title: 'Existing connection name',
            description: 'Identifies the connection to update.',
            type: 'string',
          },
          ...connectionInputSchema.properties,
        },
      },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const ownerId = await callerSupersetOwnerId(config, caller);
      const found = await findOwnedByName(config, 'database', 'database_name', ctx.input.currentDatabaseName, caller);
      const current = await getById(config, 'database', found.id);
      requireOwnerOrAdmin(caller, ownerId, current.owners as SupersetOwner[] | undefined);

      const res = await supersetAdminFetch(config, `/api/v1/database/${found.id}`, {
        method: 'PUT',
        body: JSON.stringify(buildConnectionPayload(ctx.input, ownerId)),
      });
      if (!res.ok) {
        throw new Error(`Failed to update Superset connection: ${res.status} ${await res.text()}`);
      }
      ctx.logger.info(`Updated Superset connection ${ctx.input.currentDatabaseName} (${found.id})`);
    },
  });
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

interface DatasetInput {
  connectionName: string;
  schema?: string;
  tableName: string;
  sql?: string;
}

const datasetInputProperties = {
  connectionName: {
    title: 'Connection',
    description:
      "Name of a database connection you own (or, if you're backstage-admin, any connection).",
    type: 'string' as const,
  },
  schema: { title: 'Schema', type: 'string' as const },
  tableName: {
    title: 'Table name',
    description: 'Physical table name, or a display name if you fill in the SQL field below.',
    type: 'string' as const,
  },
  sql: {
    title: 'SQL (virtual dataset)',
    description: 'Leave empty for a physical (table-backed) dataset; fill in for a virtual (query-backed) one.',
    type: 'string' as const,
  },
};

export function createSupersetDatasetAction(options: { config: Config; userInfo: UserInfoService }) {
  const { config, userInfo } = options;
  return createTemplateAction<DatasetInput>({
    id: 'superset:create-dataset',
    description:
      'Creates a dataset in Superset, on top of a connection you own. Open to any signed-in user — ' +
      'you become the owner and only you (or backstage-admin) can edit/delete it later.',
    schema: {
      input: { type: 'object', required: ['connectionName', 'tableName'], properties: datasetInputProperties },
      output: { type: 'object', properties: { id: { type: 'number' }, tableName: { type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const connection = await findOwnedByName(config, 'database', 'database_name', ctx.input.connectionName, caller);
      const ownerId = await callerSupersetOwnerId(config, caller);

      const payload: Record<string, unknown> = {
        database: connection.id,
        table_name: ctx.input.tableName,
        owners: [ownerId],
      };
      if (ctx.input.schema) payload.schema = ctx.input.schema;
      if (ctx.input.sql) payload.sql = ctx.input.sql;

      const res = await supersetAdminFetch(config, '/api/v1/dataset/', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Failed to create Superset dataset: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { id: number };
      ctx.logger.info(`Created Superset dataset ${ctx.input.tableName} (${body.id})`);
      ctx.output('id', body.id);
      ctx.output('tableName', ctx.input.tableName);
    },
  });
}

export function createSupersetUpdateDatasetAction(options: { config: Config; userInfo: UserInfoService }) {
  const { config, userInfo } = options;
  return createTemplateAction<DatasetInput & { currentTableName: string }>({
    id: 'superset:update-dataset',
    description:
      'Updates an existing Superset dataset. Only the owner or backstage-admin may run this.',
    schema: {
      input: {
        type: 'object',
        required: ['currentTableName', 'connectionName', 'tableName'],
        properties: {
          currentTableName: {
            title: 'Existing dataset name',
            description: 'Identifies the dataset to update.',
            type: 'string',
          },
          ...datasetInputProperties,
        },
      },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const ownerId = await callerSupersetOwnerId(config, caller);
      const found = await findOwnedByName(config, 'dataset', 'table_name', ctx.input.currentTableName, caller);
      const current = await getById(config, 'dataset', found.id);
      requireOwnerOrAdmin(caller, ownerId, current.owners as SupersetOwner[] | undefined);

      const connection = await findOwnedByName(config, 'database', 'database_name', ctx.input.connectionName, caller);
      const payload: Record<string, unknown> = {
        database_id: connection.id,
        table_name: ctx.input.tableName,
        owners: [ownerId],
      };
      if (ctx.input.schema) payload.schema = ctx.input.schema;
      if (ctx.input.sql) payload.sql = ctx.input.sql;

      const res = await supersetAdminFetch(config, `/api/v1/dataset/${found.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Failed to update Superset dataset: ${res.status} ${await res.text()}`);
      }
      ctx.logger.info(`Updated Superset dataset ${ctx.input.currentTableName} (${found.id})`);
    },
  });
}

// ---------------------------------------------------------------------------
// Charts & dashboards — provision-only. Superset builds these with an
// interactive visual editor (Explore / dashboard layout), not a linear
// form, so Backstage only creates the empty, correctly-owned object and
// hands back a deep link into Superset's own editor for the real work.
// No update/delete actions for these two — editing happens natively in
// Superset from here on.
// ---------------------------------------------------------------------------

const COMMON_VIZ_TYPES = [
  'table',
  'big_number_total',
  'big_number',
  'line',
  'bar',
  'pie',
  'area',
  'dist_bar',
  'echarts_timeseries_line',
  'echarts_timeseries_bar',
];

export function createSupersetProvisionChartAction(options: { config: Config; userInfo: UserInfoService }) {
  const { config, userInfo } = options;
  return createTemplateAction<{ sliceName: string; vizType: string; datasetName: string }>({
    id: 'superset:provision-chart',
    description:
      'Creates an empty chart in Superset (owned by you) and returns a link to finish building it ' +
      "in Superset's own Explore editor — chart config isn't a linear form in Superset, so Backstage " +
      "doesn't try to replicate it.",
    schema: {
      input: {
        type: 'object',
        required: ['sliceName', 'vizType', 'datasetName'],
        properties: {
          sliceName: { title: 'Chart name', type: 'string' },
          vizType: { title: 'Visualization type', type: 'string', enum: COMMON_VIZ_TYPES },
          datasetName: {
            title: 'Dataset',
            description: "Name of a dataset you own (or, if you're backstage-admin, any dataset).",
            type: 'string',
          },
        },
      },
      output: { type: 'object', properties: { id: { type: 'number' }, exploreUrl: { type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const dataset = await findOwnedByName(config, 'dataset', 'table_name', ctx.input.datasetName, caller);
      const ownerId = await callerSupersetOwnerId(config, caller);

      const res = await supersetAdminFetch(config, '/api/v1/chart/', {
        method: 'POST',
        body: JSON.stringify({
          slice_name: ctx.input.sliceName,
          viz_type: ctx.input.vizType,
          datasource_id: dataset.id,
          datasource_type: 'table',
          params: JSON.stringify({ viz_type: ctx.input.vizType, datasource: `${dataset.id}__table` }),
          owners: [ownerId],
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create Superset chart: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { id: number };
      const sc = config.getOptionalConfig('supersetAdmin');
      const publicUrl = config.getOptionalString('supersetPublicUrl') ?? sc?.getOptionalString('baseUrl') ?? '';
      const exploreUrl = `${publicUrl}/explore/?slice_id=${body.id}`;
      ctx.logger.info(`Provisioned Superset chart ${ctx.input.sliceName} (${body.id})`);
      ctx.output('id', body.id);
      ctx.output('exploreUrl', exploreUrl);
    },
  });
}

export function createSupersetProvisionDashboardAction(options: { config: Config; userInfo: UserInfoService }) {
  const { config, userInfo } = options;
  return createTemplateAction<{ dashboardTitle: string }>({
    id: 'superset:provision-dashboard',
    description:
      'Creates an empty dashboard in Superset (owned by you) and returns a link to finish building ' +
      "it in Superset's own dashboard editor.",
    schema: {
      input: {
        type: 'object',
        required: ['dashboardTitle'],
        properties: { dashboardTitle: { title: 'Dashboard title', type: 'string' } },
      },
      output: { type: 'object', properties: { id: { type: 'number' }, dashboardUrl: { type: 'string' } } },
    },
    async handler(ctx) {
      const caller = await callerInfo(ctx, userInfo);
      const ownerId = await callerSupersetOwnerId(config, caller);

      const res = await supersetAdminFetch(config, '/api/v1/dashboard/', {
        method: 'POST',
        body: JSON.stringify({ dashboard_title: ctx.input.dashboardTitle, owners: [ownerId] }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create Superset dashboard: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { id: number };
      const sc = config.getOptionalConfig('supersetAdmin');
      const publicUrl = config.getOptionalString('supersetPublicUrl') ?? sc?.getOptionalString('baseUrl') ?? '';
      const dashboardUrl = `${publicUrl}/superset/dashboard/${body.id}/`;
      ctx.logger.info(`Provisioned Superset dashboard ${ctx.input.dashboardTitle} (${body.id})`);
      ctx.output('id', body.id);
      ctx.output('dashboardUrl', dashboardUrl);
    },
  });
}
