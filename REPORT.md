# 1. Architecture

Capability Forge is intentionally a single-process vertical slice with explicit internal boundaries. The system has four load-bearing parts: a surface adapter, an LLM discovery loop, a capability compiler, and a deterministic replay engine. Policy, evidence, and human control are shared services around those paths.

The discovery path receives a goal, an entry point, and typed inputs. `BrowserSurface` converts the current browser state into a bounded observation containing visible text, interactive controls, data elements, accessibility-oriented names, bounding boxes, and opaque element references. The model chooses exactly one structured decision: click, type, wait, extract, complete, or escalate. The runtime validates that decision, performs it through the surface adapter, and records the resulting action. It never executes model-generated JavaScript or arbitrary selectors.

After a successful run, the compiler converts concrete inputs into placeholders and emits a capability. The artifact is separate from the model transcript and contains only what deterministic execution needs. A raw transcript can change between providers and is not a stable production contract.

Replay validates the artifact and invocation inputs, specializes the artifact for the selected tenant variant, checks policy, resolves each target, executes the fixed action sequence, detects exceptional states, verifies the final checkpoint, and returns typed outputs. It never constructs a decision-model client.

The same surface object is shared with the intervention control plane. This matters because handing a human a new browser would lose cookies, navigation state, focused controls, and the error that caused escalation. The control plane makes ownership explicit and prevents simultaneous automation and operator actions.

I chose TypeScript because schemas, model decisions, capability contracts, and result unions are central to correctness. Playwright gives a useful accessibility-first browser surface while still supporting screenshots and coordinates. Express keeps both the training app and operator console small. Zod validates untrusted model output, stored artifacts, and runtime contracts.

The training application represents a legacy core-servicing product: table layouts, an iframe workspace, generated form mechanics, few semantic hooks, blocking dialogs, and tenant-specific labels. It contains no real financial data.

# 2. Artifact schema

The artifact is an agent-invocable capability, not a recording of mouse events. Its top-level sections are:

- `capability`: identity, semantic version, approval state, source run, vendor application family, and tested variants.
- `contract`: typed inputs, typed outputs, sensitive-data markers, validation patterns, and possible outcomes.
- `policy`: origins, route patterns, action types, risky-action behavior, and the no-sensitive-persistence invariant.
- `steps`: ordered typed actions with risk labels and optional checkpoints.
- `success`: an independently verifiable final state.
- `businessOutcomes`: legitimate domain answers that are not system failures.
- `recoveries`: known exceptional states and bounded policies.
- `variants`: tenant-specific base URLs and narrowly scoped locator overrides.

Each target contains an ordered locator portfolio rather than one selector. A typical recorded target prefers accessible role plus name, then visible text or a constrained structural selector, with viewport-bound coordinates as a last resort. Replay accepts a candidate only when its match count is within the artifact's declared cardinality. This prevents an apparently successful click on the wrong duplicate button.

Inputs are parameterized as `{{memberId}}`; concrete invocation values do not enter the artifact. Outputs state both their type and sensitivity. The replay caller therefore knows the capability contract before running it and can handle the result without parsing UI text itself.

Artifacts begin as `draft`. A production system should require review, test evidence, and approval before unattended invocation. Semantic versioning distinguishes compatible locator or recovery improvements from contract-breaking changes. The `sourceRunId` links the capability back to discovery evidence without embedding that evidence.

# 3. Determinism & error handling

Determinism means the production path has no model deciding what to do. Given an artifact, tenant variant, and inputs, replay follows the same typed steps. Dynamic waits are tied to Playwright actionability and explicit checkpoints instead of broad sleeps. A small bounded wait action exists for surfaces where the adapter cannot expose a better readiness signal.

Replay uses a layered locator strategy. Semantic locators are evaluated first across the main page and frames. Match cardinality is checked before action. Coordinates are accepted only with the recorded viewport dimensions. Tenant overrides replace only the target for a specific step, leaving the shared capability contract and flow intact.

Runtime states are separated into three result classes:

1. `success`: the final checkpoint exists and every declared output was extracted and parsed.
2. `business_outcome`: the application produced a meaningful answer such as `MEMBER_NOT_FOUND`.
3. `failure`: the system could not safely fulfill the contract. The failure contains a stable code, message, step, expected state where known, and evidence path.

Known recoverable conditions are checked before steps. A bounded retry can address transient slowness, a known interstitial can be dismissed, and conditions requiring judgment escalate. A session expiration is not treated as a selector failure. An unresolved supervisor gate after human resume becomes `INTERVENTION_UNRESOLVED`. Policy violations stop before the prohibited action.

Every run emits redacted JSONL events. Discovery logs model rationales and structured decisions. Replay logs step boundaries and outcomes. Failures capture a screenshot. Playwright traces or encrypted DOM snapshots would be the next richer production signals.

# 4. Heterogeneity & multi-tenant

The artifact describes intent-level actions against abstract targets. `Surface` owns observation, targeting, clicking, typing, extraction, screenshots, and raw operator input. `BrowserSurface` is one implementation. A desktop adapter could provide the same contract using Windows UI Automation, macOS Accessibility, or a vision-plus-OS-input service. The replay engine and capability schema would not need to know whether the control came from a DOM, an accessibility tree, or pixels.

For a legacy web app, the browser adapter searches all frames and does not depend on test IDs. For a pixel-only surface, a target could contain an image anchor or coordinates with display and scaling constraints. I would add those as new locator variants, not new step types. This preserves artifact meaning while allowing surface-specific perception and action.

Multi-tenant reuse is organized around `appFamily`. One base capability represents a vendor product and version range. Tenant variants contain a base URL plus step-scoped locator overrides. The demo proves this with Harbor and Summit: the same flow and contract run against different branding and control labels. Overrides are narrow and reviewable, so customization does not fork the entire capability.

At registration and periodically afterward, a canary replay would compare application fingerprints: title, stable landmarks, accessibility-tree hashes, and product/version text. Compatible changes can create a proposed patch version; ambiguous drift quarantines only the affected tenant variant. Replay success rate, locator fallback usage, and checkpoint failures provide a per-capability stability signal. A tenant never silently falls back to a different app family.

# 5. Escalation & handoff

Escalation can originate from discovery, a declared replay recovery, a risky action, or a dead end. The intervention request carries the run, capability, step, reason, screenshot, state, creation time, and audit trail.

The control state machine is `automation -> none -> human -> automation`. Creating an intervention pauses the replay promise and removes automation ownership. The operator console displays the current live-session screenshot, lets an authenticated operator claim control, sends coordinate clicks or keyboard input to the same Playwright page, records each action, and exposes an explicit resume action. Replay continues only after resume and then verifies that the blocking condition is gone.

The demo console is intentionally minimal, but the seam is real. It does not reopen the URL, reconstruct cookies, or create a second session. It also avoids concurrent control. In production I would stream frames over WebRTC or a remote-browser protocol, require role-based operator authorization, issue a short-lived control lease, record identity from the identity provider, and support cancel or terminal completion in addition to resume.

# 6. Safety

Safety is enforced at runtime, not left in the prompt. Before each action, replay verifies the action type, origin, and route against the capability policy. Inputs are type- and pattern-checked before navigation. Every action carries a risk class. The current capability escalates risky actions and can be configured to block them entirely. Irreversible actions cannot be discovered accidentally because the model's action vocabulary is constrained and the runtime owns execution.

Artifacts persist parameter placeholders instead of concrete member values. Evidence redacts member IDs, SSNs, authorization material, cookies, tokens, passwords, secret-like fields, and sensitive typed outputs. Screenshots mask input fields, profile values, and extracted balances. Output values are returned to the authorized caller but only output names are written to the completion event. The optional OpenAI Responses client sets `store: false`. The training UI uses synthetic data.

The demonstration is not a complete regulated-data security boundary. A production service also needs encryption at rest and in transit, per-tenant keys, strict retention, authenticated artifact signing, operator RBAC, network isolation, browser sandboxing, a secrets broker, immutable audits, and institution-specific policy review. Screenshots require the same PII controls as application data and should be encrypted, access logged, and short lived.

# 7. Cuts

I cut breadth to keep every required capability real and coherent. There is no queue, distributed scheduler, persistent database, SSO implementation, or desktop adapter. The operator UI uses periodic screenshots rather than video streaming. Recovery policies are intentionally small and bounded. The model receives a compact accessibility-oriented observation instead of full multimodal screenshots. Artifact approval is represented but not backed by a reviewer workflow.

With more time, I would first add signed artifact approval and a multi-run stability gate. Next I would add Playwright trace encryption and a bounded one-step LLM recovery that always requires policy validation and produces a proposed artifact patch. After that, I would implement application fingerprinting and drift dashboards across tenant variants, then a Windows accessibility adapter to validate the surface boundary against a real desktop application.

These cuts keep the submission focused on the production path that matters: genuine discovery, a strong reusable contract, model-free replay, explicit runtime semantics, and safe same-session escalation.
