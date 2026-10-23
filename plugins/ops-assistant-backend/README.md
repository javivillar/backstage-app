# ops-assistant-backend

Backend of the operations assistant (page `/ops-assistant`): a model answers questions about operating and
troubleshooting the platform, looking with the **read-only** tools of the MCP server `opsassistant-oneke`
(refresquito-services, `charts/opsassistant-oneke`): Kubernetes and Argo CD state, events, pod logs, Prometheus,
Loki and the documentation of the platform. It proposes; the operator acts.

## Portable by design

| piece | where | changes with the model? |
|---|---|---|
| tools | MCP server `opsassistant-oneke` | no |
| instructions | `opsAssistant.systemPrompt` (chart cnoe-oneke) | no (provider-neutral text) |
| agent loop | `src/agent.ts` | no (neutral types of `src/model/types.ts`) |
| HTTP API + page | `src/plugin.ts`, `packages/app/.../OpsAssistantPage.tsx` | no |
| model adapter | `src/model/anthropic.ts` | **yes**: one file per provider |

To use another model (one on the operator's own machine, for instance): write `src/model/<id>.ts` implementing
`ModelProvider` (`complete({system, messages, tools}) -> {parts, stop}`), add a case to `src/model/index.ts`, and set
`opsAssistant.model.provider: <id>`. Parts a provider does not understand (`opaque`, e.g. Claude's thinking) are kept
for the provider that made them and left out for others, so a conversation survives a change of model.

## Config

```yaml
opsAssistant:
  mcpUrl: http://opsassistant-oneke.<ns>:8080/mcp
  mcpToken: ${OPS_ASSISTANT_MCP_TOKEN}
  allowedGroups: [backstage-admin]   # deny by default
  maxSteps: 12
  systemPrompt: |
    ...
  model:
    provider: anthropic
    name: claude-opus-5-5
    effort: high
    apiKey: ${ANTHROPIC_API_KEY}
    baseUrl: ""                      # optional
```

Inert (the page says "not configured") unless `mcpUrl`, `systemPrompt` and the model's key are set.

## API

- `GET /api/ops-assistant/info` → `{enabled, allowed, model, maxSteps}`
- `POST /api/ops-assistant/chat` `{question, messages?}` → `202 {id}`: the question is being answered.
- `DELETE /api/ops-assistant/chat/:id` cancels it: the model request is aborted and the conversation stays as it
  was before the question.
- `GET /api/ops-assistant/chat/:id` → `{status: running|done|error, toolCalls, elapsedMs, turn?, error?}`, where
  `turn` is `{answer, messages, toolCalls, stop, model, usage}`. The page asks every 2 s and shows the tools called
  meanwhile. A question takes up to minutes, longer than Traefik or HAProxy keep a request open (60 s), hence a job
  (`src/jobs.ts`, in memory: one replica; at most 2 running per user; a finished one kept 30 min). The backend keeps
  no conversation: the page sends back `messages` as the last answer returned them.

Every question logs one audit line (user, model, tools called, tokens, time), never the answer or the data; the MCP
server logs every tool call with the user (`X-Refresquito-User`).
