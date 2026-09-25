# Evidence index

This directory contains a curated set of genuine execution evidence for Capability Forge. All application data is synthetic, sensitive input values are redacted, and no API keys are stored here.

## Qualifying discovery

- Run: `discovery_4338119e`
- Model: `anthropic:claude-sonnet-4-5`
- Goal: look up a member and return the current savings available balance
- Result: success, four discovered steps, output `12750.44`
- Files: `discovery/discovery-discovery_4338119e/`
- Compiled artifact: `artifacts/member-savings-balance.v1.json`

The artifact's `capability.sourceRunId` links it directly to this discovery run.

## Deterministic replay

- Run: `replay_3d6b6a21`
- Variant: Summit
- Result: success, output `25004.01`, duration `752 ms`
- Files: `replay/replay-replay_3d6b6a21/`

This replay used the compiled artifact without an LLM in the execution loop and succeeded against a different tenant presentation.

## Expected business outcome

- Run: `replay_0f6cdc81`
- Input: a nonexistent synthetic member
- Result: `MEMBER_NOT_FOUND`, duration `473 ms`
- Files: `replay/replay-replay_0f6cdc81/`

The engine reports this known application outcome separately from an automation failure.

## Same-session human handoff

- Run: `replay_b0725b4f`
- Scenario: supervisor approval required
- Result: the operator took control, resolved the blocking state, returned control, and automation resumed successfully in the same browser session
- Output: `12750.44`, duration `25503 ms`
- Files: `replay/replay-replay_b0725b4f/`

The directory includes the intervention record and a screenshot of the state presented to the operator.

## Hard-failure evidence

- Run: `replay_57b5c010`
- Scenario: supervisor approval required
- Result: `REPLAY_ERROR` after human intervention timed out at `120000 ms`
- Files: `replay/replay-replay_57b5c010/`

This run is retained as failure evidence. It includes structured events, an intervention screenshot, the terminal failure result, and a failure screenshot for diagnosis.
