# Rackium Developer Brief v2.3 — Addendum

Oct 27, 2026 · @Hamza · Supersedes selected parts of v2.2-FINAL

> Converted from `docs/Rackium Developer Brief v2.3 — Addendum.pdf` (46 pages; the PDF itself is not tracked in git). Text and tables are as in the PDF; tables that the PDF split across pages are joined here. The addendum was written against v2.2 and did not see `RACKIUM-BRIEF-v2.3.md` or `DATA-MODEL.md`; where it conflicts with a decision already recorded there, nothing has been changed yet — the conflicts are listed for the product owner (see DATA-MODEL §11).
>
> **Handling:** this document names real client field names, role values and device models as reference for building configuration profiles. None of it is to be loaded into tests or demo data (see §13 "Handling note").

## Contents

Addition = entirely new, nothing equivalent in v2.2. Amendment = changes or replaces existing v2.2 text. Reference = neither; included for context.

| # | Section | Type | Affects v2.2 |
|---|---|---|---|
| 1 | Status of v2.2 and how to use this document | Reference | — |
| 2 | Answers to the 22 open questions | Reference | Various |
| 3 | Core principle: configuration over hardcoding | Addition | Constrains all sections |
| 4 | Configurable work types and workflow templates | Addition | §3 — replaces the fixed nine-phase assumption |
| 5 | Network Decommissioning workflow | Addition | New workflow template |
| 6 | Starlink Deployment workflow | Addition | New workflow template |
| 7 | Data Protection, Security & Client Control | Addition | Extends §11 with a client-facing interface |
| 8 | Data lifecycle and retention | Amendment | §11 — replaces "deletion within 30 days" |
| 9 | Security corrections | Amendment | §11 — six corrections |
| 10 | Certification and assurance roadmap | Addition | — |
| 11 | Resolved scope contradictions | Amendment | §3.5c, §4.2, §20.7 and the scope exclusions |
| 12 | Non-functional requirements | Addition | — |
| 13 | Integration Profile 1 — SD-LAN CMDB contract | Addition | §10 export, §3.4 import |
| 14 | Updated data entities | Amendment | §2 — nine new entities, six amended |
| 15 | Revised development priorities | Amendment | Replaces the v2.2 development sequence |
| 16 | Glossary — terms used in this document | Addition | — |

New to this domain? Section 16 is a glossary of every abbreviation and technical term used here — CMO, IMO, FMO, HLD, LLD, BOM, CMDB, RU, EXEREP, DGUV, VLAN, patch panel and the rest. Each entry says what the term means and why Rackium needs it, which is the part that matters when deciding how to build something. Read it alongside sections 4 to 6 rather than before them.

Still to be written, and marked as such in the text: form tab definitions for work types outside the launch set (section 4), and detailed field specifications for the non-launch work types. Neither blocks the priority 1 and 2 work.

## 1. Status of v2.2 and how to use this document

v2.2-FINAL is not approved as the final specification. It remains the baseline for the LAN infrastructure lifecycle, but it is incomplete in five areas and internally contradictory in four. This addendum closes both. Read it alongside v2.2; where the two disagree, this document wins.

What this addendum adds that v2.2 does not contain:

1. Configurable work types and workflow templates — the mechanism that lets one platform serve decommissioning, Starlink, cabling and transformation projects without hardcoding each one
2. The Network Decommissioning workflow
3. The Starlink Deployment workflow
4. The Data Protection, Security & Client Control page
5. A formal data lifecycle, and non-functional requirements

What it corrects in v2.2: the offline-capability contradiction, the third-party integration contradiction, the floor-plan contradiction, the concurrency scope, the GDPR breach wording, the credential classification, the audit-log classification, and the key-management and file-upload sections.

On the frontend audit of 3 October 2026. It remains useful but is no longer current. It assessed the prototype as it stood that day, several of its section references no longer match v2.2 after HLD and LLD renumbering, and at least one finding (the notification bell) is already resolved in newer designs. Do not work from it directly. It will be re-run against v3.0.

Sequence from here: this addendum is approved → merged into a clean v3.0 baseline → a fresh frontend audit is commissioned against v3.0. v2.3 is not itself a rewrite of the 110 pages, and no one should wait for one.

## 2. Answers to the 22 open questions

All 22 are answered here. Items 6 to 10 require content from Technonex and are listed with owners and dates rather than answers.

### Questions 1 to 5 — the ones blocking work now

**1. Design tools.** Asked: confirm or correct what these should do — Break Uplink (remove a link, mark both devices "uplink needed"), Reroute (change the cable route without changing which devices are connected), Replace Endpoint (move one end of a link to a different device), Split (A–B becomes A–X–B), Merge (A–X–B becomes A–B).

Confirmed — all five definitions are correct. Four behaviours to add:

- **Break Uplink** releases both ports and archives the connection record rather than deleting it, so the audit trail survives. The resulting "uplink needed" state is a validation warning, never a blocker.
- **Reroute** must recalculate cable length and update patch-panel and cable quantities in the BOM.
- **Replace Endpoint** reissues `cable_id` by default, because a re-terminated run is physically a new cable. The user may override and keep the original ID.
- **Split** checks port availability on the inserted device before committing. **Merge** issues a new `cable_id` and leaves the removed device in place, unlinked.

**2. Working together at the same time.** Asked: we plan option A — each person sees who else is working on a building, and a port being edited is locked for others until saved. Option B is Google-Docs-style live editing, about 1–2 extra weeks. Is A enough?

Build neither A nor B as described — build the save-time check only. Presence awareness and live change-tracking are dropped from scope. What stays is a version check on save: if a port record changed since it was loaded, the second save is rejected with "this port was changed by [user], reload". This is not a real-time feature and needs no WebSocket. It replaces §4.2.2 to §4.2.4 of v2.2, which specified soft locking with 30 and 60 second timeouts. Without it, two engineers patching the same switch overwrite each other silently. Estimated at one day, and it is not optional.

**3. Logical topology.** Asked: for the first version we plan VLANs, subnets, gateways, VLANs per port and port channels (LAG), with VRFs, security zones, DHCP, ACLs, routes, DNS and NTP to come later. Is that OK?

Yes — approved as the default profile. This matches what the client's CMDB import contract actually carries: Restricted VLAN holds ACL path as a string and DNS, DHCP and secure authentication as booleans, and no VRF or security-zone object appears anywhere in it. The deferred objects stay in the §3.6B object library as a profile-level option so a later client can switch them on without a rebuild.

**4. Floor plans.** Asked: should engineers also roughly place access points and endpoints on the floor plan?

Yes. This is already §20.7 and is confirmed as MVP. Interactive overlay mapping and heatmaps remain future scope. See the floor-plan contradiction resolved below.

**5. "CMO inventory has not same naming as FMO".** Asked: which do you mean — (1) existing devices keep their old names shown separately, (2) existing devices are renamed with "old name → new name" shown, or (3) the CMO screens use different columns or words than FMO?

Option 2 — and the premise needs correcting first. Three parts:

- **There are three states, not two: CMO → IMO → FMO.** CMO is the current mode of operation and FMO the future one. IMO is the interim mode that exists during migration — temporary equipment, temporary patching and temporary VLANs that live only between cutover steps. The client's files confirm it: Service Offering carries IMO or FMO, and interim objects have field names of their own (`u_imo_cova_name`, `u_imo_rvlan_name`, "IMO LAN Access Switch"). v2.2 models only CMO and FMO, so the third state has to be added to the data model, the HLD/LLD canvas and the CMDB.
- **Mode is a field on one record, not three tables.** `mode_state` takes CMO, IMO or FMO. A device may exist in IMO alone — temporary kit installed for cutover and removed afterwards — so the model must allow a record whose life begins and ends in the interim state without ever reaching FMO. The canvas needs to show, hide or overlay each state independently.
- **Existing devices are renamed** to the new convention and the original name is kept permanently in a new immutable field, `legacy_hostname`. Both are displayed as "old → new" wherever a migrated device appears, and mandatorily on deployment checklists and printed labels, because the engineer locates the device on site by its old name. The state labels themselves stay configurable, since another client may say As-Is / Transition / To-Be.

This also answers the "reprint label" task: it is the closing step of the rename, not an optional extra.

### Questions 11 to 20 — confirmations

**11. Price visibility.** Asked: prices and margins are visible only to Org Admin, PM and Reviewer. Will someone from the customer's company ever have the Reviewer role? If yes, they would see our prices.

Yes they will — and this is a commercial exposure, not a configuration question. §2.6 grants Reviewer "view all", which includes unit costs and margins. Client reviewers will need approval rights. Therefore add a seventh role, **External Reviewer**: approve, reject and comment on designs; BOM visible as quantity and specification only, with no unit cost, no margin and no supplier. Also note that v2.2 has no "PM" or "Org Admin" role — the roles are Owner, Architect, Field Engineer, Reviewer, Procurement, Viewer. Use those names.

**12. SLA escalation.** Asked: when a deadline is missed we alert the PM and the "owner". Is the owner the Org Admin, or someone else?

The Owner role — but make the recipient configurable. An Owner may hold dozens of projects, so SLA breach escalates to the Owner plus a per-project escalation contact, which defaults to the Owner when unset.

**13. DGUV exemption.** Asked: do some devices need an "exempt from inspection" status with a reason, or is deciding by device type enough?

Both — and it is already specified. §20.9 defines exempt as one of five DGUV statuses with a mandatory reason. Device type sets the default via `dguv_required`; per-device override requires the reason. No change needed.

**14. Analytics.** Asked: the 6th metric is "blocker resolution time". OK?

Yes. It is sound and distinct from blocker frequency, which §21.9 already lists. Keep both.

**15. BOM accuracy.** Asked: should it compare the first and final approved BOM, or the approved BOM against what was actually installed?

Approved BOM against as-installed. That is the variance with money attached — over-ordering, wastage, emergency procurement and client variation claims. First-approved against final-approved is also worth tracking but measures something different; report it separately as BOM revision count. Do not merge them into one figure.

**16. Icons.** Asked: all icons in Rackium blue (#094F9A) outline, except status icons and cable colours?

Yes. Rackium blue `#094F9A`, 1.65px rounded stroke, black labels, with status icons and the cable colour code as the exceptions. Matches §22 and §20.11.

**17. Logo colours.** Asked: please confirm the logo colours.

Pending — Technonex to supply. Note for resolution: v2.2 uses Rackium blue `#094F9A` while Technonex corporate is navy `#08306B` and red `#D62839`. An explicit ruling is needed on which governs generated documents.

**18. SC section headings.** Asked: please confirm the SC section headings for the documents.

Not answerable from the material in hand — Technonex to supply the SC file. "SC" refers to the client's structured-cabling schedule spreadsheet, which the LLD cable schedule must match column for column. The eleven CMDB import templates now in hand cover the device, port and patch-panel fields, but the SC schedule itself has not been seen and its headings cannot be inferred from them. Treat this as blocked, not partially answered.

**19. Cisco drawings.** Asked: may we use Cisco device drawings or images, or should we use generic ones?

Generic and custom SVG only. Do not ship Cisco artwork. Two reasons: their icon sets are licensed for use in documentation about their products, not for embedding in a commercial platform sold to third parties; and vendor neutrality is a stated Rackium principle, which shipping one vendor's artwork undermines. §20.11 already recommends the custom set as first choice.

**20. Approve v2.3 as final.** Asked: please confirm that the Rackium Brief v2.3 is approved as the final specification.

Not yet. v2.3 is this addendum. Approve it, merge to v3.0, then treat v3.0 as the frozen specification.

### Questions 6 to 10 and 21 to 22 — content and actions owed by Technonex

| # | Item | Owner | Status |
|---|---|---|---|
| 6 | Field help (ⓘ) texts and reference photographs | Technonex | Draft to be generated from the field definitions in v2.2, then reviewed |
| 7 | Device catalogue seed data and images | Technonex | Seed table to be built from public datasheets; images from vendor press kits or own photography |
| 8 | Country power-cord table (plug type per country) | Technonex | Can be produced immediately, no input required |
| 9 | Document branding template | Technonex | Blocked on question 17 |
| 10 | Meaning of role codes FW, R, WC, SV, UP, PD, SN | Developer to confirm source | See note below |
| 21 | Client supplier security questionnaire | Technonex | To be requested before the security hardening pass, so the work targets their actual requirements |
| 22 | GDPR features before go-live | Decided: yes | See the data lifecycle section |

**On question 10.** v2.2's default role codes are FN, BR, DS, EN, AP, FW, WL and SV. The list in the question matches on only FW and SV. The real device data uses prefixes DS, E, BW, FS, A and W, and its Device Role values are `border_node`, `control_plane_node`, `intermediate_node`, `edge_node`, `fusion_device`, `Core switch`, `Distribution switch`, `virtual_firewall` and `Firewall`. Confirm where the FW/R/WC/SV/UP/PD/SN list came from before building anything on it. Regardless of origin, role codes are per-project configuration (§2.2, §20.10) stored in a configuration table and must never be hardcoded.

**On question 22.** Decided yes, and the decision is not discretionary. The client's own data files contain personal data — named user identifiers in Owned by, Site Primary Contact and Site Secondary Contact, alongside GPS coordinates for installed equipment. Export, deletion, anonymisation and retention go in before go-live.

## 3. Core principle: configuration over hardcoding (Addition)

Nothing specific to one client is written into Rackium's code. Every client-specific element is data in a configuration profile, and the first profile ships seeded from the Siemens SD-LAN programme because those are the launch users. That profile is an example of what the engine can express, never the shape of the engine itself.

This is the single most important constraint in this addendum. Rackium is being built as a product, and a platform that needs a code change to onboard the second client is not one. The launch client's conventions are unusually well documented, which makes them an excellent first profile — and an expensive trap if they leak into the schema.

What must be configuration, not code:

| Element | Siemens SD-LAN value (Profile 1) | Generic mechanism |
|---|---|---|
| CI classes exported | 11 classes: IP Router, IP Switch, WLC, Access Point, IP Firewall, Virtual Firewall, Network Accessory, Patch Panel, LAN Port, Restricted VLAN, Static IP | Export profile defines its own class list |
| Target field names | `u_sd_lan_ip_switch_name`, `u_ciuuid`, `u_ru` | Field mapping table: Rackium field → external column, per profile |
| Lifecycle mode states | CMO / IMO / FMO | Three-state field, labels configurable per profile |
| Device roles and codes | FN, BR, DS, EN, AP, FW, WL, SV | Already configurable, §2.2 |
| Naming pattern | `{role}-{country}-{sal}-{campus}-{building}-{floor}-{seq}` | Already configurable, §20.10 |
| Status vocabularies | `on_order`, `pending_install`, `installed`, `retired`; operational status 1 / 2 / 6 | Per-profile value lists with a Rackium-internal canonical status behind them |
| Billing milestones | Hardware / Install / Service execution dates, each with an execution report reference | Configurable milestone set per work type |
| Billing units | RU reference table (RU101, RU201…) | Optional module, enabled per profile |
| External record identity | CIUUID, 34 characters with a class prefix | External ID field, format defined by profile, round-tripped never regenerated |
| Criticality, environment | critical / standard / medium; production / development / test | Per-profile enumerations |

Two rules that follow from this.

First, where a profile defines a vocabulary, Rackium stores its own canonical value and maps outward on export. A device is retired in Rackium's own terms; the profile decides whether that writes as `retired`, `6`, or something else entirely. Mapping at the boundary, never in the core.

Second, an external identifier that Rackium did not create is stored and returned unchanged. CIUUID is the clearest case: these are issued by the client's CMDB, and a round-tripped import that regenerates them silently breaks their asset reconciliation.

A practical note on data quality. The launch client's own files are inconsistent — `edge_node` against `Edge node` against `ACCESS` in the same column, Cisco against CISCO, a misspelled status value repeated down a sheet, and altitude recorded as both `20:97m` and `20.97m`. Rackium's import validation should normalise these on ingest and report what it changed. This is not incidental: it is the most concrete demonstration of what the platform does that a spreadsheet cannot, and it belongs in the first client demonstration.

## 4. Configurable work types and workflow templates (Addition)

Project creation gains a Work Type step, and the selected work type decides which phases, forms, statuses, validations and reports activate. This replaces v2.2's assumption that every project runs the same nine-phase lifecycle. It is the largest gap in v2.2 and the mechanism on which decommissioning, Starlink and every future service depends.

### The two levels

There are two distinct concepts and v2.2 conflates them.

**Workflow Template** is the programme shape — which stages exist and in what order. A project has exactly one. Seven ship as standard:

1. Network Transformation — the existing nine-phase lifecycle (CMO → Survey → HLD → LLD → Solution Package → BOM → Deployment → CMDB → Handover)
2. Network Decommissioning — three stages, specified below
3. Starlink Deployment — eight stages, specified below
4. Wireless Survey & Deployment
5. Structured Cabling
6. Data Centre Migration
7. Custom Workflow — stages assembled by the organisation from the available stage library

**Work Type** is the nature of the work within a project, and a project may carry several. It drives which survey forms, device categories, validations and document templates apply. The standard list:

| Category | Work types |
|---|---|
| Survey | Wireless Site Survey, Wired Network Site Survey, Physical Site Survey Only, Network Audit / CMDB Reconciliation |
| Design | Wireless Network Design, Wired Network Design (HLD/LLD) |
| Installation | Wireless Installation & Commissioning, Wired Installation & Commissioning, Rack & Stack, Structured Cabling Installation, Fibre Installation & Splicing, Patch Panel Termination & Testing, Cable Pathway & Containment |
| Data centre | Data Centre Fit-Out, Server Room Build / Refurbishment, Edge / MDF / IDF Room Setup |
| Decommission | ITAD, Site Decommission, Hardware Removal |
| Adjacent services | CCTV / IP Camera, Access Control, UPS / Power Distribution, Environmental Monitoring, AV / Conference Room, Desktop / Endpoint Rollout, Firewall / Security Appliance |
| Support | Smart Hands / Remote Hands, Break-Fix / IMAC, Cable Certification & Testing |

Plus "+ Add Custom Type", a free-text entry for work the standard list does not cover, stored at organisation level so it is available to later projects.

### Rules

1. Work Type is a multi-select on project creation and editable afterwards, because scope changes mid-project.
2. A survey-only project must not display BOM or Deployment. A decommissioning project must not display HLD or LLD. The template governs navigation, not just labels.
3. Phases excluded by the template are hidden, not disabled — a greyed-out phase that will never be used is noise in the field.
4. Organisations may save a configured template as a preset and reuse it, for example "Full Network Deployment" (all nine phases) or "Survey & Design Only" (CMO through Solution Package).
5. Document templates, validation rules and report sets are bound to the template, so adding a workflow does not require touching the document engine.
6. The existing nine-phase lifecycle becomes Workflow Template 1. Nothing about it changes; it stops being the only option.

### Who can add or drop stages, and at what level

Stages are not fixed once a template is chosen. Three levels of control, with different permissions:

| Level | Who | What they can change | Scope |
|---|---|---|---|
| Template definition | Org Admin | Which stages exist, their order, their names; save as an organisation preset | All future projects using that template |
| Project configuration | PM at project creation, editable later | Mark stages not applicable for this project | One project |
| Site configuration | PM | Mark a stage not applicable for one site | One site |

The site level exists because Starlink needs it — most sites skip design entirely while a few need full HLD and LLD, and forcing every site through every stage would stall the programme.

Stage dependencies are declared, and enforced. Each stage in the library names the stages it consumes. BOM consumes LLD, because the BOM is generated from the LLD. Deployment consumes BOM. Dropping a stage that others depend on must either warn and switch off the dependents, or be refused — never silently leave a downstream stage with no input.

A dropped stage is hidden, not greyed out, and its data is retained rather than deleted, so re-enabling a stage mid-project restores what was already captured.

### The stage library

Templates are assembled from a fixed library of stages. These are the stages that exist; a template is an ordered selection from them, and a Custom Workflow is any valid selection the dependencies allow.

| Stage | Consumes | Used by templates |
|---|---|---|
| Project / Site Intake | — | All |
| CMO Inventory Import | Intake | Transformation, Decommissioning, Data Centre Migration |
| Inventory Validation | CMO Import | Decommissioning, Audit |
| Site Survey | Intake | Transformation, Wireless, Cabling, Starlink, Data Centre |
| Design & Readiness | Survey | Starlink, Wireless |
| HLD | Survey | Transformation, Wireless, Data Centre |
| LLD | HLD | Transformation, Data Centre |
| Solution Package | LLD | Transformation |
| BOM & Approval | LLD or Design & Readiness | Transformation, Starlink, Cabling, Data Centre |
| Stock & Scheduling | BOM | Starlink, Cabling |
| Deployment / Installation | BOM | Transformation, Starlink, Cabling, Data Centre |
| Logical Decommissioning & Reset | Inventory Validation | Decommissioning |
| Physical Deinstallation & Closure | Logical Decommissioning | Decommissioning |
| CMDB | Deployment or Physical Deinstallation | All |
| Handover | CMDB | All |

The Consumes column is the dependency rule referenced above. A stage with no upstream input cannot be enabled; where two inputs are listed with *or*, either satisfies it — which is what lets a Starlink project reach BOM without an LLD.

### What a work type actually changes

Work Type is not a label. Selecting one activates a defined set of forms, validations and documents. The binding for the launch set:

| Work type | Survey form tabs activated | Key validations | Documents produced |
|---|---|---|---|
| Wireless Site Survey | Site access, Room/area, RF environment, Mounting, Power, Existing WLAN | AP coverage gaps, mounting feasibility | Wireless Survey Report |
| Wired Network Site Survey | Site access, Room, Rack, Patch panel, Cable pathway, Power, Environmental | Rack space, port availability, pathway capacity | Physical Site Survey Report |
| Rack & Stack | Rack, Rack elevation, Power, Weight/load, Environmental | RU availability, power budget, weight limit | Rack Build Sheet, Rack Elevation |
| Structured Cabling | Cable pathway, Patch panel, Wall socket, Cable schedule | Length limits, bend radius, pathway fill | Cable Schedule, Test Results |
| Fibre Installation | Fibre route, Splice points, Connector type, Loss budget | Loss budget, connector compatibility | Fibre Test Report |
| ITAD / Site Decommission | Inventory, Reset evidence, Disposition, Rack evidence | Disposition evidence completeness, reset confirmation | Decommissioning Report, Disposition Record |
| Network Audit / CMDB Reconciliation | Inventory, Discrepancy log | Reported versus found variance | Reconciliation Report |
| Physical Site Survey Only | Site access, Room, Rack, Power | Completeness only | Site Survey Report |

The remaining work types listed above reuse these form tabs in different combinations; the binding table is configuration data, maintained in Project Settings, not code. Form tab definitions for work types not in this table are still to be written — see the open items at the end.

### Why this structure rather than extending the nine phases

Adding decommissioning and Starlink as extra phases inside one lifecycle would mean every project carries stages it will never use, and every new service makes the problem worse. Separating programme shape from work nature means a new service is a configuration exercise, not a release.

## 5. Network Decommissioning workflow (Addition)

Three stages, not four. Site and inventory intake is the first action within stage 1, not a stage of its own — it is the "Upload CMO Inventory" step. The approved stages are:

1. **Inventory & Validation** — inventory uploaded, reconciled against what is on site, mismatches resolved, device list approved
2. **Logical Decommissioning & Reset** — each approved device removed from the logical environment, cleared and reset, with evidence
3. **Physical Deinstallation & Closure** — devices removed, disposition recorded, before-and-after rack evidence captured, site closed

A device cannot enter stage 3 until its stage 2 reset is confirmed with complete evidence. A site cannot close until every released device is reconciled.

### Data objects

Reset status and evidence, configuration backup status, management-system removal confirmation, factory-default reset confirmation, physical removal status, before-and-after rack evidence, device disposition type, warehouse or ITAD handover evidence, and the final decommissioning report.

**Disposition values — six, not four:** Pending Decision, Returned to Client Warehouse, Redeployment / Reuse, Return to Supplier, Certified Recycling / ITAD, Secure Destruction. The current design shows only four; Return to Supplier and Secure Destruction are missing.

### Capturing the on-site reset — answering how the engineer's work reaches Rackium

The engineer must never write a separate report. Rackium builds the record from captured evidence, bound to the asset.

The flow: scan the device QR or barcode → Rackium loads asset ID, hostname, model, serial, management IP, rack location, the approved procedure and the required evidence → engineer starts a reset session (device, work order, engineer identity, start time, site, command checklist) → engineer executes the approved vendor- and model-specific procedure → evidence captured → Rackium generates the Logical Decommissioning & Device Reset Record.

Scanning first is what prevents evidence being attached to the wrong switch. The procedure is displayed and not editable by the technician.

Capture method for v1: terminal transcript upload plus photographs. A Rackium-driven terminal and API automation are both deferred. Three conditions apply to the transcript upload, and the first is not negotiable:

1. **Transcripts are sanitised at ingest, and the raw file is never persisted.** A real console session captures SNMP community strings, RADIUS and TACACS shared secrets, local user password hashes, wireless pre-shared keys and certificate material. Without redaction on upload, Rackium becomes a credential store for the client's network — which directly contradicts the rule that no device credentials appear in reports or transcripts. Redact on ingest, compute the integrity hash on the redacted file, discard the original.
2. **Evidence is append-only.** A stored hash alone does not prevent replacement by anyone who can also rewrite the hash. Evidence files are written once, the hash is recorded in the audit log, and neither can be altered by an administrator.
3. **Required evidence is driven by disposition type** — see below.

**What sanitisation must remove.** The redaction runs on ingest, before storage, and matches at minimum:

| Pattern | Example of what it catches |
|---|---|
| `snmp-server community <string>` | SNMP read and write community strings |
| `username <name> (password\|secret) <value>` | Local account credentials and hashes |
| `enable (password\|secret) <value>` | Privileged-mode credentials |
| `(radius\|tacacs)[- ]server key <value>`, `key <value>` | RADIUS and TACACS shared secrets |
| `wpa-psk`, `pre-shared-key`, `key-string` | Wireless pre-shared keys |
| `-----BEGIN (RSA \|EC \|OPENSSH )?PRIVATE KEY-----` to `-----END ...-----` | Private key blocks |
| `-----BEGIN CERTIFICATE-----` to `-----END CERTIFICATE-----` | Embedded certificates |
| `ntp authentication-key`, `crypto isakmp key` | Authentication and VPN keys |
| Lines matching `password`, `secret`, `passphrase`, `psk`, `shared-key` followed by a value | Catch-all for vendor syntax not listed above |

Matched values are replaced with `[REDACTED]`, the line itself is kept so the command remains auditable, and the count of redactions is recorded on the evidence record. The redaction rule set is configurable per profile, because vendor syntax differs, and new patterns can be added without a release.

**Fail closed.** If the redaction pass errors or the file cannot be parsed, the upload is rejected rather than stored unredacted. Treat a transcript that could not be sanitised as evidence that was never captured.

A Rackium-driven terminal is explicitly out of scope, not merely deferred. Executing commands on customer network devices from the browser means Rackium holds or proxies live device credentials. If it is ever built it belongs on a customer-side jump host using the customer's own credential vault, with Rackium receiving only the result. Scope it that way or not at all.

### Factory reset is not data sanitisation

`write erase` and `reload` clears the running configuration. It does not purge flash or NVRAM. That distinction decides what evidence each disposition requires, and treating all dispositions identically is the one thing in this workflow that would fail a client compliance audit.

| Disposition | Sufficient evidence |
|---|---|
| Redeployment / Reuse, Returned to Client Warehouse | Factory-default reset confirmed, post-reset state verified, sanitised transcript |
| Return to Supplier | As above, plus RMA or supplier reference |
| Certified Recycling / ITAD | Purge to a recognised media-sanitisation standard, plus the disposal vendor's certificate of sanitisation, referenced by asset serial |
| Secure Destruction | Certificate of destruction referenced by asset serial, plus photographic evidence |

### Required reset evidence

Device identity confirmed; configuration backup completed or marked not required; management-system removal confirmed; configuration and credentials erased; factory-default reset confirmed; post-reset state verified; sanitised CLI transcript; optional console photograph; engineer, timestamp and confirmation.

### The output is not only a PDF

On stage 3 completion, Rackium generates both the Physical Deinstallation & Asset Disposition Report and the CMDB write-back files for the active integration profile. For Profile 1 that means import files with hardware status set to retired, operational status set to the profile's retired value, and the deactivation timestamp populated.

This matters more than it appears. The client's own import mapping already specifies the rule — if the object exists in the target table with status Installed and the input carries status Retired, write the deactivation date and time. That is precisely what this workflow produces. Generating those files turns the module from a report writer into the system of record for the account, and it is the strongest commercial argument in this addendum.

### Automated console integration

Remains TBD, subject to technical review. Nothing in v1 depends on it.

## 6. Starlink Deployment workflow (Addition)

Workflow Template 3, implemented alongside the LAN pipeline and never mixed into it.

The lifecycle is frozen and absent from v2.2. Eight stages:

1. **Site Intake** — site registered, client programme and region assigned, basic attributes captured
2. **Site Survey** — physical survey including sky visibility, obstruction assessment, mounting location, cable route and power availability
3. **Design & Readiness** — mount type, routing, power and grounding decided; readiness confirmed
4. **HLD / LLD** — where required only; many sites will skip this, and the template must allow the stage to be marked not applicable per site rather than forcing it
5. **BOM & Approval** — equipment and accessories listed, costed, approved
6. **Stock & Scheduling** — equipment allocated from stock, engineer and date scheduled
7. **Installation & Commissioning** — installed, aligned, speed-tested, evidence captured
8. **CMDB & Handover** — asset recorded, documentation issued, site handed over

### What each stage captures

| Stage | Captured data | Evidence required | Exit condition |
|---|---|---|---|
| Site Intake | Site ID, client programme, region, country, address, coordinates, site contact, access constraints, target date | — | Site record created and assigned |
| Site Survey | Sky visibility and obstruction assessment, proposed dish location, mount type, cable route and length, entry point, power source and distance, earthing/grounding point, indoor equipment location | Photographs of mount location, sky view, cable route, power point | Survey submitted and approved |
| Design & Readiness | Confirmed mount type, routing plan, power and grounding plan, structural or landlord permissions, any required works | Readiness checklist complete | Site marked ready to schedule |
| HLD / LLD | Network integration design where the terminal joins an existing LAN | Standard HLD/LLD outputs | Approved, or marked not applicable |
| BOM & Approval | Terminal model, mount kit, cable type and length, PoE injector, surge protection, router, consumables | Costed and approved BOM | BOM approved |
| Stock & Scheduling | Equipment allocation, serial reservation, engineer assignment, scheduled date, access arranged | Stock allocation record | Visit scheduled |
| Installation & Commissioning | Terminal serial, dish orientation and tilt, obstruction scan result, cable length used, grounding confirmed, service activation, speed and latency test results | Photographs: installed dish, mount, cable route, entry point, indoor equipment, speed-test screen | Commissioning checklist complete and tests passed |
| CMDB & Handover | Asset record created, service account linked, documentation issued, client sign-off | Signed handover document | Site closed |

Validations specific to this workflow: obstruction scan result must be recorded before commissioning passes; cable length must be within the terminal's supported maximum; grounding confirmation is mandatory where local regulation requires it; and the installed terminal serial must match the serial reserved at Stock & Scheduling, or the variance must be explained.

### Global map dashboard

The programme view is a map, not a table, because these deployments are geographically dispersed by nature and the question being asked is always "where are we, and where is it stuck".

Displays: client programme, region, country, site, status, next action.

Controls: country and status filters, with map and site list synchronised in both directions — filtering the list redraws the map, selecting on the map scrolls the list.

Status values follow the common Rackium set: Not Started / Review, In Progress / Scheduled, Completed, Blocked.

This dashboard pattern is not Starlink-specific. Build it as a reusable programme-level view bound to a workflow template, so Network Decommissioning gets the same map for its 56 sites without a second implementation.

### Site-level flexibility

Starlink differs from the LAN pipeline in one structural way: sites are numerous, individually small, and highly variable — some need a full design, most need none. The template must therefore support per-site stage applicability, where a stage is marked not applicable for a given site and the site still reaches completion. The LAN pipeline's strict phase dependency would stall the programme.

## 7. Data Protection, Security & Client Control (Addition)

A new client-facing page that lets an authorised client administrator verify Rackium's security posture themselves rather than being told about it. §11 of v2.2 specifies backend controls but no interface. For enterprise clients running supplier assessments, demonstrating security is worth more than asserting it — and this page is what turns a security questionnaire from a week of email into a login.

Visible to: client Org Admin and External Reviewer roles. Read-only except where noted.

| Panel | Contents |
|---|---|
| Hosting & residency | Hosting region, data-residency commitment, failover region |
| Tenant isolation | Isolation model, confirmation that client data is logically separated |
| Encryption | Encryption at rest and in transit, algorithms, key-rotation status |
| Users & roles | Active users, role assignments, scope assignments, last login |
| MFA | MFA status per user, enforcement policy |
| Access activity | Recent access events for this client's data, filterable by user and date |
| Audit log | Filtered view of this client's audit records, with export |
| Retention | Configured retention periods per artefact type, editable by the client where policy allows |
| Subprocessors | Current subprocessor list with purpose and region |
| Data export | Raise and track an export request |
| Deletion | Raise and track a deletion or anonymisation request |
| Security contact | Named contact and reporting channel for security issues |

Two design rules. The page shows only the requesting client's own data — a multi-tenant leak here would be worse than having no page. And export and deletion requests are workflow items with an owner, a status and an SLA, not buttons that fire immediately; a one-click deletion of a live project is a support incident waiting to happen.

## 8. Data lifecycle and retention (Amendment)

"Deletion within 30 days" is not a lifecycle and must be replaced. Every artefact Rackium holds passes through seven defined states, and the specification must say what happens to each artefact type at each one.

The states: Capture → Active Processing → Handover → Retention → Archive → Export → Secure Deletion.

These are concrete platform defaults, not placeholders. They require Technonex sign-off before they are quoted to any client, because they are commercial commitments as much as technical settings. A client may extend any period by contract; none may be reduced below the platform minimum, and audit retention cannot be reduced at all.

| Artefact | Default retention | Minimum | Notes |
|---|---|---|---|
| Project database records (devices, ports, connections, surveys) | 3 years after project close | 1 year | Then archived read-only for 1 year, then deleted |
| Survey and deployment photographs | 2 years after project close | 1 year | Highest-volume artefact; EXIF location stripped on ingest unless the client requires it retained |
| Rack before/after evidence | 3 years after project close | 3 years | Longer than ordinary photographs because it evidences contractual completion |
| CLI logs and reset evidence | 3 years after project close | 3 years | Sanitised only, raw never persisted; supports disposal-chain challenges |
| ITAD and destruction certificates | 7 years | 7 years | Disposal compliance evidence; survives project deletion |
| Generated reports and documents | 3 years after project close | 1 year | Regenerable from source data, so the underlying record matters more than the file |
| Audit records | 7 years | 7 years | Append-only; not deleted when a project is deleted; cannot be shortened by client configuration |
| Backups | 35-day rolling window | 35 days | Deletion from live does not remove data from backup until this window expires |
| Deleted user accounts | Anonymised immediately | — | Account data removed, actions retained against an anonymised identifier for audit integrity |
| Completed projects | Archive at close, delete after 3 years | 1 year | Archived projects are read-only |
| Terminated or cancelled projects | 12 months | 6 months | Shorter, because there is no handover obligation |
| Draft and unsubmitted surveys | 90 days after last edit | 30 days | Prevents indefinite accumulation of abandoned drafts |

**Legal hold.** Any project, site or evidence set can be placed on legal hold, which suspends every deletion rule until released. Hold placement and release are audit events. Without this, a deletion schedule becomes a liability the first time a client is in dispute.

Client-specific retention policies override defaults within bounds the platform enforces — a client may extend retention but not reduce audit retention below the platform minimum.

Two points that need stating plainly in the specification, because they are the ones clients ask about and vague answers fail assessments: deletion from live systems does not immediately remove data from backups, and the backup window must be published; and an anonymised user is not a deleted user, which is the correct behaviour for audit integrity but must be disclosed.

## 9. Security corrections to Section 11 (Amendment)

Six corrections. Each replaces the corresponding text in v2.2.

### Breach notification wording

v2.2 states "breach notification within 72 hours". This is imprecise and, as written, assigns Technonex an obligation that is not ours. Replace with:

> Where Rackium and Technonex act as processor, we inform the controller without undue delay on becoming aware of a personal data breach. The controller determines whether notification to the supervisory authority is required within the applicable 72-hour period.

### Credentials classification

"Passwords" must not be described as stored secret data. Rackium stores:

- Secure password hashes where local authentication is used
- Never recoverable plaintext passwords, under any circumstance
- Encrypted and revocable API tokens
- No device credentials in reports, exports or terminal transcripts — this is what makes transcript sanitisation mandatory in the decommissioning workflow

### Audit log classification

Audit logs are currently classified Internal. They expose customer sites, user actions and infrastructure identifiers, so reclassify as Confidential. The specification must additionally define:

- Audit retention period, longer than project data retention
- Append-only, immutable storage
- Which roles may read audit records, and that this is itself audited
- Export history — who exported audit data and when
- Protection against alteration by administrators, including Technonex administrators

That last point is the one enterprise assessors test. An audit log a platform administrator can edit is not an audit log.

### Key management

"AES-256" alone is insufficient. Add: a managed key service; a defined key-rotation schedule; separation of production and backup keys; restricted key-administration roles; a documented key-revocation procedure; and a secrets vault for application credentials, distinct from the key service.

### File-upload security

Rackium will receive photographs, spreadsheets, PDFs, SVGs and CLI logs — an unusually broad and hostile intake surface. Required controls:

| Control | Applies to |
|---|---|
| Malware scanning | All uploads |
| MIME and extension validation, content-sniffed not trusted | All uploads |
| File-size limits per type | All uploads |
| SVG sanitisation | SVG — these carry executable script and are rendered in-browser |
| EXIF handling, location stripped by default | Photographs |
| Executable upload prevention | All uploads |
| Sensitive-content detection and redaction | CLI logs, transcripts |
| Checksum on store, recorded in the audit log | Evidence files |

SVG deserves specific attention: Rackium both accepts and generates SVG, and an unsanitised SVG rendered in another user's browser is a stored cross-site scripting vector.

### Evidence integrity

Evidence files are append-only. Checksums are computed on store and recorded in the audit log, not only alongside the file, so that replacing a file and its checksum together is still detectable.

## 10. Certification and assurance roadmap (Addition)

A focused assurance stack is a stronger trust signal than a long list of unrelated certificates. This matters for the enterprise accounts Rackium is aimed at, where procurement asks what you hold before it asks what you do. It affects engineering directly: several of these certifications require controls that are cheap to build now and expensive to retrofit.

### Priority order

| # | Standard | Status | Why |
|---|---|---|---|
| 1 | ISO/IEC 27001 | Essential | Rackium processes sensitive infrastructure data — site, room, rack and device records, topology and port mappings, asset identifiers, photographs, approval evidence, and user and technician information |
| 2 | ISO 9001 | Strongly recommended | Demonstrates controlled software and service delivery: requirements and change management, development and release controls, testing, incident and corrective action, continual improvement |
| 3 | ISO/IEC 27701 | Recommended | Extends 27001 into privacy management — user and technician data, contact details, site photographs containing people, access records, retention and deletion, controller/processor/subprocessor roles. Complements GDPR, does not replace it |
| 4 | Independent penetration test | Essential evidence | Not a certification, but likely to be valued alongside 27001 |
| 5 | BSI C5 | Consider later | High-value German cloud assurance; substantially more demanding and expensive, and should follow 27001 rather than replace it |
| 6 | SOC 2 Type II | For international clients | An attestation report, not an ISO certification; Type II assesses whether controls operated effectively over a period. Lower priority than 27001 and C5 for a Germany-focused engagement |
| 7 | ISO 22301 | When clients depend on availability | Business continuity — disruption response, backup and recovery, recovery objectives, crisis responsibilities, continuity testing |
| 8 | ISO/IEC 42001 | Later, for NexAI | AI management — risk assessment, data and model governance, human validation, performance monitoring, explainability, controlled change. Pursue once the AI features are mature and customer-facing; not ahead of 27001, 9001 or privacy assurance |

**Scope matters more than the badge.** The ISO/IEC 27001 scope should explicitly read: design, development, hosting, operation, support and security management of the Rackium infrastructure-lifecycle platform. A generic office-only scope provides far less confidence and will be read as such by an assessor.

### Penetration test coverage

Web application and API security; authentication and authorisation; tenant and customer data separation; file and photograph uploads; session and access-token management; common OWASP vulnerabilities; privilege escalation; data export and deletion; cloud configuration.

Provide customers with an executive summary and formal remediation confirmation — not the unrestricted technical report.

### Phasing

| Phase | Target |
|---|---|
| Immediate | ISO/IEC 27001, ISO 9001, GDPR governance pack, independent penetration test |
| Next | ISO/IEC 27701, ISO 22301 |
| Enterprise cloud maturity | BSI C5 or SOC 2 Type II, depending on customer geography |
| AI maturity | ISO/IEC 42001 |
| Field-service programme | ISO 14001, ISO 45001 |

### Two clarifications

**Field-service certifications are separate.** ISO 45001 (technician health and safety), ISO 14001 (environmental management, relevant to ITAD and waste operations) and ISO 22301 at organisational level support Technonex's onsite delivery capability. They do not establish Rackium's software security and should not be presented as if they do.

**IEC is not a separate certification.** In names such as ISO/IEC 27001, ISO and IEC jointly developed the standard. The correct reference is the complete standard name.

### What this means for the build

Several controls specified elsewhere in this addendum exist because these certifications will require them: append-only audit storage, key rotation and separation, tenant isolation evidence, retention and deletion mechanisms, access logging, and the Data Protection & Client Control page. Building them now is materially cheaper than retrofitting them during an audit.

Before certification scope is frozen, obtain the client's supplier-security questionnaire and contractual control requirements, and design the scope to answer those directly rather than accumulating logos. This is the same request already listed as an open item.

## 11. Resolved scope contradictions (Amendment)

Four places where v2.2 contradicts itself. Each is now decided; the losing position is struck from the brief at v3.0.

### Offline capability — decided: online-only with saved drafts for MVP

v2.2 says native offline PWA capability is out of scope and localStorage is sufficient, then elsewhere requires offline survey execution with synchronisation and conflict resolution. Both cannot stand.

**Decision:** MVP is online-only with server-saved drafts and resilient auto-save.

localStorage is explicitly rejected as the mechanism for field surveys: it is unencrypted, size-limited, silently cleared by the browser, and these surveys carry photographs and confidential infrastructure data.

Controlled offline mode is a defined phase-2 feature, not an aspiration. When built it requires IndexedDB, an encrypted local cache, a sync queue, conflict management, and automatic local deletion once synchronisation completes. Specifying it now prevents the architecture foreclosing it.

This needs a frank conversation with the client: some sites have no usable connectivity, and online-only genuinely constrains where engineers can work. The honest MVP position is that surveys need connectivity, with offline following in phase 2.

### Third-party integrations — decided: four tiers

v2.2 excludes third-party APIs, then expects CMDB import, inventory synchronisation, CMDB export, SSO and catalogue synchronisation. Separate them:

| Tier | Scope | Phase |
|---|---|---|
| File-based import and export | CMDB import files, BOM export, cable schedules, catalogue import | MVP |
| Identity integration | SSO and SAML | MVP for enterprise clients |
| Live CMDB and API synchronisation | Direct read/write against a client CMDB | Later phase |
| Device reset and configuration push | Automated console or controller integration | Technical-review backlog |
| Monitoring and configuration management | Pushing config to live devices | Out of scope |

The first tier is what the launch account actually needs — their integration is a file exchange, not an API.

### Floor plans — decided: attachment in MVP, overlay later

v2.2 lists floor-plan upload as out of scope while §20.7 defines floor-plan attachment with rough AP and endpoint positioning. §20.7 wins. MVP includes upload of a PDF or image per floor, display alongside the HLD canvas, and rough positioning of APs and endpoints. Interactive overlay mapping, coordinate-accurate placement and heatmaps remain future scope. Strike the out-of-scope line.

### Concurrency — decided: save-time conflict check only

Covered in the answer to question 2. Presence awareness and live change-tracking are dropped. §4.2.2 to §4.2.4's soft-locking model with 30 and 60 second timeouts is replaced by a version check on save. Port assignments remain atomic and there is still no automatic merge, which §4.2.3 already states correctly.

## 12. Non-functional requirements (Addition)

v2.2 has no measurable thresholds, so no one can say whether Rackium is ready. These are the figures to design and test against.

Where these numbers come from, so they can be challenged properly. The volume figures marked derived are calculated from the client's actual import files and should be treated as firm. Everything marked proposed is a reasonable industry default that requires Technonex sign-off before it is quoted to a client or written into a contract — particularly availability and the support model, which become commitments the moment they leave this document.

### Volume

The volume driver is ports, not devices. This is the figure most likely to be got wrong. The client's LAN Port import file carries one row per physical port with VLAN, speed, status and description fields. A single 48-port access switch is 48 rows; a few hundred switches across a programme is several hundred thousand port records before any connection, evidence or audit row exists. Size the schema, the indexes and the CMDB queries against that, not against an 18-device demonstration site.

| Dimension | Target |
|---|---|
| Concurrent users per organisation | 50 |
| Concurrent users platform-wide | 500 |
| Projects per organisation | 500 |
| Sites per project | 1,000 |
| Devices per site | 2,000 |
| Ports per project | 500,000 |
| Connections per building | 10,000 |
| Photographs per site | 1,000 |
| Maximum photograph size | 25 MB |
| Maximum import file size | 50 MB |
| Maximum floor-plan file | 50 MB |

The port figure is derived from the client's LAN Port import file and is firm. The rest are proposed working limits for sizing, to be confirmed against the first real programme.

### Performance

| Operation | Target |
|---|---|
| Page load, interactive | < 2 s at p95 |
| API read response | < 500 ms at p95 |
| API write response | < 1 s at p95 |
| HLD canvas interaction (pan, zoom, drag) | 60 fps at 500 objects on canvas |
| CMDB query across a 500,000-port project | < 3 s at p95 |
| Import of a 10,000-row file | < 60 s, asynchronous with progress |
| Document generation, 100-page PDF | < 30 s, asynchronous |

The canvas and CMDB query targets are derived from the volumes above. The remainder are proposed.

### Availability and operations

| Requirement | Target | Basis |
|---|---|---|
| Availability | 99.5% monthly, excluding announced maintenance | Proposed — needs sign-off |
| Recovery point objective | 24 hours | Proposed — needs sign-off |
| Recovery time objective | 8 hours | Proposed — needs sign-off |
| Backup restoration testing | Quarterly, documented, results retained | Proposed |
| Monitoring and alerting | Uptime, error rate, queue depth, storage headroom, failed logins | Proposed |
| Operational log retention | 90 days minimum, separate from audit retention | Proposed |

### Client environment support

Chrome, Edge and Safari, current and one previous major version. Firefox current version. Tablet support for iPad and Android at 10 inches and above for survey and deployment modules; phone support is not a target. Accessibility target WCAG 2.1 AA for the core workflow screens.

### Release and environments

Three environments: development, staging and production, with staging matching production configuration. Database migrations are versioned and reversible. Every release has a documented rollback path. Test environments use generated or anonymised data — client production data is never copied into a test environment, which matters particularly here given what the import files contain.

### Support model

| Severity | Definition | Response | Resolution target |
|---|---|---|---|
| S1 | Platform unavailable, or data loss | 1 hour | 4 hours |
| S2 | Major function unavailable, no workaround | 4 hours | 1 business day |
| S3 | Function impaired, workaround exists | 1 business day | 5 business days |
| S4 | Minor issue or cosmetic | 2 business days | Next release |

## 13. Integration Profile 1 — SD-LAN CMDB contract (Addition)

Eleven import templates define the launch client's CMDB contract, and they are now in hand. Each carries four sheets: Template (columns and permitted values), Example (real site data), Explaination (target field names, types, reference tables, custom versus out-of-box) and Mapping (transformation logic and mandatory flags). This is the exact specification Rackium's import and export must satisfy — and, per the configuration principle, it is seeded as Profile 1 rather than built into the schema.

### The eleven CI classes

IP Router, IP Switch, Wireless LAN Controller, Wireless Access Point, IP Firewall, Virtual Firewall Server, Network Accessory, Patch Panel, LAN Port, Restricted VLAN, Static IP.

### What the contract requires that v2.2 does not have

| Requirement | Detail | Status in v2.2 |
|---|---|---|
| Three-stage execution milestones | Hardware, Install and Service execution dates, each with its own execution report reference | Missing — only "installed" is modelled |
| Execution report reference | Reference to an execution report record; the billing trigger | Missing |
| Billing unit ("RU") | Reference to a service-catalogue unit, distinct from rack unit | Missing, and currently conflated with rack unit |
| External CI identifier | 34-character identifier with a class prefix, issued by the client CMDB | Missing |
| Interim mode state | IMO records distinct from CMO and FMO | Missing |
| Site identifier format | Country-SAL-campus-building-floor-rack, as a reference | Partially — hierarchy exists, the composed identifier does not |
| Device geolocation | Latitude, longitude and altitude per device | Missing |
| Operational versus hardware status | Two separate status fields with different vocabularies | Partially |
| Port-level attributes | Interface type, bandwidth, speed, VoIP flag, restricted-VLAN flag, port status, vendor port name, customer port name | Partially |

The three-stage milestone model is the most commercially significant gap. Technonex is paid against execution reports, and Rackium currently has no concept of them. Deployment must capture hardware delivery, physical installation and service activation as distinct events, each with its own date and report reference.

The billing-unit confusion must be fixed before the schema is written. In the client's model these are two different things: a service-catalogue billing unit, and the physical position in the rack. v2.2 has one field. Split them.

### Naming confirmed

Real device names follow `{role}-{country}-{SAL}-{campus}-{building}-{floor}-{sequence}`, which matches §20.10 exactly. Observed role prefixes are DS, E, BW, FS, A and W. Legacy-format names appear in the same files alongside converted ones, which is the evidence behind the `legacy_hostname` decision above.

### Reference data available for seeding

Device models present in the sample data, usable as initial catalogue seed: C8355-G2, C9300-24UX-A, C9500-24Y4C, C9600X-LC-32CD, CW9300-24T-A, CW9164I, CW9167, CW91647/-E, FPR1150-NGFW-K9, C9500-NM-8X.

### Handling note

These files contain live client values — serial numbers, management IP addresses, equipment coordinates and named user identifiers. They are reference material for building the profile and must not be loaded into any Rackium test or demonstration environment, per the test-data rule above. Build the profile from the column definitions; generate synthetic rows for testing.

## 14. Updated data entities (Amendment)

v2.2 defines 17 entity schemas. This addendum adds nine and amends six.

### New entities

| Entity | Purpose | Key fields |
|---|---|---|
| WorkflowTemplate | Programme shape | name, stage list, stage order, preset flag, organisation scope |
| WorkType | Nature of work within a project | name, category, custom flag, linked forms, linked validations, organisation scope |
| IntegrationProfile | Per-client external contract | name, client, CI class list, field mappings, value mappings, identifier format |
| ExecutionReport | Billing milestone record | report number, type (hardware/install/service), date, site, devices covered, status |
| BillingUnit | Service-catalogue unit | code, description, rate reference, applicable CI classes |
| DecommissionSession | One device's reset session | device, work order, engineer, start time, procedure reference, checklist state, status |
| ResetEvidence | Captured reset proof | session, type, sanitised file reference, checksum, captured by, captured at |
| DispositionRecord | What happened to a removed device | device, disposition type, evidence set, certificate reference, warehouse or vendor reference |
| RackEvidence | Before and after rack imagery | rack, view (front/rear), phase (before/after), image reference, captured by, captured at |

### Amended entities

| Entity | Change |
|---|---|
| Project | Add workflow template reference, work type list, integration profile reference |
| Device | Add `mode_state` (CMO/IMO/FMO), `legacy_hostname` (immutable), external CI identifier, latitude, longitude, altitude, billing unit reference, separate operational and hardware status |
| Port | Add interface type, bandwidth, speed, VoIP flag, restricted-VLAN reference and flag, port status, vendor port name, customer port name, record version for the save-time conflict check |
| Connection | Add `mode_state`, archived flag with reason, superseded-by reference |
| Rack | Add composed site identifier, rack position, adjacent rack reference |
| User | Add anonymised flag and anonymised-at date, for the retention model |

### Two schema notes

**Record version on Port.** The save-time conflict check needs a version or updated-at column on the port record, compared on write. This is the entire implementation of the concurrency decision — one column and one comparison.

**`mode_state` belongs on both Device and Connection.** An interim migration state has its own temporary cabling, not only temporary devices. A model that tracks mode on devices alone cannot represent a cutover where equipment stays and patching changes, which is the common case.

## 15. Revised development priorities (Amendment)

Two things must land before anything else, because everything else sits on them.

### Before any further module work

1. **Work type and workflow template engine.** Until this exists, every new service is hardcoded, and both decommissioning and Starlink are blocked behind it.
2. **Schema corrections.** `mode_state` across Device and Connection; `legacy_hostname`; the billing-unit and rack-unit split; external CI identifier; the three-stage execution milestones; the port record version. These are cheap now and expensive after data exists.

### Then, in order

3. Integration Profile engine, with Profile 1 seeded from the eleven templates
4. Network Decommissioning workflow, including sanitised evidence capture and CMDB write-back
5. Save-time conflict check on ports
6. External Reviewer role and the price-masking rules
7. Data Protection, Security & Client Control page
8. Data lifecycle, retention and legal hold
9. Security corrections — audit immutability, key management, file-upload controls
10. Starlink Deployment workflow and the reusable programme map
11. Remaining v2.2 gaps as re-confirmed by the audit against v3.0

### What is deliberately not being built

Presence awareness and live collaborative editing. A Rackium-driven terminal against customer devices. Offline survey execution in MVP. Live CMDB API synchronisation. Configuration push to network devices. Phone-sized responsive layouts.

### Open items owed back

| Item | Owner | Needed by |
|---|---|---|
| Logo colours, and whether Rackium blue or Technonex corporate governs generated documents | Technonex | Before the document engine is branded |
| Source of the FW/R/WC/SV/UP/PD/SN role code list | Developer | Before role seed data is written |
| The SC schedule file itself | Technonex | Before the LLD export is finalised |
| Client supplier security questionnaire | Technonex | Before the security hardening pass |
| Field help texts, catalogue seed, power-cord table | Technonex | Before first client demonstration |

### Decision requested

Approve this addendum as v2.3. On approval it merges into a clean v3.0 baseline, and a fresh frontend audit is commissioned against v3.0 rather than against the October prototype.

## 16. Glossary — terms used in this document (Addition)

Every term below appears somewhere in this addendum or in v2.2. The third column is the one that matters: why Rackium needs it. A definition without that is not enough to build from.

### Project lifecycle

| Term | What it is | Why it matters here |
|---|---|---|
| CMO — Current Mode of Operation | The network as it exists today, before any change | The starting inventory. Imported at the beginning of a project and used to validate what engineers actually find on site |
| IMO — Interim Mode of Operation | The temporary state during migration — temporary switches, temporary patching, temporary VLANs that exist only between cutover steps | A third state the data model must carry. A device can exist only in IMO: installed for the cutover, removed afterwards. Missing from v2.2 |
| FMO — Future Mode of Operation | The target design, how the network will look when finished | What the HLD and LLD describe, and what Deployment builds |
| HLD — High Level Design | The topology drawing: which devices exist, where they sit, what connects to what | Produced on a canvas. Drives everything downstream — LLD, BOM, deployment and CMDB all derive from it |
| LLD — Low Level Design | The detail under the HLD: exact ports, exact cables, exact lengths, exact patch-panel positions | The deliverable the installing engineer actually works from |
| BOM — Bill of Materials | The priced list of everything to be bought for the project | Generated from the LLD. Where the commercial margin lives, which is why price visibility is role-restricted |
| Solution Package | The bundle sent to the client for approval — design, BOM summary, assumptions | The commercial approval gate before procurement begins |
| Handover | Final documentation pack issued to the client at project close | Triggers final billing and starts the retention clock |
| SOW — Scope of Work | In Rackium, the type of work a project covers (wireless survey, rack and stack, ITAD…) | Not geographic scope. This was the largest gap in v2.2 and became the Work Type selector |
| Blocker | Anything stopping a phase from progressing | Tracked as a first-class record with an owner, not a comment |
| SLA — Service Level Agreement | A contractual deadline with consequences for missing it | Rackium tracks these, warns before breach and escalates after |

### Physical infrastructure

| Term | What it is | Why it matters here |
|---|---|---|
| Rack | The metal cabinet holding network equipment | The physical container everything is located against |
| RU — Rack Unit | The standard vertical measurement of rack space, 44.45mm. A switch might be 1RU, a server 2RU | Used to work out whether equipment physically fits |
| RU — the client's billing unit | A different thing with the same abbreviation. A service-catalogue unit used for invoicing | v2.2 conflates these two. They must be separate fields. This is the single most likely schema mistake in the project |
| Rack elevation | A front-and-rear drawing of a rack showing what is mounted at each RU position | How engineers know where to physically install each device |
| Patch panel | A passive panel of ports that terminates permanent cabling, so equipment is patched to it with short leads rather than rewired | Every structured cabling job centres on these. Has its own CI class in the client's CMDB |
| Wall socket / outlet | The network port in the wall at the user end of a cable run | The far end of the cable the patch panel terminates |
| MDF / IDF | Main and Intermediate Distribution Frame — the main comms room and the satellite comms rooms it feeds | Defines the building's cabling hierarchy and therefore cable lengths |
| Uplink | The connection from a smaller switch up to a larger one | Design tools exist specifically to create, break and reroute these |
| SM / MM fibre | Single-mode and multi-mode optical fibre. Single-mode runs further, multi-mode is cheaper over short distances | Determines cable and optic selection, and they are drawn in different colours |
| SFP / optic | The removable transceiver module plugged into a switch port to take a fibre or copper cable | Priced separately in the BOM and frequently forgotten in manual processes |
| DAC / Twinax | Direct Attach Copper — a short fixed cable with transceivers moulded on each end | Cheaper than optics for in-rack links; a distinct media type |
| Stack cable | A proprietary cable joining switches so they behave as one logical switch | A distinct media type with its own drawing style |
| PoE — Power over Ethernet | Power delivered over the data cable, so an access point needs no separate power supply | Drives power budget validation on switches |
| Cable ID | The printed label identifying a physical cable run | Printed from Rackium. If a device is renamed after labels are printed, the labels must be reprinted — hence the reprint task |
| Cable schedule / cable matrix | The table of every cable run: both endpoints, type, length, label | The core LLD deliverable, and what the client's SC spreadsheet holds |

### Logical network

| Term | What it is | Why it matters here |
|---|---|---|
| VLAN | A logical network segment carved out of physical switches, so devices on the same switch can be on separate networks | Assigned per port. Recorded in the LLD and exported to the client CMDB |
| Subnet | The IP address range used by a VLAN | Paired with a VLAN and a gateway |
| Gateway | The router address devices use to reach other networks | One per subnet |
| Trunk vs access port | A trunk carries many VLANs between switches; an access port carries one, for an end device | Different line styles on the logical view, and different port configuration |
| Port channel / LAG | Several physical links bonded into one logical link for capacity and resilience | Maps to specific physical ports, so the physical and logical records must agree |
| VRF | Virtual Routing and Forwarding — separate routing tables on one device, keeping networks fully isolated | Deferred from v1. Confirmed as absent from the launch client's import contract |
| Restricted VLAN | A VLAN with constrained access, used for unknown or quarantined devices | Has its own CI class in the client's CMDB, carrying ACL path, DNS, DHCP and authentication flags |
| WLC — Wireless LAN Controller | The appliance that centrally manages wireless access points | Its own CI class; access points reference the controllers they belong to |
| Device role | What a device does in the architecture — Fusion, Border, Distribution, Edge Node, Access Point | Configurable per project. Drives naming, validation rules and expected uplinks |

### Decommissioning and disposal

| Term | What it is | Why it matters here |
|---|---|---|
| Decommissioning | Removing equipment from service: clearing it logically, then removing it physically | A full workflow template, not a phase |
| Logical decommissioning | Removing a device from the network — monitoring systems, controllers, services, configuration, credentials | Must happen before physical removal, or you pull a live device |
| Factory-default reset | Returning a device to its shipped configuration, typically `write erase` plus `reload` | Sufficient for reuse. Not sufficient for disposal — see purge |
| Purge / media sanitisation | Rendering stored data unrecoverable, to a recognised standard such as NIST SP 800-88 | Required before a device leaves client control for recycling or destruction. The distinction from factory reset is the compliance crux of this workflow |
| ITAD — IT Asset Disposition | The regulated process of disposing of retired IT equipment | A work type and a disposition value. Requires a certificate from the disposal vendor |
| Disposition | What happens to a device after removal — reuse, return, recycle, destroy | Drives which evidence is mandatory. Six values, not four |
| Chain of custody | The documented trail of who held an asset and when, from removal to final disposal | What the evidence, timestamps and certificates collectively produce |
| DGUV | German statutory electrical safety inspection, mandatory for workplace electrical equipment | Tracked per device with inspection dates and certificates. Warns at deployment if missing |
| Reset session | One device's controlled reset, bound to an engineer, a time and a procedure | The container for the evidence that proves the reset happened |
| Rack evidence | Photographs of a rack front and rear, before and after work | Proves contractual completion and protects against later damage claims |

### CMDB and integration

| Term | What it is | Why it matters here |
|---|---|---|
| CMDB — Configuration Management Database | The client's master inventory of IT assets and their relationships | Rackium both reads from it at project start and writes back to it at close |
| CI — Configuration Item | One record in a CMDB: a switch, a port, a patch panel | Each CI type has its own fields and its own import file |
| CI class | The type of a CI — IP Switch, LAN Port, Patch Panel | Eleven classes in the launch client's contract. Must be configurable, not hardcoded |
| CIUUID | The client CMDB's own unique identifier for a record, 34 characters with a class prefix | Issued by them, not by us. Must be stored and returned unchanged, never regenerated |
| SD-LAN | The client's programme name for their software-defined LAN estate | Appears throughout their field names. A client label, not a Rackium concept |
| SAL code | A site or location code in the client's hierarchy | Part of the device naming pattern and the project scope boundary |
| Site identifier | The composed location string, country-SAL-campus-building-floor-rack | A single reference field in their CMDB; Rackium holds the parts separately and must compose it on export |
| EXEREP / Execution Report | The client's record that a piece of work was performed, referenced by number | The billing trigger. Three per device — hardware, install and service. Entirely missing from v2.2 |
| Integration profile | The per-client definition of CI classes, field names, value vocabularies and identifier formats | The mechanism that keeps client specifics out of the code |
| OOB vs Custom field | Out-of-box fields ship with the CMDB platform; custom fields were added by the client, prefixed `u_` | Tells you which fields are standard and which are specific to this client |

### Security, privacy and compliance

| Term | What it is | Why it matters here |
|---|---|---|
| Controller vs processor | Under GDPR, the controller decides why data is processed; the processor acts on their instructions | Technonex is usually the processor. This changes who must notify a breach, and to whom |
| Subprocessor | A third party the processor uses — hosting, storage, email | Must be disclosed to clients, which is why the Client Control page lists them |
| Legal hold | A freeze on deletion because data may be needed for a dispute or investigation | Must override every retention rule, or the deletion schedule becomes a liability |
| Append-only / immutable | Records can be added but never changed or removed, including by administrators | What makes an audit log trustworthy. An audit log an admin can edit is not one |
| Tenant isolation | Keeping each client's data strictly separated in a shared platform | The first thing an enterprise security assessment tests |
| Key rotation | Replacing encryption keys periodically so a compromised key has a limited window | "AES-256" alone says nothing about this |
| Secrets vault | A dedicated store for application credentials, separate from the codebase and the database | Prevents credentials in config files or source control |
| Stored XSS | A script saved by one user and executed in another user's browser | The specific risk of accepting SVG uploads and rendering them without sanitisation |
| EXIF | Metadata embedded in photographs, often including GPS coordinates | Survey photographs can silently disclose site locations; stripped by default |
| SSO / SAML | Single Sign-On — users authenticate through their employer's identity system rather than a Rackium password | Usually mandatory for enterprise clients |
| MFA | Multi-factor authentication | Mandatory for Owner and Architect roles |

### Platform and engineering

| Term | What it is | Why it matters here |
|---|---|---|
| OWASP | A widely used catalogue of common web application vulnerabilities | The baseline a penetration test is measured against |
| Hash / checksum | A fingerprint of a file; any change to the file changes the fingerprint | Proves evidence has not been altered — provided the hash is stored where it cannot be rewritten |
| Anonymisation | Removing the link between data and a person, without deleting the data | How a deleted user's past actions stay in the audit trail legitimately |
| Workflow template | The programme shape — which stages exist and in what order | One per project. The master switch for what the user sees |
| Work type | The nature of the work — survey, installation, rack and stack, ITAD | Several per project. Decides which forms, validations and documents apply |
| Optimistic concurrency | Letting two people edit freely, then rejecting the second save if the record changed underneath | The agreed concurrency approach. Cheap, and prevents silent overwrites without any real-time machinery |
| PWA | Progressive Web App — a web app that can install and work offline | Deferred to phase 2 for field surveys |
| localStorage vs IndexedDB | Two browser storage mechanisms. localStorage is small, unencrypted and easily cleared; IndexedDB is larger and more durable | Why localStorage was rejected for offline surveys carrying photographs and client data |
| p95 | The 95th percentile — the value 95% of requests come in under | A fairer performance target than an average, which hides the slow cases |
| RPO / RTO | Recovery Point Objective (how much data you can afford to lose) and Recovery Time Objective (how long you can be down) | The two numbers that define what backup and failover must achieve |
| Scope-based access | Restricting a user to part of a project — one building, one country | Already in v2.2. An engineer assigned to one building sees only that building |
