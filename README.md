---
description: "Persist scoped producer tasks and original outputs before receipt-aware IM delivery."
kind: "package-bundle"
---
# dsh-job-delivery

English | [中文](README.zh.md)

## Summary

This unpublished development candidate adds durable task identity, producer registration, independent execution and delivery queues, checkpointed outputs, cancellation and explicit reconciliation. It uses native DSH jobs and storage. The native owner business page, model tools, cross-platform release gates and public distribution remain pending.

## Usage and authority

Target DSH 0.2.2-rc.1 and Node ^22.19 or >=24. The bundle inserts a disabled runtime. Its native dependencies are the jobs registry and storage-domain facility; the configured storage route must provide a durable backend. An IM provider may arrive later. Executors are installed Host plugins, never model-selected modules.

The Host service is `ctx.jobDelivery`. Register producers through `ctx.effect(() => ctx.jobDelivery.register(producer))`. Producers declare their concurrency and call `context.checkpoint(outputId, parts)` for each ready original before completing. Submit authenticated `scope`, `actorId`, source `operationId`, provider ID and JSON payload. Freeze selected model, voice and other user preferences in that payload. The entire source is durable before execution becomes eligible; admission cancellation is checked before persistence, and an already committed admission returns its identity.

This is a trusted Host service. Consumers authorize the requester before submitting, inspecting or reconciling a task; the supplied scope is checked against retained identity. No model tool, public HTTP endpoint, credential reader or ordinary-member permission policy is installed here. Native jobs expose only derived task IDs and execution state, while complete source and outputs remain in the owner-controlled domain.

## Persistence and recovery

The schema-1 native domain uses whole-unit version checking. Invalid records or unsupported versions fail startup instead of disappearing. The JSON backend rewrites one bounded unit; choose capacities and a suitable native backend for the workload. A domain has one writer owner; separate processes need distinct profile storage or a backend providing exclusive ownership. All retention limits reject new work explicitly, preserving existing records. The operator controls task count, record/payload/receipt/retained bytes, output count and text/part limits, global and per-scope concurrency, mutation admission and deadlines.

Task identity includes account and conversation privacy kind. Replaying one source operation cannot create new execution; a changed payload under the same identity conflicts. Producers checkpoint outputs separately. A completed or uncertain computation is not automatically repeated to repair delivery. On startup, retained running computation and sending output become uncertain. An owner-confirmed no-send observation can requeue only the saved output. Repeating computation requires explicit confirmation no external execution started and is refused after any checkpoint exists.

Unknown sends remain unknown until reconciliation. Accepted means server acceptance, not phone-client delivery. Cancellation is persisted before aborting active work; accepted late receipts remain accepted. Producer unregister and runtime disposal abort and await actual cleanup. Executors and transports must settle after abort. Muted/offline preflight spends no producer work; a new source, normalized inbound event, IM service activation or explicit `wake` can recheck a transient hold. Native job settlement wakes job-admission holds while leaving muted/offline holds intact. No polling schedule or fixed retry gap is installed.

Original media parts reference storage owned by their producing plugin; that plugin must preserve and restore the original bytes. The queue neither resizes nor regenerates those bytes. A checkpoint reserves room for a complete supported receipt before it can be sent. An invalid or oversized transport receipt causes a visible fault and an uncertain output; it is not silently shortened or automatically retried.

## Validation and pending work

`npm test` builds and exercises synthetic storage-backed queues. `npm run test:native -- --im-kit-archive <library.tgz> --minimum-free-bytes 1610612736` installs the candidate in a dedicated SDK profile, forcibly interrupts only its owned SDK process and checks recovery in a second process. The explicit free-space budget is checked before installation and the declared pnpm is pinned on PATH. These checks use original synthetic sources and local transports, with no QQ messages, model API calls or Bilibili writes. Current executed results live in the sibling development evidence; source tests are not semantic model benchmarks.

The candidate still needs its native owner page, safe user-facing tools, full publication checks, public installation verification and combinations with real generation/search/voice plugins. It is not a complete task scheduler, a model runner or a process sandbox. Supported applications launch through DSH profiles only.
