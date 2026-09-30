# Rackium — Developer Brief

**Version:** 2.2 (Final)  
**Date:** 2026-09-28  
**Author:** Technonex GmbH — Product & Engineering  
**Status:** Complete Developer Specification  
**Classification:** Confidential — Internal + Approved Development Partners

---

## Document Change Log

| Version | Date | Changes |
|---|---|---|
| 2.0 | 2026-09-22 | Initial comprehensive developer brief |
| 2.1 | 2026-09-24 | Technical corrections, survey sub-forms, catalogue UX, auto cable length, iconography, security, complementary fields |
| 2.2 | 2026-09-28 | Solution Package phase, DGUV tracking, configurable device naming, blueprint templates, logical topology objects, concurrency control, Cable ID update, project management suite, canvas UX parity, Rackium Editor definition, port mapping workflow, visual standards, NexAI smart features, deployment states, CMDB Port Connectivity, professional cable routing, product principles, UI/UX design system, validation rule IDs, acceptance test scenarios |

---

## Executive Summary

**Rackium** is a browser-based infrastructure lifecycle platform that replaces the fragmented Excel + Visio + WhatsApp workflow used by network infrastructure teams. It covers the complete project lifecycle from physical site survey through high-level design (HLD), low-level design (LLD), solution packaging, bill of materials (BOM), deployment, configuration management (CMDB), and formal handover — in one connected application.

The platform manages **nine connected phases** through a single data model. A device placed during HLD carries its identity through LLD port assignments, solution packaging, BOM procurement, field deployment, and into the final CMDB record. A cable connection drawn between two ports creates one record that feeds every downstream output — cable schedule, BOM line item, deployment checklist, and CMDB entry. No re-entry. No version mismatch. No WhatsApp photos.

**Phase pipeline:**

```
CMO Inventory Validation → Physical Site Survey → HLD → LLD → Solution Package → BOM → Deployment & Installation → CMDB → Handover
```

The target user is a network architect or field engineer working on enterprise LAN rollouts (SD-LAN, campus networks, data centres). The primary client workflow being replaced is the Siemens SD-LAN delivery process — but Rackium is designed as a universal platform for any enterprise infrastructure project, not a single-client tool.

**NexAI** is the marketing label for Rackium's built-in smart platform features — cable-length calculation, validation, design reconciliation, BOM analysis, deployment deviation detection, and CMDB reconciliation. These are not separate AI modules but integrated platform intelligence that assists, suggests, and validates while keeping human authority over all decisions.

---

## Product Principles

The following principles are part of the Rackium baseline and must be applied across every module:

| Principle | Behaviour |
|---|---|
| **Persistent context** | Building, floor, room and rack context remains visible. Inactive or locked context is faded grey; the current selection remains active and identifiable. |
| **Progressive disclosure** | The interface moves from site context to room, rack, RU, device, port and connection details without replacing the user's navigational context. |
| **Data-connected graphics** | A graphical object represents structured data. Editing a device, port, cable or RU updates connected project records rather than only changing a drawing. |
| **Single connection record** | The same physical connection record feeds LLD, installation, cable register, CMDB and handover data. |
| **Plan versus actual** | Approved design remains the baseline; installation and CMDB show actual state, accepted deviations and validation results. |
| **Human authority** | NexAI can suggest and validate, but approval, accepted deviations and final acceptance remain controlled human decisions. |

---

## Fixed Visual and Interaction Standards

These visual rules are locked and must be enforced across every page, module, and component:

| Element | Locked Rule |
|---|---|
| **Text** | All active headings, labels, values, descriptions and button text are **black**. |
| **Rackium blue (#094F9A)** | Used for thin icons, outlines, active navigation, selected objects and connection graphics; **not** for general body text. |
| **Green** | Completed, accepted, operational or Ready status only. |
| **Amber** | Pending, warning or validation-required status only. |
| **Red** | Errors, conflicts, deviations or OM4 link representation where the established media legend requires it. |
| **Grey** | Locked, inactive, unavailable, planned-but-not-live or contextual background elements. |
| **Canvas** | White or off-white, restrained enterprise interface with thin strokes and minimal visual density. |
| **Rack numbering** | 42RU elevation must show RU42 at the top and RU1 at the bottom. Rack units must not deform to fit text. |
| **Port drawings** | Authoritative device and patch-panel drawings must retain correct port numbering and must not be regenerated approximately. |

---

## 1. What Rackium Is

**One sentence:** Rackium is a browser-based platform where network architects design infrastructure and field engineers build it — survey to handover, one connected data model, zero Excel.

**What it replaces:**

| Current tool | Rackium replacement |
|---|---|
| Excel SC spreadsheet | LLD port/cable schedule (auto-generated, always current) |
| Visio topology diagrams | HLD interactive canvas (data-connected, not just shapes) |
| WhatsApp photo sharing | In-app survey photos with GPS, annotation, and auto-organisation |
| Email-based approvals | In-platform approval workflows with audit trail |
| Manual cable matrices | Auto-generated cable matrix from design data |
| PDF rack elevation drawings | Interactive rack elevations with port-level click-through |
| Separate BOM tracking | Auto-generated BOM with procurement status tracking |
| Post-project CMDB creation | CMDB auto-populated from deployment records |
| Physical survey paper forms | Mobile-first digital survey with offline capability |

**What it is NOT:**

- Not a network monitoring tool (no SNMP polling, no live traffic)
- Not a configuration management tool (no config push to devices)
- Not a replacement for Ekahau (no RF heatmaps — future scope)
- Not a free-form diagramming tool (every graphical object represents structured data)

---

## 2. Data Model

### 2.1 Project Hierarchy

```
Organisation (Technonex GmbH)
└── Project ("LANSpire" — the client engagement)
    ├── Country (Germany)
    │   └── SAL Code (ERL — Erlangen region)
    │       └── Campus (C01 — Erlangen HQ Campus)
    │           ├── Building (B001 — Administration)
    │           │   ├── Floor (F00 — Ground)
    │           │   │   └── Room (TR-01 — Telecom Room)
    │           │   │       ├── Rack (R01 — 42U)
    │           │   │       │   ├── Device (Switch — RU 36-37)
    │           │   │       │   │   └── Port (Gi1/0/1)
    │           │   │       │   ├── Patch Panel (PP-01 — RU 42)
    │           │   │       │   └── PDU (PDU-A)
    │           │   │       └── Rack (R02 — 42U)
    │           │   ├── Floor (F01)
    │           │   └── Floor (F02)
    │           ├── Building (B002 — Production)
    │           └── Building (B003 — Warehouse)
    └── Country (UK)
        └── SAL Code (LON)
            └── Campus (C01)
                └── Building (B001)
```

**SAL code = project scope.** Every device, connection, and design decision exists within a SAL code. The SAL code is the operational boundary.

**Everything below "Room" is queryable:** every rack, every device in that rack, every port on that device, every cable connected to that port. This is the core data model that makes Rackium a cable management platform, not just a drawing tool.

### 2.2 Device Roles (Configurable Per Project)

Device roles define the function of a device in the network architecture. The system ships with a default set that the user can rename, reorder, add to, or remove from. Role labels are free-text — the system does not impose "Fusion" or "Border" terminology.

**Default device roles (user-configurable):**

| Default Role | Default Code | Typical Function | HLD Behaviour |
|---|---|---|---|
| Fusion | FN | Core aggregation switch (campus core) | Sits at the root of the building topology |
| Border | BR | Edge/WAN router or L3 gateway | Connects to WAN/service provider |
| Distribution | DS | Distribution layer switch | Optional — connects core to access layer |
| Edge Node | EN | Access layer switch (floor/room level) | Connects to APs and end devices |
| Access Point | AP | Wireless access point | Connects to Edge Node via PoE |
| Firewall | FW | Security appliance | Custom role — added by user |
| WLC | WL | Wireless LAN controller | Custom role — added by user |
| Server | SV | Compute node | Custom role — added by user |

Users can rename any role (e.g. "Fusion" → "Core Switch"), change abbreviation codes, add custom roles, and delete unused ones. Renamed labels propagate everywhere they appear. A hover tooltip on every device name explains each naming segment dynamically from the project's naming configuration (see Section 20.10).

Each role has configurable default requirements:
- Expected uplink type (fibre SM, fibre MM, copper)
- Expected uplink speed (1G, 10G, 25G, 100G)
- PoE requirement (yes/no)
- Minimum port count
- Typical stacking behaviour

### 2.3 Connection Schema

Every connection (cable run) between two devices is a first-class data record. This is what makes Rackium different from Visio — in Visio, a line is just a line. In Rackium, a line is a queryable record that feeds the cable schedule, BOM, deployment checklist, and CMDB.

**Connection record fields:**

| Field | Type | Description |
|---|---|---|
| `connection_id` | UUID | Unique identifier |
| `source_device` | FK → Device | Source device |
| `source_port` | FK → Port | Specific port on source device |
| `destination_device` | FK → Device | Destination device |
| `destination_port` | FK → Port | Specific port on destination device |
| `media_type` | Enum | SM fibre, MM fibre, Cat6a, Cat5e, Stack, DAC, Twinax, Power |
| `speed` | Enum | 100M, 1G, 2.5G, 5G, 10G, 25G, 40G, 100G |
| `cable_id` | String | User-entered cable identifier (default 8-digit format, user may override with free-text — see Section 4.1) |
| `cable_length_m` | Decimal | Cable length in metres (auto-calculated or manual) |
| `sfp_source` | FK → CatalogueItem | SFP/optic at source end |
| `sfp_destination` | FK → CatalogueItem | SFP/optic at destination end |
| `patch_panels` | FK[] → PatchPanel.Port | Intermediate patch panel hops (ordered) |
| `pathway` | FK → Pathway | Physical cable route (from survey) |
| `status` | Enum | `designed`, `approved`, `installed`, `tested`, `faulty`, `decommissioned` |
| `trace_status` | Enum | `fully_traced`, `partially_traced`, `not_traceable`, `marker_identified`, `estimated` |
| `design_revision` | FK → Version | Which design version created this connection |
| `created_by` | FK → User | Who created the record |
| `created_at` | Timestamp | When |

**Hop-by-hop traceability:**
A connection from Border port Te1/1/4 to Edge 04 port Te1/1/1 might traverse:
```
Border Te1/1/4 → PP-01 Port 24 → [surveyed fibre route: Floor 0 riser → Floor 2 trunking, 58m] → PP-02 Port 08 → Edge 04 Te1/1/1
```
Every hop is stored. Clicking any segment shows where it goes. This is the "cable matrix answer" — the question every engineer asks: "where does this port go?"

### 2.4 Equipment Catalogue

The platform ships with a seeded catalogue of network equipment. This is not a product database — it's a technical specification database that drives validation, BOM generation, and rack layout rendering.

**Catalogue item schema:**

| Field | Example (C9300-48P) |
|---|---|
| `vendor` | Cisco |
| `model` | C9300-48P |
| `category` | Switch |
| `subcategory` | Access Layer |
| `description` | Catalyst 9300 48-port PoE+ |
| `ru_height` | 1 |
| `weight_kg` | 5.2 |
| `power_draw_watts` | 750 |
| `poe_budget_watts` | 715 |
| `port_layout` | JSON: `{ "access": [{"type": "RJ45", "count": 48, "speed": "1G", "poe": true}], "uplink_module_slots": 1, "stack_ports": 2 }` |
| `compatible_modules` | Array of module models (e.g. C9300-NM-8X for 8× 10G SFP+) |
| `compatible_sfps` | Array of SFP models per port type |
| `compatible_psus` | Array of PSU models, with `psu_slots` count |
| `stack_cable_options` | Array: cable model, max length, speed |
| `airflow` | Front-to-back |
| `dimensions_mm` | `{ "W": 445, "D": 460, "H": 44.45 }` |
| `eos_date` | null (active) |
| `eol_date` | null (active) |
| `datasheet_url` | Link to vendor datasheet |
| `image_front` | SVG of front-panel port layout (to-scale) |
| `image_rear` | SVG of rear-panel port layout |
| `servon_available` | Boolean: available from SERVON catalogue |
| `servon_product_code` | SERVON catalogue reference |

**Catalogue sources (layered):**

| Layer | Managed by | Example |
|---|---|---|
| Seeded | Rackium team | Cisco, Juniper, Aruba, Meraki, Fortinet devices |
| SERVON | Auto-synced | SERVON racks, patch panels, PDUs, cables, accessories |
| Organisation | Org admin | Custom/niche devices added by the client's team |
| Project | Architect | One-off devices specific to a single project |

### 2.5 Baseline Network Topology Reference

A simplified S-site example is frozen for presentation and interaction design:
- One Fusion device
- One Border device
- Five Edge switches
- Five access points
- The Border connects directly to all Edge switches
- The Distribution layer remains visible in grey as "not required" for the example S-site
- The topology remains visible across design, deployment and CMDB views so the same objects can be compared through their lifecycle

### 2.6 User Roles & Permissions

| Role | Can do | Cannot do |
|---|---|---|
| **Owner** | Everything + delete project + manage org + manage users | — |
| **Architect** | Create/edit HLD, LLD; manage survey forms; approve surveys; view BOM; manage catalogue; invite members | Delete project, change org settings |
| **Field Engineer** | Fill surveys; upload photos; execute deployment checklists; edit MDF-to-IDF patching | Edit HLD/LLD designs; approve phases; delete devices |
| **Reviewer** | View all; approve/reject designs; add comments | Edit designs; manage surveys; manage users |
| **Procurement** | View BOM; update procurement status; manage vendor info | Edit designs; manage surveys |
| **Viewer** | View everything | Edit nothing |

**Scope-based access:**
Roles can be scoped to specific parts of the project:
- A field engineer assigned to Building B001 sees only B001's survey and deployment
- An architect assigned to Germany sees all German SAL codes but not UK

---

## 3. Module Specifications

### 3.1 Phase Navigation

The left sidebar contains the project tree. The top bar contains phase navigation tabs. The user experience is:

1. Navigate to a building in the left sidebar tree
2. Phase tabs appear: **Overview | Survey | HLD | LLD | Solution Package | BOM | Deployment | CMDB | Handover**
3. Each tab shows that phase's module for the selected building
4. Phase completion status shown as coloured indicators on the tabs

**Phase dependency enforcement:**
```
Survey ──→ HLD ──→ LLD ──→ Solution Package ──→ BOM ──→ Deployment ──→ CMDB ──→ Handover
```

A phase cannot begin until its predecessor is at least submitted for review. A phase cannot complete until its predecessor is approved. These dependencies are configurable per project — a PM can allow parallel work on HLD while survey review is in progress, but must explicitly enable this.

### 3.2 Building Overview Dashboard

**Purpose:** Single-screen status view for one building. The architect, PM, or reviewer lands here to understand where the building stands.

**Dashboard layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Building B001 — Administration                                      [⚙️] [📊] │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Phase Progress Pipeline                                                     │
│  ●━━━━●━━━━●━━━━●━━━━●━━━━●━━━━●━━━━●━━━━●                                 │
│  CMO   Survey HLD  LLD   SP   BOM  Deploy CMDB  Handover                    │
│  ✅     ✅    ✅    🔵    ⬜    ⬜    ⬜    ⬜     ⬜                          │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ Survey           │  │ HLD             │  │ LLD             │              │
│  │ ✅ Complete       │  │ ✅ Approved v2.1 │  │ 🔵 In progress   │              │
│  │ 6/6 rooms        │  │ 14 devices      │  │ Rev 1.1          │              │
│  │ 56/56 CMO ✅     │  │ 23 connections  │  │ 8/14 devices     │              │
│  │ 100%             │  │ 100%            │  │ patched — 57%    │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ Solution Package │  │ BOM             │  │ Deployment      │              │
│  │ ⬜ Not ready      │  │ ⬜ Locked        │  │ ⬜ Locked        │              │
│  │ Awaiting LLD     │  │ Awaiting SP     │  │ Awaiting BOM    │              │
│  │ approval         │  │ approval        │  │ delivery        │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐                                   │
│  │ CMDB            │  │ Handover         │                                   │
│  │ ⬜ Locked        │  │ ⬜ Locked         │                                   │
│  └─────────────────┘  └─────────────────┘                                   │
│                                                                              │
│  Current Phase: LLD · Progress: 57% · Open Blockers: 1                      │
│  Approval Awaiting Action: LLD review (assigned to MK)                      │
│                                                                              │
│  Open Blockers                                                               │
│  ├── ⛔ TR-22: Patch panel PP-02 has 0 free ports (survey)                   │
│  │     Raised: 14 Oct · Assigned to: SM · Priority: High                    │
│                                                                              │
│  Recent Activity                                                             │
│  ├── 10:42 — SM completed LLD patching for TR-21 (Floor 2)                  │
│  ├── 09:15 — MK approved HLD v2.1                                           │
│  └── Yesterday — JD uploaded 4 deployment photos for TR-01                  │
│                                                                              │
│  Quick Stats                                                                 │
│  Floors: 3 · Rooms: 6 · Racks: 8 · Devices: 14 · Connections: 23          │
│  Validation: 0 critical · 2 warnings · 3 info                               │
│  DGUV: 12 valid · 2 expiring · 0 expired                                    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Phase card behaviour:**

| Phase card state | Colour | Meaning |
|---|---|---|
| Not started | Grey | Predecessor phase not complete |
| In progress | Blue | Work underway |
| Submitted | Amber | Awaiting review/approval |
| Approved / Complete | Green | Phase done |
| Changes requested | Red | Returned with comments |
| Blocked | Red + blocker icon | Dependency or issue preventing progress |

**Additional dashboard elements:**
- Project continuity pipeline showing all phases with completion percentage
- Open blockers section with raised date, assigned resolver, and priority
- Approval awaiting action section
- Recent activity timeline (timestamped log of phase completions, approvals, revisions, deployments)

---

### 3.3 Project Creation & Settings Module

**Purpose:** Architects create and configure projects before any design work begins.

**Create project wizard (3 steps):**

Step 1 — Identity:
- Project name (e.g. "LANSpire")
- Client name (optional)
- Project description
- Project code / reference number

Step 2 — Structure:
- Add countries, SAL codes, campuses, buildings
- Import structure from CSV/Excel (for large rollouts with 50+ buildings)
- SAL code creation is the project scope trigger

Step 3 — Team:
- Invite members (email + role)
- Assign scope per member (entire project, specific countries, specific buildings)

**Project settings (accessible anytime from gear icon):**

```
Project Settings
├── General
│     Name, description, client, status (Active / On Hold / Complete / Archived)
│
├── Hierarchy
│     Add/rename/delete countries, SALs, campuses, buildings
│
├── Device Roles
│     Default roles ship with the platform (see Section 2.2)
│     User can:
│       ✓ Rename any role (e.g. "Fusion" → "Core Switch")
│       ✓ Add custom roles (e.g. "Firewall", "WLC")
│       ✓ Delete unused roles
│       ✓ Set default requirements per role (PoE, min ports, uplink speed)
│     Renamed labels propagate everywhere
│
├── Connection Types
│     Default media: SM fibre, MM fibre, Cat6a, Cat5e, Stack cable, DAC, Twinax, Power
│     User can:
│       ✓ Add custom media types
│       ✓ Set colour coding per type (for HLD/LLD diagrams) — user-configurable defaults
│       ✓ Define speed options per media
│       ✓ Set maximum cable length per media (validation engine uses this)
│
├── Naming Conventions (see Section 20.10 for full specification)
│     Define hostname patterns using variables:
│     Pattern: {role}-{country}-{sal}-{campus}-{building}-{floor}-{seq}
│     Example: E-DE-ERL-C01-B001-F02-004
│     User can change pattern, variables, separator
│     System auto-suggests hostnames on device placement (user can override)
│
├── Survey Form Templates (see 3.5)
├── Custom Validation Rules (see 3.4)
├── Members & Permissions
├── Templates (save project settings as reusable template for new projects)
│
└── Danger Zone (archive / delete project — Owner only)
```

---

### 3.4 Custom Validation Rules Builder

**Purpose:** Architects define project-specific validation rules beyond the built-in ones (Section 5).

**Rule builder:**
```
IF   [subject] [condition] [value]
THEN [severity] [message]

Examples:
  IF   Edge Node     has single uplink
  THEN Warning       "Edge switch {hostname} has no redundant uplink"

  IF   any rack      weight exceeds 500 kg
  THEN Critical      "Rack {rack_label} exceeds floor load limit"

  IF   any connection cable length exceeds 90m AND media is Cat6a
  THEN Warning       "Cat6a link {link_id} is {length}m — near 100m limit"

  IF   Edge Node     PoE budget exceeds 80%
  THEN Warning       "PoE on {hostname} at {poe_percent}% — consider PSU upgrade"

  IF   any rack      PDU count equals 1
  THEN Warning       "Rack {rack_label} has no power redundancy"

  IF   any device    PSU count less than psu_slots (from catalogue)
  THEN Warning       "{hostname} has {psu_count}/{psu_slots} PSUs — no power redundancy"
```

**Available condition subjects:** Device (role, port count, PoE budget %, uplink count, power draw, PSU count), Connection (cable length, media, speed), Rack (weight, power, U occupancy %, PDU count), Room (rack count, device count), General (empty fields, photo count).

Custom rules run alongside built-in rules. Findings show a "Custom" badge in the Review panel.

---

### 3.5 Survey Form Builder & Execution Module

**Purpose:** The architect designs survey forms on-platform. Field engineers fill them on-site using a mobile/tablet browser. All data flows directly into the system — no Excel, no manual upload, no data re-entry.

#### 3.5a CMO Inventory Upload (Before Survey)

Before survey begins, the Technonex engineer uploads the CMO device list:

1. Navigate to SAL code → CMO Inventory
2. Upload Excel/CSV containing: hostname, serial number, MAC address, model, vendor, location (floor/room/rack)
3. System validates format, flags duplicates, counts devices
4. CMO inventory is now the baseline for this SAL code
5. Dashboard shows: "CMO: X devices loaded · 0 validated"

During physical survey, as the engineer scans devices (serial + MAC), each match auto-validates against this list. The CMO progress updates live.

#### 3.5b Survey Form Builder (Architect)

**Where:** Project Settings → Survey Form Templates

**Available field types:**

| Field Type | Description | Example |
|---|---|---|
| Text | Free text | Room name, notes |
| Number | Numeric with min/max/unit | Port count, U-height, cable length (m) |
| Dropdown | Single-select | Room type (TR/SR/Office), Rack size (24U/42U/48U) |
| Multi-select | Multiple choices | Available media types |
| Checkbox | Yes/no | Raised floor? Cooling present? |
| Photo capture | Camera with annotation | Room overview, rack front, pathway |
| GPS | Auto-capture with manual override | Room location |
| Signature | Touch signature | Site access confirmation |
| Date/time | Picker | Survey date, next access window |
| File upload | Attach documents | Floor plans, existing docs |
| Section header | Visual separator | Groups related fields |
| Calculated | Auto-computed | Free U = Total U − Occupied U |
| Repeatable group | Duplicatable block | "Add another rack", "Add another PP" |
| Device scanner | Serial + MAC input with CMO auto-validation | Scan existing device |

The **Device scanner** field type is critical: engineer enters or scans a serial number + MAC address → system immediately checks against CMO inventory → shows ✅ validated or ❌ not found. This is how CMO validation happens in real-time during survey.

**Key capabilities:**
- Mark fields required/optional
- Field-level validation (min/max, regex)
- Duplicate and modify templates
- Preview on mobile
- Form versioning (updated template doesn't affect existing submissions)
- Multiple templates per project

#### 3.5c Survey Execution (Field Engineer — mobile-first)

**Where:** Engineer opens Rackium on tablet/phone → assigned building → Survey

**Survey sub-tab structure (from UI mockups):**
```
Site Structure → Room Details → Rack Survey → Existing Connectivity/Building Connections → Validation
```

**Mobile interface (responsive, touch-optimised):**
- Room-by-room form filling
- Progress bar per room (6/9 sections complete — 67%)
- Save draft / Submit buttons
- Photo capture opens device camera directly, with annotation tools (arrows, circles, text labels)
- Every photo auto-tagged with GPS + timestamp
- Device scanner field: tap → camera opens for barcode/QR scan or manual entry → instant CMO validation

**NexAI-Assisted Rack Capture workflow:**
```
Capture → Analyse → Review → Confirm
```
The platform uses smart recognition to map rack contents: RU positions, device identification via serial/label OCR, and automatic matching against CMO inventory. The engineer reviews and confirms the automated capture, correcting any misidentifications before submission.

**Rack Survey Readiness Summary:**
Each surveyed rack includes a readiness summary panel showing:
- Front/rear 42RU elevation with device positions
- Rack details (type, dimensions, free RU)
- Mounting and power status
- Cable path assessment
- Accessibility rating
- Overall readiness summary for FMO planning

**Offline capability:**
- Forms fillable without internet
- Data saves to browser local storage
- Auto-syncs when connection restores
- Conflict resolution if same room edited by two people offline

**Survey progress tracking (Architect dashboard):**
```
Building B001 — Survey Progress
├── Floor 00
│     └── TR-01  ✅ Complete (12 Mar, imported)
├── Floor 01
│     ├── TR-11  ✅ Complete (14 Mar, imported)
│     └── TR-12  ✅ Complete (14 Mar, imported)
├── Floor 02
│     ├── TR-21  🔶 Submitted — awaiting verification
│     ├── TR-22  🔶 Submitted — 1 validation issue
│     └── TR-23  📝 Draft — 67% complete

CMO Validation: 52/56 devices ✅ · 4 pending
Overall: 4/6 rooms complete · 1 pending · 1 in progress
```

**Survey status per room:** Draft → Submitted → Verified → Imported (into HLD)

**Verification workflow:**
1. Engineer submits → Architect notified
2. Architect reviews → Approve (→ Verified) or Reject with comments (→ Draft, engineer notified)
3. Verified surveys importable into HLD (devices + racks pre-positioned on canvas)

**Key behaviour:**
- Survey data = source of truth for physical constraints
- 0 free ports on PP-02 in survey → HLD routing through PP-02 raises immediate error
- HLD cannot override survey data, only flag exceptions
- Every update timestamped and user-attributed

#### 3.5d Dedicated Survey Sub-Forms (from Siemens Survey Analysis)

The survey form builder (3.5b) ships with pre-built templates matching enterprise SD-LAN survey requirements. These are based on the Siemens Physical Site Survey v2.4 standard — the industry benchmark. Each sub-form is a tab within the survey module:

**Tab 1: Location Details** (pre-filled by architect, validated on-site)
- Site ID, name, address, city, country, SAL code, campus ID
- Location coordinates (GPS — auto-captured, manual override)
- Location function (office / warehouse / factory / data centre / mixed)
- Site criticality (Low / Standard / Critical / Mission Critical) + reason
- Mono site / Zebra site classification
- Business units present at location
- Operational hours
- Building details (SAL code/name per building, coordinates, floor count, criticality per building, SRE code)
- Comm room access method + contact details
- Stakeholder contacts (Success Manager, SRE — name, email, phone)
- Access requirements and H&S requirements (link or description)

**Tab 2: Comms Rooms Summary** (auto-populated from rack data + manual additions)
- Per room: building, floor, room number, rack number
- Per rack: total RU, used RU, free RU
- Per PDU in rack: free power sockets (up to 4 PDUs per rack)
- Power source description
- Power redundancy source
- Free space for new rack installation (Y/N)
- Power availability for new rack (Y/N)
- Photos (yes/no toggle — required if allowed)

**Tab 3: Floor-wise Device Details** (primary CMO capture form)
All fields from existing Device Scanner (Section 3.5b) PLUS:
- Building wing
- Floor area (sq meters)
- Device management IP
- Free power sockets in rack
- Free fibre ports on patch panel (count)
- Free copper ports on patch panel (count)
- Upstream device name + port
- Approx distance to upstream device
- UPS installed in rack? (Y/N)
- Devices directly connected to UPS? (Y/N)
- Dual PDUs installed? (Y/N)
- Power sourced from UPS? (Y/N)
- Power socket type (dropdown: C13/C14, UK Standard, Schuko, CEE, NEMA)

**Tab 4: Rack Layout** (U-by-U visual capture)
- Rack metadata: site name, building/floor/wing, room, rack name, sequence number, rack purpose/owner
- U-by-U capture: for each RU, what's installed (device details, patch panel with port label range and free/used count, cable tray, free)
- Rack physical properties: type, elevation (total U), dimensions (W×D×H), back accessible, sides accessible, mounting rail type, depth hindrance, screw/cage nut type
- Cable routing in room (under floor / over rack / concealed / tray)
- Patch cable category in use (Cat5/6/6a/7)
- Specific cable make required
- Photos: rack front (required), rack rear (required), PDU/UPS power socket (required)

**Tab 5: Fibre Cabling** (port-to-port fibre mapping)
- Per fibre connection: building, floor, room, rack, device hostname, device port number
- Fibre connector type (SC / LC / MPO)
- Port LED status (Is port up? Green LED? — Y/N)
- Source patch panel rack + panel number + port number
- Destination patch panel number
- Connected device at destination
- "Not traceable" / "Underground" notation for cables that cannot be physically traced

**Tab 6: Passive Copper Cabling** (port-to-port copper mapping)
- Per copper connection: building, floor, room, rack, device hostname, device port number
- Device type
- Patch panel number + port number
- Port LED status (Y/N)
- Patch panel rack location
- Purpose of connectivity
- "Not traceable" notation with marker label if visible

**Tab 7: WAN** (WAN CPE and circuit details)
- CPE location: building, wing, floor, room, rack, RU position
- CPE details: hostname, make, model, serial
- WAN service provider
- Number of WAN circuits
- MPLS enabled (Y/N) + bandwidth
- Internet enabled (Y/N) + bandwidth
- LAN ports connected (count)
- Connected LAN device hostname + floor/room
- LAN port type (Fibre SMF / Fibre MMF / Copper)
- LAN port speed
- Free ports (count + type + IDs)
- Approx distance to core switch
- Power details (UPS, dual PDU, socket type)

**Tab 8: WLAN** (Access Points + Controllers)
- Floor layout requirements: scale bar, office areas included, non-office areas excluded, exclusion zones, neighbouring buildings
- Per AP: mount type (wall/ceiling), wall/ceiling material, building/wing/floor, ceiling height, cable type, AP hostname, make, model, serial, MAC, connected switch + port, AP photos
- Per WLC: hostname, make, model, serial, MAC, location, used/free ports, uplink cable type, uplink switch + port, AP support count

**Tab 9: SSID** (Wireless network documentation)
- Per SSID: name, purpose, authentication method (WPA2/WPA3 Enterprise / Captive Portal / Open), IP assignment (Static/DHCP), which APs broadcast it

**Tab 10: Firewall** (if present)
- Location: building, wing, floor, room, rack, RU position
- Device: hostname, make, model, serial, management IP
- Purpose of firewall
- Uplink details: port IDs, cable type, upstream device + port, distance
- Free fibre + copper ports
- EOS/EOL status
- Firewall type (physical / virtual)
- Power details

**Tab 11: Lab / Isolated Network** (if applicable)
- Location, device type, make, model, serial, hostname, IP
- Connectivity to corporate network
- Free copper/fibre ports
- Power details
- End user cabling type
- Fibre patch panel (if any)
- Rack details + free RU
- Mark isolated area on floor map
- Photos

**Tab 12: Local Server** (if applicable)
- Location, make, model, serial, function
- Uplink details (port IDs, cable type, switch + port)
- Hostname, IP, static/DHCP, MAC
- Service owner
- Special requirements (local ISE/DDI, redundancy needs)

**Tab 13: Endpoints** (VoIP, printers, MTR, IP devices)
- Device type, model, service owner
- Placement (building/wing/floor/room)
- Device details: switch port, MAC, hostname, IP, static/DHCP, serial
- Photos

**Tab 14: BMS & rVLAN Devices** (building management system endpoints)
- Device type (CCTV, DVR, access controller, fire alarm, UPS controller, SeePass, SiPass)
- Model, service owner
- PoE / Non-PoE
- MAC, hostname, IP, static/DHCP
- Connected switch + port

**Tab 15: Rooms & Open Areas** (for wireless capacity planning)
- Per room: building, floor, room type (meeting/conference/open area/auditorium/canteen), room number
- Seat count / user count
- Number of APs currently in room

**Tab 16: Storage Area** (staging/logistics for build)
- Staging area location + photos
- Device receiving/storage location
- Tools/trolleys availability
- Staging space description
- Power socket count + type
- Network connection (count + type)
- Packaging waste disposal location

**Tab 17: Passive Requirements for FMO** (filled POST-survey by architect)
- New racks needed (count, size H/W/D)
- PDU count needed
- Ladder requirement
- Cooling requirement for devices
- Fibre patch panel requirements: source rack/device → destination rack/device, fibre type (SM/MM), connector type (LC/SC/FC)

**Must vs Good-to-Have field classification:**
Every field in every survey sub-form is tagged as either:
- **Must** — required, form cannot be submitted without it
- **Good to Have** — optional, captured if information is available
- **Pre-filled** — entered by the architect before survey, validated on-site by engineer
- **Survey** — captured during physical survey

This classification appears as a small coloured badge next to each field label:
- 🔴 Must (red) — required
- 🟡 Good to Have (yellow) — optional
- 🔵 Pre-filled (blue) — pre-populated, engineer validates
- 🟢 Survey (green) — captured on-site

The badge also serves as a filter — the engineer can toggle "show Must fields only" for a quick-pass survey when time is limited, then revisit for Good-to-Have fields.

---

### 3.6 HLD Module (High-Level Design)

**Purpose:** The architect designs the FMO (Future Mode of Operation) network topology for the building. This is what the client wants — not what currently exists. The HLD is driven by client requirements, not by survey data. Survey data provides physical constraints (available space, pathways, power); the HLD is the target architecture.

**The HLD canvas is a fully interactive, data-connected topology diagram with:**
- Drag-and-drop device placement from the object library
- Draw connection lines between devices (click source → click destination)
- Colour-coded connections by media type — user-configurable defaults: SM = orange, MM = red, Cat6a = blue, Stack = green, DAC = purple, Power = grey
- Connection lines can be: straight, bent (with drag-adjustable bend points), curved
- Speed labels on connections (1G, 10G, 25G, 100G)
- Snap-to-grid alignment
- Zoom in/out, fit to screen, percentage zoom
- Pan / hand tool
- Select, multi-select, move, copy, delete
- Undo/redo
- Canvas organised by floor (horizontal floor sections with dashed borders)

**Canvas structure:**
```
Building B001
┌─────────────────────────────────────────────────────┐
│ Floor 0                                              │
│   ┌── Room TR-01 ──────────────────────────┐        │
│   │  ☁ WAN / Service Provider              │        │
│   │  [Fusion icon] Fusion ✅               │        │
│   │  [Switch icon] Border ✅               │        │
│   │  [UPS icon] UPS-01                     │        │
│   │  [PDU icon] PDU-A  [PDU icon] PDU-B    │        │
│   └────────────────────────────────────────┘        │
├─────────────────────────────────────────────────────┤
│ Floor 1                                              │
│   ┌── TR-11 ──┐           ┌── TR-12 ──┐            │
│   │ [Switch] Edge 01 ✅   │ [Switch] Edge 02 ✅    │
│   │ [AP] AP-111           │ [AP] AP-121            │
│   └───────────┘           └───────────┘            │
│        ┃ 10G SM                ┃ 10G SM             │
│        ┃ (orange line)         ┃ (orange line)      │
├────────┸────────────────────────┸────────────────────┤
│ Floor 2                                              │
│   ┌── TR-21 ──┐  ┌── TR-22 ──┐  ┌── TR-23 ──┐     │
│   │ [Switch]   │  │ [Switch]   │  │ [Switch]   │     │
│   │ Edge 03 ✅ │  │ Edge 04 ⚠️ │  │ Edge 05 ✅ │     │
│   │ [AP] AP-211│  │ [AP] AP-221│  │ [AP] AP-231│     │
│   └────────────┘  └────────────┘  └────────────┘     │
└─────────────────────────────────────────────────────┘
```

**Device placement workflow:**
1. Architect drags a device role (e.g. "Edge Node") from the HLD Object Library (right panel) onto a room
2. Smart equipment suggestion fires (Section 6): system filters catalogue by role requirements, asks PoE needed? Port count? Uplink speed? Vendor?
3. Architect selects specific model (e.g. C9300-48P)
4. System auto-populates: RU height, weight, power draw, PoE budget, port layout from catalogue
5. System auto-suggests hostname from naming convention (user can override)
6. Device appears on canvas with role icon, label, hostname, and validation status indicator (✅ / ⚠️ / ❌)

**Power distribution on canvas:**
- UPS devices show capacity and connected load
- PDU devices show outlet count and utilisation
- Power chain visualisation: UPS → PDU → Device (dotted lines or a power overlay layer)
- Power budget warnings when load approaches capacity

**Environmental elements:**
- Cooling units can be placed on canvas (shows capacity)
- Raised floor indicator per room (from survey data)
- Room thermal calculation based on devices placed

**Connection drawing:**
1. Architect clicks source device → clicks destination device
2. System prompts: media type, speed, SFP/optic type (auto-suggested based on media+speed)
3. Connection line appears with colour coding and speed label
4. System immediately validates: are ports available? Does media match? Is there a surveyed pathway? Does cable length spec allow it?
5. If blocked → validation tooltip appears on the connection

**Stacking workflow:**
1. Architect places 2+ compatible switches in the same room/rack
2. Right-click or select both → "Create stack"
3. System asks stack cable length (auto-suggests based on RU positions if in same rack)
4. Stack group created: stack data cables + stack power cables added to design
5. Stack cables appear as green lines on canvas
6. BOM auto-adds: stack data cables, stack power cables (with lengths)

**Cable pathway routing:**
- When a connection crosses rooms/floors, architect can specify the pathway: through which trunking, conduit, tray
- If survey captured pathway data between those rooms, system auto-links to surveyed route with measured length
- If no surveyed pathway exists, system flags it as "pathway not surveyed — length estimated"

**Validation tooltip (shown on ⚠️ devices or connections):**
```
⚠️ Uplink validation failed
Border → Edge 04 · 10G MM
No free port on PP-02 in TR-22
[Open survey record →]  [Resolve →]
```

**HLD Object Library (right sidebar):**
```
▼ Network devices
  [router icon]     Fusion
  [switch icon]     Border
  [switch icon]     Edge Node
  [ap icon]         AP
  [firewall icon]   Firewall (if added as custom role)
  [server icon]     Server

▼ Infrastructure
  [rack icon]       Rack
  [room icon]       Room
  [ups icon]        UPS
  [pdu icon]        PDU

▼ External
  [cloud icon]      WAN / Service Provider
  [building icon]   Remote Site

▼ Connections (draw mode) — user-configurable default colours
  ── SM fibre     (orange)
  ── MM fibre     (red)
  ── Cat6a        (blue)
  ── Stack cable  (green)
  ── DAC / Twinax (purple)
  ── Power        (grey)
  ── Custom types (from project settings)
```

**CMO vs FMO overlay:**
The HLD can show a CMO overlay — existing devices from the CMO inventory are shown as faded/ghost icons on the canvas. The FMO design (the actual HLD) is drawn on top. This lets the architect see:
- Which CMO devices are being replaced (ghost icon + new device in same position)
- Which CMO devices are being retained (ghost icon promoted to solid)
- Which positions are net new (no ghost icon underneath)

**Two topology views:**
1. **Physical topology** (default) — devices in rooms on floors, as above
2. **Logical topology** — same devices as a network diagram (tree/star layout) without floor/room structure, showing logical relationships, VLANs, subnets (see Section 3.6B for full object library)

**NexAI-Suggested HLD:**
The platform can suggest an initial HLD topology based on survey inputs (device counts, room layouts, pathway data) and the selected blueprint template. The suggestion includes device placement, connection patterns, and equipment selection. The architect reviews, modifies, and approves the suggestion. NexAI provides a validation panel showing design completeness, potential issues, and optimisation suggestions.

**HLD Editor Toolbar:**
```
Select | Move | Create Uplink | Break Uplink | Reroute | Replace Endpoint | Split | Merge | Change Medium | Validate | Undo | Redo | Delete
```

**Toolbar:**
- Validate design — runs all validation rules, populates review findings
- Generate HLD — produces exportable HLD document (PDF/PNG/SVG)
- Save version — snapshot with label (see Section 7)
- Zoom controls (+, −, fit, percentage)
- Pan/hand tool
- Grid toggle, snap toggle

**Bottom status bar:**
```
Survey-linked objects: 8 · CMO validated: 52/56 · Open design questions: 2 · Engine synced ●
```

#### 3.6A Site Blueprint Templates

Blueprint Templates accelerate HLD creation for repetitive rollouts by providing pre-built topology patterns that the architect customises rather than building from scratch.

##### 3.6A.1 Template Sizes

| Template | Typical use case | Indicative topology |
|---|---|---|
| **Small (S)** | Branch office, retail location | 1–2 access switches, no distribution layer, single uplink to WAN |
| **Medium (M)** | Regional office, small factory | 1 distribution switch pair, 4–8 access switches, redundant WAN uplinks |
| **Large (L)** | Campus building, large factory | Core switch pair, 2–4 distribution switch pairs, 12–24 access switches, redundant paths |
| **Extra Large (XL)** | Data centre, headquarters | Full core–distribution–access–WAN hierarchy, multiple buildings, high redundancy |

These are starting points, not rigid constraints. The architect selects a template and the system generates:
- A draft HLD canvas with devices positioned in a standard layout
- Placeholder connections between layers
- Suggested rack assignments based on room count

Everything is editable — the architect adds, removes, or repositions devices and connections as needed.

##### 3.6A.2 Template Variants

Each size can have topology variants:

| Variant | Description |
|---|---|
| **Single path** | No redundancy — single uplink per layer |
| **Redundant distribution** | Dual distribution switches with redundant uplinks |
| **Full mesh** | Every distribution pair connected to every core device |
| **Collapsed core** | Distribution and core roles combined in one device pair |
| **Routed access** | Layer 3 at the access layer |

The system ships with default variants per size. Organisations can create custom variants and save them as organisation-level templates.

##### 3.6A.3 Template Customisation Propagation

When the architect modifies a template-generated design:

| Action | System behaviour |
|---|---|
| Add a device | Added to the design; no template constraint |
| Remove a device | Removed; connections to/from it are flagged for reassignment |
| Change device model | Updated; compatibility checks run automatically |
| Add a floor/room | System suggests additional access switches based on the template's ratio |
| Change uplink type | Updated; optics/cable type in the BOM adjusts accordingly |

The template is a starting accelerator — once the architect edits the design, it becomes a custom design. The system tracks which template was used as metadata but does not enforce template conformance after initial generation.

##### 3.6A.4 Organisation-Level Custom Templates

An organisation admin can:
1. Design a topology in the HLD canvas for any project.
2. Save it as an organisation template with a name, description, and size classification.
3. The template captures: device roles and counts, connection patterns, rack assignment rules, and default device models.
4. Other architects in the organisation can then select this template when creating a new building's HLD.

This supports clients who deploy a standardised network design across dozens of sites — the architect creates the pattern once and reuses it.

#### 3.6B Logical Topology View — Object Library

##### 3.6B.1 Logical Objects

| Object | Icon | Properties | Description |
|---|---|---|---|
| **VLAN** | Coloured rectangle/zone | VLAN ID, name, description, associated ports | A Layer 2 broadcast domain |
| **Subnet** | Network block | Network address, prefix length, gateway IP, DHCP range, description | An IP address range assigned to a VLAN or interface |
| **VRF** | Dashed boundary | VRF name, route distinguisher, description | A virtual routing and forwarding instance isolating routing tables |
| **Security Zone** | Shaded boundary with lock icon | Zone name, trust level (untrusted/DMZ/trusted/management), associated interfaces, firewall policy reference | A logical security perimeter |
| **Gateway** | Router icon with arrow | IP address, associated VLAN/subnet, redundancy protocol (HSRP/VRRP/none), priority | The default gateway for a subnet |
| **DHCP Scope** | IP block with range indicator | Scope name, start IP, end IP, subnet mask, lease duration, DNS servers, exclusions | DHCP address pool configuration |
| **ACL / Firewall Rule Set** | Shield icon | ACL name/number, direction (inbound/outbound), associated interface, rule count, description | Access control list reference (rules defined in detail panel, not on canvas) |
| **Route** | Directional arrow between subnets/VRFs | Route type (static/OSPF/BGP/EIGRP), destination, next-hop, metric, administrative distance | A routing relationship between network segments |
| **DNS Zone** | Globe icon | Zone name, type (forward/reverse), primary server | DNS zone reference |
| **NTP Source** | Clock icon | Server address, stratum, authentication | Time synchronisation source |

##### 3.6B.2 Logical Connection Types

| Connection type | Line style | Description |
|---|---|---|
| **Trunk** | Thick solid line | Carries multiple VLANs between devices; label shows allowed VLAN list |
| **Access port link** | Thin solid line | Single VLAN assignment |
| **Port-channel / LAG** | Double parallel lines | Aggregated logical link; label shows member interfaces |
| **Routed link** | Solid line with arrow | Layer 3 point-to-point between subnets |
| **VRF leaking** | Dashed line with bidirectional arrow | Route leaking between VRFs |
| **Firewall traversal** | Line through shield icon | Traffic crossing a security zone boundary |

##### 3.6B.3 Physical-to-Logical Mapping

Every logical object must map to physical infrastructure:
- A VLAN is assigned to specific switch ports (which exist as physical port records).
- A subnet is associated with a VLAN and a gateway device.
- A port-channel maps to specific physical interfaces on specific devices.
- A security zone boundary maps to firewall interfaces.

The system must validate this mapping: a VLAN assigned to a port on a switch that doesn't exist in the physical topology is a validation error. Conversely, when the architect assigns a VLAN to a switch port on the logical canvas, that assignment is reflected in the port schedule (LLD Section 3.7).

##### 3.6B.4 Logical View Display

The logical topology canvas shows the same devices as the physical topology but arranged to emphasise logical relationships:
- Devices are grouped by VLAN membership or security zone rather than physical location.
- VLAN zones are shown as coloured background regions.
- Subnets are labelled on the links or zones.
- The architect can toggle between "show all VLANs" and filtering to a specific VLAN or VRF.

The logical view is a **separate canvas** from the physical view, not an overlay. Changes to device properties on either canvas update the shared data model.

#### 3.6C HLD Canvas UX Features

##### Snap-to-Grid and Alignment Tools

| Feature | Behaviour |
|---|---|
| **Snap to grid** | Toggle on/off. When enabled, objects snap to a configurable grid (default: 20px). Grid is visible when enabled, hidden when disabled. |
| **Snap to object** | When dragging an object near another, alignment guides (blue dashed lines) appear at matching edges and centres. Object snaps to the guide. |
| **Auto-align selection** | Select multiple objects → right-click → Align: Left / Centre / Right / Top / Middle / Bottom |
| **Distribute evenly** | Select 3+ objects → right-click → Distribute: Horizontally / Vertically. Equalises spacing between objects. |
| **Resize to match** | Select multiple objects → right-click → Match size: Width / Height / Both. Resizes to the largest selected object. |

Keyboard shortcuts: `Ctrl+Shift+G` — toggle grid · `Ctrl+Shift+A` — auto-align selected objects

##### Layer System

The canvas supports user-manageable layers. Each object belongs to one layer. Layers control visibility and editability.

**Default layers (auto-created):**

| Layer | Contains | Default visibility |
|---|---|---|
| Core | Core/fusion devices and connections | Visible |
| Distribution | Distribution devices and connections | Visible |
| Access | Access/edge devices and connections | Visible |
| WAN/Edge | Border routers, firewalls, external connections | Visible |
| Wireless | Controllers, APs, wireless connections | Visible |
| Pathways | Cable routes, conduits, risers | Visible |
| Labels & Notes | Text labels, annotations, notes | Visible |
| Background | Floor plan image, building outline | Visible |

**Layer controls:**
- 👁️ Eye icon — toggle visibility
- 🔒 Lock icon — toggle editability (locked layers are visible but objects cannot be selected or moved)
- Colour indicator — each layer has a tint for identification
- Layer order — drag to reorder (affects rendering z-order)
- Custom layers — user can create, rename, and delete layers

**Connection line filtering:** A connection is visible only when both its source and destination layers are visible. When a layer is hidden, connections to/from devices on that layer fade out (ghosted, 20% opacity) rather than disappearing entirely, so the architect can see that hidden connections exist.

##### Multi-Page Diagrams

A single HLD design can span multiple pages (sheets). Each page is a separate canvas with its own viewport.

| Feature | Behaviour |
|---|---|
| **Page tabs** | Tabs at the bottom of the canvas (like spreadsheet sheet tabs). Click to switch, right-click to rename, reorder, duplicate, or delete. |
| **Add page** | "+" button at the end of the page tabs. New page inherits grid and layer settings. |
| **Cross-page references** | A device that appears on one page can have a reference marker on another page: a small icon with the page name and device label. Clicking the reference navigates to that device on the other page. |
| **Cross-page connections** | A connection between devices on different pages shows as a line terminating at a page-reference connector. The connection record is shared — it's one connection, rendered on two pages. |
| **Page overview** | A panel showing thumbnails of all pages in the design for quick navigation. |

##### Properties Panel (Right-Side)

When a device is selected on the HLD canvas, a collapsible properties panel slides in from the right side of the screen:

| Section | Fields |
|---|---|
| **Identity** | Hostname (editable), device role, manufacturer, model (searchable dropdown from catalogue) |
| **Location** | Building, floor, room, rack, RU position (dropdowns from project hierarchy) |
| **Network** | Management IP, VLAN assignments (summary), uplink count |
| **Status** | Lifecycle state (existing/proposed/approved/installed), design revision |
| **Connections** | Count of connections, with expandable list showing destination device and port for each |
| **Quick actions** | "Open device detail" (full page), "Show in rack elevation", "Show in LLD", "Show connections" |

When no object is selected, the panel shows canvas-level properties: page name, grid settings, layer controls, design revision info. When a connection line is selected, the panel shows: source and destination endpoints, cable type, Cable ID, pathway, length, and status.

##### Stencil Import

Users can import custom stencils (icon sets):

| Format | Description | Import behaviour |
|---|---|---|
| **SVG** | Scalable Vector Graphics | Each SVG file becomes one stencil. User assigns a category and name. |
| **PNG/JPG** | Raster images | Accepted as stencil icons. System warns if resolution is below 128×128px. |
| **.vssx** | Visio Stencil file | System extracts individual shapes from the Visio stencil file and converts each to an SVG. Shape names from Visio become stencil names. |
| **Bulk upload** | ZIP of SVG/PNG files | Uploaded as a stencil pack. Folder structure within the ZIP maps to categories. |

Stencil management includes organisation library (admin-managed), project library, and personal library. Each stencil has: name, category, tags, default size, connection points. Visio stencil conversion is best-effort — simple shapes convert reliably; complex Visio-specific features may not.

##### Undo/Redo History

| Feature | Behaviour |
|---|---|
| **Undo** | `Ctrl+Z` — reverses the last action. Supports at least 50 levels of undo per session. |
| **Redo** | `Ctrl+Y` or `Ctrl+Shift+Z` — re-applies the last undone action. |
| **Action granularity** | Each undoable action is one user operation. Bulk operations undo as one step. |
| **Undo boundary** | Undo history resets when the user saves the design. Saving is a checkpoint. |
| **Undo across tabs** | Undo history is per-canvas-tab. Undoing in the HLD does not affect LLD actions. |
| **Undo indicator** | Toolbar shows undo/redo buttons with tooltips showing the action name. |

##### Copy/Paste

| Feature | Behaviour |
|---|---|
| **Copy** | `Ctrl+C` — copies selected objects to clipboard |
| **Cut** | `Ctrl+X` — copies and removes selected objects |
| **Paste** | `Ctrl+V` — pastes objects at cursor position |
| **Paste within same diagram** | Objects duplicated. Device names auto-suffixed. Connections between copied objects preserved. |
| **Paste between pages** | Objects duplicated to the target page. Same auto-naming behaviour. |
| **Paste between buildings** | Objects duplicated to the target building's HLD. Location metadata updated. User prompted to confirm device renaming. |
| **Paste between projects** | Not supported — devices reference project-specific data. |
| **Duplicate shortcut** | `Ctrl+D` — duplicates selected objects in place (offset by 20px right and down). |

##### Canvas Search

| Feature | Behaviour |
|---|---|
| **Open search** | `Ctrl+F` opens a search bar at the top of the canvas |
| **Search scope** | Searches all objects: device hostnames, labels, Cable IDs, annotations, IP addresses, VLAN IDs |
| **Results list** | Dropdown showing matching objects with type icon and page number |
| **Navigate to result** | Clicking a result pans and zooms to centre on that object, highlighted with a pulsing outline |
| **Cycle through results** | `Enter`/`F3` for next match; `Shift+F3` for previous |
| **Cross-page search** | Results include all pages. Clicking a result on another page switches to that page. |
| **Filter by type** | Optional filter chips: Devices / Connections / Labels / All |

##### Minimap / Navigator

A small overview panel in the bottom-right corner showing a birds-eye view of the entire diagram:
- Viewport indicator rectangle shows the currently visible area
- Click anywhere on the minimap to pan
- Drag the viewport rectangle to pan
- Toggle on/off via toolbar button or `Ctrl+M`
- Auto-scales to fit entire diagram content
- Default 200×150px, resizable

##### Annotations and Pinned Comments

**Annotation tools:**
- **Sticky note** — coloured note box (yellow, blue, green, red) for design notes and review comments
- **Callout** — text label with arrow pointing to a specific object or area
- **Freehand drawing** — pen tool for quick sketches or markups
- **Area highlight** — transparent coloured rectangle over a region

**Review comments (canvas-pinned):**
- Right-click → "Add comment" places a comment pin (💬) at that location
- Each pin opens a threaded conversation
- Comments can be resolved (pin changes to checkmark and fades)
- Filter: All / Open / Resolved / Mine
- Notifications sent when comments are pinned or replied to

Annotations exist on the layer system (Labels & Notes by default) and can be hidden when generating formal output documents. Review comments are metadata — they do not appear in exported PDFs unless explicitly included.

---

### 3.7 LLD Module (Low-Level Design)

**Purpose:** The detailed uplinking sheet — exact port-to-port connections, rack elevations, cable specifications. The LLD answers: "which exact interface on which device connects to which exact interface on which other device, through which patch panels, using which cable type, at which speed."

**Four sub-tabs:**

#### Tab 1: Physical Connections (default view)

Interactive rack elevation views showing devices in racks with connection lines between them.

**Rack elevation rendering:**
- Each rack shown as a vertical strip with RU numbers (RU1 at bottom, RU42 at top)
- Devices rendered at correct RU position with correct height
- Device face shows port layout from catalogue data (port grids with port numbering)
- Patch panels show individual ports with status (free/used — colour coded)
- Connection lines drawn between ports across racks with media colour coding
- Click any device → right panel shows device details (including DGUV validity)
- Click any port → shows what it connects to (the cable matrix answer)
- Click any connection line → shows full hop-by-hop route

**Port-level detail:**
When a device is selected, every port on that device is shown and individually addressable:

```
Device: C9300-48P (Edge 04) — Rack R04, RU 36
├── Uplink module: C9300-NM-8X (slot 1)
│     ├── Te1/1/1  → Border Te1/1/4 · MM 10G · FO-005 [connected] ✅
│     ├── Te1/1/2  → [available]
│     ├── Te1/1/3  → [available]
│     └── Te1/1/4  → [available]
├── Access ports (48x GbE PoE+)
│     ├── Gi1/0/1  → PP-02 P12 · Cat6a 1G · VLAN 100 · PoE+ 30W [connected]
│     ├── Gi1/0/2  → PP-02 P13 · Cat6a 1G · VLAN 100 · PoE+ 30W [connected]
│     ├── Gi1/0/3  → [available]
│     ├── ...
│     └── Gi1/0/48 → [available]
└── Stack ports
      ├── Stack 1 → Edge 03 Stack 1 · StackWise · 0.5m [connected]
      └── Stack 2 → [available]
```

**Per-port editable fields (in LLD and Deployment):**
- Connection destination (device + port)
- Cable ID (default 8-digit format, user may enter free-text — see Section 4.1)
- Media type and speed
- VLAN assignment (documentation only, not config push)
- PoE policy: enabled/disabled, power class, allocated watts
- Port description / label
- Status: designed / connected / tested / faulty / reserved / decommissioned

**Connection route visualisation (shown when clicking a connection):**
```
Border Te1/1/4 → PP-01 P24 → [surveyed fibre route 58m] → PP-02 P08 → Edge 04 Te1/1/1
        └── MM fibre · 10G · SFP-10G-SR · Cable ID: FO-005 · Status: Designed
```

**MDF-to-IDF patching:**
The horizontal cabling from patch panel to wall outlets / APs (MDF-to-IDF / local distribution) is NOT filled in by the architect. These fields are marked "TBD — to be captured during deployment" in the LLD. The local cabling team fills this data during deployment as they patch cables.

#### Tab 2: Rack Elevations

Full rack face views (front and rear toggle) for every rack in the building. Devices shown at correct RU positions with catalogue-accurate port layouts. This is the Visio rack diagram equivalent — but interactive and data-linked.

**Authoritative device artwork requirements:**
- The magnified switch must use the supplied 48+8 front-face drawing with correct port numbering: odd access ports on the upper row, even access ports on the lower row, plus NM1–NM8.
- The patch panel must use the supplied SERVON 24-port drawing with sequential ports 01–24.
- Only the selected source port and selected destination port should be highlighted in Rackium blue; no additional ports may appear selected.
- The physical sequence must be respected: patch panel at its correct RU above/below the switch, with leader lines anchored only to their correct rack units.

**Example rack content (42RU):**

| RU | Content |
|---|---|
| RU42 | PP-01 · 24-port patch panel |
| RU41 | Horizontal cable manager |
| RU40 | SW-CMO-01 · C9300-48UX |
| RU39 | Horizontal cable manager |
| RU38 | PP-02 · 48-port patch panel |
| RU37 | FP-OM4-UG1705-01 |
| RU36 | FP-OS2-UG1705-01 |
| RU35 | Reserved for FMO |
| RU34 | Reserved for FMO |
| RU33 | Shelf |

#### Tab 3: Port Schedule

Excel-style table listing every port on every device:

| Device | Interface | Type | Speed | Status | Connected To | Cable ID | VLAN | PoE | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Border | Te1/1/1 | SFP+ | 10G | Connected | Fusion Te1/1/1 | FO-001 | — | — | Backbone |
| Border | Te1/1/4 | SFP+ | 10G | Connected | Edge 04 Te1/1/1 | FO-005 | — | — | Floor 2 uplink |
| Edge 04 | Gi1/0/1 | RJ45 | 1G | Connected | PP-02 P12 | CU-221 | 100 | 30W | AP-221 |
| Edge 04 | Gi1/0/2 | RJ45 | 1G | Available | — | — | — | — | — |

Filterable by device, rack, room, floor, status, VLAN. Exportable as Excel.

#### Tab 4: Cable Schedule

Every cable run in the building:

| Link ID | Cable ID | Source Device | Source Port | Dest Device | Dest Port | Media | Speed | Length | PP (source) | PP (dest) | Route | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UL-01 | FO-001 | Fusion | Te1/1/1 | Border | Te1/1/1 | SM | 10G | 2m | — | — | Same rack | Ready |
| UL-05 | FO-005 | Border | Te1/1/4 | Edge 04 | Te1/1/1 | MM | 10G | 58m | PP-01 P24 | PP-02 P08 | Riser F0→F2 | Blocked |

Filterable and exportable as Excel — this is the SC spreadsheet equivalent, auto-generated from the design.

---

### 3.7A Solution Package Module

The Solution Package is the **client approval gate** between LLD completion and BOM generation. No material is ordered until the Solution Package is approved.

**Position in workflow:**
Overview → Survey → HLD → LLD → **Solution Package** → BOM → Deployment → CMDB → Handover

#### 3.7A.1 Purpose

The Solution Package bundles all design outputs into a single reviewable package for client sign-off. It serves three functions:

1. **Client approval** — The client reviews the proposed design before Technonex commits to procurement.
2. **Commercial checkpoint** — Internal commercial review confirms pricing, margins, and supplier availability.
3. **Design freeze** — Once approved, the LLD and HLD become the baseline. Any post-approval change triggers a formal change request.

#### 3.7A.2 Three-Page Structure

**Page 1: Suggested Solution Package**
Shows the proposed package structure generated from survey, HLD, LLD and BOM information. Indicates completeness, available source data, missing client inputs and package readiness. NexAI assists by organising and checking information but does not invent client-specific technical decisions.

**Page 2: Required Inputs**
The full technical requirement set condensed into twelve usable groups:

1. Network addressing and segmentation
2. Routing and SD-WAN integration
3. Catalyst Center and LAN automation
4. Central network services
5. Security and management access
6. Wireless and RF design
7. Software and configuration standards
8. Monitoring and assurance
9. CMO-to-FMO migration
10. Testing and acceptance
11. Commercial and procurement approval
12. Document governance and client approval

Important detailed inputs include IP pools, VLAN/VN/VRF relationships, AS numbers, transit and overlay definitions, Catalyst Center hierarchy, LAN-automation seed data, golden image, AP management and RF parameters, DNS/DHCP/NTP/AAA/ISE, SNMP/SSH/syslog, monitoring agents and tests, existing-to-new device and VLAN mappings, relocated-versus-new equipment, migration sequence and acceptance ownership.

**Page 3: Validation and Approval Readiness**
- Reconciles Survey, HLD, LLD, device quantities, BOM, rack/RU feasibility, ports, cable media and SFP compatibility.
- Checks hostname conventions, subnet overlap, VLAN and routing relationships, software standards, migration inputs, testing criteria and mandatory attachments.
- Displays passed checks, accepted warnings, critical conflicts and mandatory-input completion.
- Supports Network Architect and Project Manager review before client submission.
- Provides Preview Package, Word/PDF export, Return for Changes and Submit for Client Approval actions.
- Deployment release remains locked until the Solution Package is approved.

#### 3.7A.3 Solution Package Contents (Auto-Compiled)

| Document | Source |
|---|---|
| Executive summary | Auto-generated from project metadata, site count, device count, connection count |
| HLD diagrams (physical and logical) | HLD module — latest approved revision |
| LLD connectivity diagrams | LLD module — all four sub-tabs |
| Rack elevation drawings | LLD rack elevation tab |
| Port and patching schedules | LLD port schedule and cable schedule tabs |
| Cable route and pathway drawings | HLD pathway data |
| Bill of Materials (draft) | BOM module — pre-approval draft |
| Bill of Resources / work package | BOM module — BoR output |
| Site survey summary | Survey module — completed survey data |
| Compliance and validation report | Validation engine — all critical/warning items and their resolution status |
| Open items and exceptions | Any unresolved validation warnings approved with documented exceptions |

#### 3.7A.4 Solution Package States

| State | Meaning |
|---|---|
| `not_ready` | LLD is incomplete or has unresolved critical validation errors |
| `draft` | LLD is complete; Solution Package is auto-compiled but not submitted |
| `submitted` | Package sent to client/internal reviewer |
| `under_review` | Reviewer has opened the package |
| `changes_requested` | Reviewer has returned the package with comments — design returns to LLD for revision |
| `approved` | Client and internal sign-off received — BOM generation unlocked |
| `superseded` | A newer revision has replaced this package |

#### 3.7A.5 Approval Workflow

1. Architect clicks **"Compile Solution Package"** — system checks all critical validation rules pass. If any fail, compilation is blocked with a list of unresolved items.
2. System generates the package as a single reviewable document set (viewable in-platform and exportable as PDF bundle).
3. Architect adds optional cover notes and submits to the designated reviewer(s).
4. Reviewer can:
   - **Approve** — triggers design freeze; BOM phase unlocks.
   - **Request changes** — must attach comments to specific items; design returns to LLD with those comments visible.
   - **Reject** — terminates this design revision; architect must create a new revision.
5. Approval is recorded with reviewer identity, timestamp, and digital signature.

#### 3.7A.6 Post-Approval Change Control

Once a Solution Package is approved:
- The associated HLD and LLD revisions are **frozen** — they become read-only.
- Any change requires a **Change Request** (CR) that describes what changed and why, shows the impact on BOM, and requires re-approval through the same workflow.
- The system tracks CR history against the original Solution Package.

#### 3.7A.7 Dashboard Integration

The building-level dashboard (Section 3.2) shows the Solution Package status card between LLD and BOM:
- **Not Ready** — grey, with count of blocking validation errors
- **Draft** — blue, with "Compile" action
- **Submitted / Under Review** — amber, with reviewer name and submission date
- **Changes Requested** — red, with comment count
- **Approved** — green, with approval date and approver

---

### 3.8 BOM Module (Bill of Materials — Procurement Tracker)

**Purpose:** Auto-generated inventory of everything needed to build the designed network. NOT an invoice — no pricing. It is a procurement tracker.

**Auto-generation:**
BOM is computed from HLD + LLD data. Every device placed, every connection drawn, every SFP specified, every stack cable, every power supply — automatically appears in the BOM with quantity and source traceability.

**NexAI BOM Analysis:**
The platform provides a BOM analysis panel showing calculation logic, component validation, and procurement package recommendations. NexAI checks for specification conflicts, quantity discrepancies, and compatibility issues between BOM items.

**BOM table:**
| Item | Model / Spec | Source | Qty | Procurement Status | Vendor | Delivery | Notes |
|---|---|---|---|---|---|---|---|
| Edge switch 48-port | Cisco C9300-48P | HLD / LLD | 3 | Ordered | Cisco | 15 Apr | — |
| Edge switch 24-port | Cisco C9300-24P | HLD / LLD | 2 | Quoted | Cisco | TBD | — |
| 10G SR SFP+ | SFP-10G-SR | LLD | 8 | Delivered | SERVON ★ | 10 Apr | — |
| StackWise cable 0.5m | CAB-STK-E-0.5M | HLD | 4 | Not ordered | — | — | — |
| AC PSU 715W | PWR-C1-715WAC | HLD | 10 | Quotation requested | — | — | Dual PSU config |
| 42U rack | SERVON-R42 | Survey | 2 | Delivered | SERVON ★ | 05 Apr | — |

★ = Available from SERVON catalogue

**Source traceability tags:** Each item shows which phase generated the requirement (Survey / HLD / LLD)

**Procurement status per line item:**
Not ordered → Quotation requested → Quoted → Ordered → Shipped → Delivered → Installed

**Procurement fields per item:**
- Vendor (multiple vendor options can be listed for client choice)
- Expected delivery date
- Actual delivery date
- PO number / reference
- Notes

**NO pricing columns.** Rackium generates quantity + specification. The client handles pricing and purchasing.

**BOM traceability checklist (right panel):**
- ✅ Survey data incorporated
- ✅ Design (HLD/LLD) referenced
- ✅ Components match design intent
- ✅ Power and cooling verified
- ✅ Cable lengths from surveyed pathways
- ⚠️ 1 blocked link — cable order held
- ✅ Ready for procurement

**Actions:** Export BOM (Excel), Send for review, Auto-refresh BOM (re-computes from latest design changes)

---

### 3.9 Deployment & Installation Module

**Purpose:** Field engineer view. Execute installation, verify connectivity, record as-built information. The engineer follows the approved LLD and records what actually gets installed.

Rather than introducing an unrelated deployment dashboard, the approved approach reuses the established topology canvas. This allows the viewer to compare planned, installed and operational states in the same connected view.

#### 3.9.1 Deployment Lifecycle States

| State | Meaning | Visual Treatment |
|---|---|---|
| **Pending** | Planned device or AP has not yet been installed | Amber/yellow status |
| **Installed** | Device is physically mounted and its installation record exists, but connectivity is not yet fully validated | Active blue device with Installed status |
| **Ready** | Device is installed, uplinked, tested and validated | Green Ready status |

#### 3.9.2 Topology-Based Deployment View

Installed devices and APs become active while uninstalled devices remain pending. Completed and live connections use the established media colours; unfinished planned links remain grey.

**Stats bar (top of deployment view):**
```
14 planned → 9 installed → 6 tested → 5 remaining
```

**Location tree (left sidebar — same as LLD tree but with deployment status icons):**
```
▼ Floor 00
  ▼ TR-01
    ✅ Fusion (installed, tested)
    ✅ Border (installed, tested)
▼ Floor 01
  ▼ TR-11
    ✅ Edge 01 (installed, tested)
▼ Floor 02
  ▼ TR-22
    🔧 Edge 04 (installing)
  ▼ TR-23
    ⏳ Edge 05 (not started)
```

#### 3.9.3 Per-Device Deployment Record

**Right panel fields:**
- Hostname, model, serial number, MAC address, asset ID
- Rack/RU, latitude, longitude, altitude
- DGUV validity
- Technician and timestamp
- PDU outlet (engineer records: PDU-A outlet 06)

**Field actions:**
- Scan Device — serial/MAC capture
- Confirm Installation — mark device as physically mounted
- Confirm Uplinking — mark connections as patched
- Add Evidence — upload installation photos

**Installation checklist:**
- ☑ Device installed at correct RU
- ☑ Device labelled (hostname label attached)
- ☑ Power connected (to specified PDU outlet)
- ☑ Ports patched (per LLD cable schedule)
- ☑ Link tested (connectivity verified)
- ☑ DGUV inspection recorded

**MDF-to-IDF patching (captured here, not in LLD):**
The horizontal cabling details that were "TBD" in the LLD get filled in during deployment — which patch panel port connects to which wall outlet, actual cable lengths, Cable IDs for horizontal runs.

#### 3.9.4 Validation Discrepancy Detection

Rackium distinguishes a completed field action from a compliant installation. Example: the approved LLD may require OS2 with an SFP-10G-LR, while the field record shows OM4 with an SFP-10G-SR. Rackium identifies the cable-medium and transceiver mismatch and requires correction or an approved deviation.

**Exception logging:**
If anything differs from the approved LLD, the engineer logs an exception:
- What was designed vs what was installed
- Reason for deviation
- Photo evidence
- Exceptions feed into the as-built vs as-designed comparison

**Evidence photos:**
- Engineer uploads photos per device (installed device, label, cable connections, rack overview)
- Photos auto-tagged with GPS + timestamp

**Approved connection from design (read-only reference):**
```
Border Te1/1/4 → PP-01 P24 → [surveyed route 58m] → PP-02 P08 → Edge 04 Te1/1/1
MM fibre · 10G · ✅ Route validated in survey and design
```

**Live progress:**
As devices are installed and checked off, the deployment stats update in real-time. The building overview dashboard reflects this.

---

### 3.10 CMDB Module

**Purpose:** The completed deployment record — the as-built configuration management database. CMDB = finalised deployment. Every device with final details, every connection with tested status, full audit trail.

CMDB is defined as the accepted as-built inventory, connectivity and lifecycle record.

#### 3.10.1 Primary CMDB Page — Configuration Item View

**Asset record (per device / selected Configuration Item):**
```
Asset: E-DE-ERL-C01-B001-F02-004
├── Identity
│     Hostname, Model, Serial, MAC, CMDB CI ID, Asset ID
├── Location
│     Building / Floor / Room / Rack / RU / Latitude, Longitude, Altitude
├── Operational State
│     Ports mapped, Validated uplinks, Free ports, Last link test, DGUV validity
├── Relationships
│     Upstream device, Source/destination ports, Patch panel, Cable type, Cable ID
├── Governance
│     Lifecycle state, Acceptance state, Evidence, History, Provenance
│     NexAI reconciliation result
├── History (audit trail)
│     Every change with timestamp and user
└── Evidence
      Installation photos, test results, rack label photo
```

**Additional primary page elements:**
- Building and asset hierarchy (left panel)
- Data provenance indicators
- Recent changes log
- Data quality score
- NexAI reconciliation — compares accepted as-built inventory against HLD/LLD and installation records; identifies missing evidence, duplicate identifiers or inventory variance

**CMDB views:**
1. **Asset list** — filterable table (search by hostname, serial, location, model)
2. **Connection map** — visual representation of all live connections
3. **Cable matrix** — spreadsheet-style: every port on every device and where it terminates (Section 3.10a)
4. **Port Connectivity** — full physical connections for a selected switch (Section 3.10b)
5. **Change log** — chronological record of every change
6. **Lifecycle dashboard** — warranty expiry timeline, refresh dates, DGUV compliance

**Post-deployment edits:**
CMDB remains editable for operational changes (firmware update, IP change, port re-patch, device swap). Each edit creates an audit log entry.

#### 3.10a Cable Matrix View

The definitive "where does this port go?" answer:

```
Cable Matrix — Building B001                            [Filter ▼] [Export ▼]
┌──────────────┬────────────┬────────┬─────────────────┬───────────┬──────┬─────┬───────────┬──────┐
│ Device       │ Port       │ Status │ → Dest Device   │ Dest Port │Media │Speed│ Cable ID  │Length│
├──────────────┼────────────┼────────┼─────────────────┼───────────┼──────┼─────┼───────────┼──────┤
│ Border       │ Te1/1/1    │ ● Up   │ Fusion          │ Te1/1/1   │ SM   │ 10G │ FO-001    │ 2m   │
│ Border       │ Te1/1/4    │ ● Up   │ Edge 04         │ Te1/1/1   │ MM   │ 10G │ FO-005    │ 58m  │
│ PP-01 (TR-01)│ Port 01    │ ● Used │ Edge 01         │ Gi1/0/1   │Cat6a │ 1G  │ CU-101    │ 22m  │
│ PP-02 (TR-22)│ Port 08    │ ● Used │ Edge 04         │ Te1/1/1   │ MM   │ 10G │ FO-005-B  │ 8m   │
│ Edge 04      │ Gi1/0/1    │ ● Used │ PP-02           │ Port 12   │Cat6a │ 1G  │ CU-221    │ 5m   │
│ Edge 04      │ Gi1/0/3    │ ○ Free │ —               │ —         │ —    │ —   │ —         │ —    │
└──────────────┴────────────┴────────┴─────────────────┴───────────┴──────┴─────┴───────────┴──────┘
```

Filterable by device, rack, room, floor, status, media. Click any row → full connection detail. Export as Excel.

#### 3.10b CMDB Port Connectivity Page

A dedicated page exposing all physical connections for a selected switch while retaining the locked CMDB hierarchy in the background:

- Clicking an Edge configuration item opens its rack and RU context
- The selected switch is highlighted in the 42RU rack elevation; separate magnified switch and patch-panel panels are not used
- Patched switch ports are visibly marked and routed to the relevant patch panels or fibre panels
- The right-side **Ports and Connections expander** lists: host switch port, destination panel and port, source/destination RU, cable ID, medium and validation state
- Filters: All 48, Patched, Uplinks and Free, with search by port, panel or cable ID
- The register is vertically scrollable so all 48 access-port records can be inspected without overcrowding the page

**Professional cable-routing model:**
1. Show a short lead from every patched port so its connected state is visible.
2. Merge leads travelling in the same direction into a shared cable bundle or trunk.
3. Route the bundle through the horizontal and vertical cable-management path using controlled orthogonal bends.
4. Split the bundle only near the destination panel and fan out to the destination ports.
5. Allow a selected connection to be highlighted end to end while the remaining bundle is subdued.

Established media colours remain: Cat6A blue, OS2 single-mode yellow/orange and OM4 multimode red. The view must avoid diagonal spaghetti lines and must never create access-port numbers beyond Gi1/0/48.

---

### 3.11 Handover Module

**Purpose:** Formal wrapper around the CMDB. Compile all project documentation into a deliverable package for the client.

**Pre-compilation checklist (auto-evaluated):**
```
├── ✅ Survey: all rooms verified and imported
├── ✅ HLD: approved (v2.1)
├── ✅ LLD: approved (v1.2)
├── ✅ Solution Package: approved
├── ✅ BOM: all items delivered
├── ✅ Deployment: all devices installed and tested
├── ⚠️ CMDB: 2 devices missing firmware version
├── ✅ As-built vs as-designed: 1 exception (documented)
└── ⚠️ Sign-off: awaiting client signature
```

**Handover package (auto-compiled):**

| Document | Format | Source |
|---|---|---|
| Executive summary | PDF | All phases |
| Survey report | PDF | Survey data + photos |
| HLD document | PDF | Topology diagrams |
| LLD document | PDF | Rack elevations, port/cable schedules |
| Cable matrix | Excel | CMDB connection data |
| BOM (final) | Excel | Final quantities with substitutions |
| Deployment report | PDF | Installation records, tests, exceptions, photos |
| CMDB extract | CSV + PDF | Full asset register |
| As-built vs as-designed | PDF | Visual diff with exceptions |
| Exception register | PDF | All exceptions with resolution notes |
| Photo evidence pack | ZIP | All photos organised by room/rack |

**Handover workflow:** Pending → Ready → Compiled → Under review → Delivered → Accepted

**Sign-off:** Client name, role, date, digital signature, comments/conditions, acceptance checkbox.

**Post-handover:** Building record becomes read-only for design phases (no more HLD/LLD changes without creating a new version). CMDB remains editable for operational changes. Handover package permanently stored and downloadable.

---

## 4. Port-Level Management

When a device is placed in the LLD, every port on that device becomes an individually addressable, editable, queryable object. This is what makes Rackium a cable documentation platform, not just a diagramming tool.

**Per-port fields:**
- Connection destination (device + port)
- Cable ID (default 8-digit format, user may enter free-text — see Section 4.1)
- Media type and speed
- VLAN assignment (documentation only)
- PoE policy: enabled/disabled, power class, allocated watts
- Port description / label
- Status: designed / connected / tested / faulty / reserved / decommissioned

**Port schedule export:** Excel table listing every port on every device with its assignment — field engineers use this to patch cables.

**AP-to-switch port assignments:** When an AP is placed in the HLD, the system creates a connection record from the AP's uplink port to the specified Edge switch port. This connection shows in the LLD port schedule and cable schedule, and the engineer follows it during deployment.

### 4.1 Cable ID Specification

| Property | Specification |
|---|---|
| Field type | Free-text string with 8-digit default format |
| Entry method | System suggests an 8-digit unique identifier by default. The user can accept the suggestion or override with any free-text value following their project's or client's preferred convention. |
| Default format | Eight-digit unique identifier (e.g. `10010012`) — auto-suggested by the system |
| Override | Users may enter any format they prefer. The system does not enforce the 8-digit format — it is a default, not a constraint. |
| Maximum length | 32 characters |
| Allowed characters | Alphanumeric, hyphen, underscore, dot, forward slash |
| Uniqueness | Enforced per project — no two cables in the same project may share a Cable ID. The system validates on entry and rejects duplicates with the message: "Cable ID '{id}' is already assigned to connection {source} → {destination}" |
| Case sensitivity | Case-insensitive for uniqueness (e.g., `CAB-001` and `cab-001` are treated as duplicates) |
| Required | Yes — every physical cable must have a Cable ID before the connection can be marked as `installed` |
| When entered | At any point from LLD design through deployment. During LLD, the field can be left empty for planned connections. During deployment/patching, it must be filled. |
| Label generation | The system generates printable labels (including QR code) from the Cable ID. Scanning the QR code at either end of the cable opens the connection record. |
| Both-end traceability | Both ends of one cable carry the same Cable ID. The system enforces this — a Cable ID is associated with exactly one connection record that has both source and destination endpoints. |

### 4.2 Concurrent Editing and Port-Level Locking

When multiple architects work on the same project simultaneously, the system must prevent conflicting port assignments and provide real-time visibility of each other's work.

#### 4.2.1 Real-Time Presence

Using the WebSocket infrastructure (Section 13.1):
- When an architect opens a building's LLD or HLD, other users working on the same building see a presence indicator (avatar/initials) in the module header.
- The system shows which device or rack each user is currently editing.

#### 4.2.2 Port-Level Locking

| Event | System behaviour |
|---|---|
| User A opens a device's port assignment panel | No lock yet — viewing is non-exclusive |
| User A begins editing a specific port (clicks to assign) | System acquires a soft lock on that port for User A |
| User B attempts to edit the same port | System shows "This port is being edited by [User A]" — User B cannot modify it |
| User A saves the assignment | Lock released; User B's view updates in real-time to show the new assignment |
| User A abandons without saving (navigates away, closes tab) | Lock released after 30-second timeout |
| User A's session disconnects | Lock released after 60-second timeout |

#### 4.2.3 Conflict Resolution

If, despite locking, two saves arrive for the same port (e.g., due to network latency):
1. **First save wins** — the first save to reach the server is committed.
2. **Second save receives a conflict notification** — "Port Gi1/0/24 on {device} was just assigned to {connection} by {User A}. Your change was not saved."
3. The second user's view refreshes to show the current state.
4. No automatic merge — port assignments are atomic (one connection per port), so there is no meaningful merge.

#### 4.2.4 Bulk Operation Locking

When a user performs a bulk operation (e.g., auto-assigning all access ports on a switch, or applying a blueprint template):
- The system acquires locks on all affected ports before starting.
- If any port is locked by another user, the bulk operation pauses and reports which ports are blocked.
- The user can proceed with the unblocked ports or wait.

#### 4.2.5 Locking Scope

Locking applies to: port assignments, rack unit assignments, Cable ID assignments, connection record creation/modification.

Locking does not apply to: viewing any data (always non-exclusive), editing device metadata (hostname, serial — uses last-write-wins with change history), HLD canvas object positioning (multiple users can work on different parts simultaneously).

---

## 5. Validation Engine

The validation engine runs continuously as data changes. It produces findings with three severity levels:

**Critical — blocks the phase from being approved:**
- Port media mismatch (SM port ↔ MM cable)
- SFP module incompatible with port
- Device placed in rack but no power connection defined
- Cable route through patch panel with 0 free ports
- Device model requires dual PSU but only single PSU configured
- Rack weight exceeds manufacturer specification
- Device placed at RU position that overlaps with another device

**Warning — should be resolved but does not block:**
- UPS cannot carry the full rack load
- Single PDU (no power redundancy)
- Single PSU when device supports dual (no power redundancy)
- Empty RU count exceeds 50% of rack
- Cable length within 90% of media specification limit
- PoE budget utilisation exceeds 80%
- Cooling capacity approaching thermal load
- Stack member count approaching maximum

**Info — advisory:**
- Link negotiates below maximum speed
- Device has no hostname assigned
- TBD fields remaining in connection record
- Evidence photos not uploaded for installed device
- CMO device not yet validated during survey
- Cable pathway not surveyed (length is estimated)

Findings appear in the Review tab on every module. Each finding links to the specific device, connection, or rack that triggered it. Custom rules (Section 3.4) run alongside these built-in rules with a "Custom" badge.

**NexAI validation functions:**
- Detect RU conflicts, occupied ports, unsupported combinations
- Identify invalid hierarchy or missing patch capacity
- Flag downstream impacts of design changes
- Compare Survey, HLD, LLD, rack layout, ports, SFPs, media and BOM quantities

### 5.1 Validation Rule IDs

Each built-in validation rule has a stable identifier for traceability:

| Rule ID | Severity | Description |
|---|---|---|
| VAL-001 | Critical | Port media mismatch — SFP type does not match cable media |
| VAL-002 | Critical | SFP module incompatible with port slot type |
| VAL-003 | Critical | Device placed in rack with no power connection defined |
| VAL-004 | Critical | Cable route requires patch panel with 0 free ports |
| VAL-005 | Critical | Device requires dual PSU but only single configured |
| VAL-006 | Critical | Rack weight exceeds manufacturer specification |
| VAL-007 | Critical | RU position overlaps with another device |
| VAL-008 | Warning | Cable length within 90% of media specification limit |
| VAL-009 | Warning | PoE budget utilisation exceeds 80% on device |
| VAL-010 | Warning | Stack member count approaching platform maximum |

### 5.2 Functional Requirement IDs

| Requirement ID | Module | Description |
|---|---|---|
| LLD-001 | LLD | Port-level editing with per-port VLAN, PoE, and status fields |
| LLD-002 | LLD | Cable schedule auto-generation from connection records |
| LLD-003 | LLD | Hop-by-hop connection route visualisation |
| HLD-001 | HLD | Drag-and-drop device placement with catalogue integration |
| HLD-002 | HLD | Connection drawing with media/speed auto-suggestion |
| HLD-003 | HLD | CMO overlay with ghost icons |
| BOM-001 | BOM | Auto-generation from HLD + LLD data |
| BOM-002 | BOM | Source traceability tags per line item |
| DEP-001 | Deployment | Per-device installation checklist with serial/MAC capture |
| DEP-002 | Deployment | Exception logging with photo evidence |
| CMDB-001 | CMDB | Cable matrix view with full hop-by-hop detail |
| CMDB-002 | CMDB | Post-deployment edit capability with audit trail |
| BPT-001 | Blueprint | Template sizes S/M/L/XL with topology variants |
| BPT-002 | Blueprint | Organisation-level custom template creation |
| BPT-003 | Blueprint | Template customisation propagation |
| BPT-004 | Solution Package | Three-page structure (Suggested SP, Required Inputs, Validation) |
| BPT-005 | Solution Package | Approval workflow with design freeze |
| BPT-006 | Solution Package | Post-approval change control |

### 5.3 Acceptance Test Scenarios

| Scenario ID | Description | Pass Criteria |
|---|---|---|
| AC-01 | Place device on HLD canvas and verify catalogue data auto-populates | RU height, weight, power draw, PoE budget, port layout all populated from catalogue within 2 seconds |
| AC-02 | Draw connection and verify validation fires | Media mismatch between SFP and cable type produces VAL-001 critical finding within 1 second |
| AC-03 | Complete LLD and compile Solution Package | All critical validation rules pass; package compiles with all 11 document sections present |
| AC-04 | Submit Solution Package for approval | Reviewer receives notification; can approve, request changes, or reject; approval unlocks BOM |
| AC-05 | Generate BOM from approved design | All devices, SFPs, cables, PSUs, stack cables appear with correct quantities and source tags |
| AC-06 | Execute deployment checklist for one device | Serial, MAC, rack/RU, PDU outlet, cable IDs captured; device transitions Pending → Installed |
| AC-07 | Log deployment exception (media mismatch) | Exception recorded with designed vs installed values, reason, and photo; appears in as-built comparison |
| AC-08 | Verify CMDB cable matrix after deployment | Every port on every device shows correct connection with tested status; click any row shows hop-by-hop |
| AC-09 | Concurrent port editing by two users | User A locks port; User B sees lock message; User A saves; User B's view refreshes in <2 seconds |
| AC-10 | Generate handover package | All 11 documents compile; PDF bundle downloadable; sign-off captures digital signature |
| AC-11 | Blueprint template generates HLD | Template M with redundant distribution produces correct device count, connections, and rack assignments |
| AC-12 | Survey offline then sync | Form filled offline with 3 photos; on reconnect, all data and photos sync; CMO validation runs; progress updates |

---

## 6. Smart Equipment Suggestions

When a user places a device role on the HLD canvas, the system suggests specific equipment from the catalogue.

**Flow:**
1. User drags "Edge Node" onto Room TR-22
2. System checks role's default requirements (access-layer switch)
3. System asks filters: PoE required? Port count? Uplink speed? Stackable? Vendor?
4. System queries catalogue, ranks results by fit
5. Results show as a picker with key specs

**The picker shows:**
- Matching models ranked by fit score
- Key specs per model (ports, PoE budget, power draw, weight, RU height)
- Stackable indicator
- PSU options (single vs dual)
- Compatible uplink modules
- SERVON availability flag
- "Add custom device" option for models not in catalogue
- Datasheet link

**Auto-populated after selection:**
Once the architect picks C9300-48P, the system instantly:
- Places the device on canvas/rack at the specified position
- Sets RU height, weight, power draw, PoE budget
- Auto-suggests hostname from naming convention
- Adds PSUs to BOM based on psu_slots count
- Shows compatible uplink modules and SFPs
- If stacking enabled → shows compatible stack cables
- All accessories auto-appear in BOM

### 6.1 Catalogue Progressive Search UX

The device catalogue is a progressively narrowing search. The architect never scrolls through 300 devices looking for the right one.

**Step 1 — Vendor selection** (grid of vendor logos with device counts)
**Step 2 — Category filter** (Switches, Routers, Firewalls, APs, WLC, Compute)
**Step 3 — Role-based filtering** (auto-applied from the dragged device role)
**Step 4 — Results with comparison** (ranked by fit score, with side-by-side comparison)
**Step 5 — Select → auto-populate** (all specs flow into BOM)

**"Best fit" ranking logic:**
1. Meets all filter criteria (PoE, port count, uplink speed, stackable)
2. PoE budget headroom
3. Uplink speed matches or exceeds requirement
4. Stackable if stacking enabled
5. SERVON availability (commercial advantage)
6. Not end-of-sale

**Compare mode:** Side-by-side comparison table of 2-3 models with all key specs and fit scores.

**Free-text search:** Works at every level. Type "9300" → shows all models containing "9300". Type "48 PoE 10G" → natural language parsed into filters.

**"Add custom device" option:** If the needed device isn't in the catalogue, the architect fills in the Catalogue Item Schema fields manually.

**Catalogue admin panel:**
```
Catalogue Admin
├── Seeded devices (read-only — maintained by Rackium team)
├── SERVON products (synced from SERVON catalogue)
├── Organisation devices (added by org admins)
└── Actions: Add device, Import CSV, Request device, Sync SERVON
```

---

## 7. Version Control & Design Diff

Every design phase (HLD, LLD) supports version control.

**Workflow:**
1. Architect works on LLD — auto-saved
2. At milestones, clicks "Save version" → enters label
3. System saves complete snapshot
4. Version history viewable with labels and approval status

**Visual diff (select any two versions):**
- Added devices: green highlight
- Removed devices: red highlight
- Changed connections: amber highlight
- Text summary of all differences

**Branch designs (what-if scenarios):**
Architect can branch from any version to explore alternatives without affecting main design. Branches can be merged or discarded.

**Approval workflow:**
- Reviewer invited to review specific version
- Approve / Reject with comments / Request changes
- Approved version = baseline for BOM generation and Deployment

---

## 8. Notifications & Task Assignment

**In-app notification centre (bell icon):**
- Survey submitted for review
- Design approved / rejected
- Task assigned
- Validation issue raised
- BOM item status changed
- Deployment progress updates
- DGUV inspection expiry warnings

**Task assignment:**
Architects assign specific work to team members:
- What: Deploy Edge 03-05 in B001
- Assigned to: JD (Field Engineer)
- Deadline: 25 Apr 2024
- Notes: "Start with TR-21, materials on-site"
- Status: Not started → In progress → Complete

**Email notifications (configurable per user):**
Each user toggles: in-app, email, both, or daily digest.

---

## 9. Audit Trail & Compliance

Every action logged with timestamp, user, and details. Immutable record.

**What gets logged:**
- Every design change (device add/move/remove, connection create/modify/delete)
- Every survey submission and edit
- Every status change
- Every deployment record
- Every user action (login, role change, permission grant/revoke)
- Every export and document generation
- Every version save and approval
- Every CMO validation event
- Every NexAI suggestion acceptance/override with reason

**Audit log view (Owner and Architect):**
Filterable by date, user, action type, module. Exportable as CSV or PDF.

**Digital signatures:** Handover sign-off and survey verification capture digital signatures stored as audit records and embedded in exported PDFs.

---

## 10. Document Generation Engine

Auto-generate professional PDF deliverables from platform data at any point.

**Available documents:**

| Document | When | Contents |
|---|---|---|
| Survey report | After survey | Room-by-room data with photos, GPS |
| HLD document | After HLD | Topology diagrams, device inventory |
| LLD document | After LLD | Rack elevations, port/cable schedules |
| Cable matrix | After LLD | Every port, every connection — Excel |
| Solution Package | After LLD | Complete design package for client approval |
| BOM document | After BOM | Itemised list with quantities, traceability |
| Deployment report | After deployment | Installation records, tests, exceptions, photos |
| CMDB report | After deployment | Full asset register with lifecycle data |
| As-built comparison | After deployment | Designed vs installed, with exceptions |
| Handover package | At handover | All above compiled into branded package |

**Branding:** Client logo + Rackium/Technonex branding, cover page, auto-generated table of contents, page numbers, headers, footers.

**Formats:** PDF (primary), Excel (tabular data), PNG/SVG (individual diagrams), Word (Solution Package export)

---

## 11. Security & Data Protection

Rackium stores confidential client infrastructure data. The platform must be Ekahau-class in terms of data protection.

### 11.1 Data Classification

| Data Type | Classification | Examples |
|---|---|---|
| Network topology | Confidential | HLD/LLD diagrams, device placement |
| Device identity | Confidential | Serial numbers, MAC addresses, hostnames, IP addresses |
| Physical location | Confidential | GPS coordinates, building layouts, room/rack positions |
| CMO inventory | Confidential | Existing infrastructure details |
| Survey photos | Confidential | Physical security-relevant images |
| User credentials | Secret | Passwords, API tokens, session tokens |
| Audit logs | Internal | User activity records |
| Catalogue data | Internal | Device specifications (non-client-specific) |

### 11.2 Encryption

- **At rest:** AES-256 encryption for all stored data
- **In transit:** TLS 1.3 for all API communication, WebSocket connections, and file transfers
- **File storage:** Encrypted at rest (S3 server-side encryption)
- **Database:** Encrypted at rest with key rotation
- **Backups:** Encrypted with separate keys from production

### 11.3 Authentication & Access Control

- **SSO/SAML:** Support for enterprise SSO (Azure AD, Okta, Google Workspace)
- **MFA/2FA:** Mandatory for Owner and Architect roles, configurable for others
- **Password policy:** Minimum 12 characters, complexity requirements, breach database check
- **Session management:** Configurable timeout (default 30 min), concurrent session limit, session revocation, device tracking
- **API tokens:** Scoped, time-limited, revocable
- **RBAC:** As defined in Section 2.6 — enforced at API level

### 11.4 Tenant Isolation

- Multi-tenant architecture with strict data isolation per organisation
- Logically separated (separate database schemas or row-level security)
- API endpoints enforce org_id on every query

### 11.5 GDPR Compliance

- EU hosting for EU clients
- Right to deletion within 30 days
- Data processing agreement available
- Data portability in open formats
- Breach notification within 72 hours

### 11.6 Backup & Disaster Recovery

- Daily full backups, hourly incremental
- RPO: 1 hour · RTO: 4 hours
- Geographic redundancy

### 11.7 Security Operations

- Penetration testing pre-launch and annually
- Automated vulnerability and dependency scanning
- Rate limiting, input validation, CORS, CSP

### 11.8 Export Security

- PDF watermarking with organisation name, date, user
- Export audit logging
- Time-limited, password-protectable share links

---

## 12. Network Iconography Library

Rackium must use industry-standard network device icons that engineers recognise from Cisco Packet Tracer and Microsoft Visio.

### 12.1 Icon Standards

- **Format:** SVG (scalable, theme-aware)
- **Style:** Clean, modern, flat design — consistent with Rackium's visual language
- **Colour:** Icons use the role's assigned colour with consistent outline style. Icons use Rackium blue (#094F9A), 1.65px rounded stroke, and black labels.
- **States:** Normal, selected (blue highlight), error (red), warning (amber), CMO/ghost (40% opacity)
- **Size:** 32×32px base grid, scales with zoom

### 12.2 Required Icon Set

**Network Devices:**
| Icon | Represents | Based on |
|---|---|---|
| Router | Router, gateway, border router | Cisco router icon (circle with arrows) |
| L3 Switch | Core/distribution switch, Fusion, Border | Cisco L3 switch icon |
| L2 Switch | Access switch, Edge Node | Cisco L2 switch icon |
| Firewall | Firewall, security appliance | Cisco firewall icon |
| Wireless AP | Access point | Cisco AP icon |
| WLC | Wireless LAN controller | Cisco WLC icon |
| Server | Server, compute node | Cisco server icon |
| Cloud | WAN, internet, service provider | Cisco cloud icon |

**Infrastructure:**
Rack, Patch Panel, UPS, PDU, Cable Manager, Building, Floor, Room

**Editor Icons (third matching icon set):**
- Canvas: Select, Pan, Zoom In, Fit View
- Editing: Undo, Redo, Duplicate, Delete
- Properties: Device Properties, Replace Device, Rename, Lock Object
- Connections: Change Source/Destination Port, Reverse Link, Set Link Speed
- Rack Components: Add Patch Panel, Cable Manager, PDU, Shelf
- Installation: Scan Device, Confirm Installation, Confirm Uplinking, Add Evidence
- Governance: Comment, Approve Deviation, Revision History, Save Revision

**Connection Lines (user-configurable default colours):**
| Line Style | Default Colour | Media Type |
|---|---|---|
| Solid thick | Orange (#F4A624) | SM fibre |
| Solid thick | Red (#E8443A) | MM fibre (OM4) |
| Solid thick | Blue (#1A5DAD) | Cat6a / Cat5e copper |
| Dashed thick | Green (#2CB67D) | Stack cable |
| Dotted | Purple (#8B5CF6) | DAC / Twinax |
| Dotted thin | Grey (#94A3B8) | Power (for power chain overlay) |

These are defaults. Users can change colours per connection type in Project Settings → Connection Types.

### 12.3 Rack Elevation Rendering

- Accurate port grids from catalogue data
- Front/rear toggle
- Port-level interaction (click any port)
- Port status colouring: Green = connected/tested, amber = designed/not yet patched, red = faulty, grey = available
- Device labels: model, hostname, serial (configurable visibility)
- Connection lines with media colour coding
- Scale accuracy per catalogue spec
- U-numbering: RU1 at bottom, RU42 at top (bottom-up)
- Equipment-name labels must not obstruct hardware drawings

### 12.4 Custom Stencils

Organisation admins can upload custom SVG icons. Supports organisation library, project library, and personal library (see Section 3.6C for full import specification).

---

## 13. Technical Specifications

### 13.1 Stack

- **Frontend:** React with existing state management (designStore.js)
- **Backend:** Node.js/Express
- **Database:** PostgreSQL with row-level security for tenant isolation
- **Auth:** Existing access/share token system + SSO/SAML
- **File storage:** S3-compatible with AES-256 encryption
- **Real-time:** WebSocket for live progress, presence, and port locking
- **Search:** Full-text search across devices, connections, hostnames, serial numbers
- **Hosting:** EU-based cloud infrastructure (AWS eu-central-1 Frankfurt or equivalent)
- **CDN:** For static assets and catalogue images
- **Monitoring:** Application performance monitoring, error tracking, uptime monitoring

### 13.2 API Design

Every module exposes CRUD endpoints following existing API patterns:

```
// Project hierarchy
POST   /api/projects
GET    /api/projects/:projectId
POST   /api/projects/:projectId/sal-codes
GET    /api/projects/:projectId/buildings/:buildingId

// CMO Inventory
POST   /api/sal/:salId/cmo/import
GET    /api/sal/:salId/cmo/devices
PUT    /api/sal/:salId/cmo/devices/:id/validate

// Survey
GET    /api/buildings/:buildingId/survey/forms
POST   /api/buildings/:buildingId/survey/rooms/:roomId/submit
PUT    /api/buildings/:buildingId/survey/rooms/:roomId/verify

// HLD
GET    /api/buildings/:buildingId/hld
PUT    /api/buildings/:buildingId/hld
POST   /api/buildings/:buildingId/hld/devices
POST   /api/buildings/:buildingId/hld/connections
POST   /api/buildings/:buildingId/hld/versions

// LLD
GET    /api/buildings/:buildingId/lld
GET    /api/buildings/:buildingId/lld/port-schedule
GET    /api/buildings/:buildingId/lld/cable-schedule

// Solution Package
POST   /api/buildings/:buildingId/solution-package/compile
PUT    /api/buildings/:buildingId/solution-package/:id/submit
PUT    /api/buildings/:buildingId/solution-package/:id/approve
PUT    /api/buildings/:buildingId/solution-package/:id/reject

// BOM
GET    /api/buildings/:buildingId/bom
PUT    /api/buildings/:buildingId/bom/items/:id/status
GET    /api/buildings/:buildingId/bom/export

// Deployment
GET    /api/buildings/:buildingId/deployment/devices
PUT    /api/buildings/:buildingId/deployment/devices/:id
POST   /api/buildings/:buildingId/deployment/devices/:id/photos
POST   /api/buildings/:buildingId/deployment/devices/:id/exceptions

// CMDB
GET    /api/buildings/:buildingId/cmdb/assets
GET    /api/buildings/:buildingId/cmdb/cable-matrix
GET    /api/buildings/:buildingId/cmdb/port-connectivity/:deviceId
GET    /api/buildings/:buildingId/cmdb/audit-log

// DGUV
GET    /api/buildings/:buildingId/dguv/status
GET    /api/projects/:projectId/dguv/report

// Catalogue
GET    /api/catalogue/devices?vendor=Cisco&category=switch&poe=true&ports=48
POST   /api/catalogue/devices

// Users & Auth
POST   /api/auth/login
POST   /api/auth/sso/saml
POST   /api/projects/:projectId/invite

// Documents
POST   /api/buildings/:buildingId/documents/generate

// Concurrency
WS     /ws/buildings/:buildingId/presence
WS     /ws/buildings/:buildingId/locks
```

### 13.3 Export Formats

| Export | Format | Content |
|---|---|---|
| BOM | Excel (.xlsx) | Quantities, specs, procurement status |
| Cable schedule | Excel (.xlsx) | All connections in SC format |
| Port schedule | Excel (.xlsx) | All ports with mapping |
| Cable matrix | Excel (.xlsx) | Every port, every connection |
| HLD diagram | PDF, PNG, SVG | Physical/logical topology |
| LLD diagram | PDF, PNG, SVG | Rack elevations with connections |
| Solution Package | PDF, Word | Complete design package |
| Survey report | PDF | Room data with photos |
| Deployment report | PDF | Installation records with photos |
| Handover package | ZIP | All documents compiled |
| Design file | JSON | Portable backup/transfer |
| CMDB extract | CSV, JSON | For external CMDB import |
| Audit log | CSV, PDF | Compliance documentation |
| DGUV report | PDF, Excel | Inspection status across project |

### 13.4 Shared Data Model Requirements

The interfaces designed require a shared data model rather than independent page-specific records. At minimum, the following entities and relationships must persist across stages:

| Entity | Required Relationships |
|---|---|
| Location | Country, site, campus, building, floor, room and geographical coordinates |
| Rack | Room, rack identifier, front/rear orientation, RU capacity and installed objects |
| Device | Role, model, hostname, serial, MAC, asset ID, lifecycle and acceptance |
| Port | Device, port identifier, media capability, state and assigned connection |
| Connection | Source/destination device and port, panel/RU, cable ID, medium, length, SFP, speed and status |
| Design baseline | Approved HLD, LLD, Solution Package and BOM version |
| Installation record | Technician, timestamp, scanned identifiers, evidence, test result and deviation |
| Validation record | Rule, result, warning/error, resolution, approver and revision |

---

## 14. Rackium Editor

The Rackium Editor is the controlled visual workspace for creating, correcting and maintaining infrastructure records throughout the lifecycle. It is **not** a free-form diagramming tool. Every editable object is connected to structured project data and downstream outputs.

### 14.1 Functional Scope

| Editing Area | Principal Functions |
|---|---|
| Site layout | Create and modify buildings, floors, communication rooms, pathways and racks |
| Rack layout | Front and rear elevations, RU placement, switches, patch panels, cable managers, shelves, PDUs and other rack components |
| Topology | Create or amend Fusion, Border, optional Distribution, Edge, AP and endpoint relationships |
| Connectivity | Select source and destination ports; define patching, SFP, cable medium, length, speed and cable ID |
| As built | Record installed serial/MAC data, location, evidence, actual connectivity and approved deviations |
| Governance | Comments, validation, approval of deviations, revision history, undo/redo and saved revisions |

### 14.2 Editor Toolbar

A two-row contextual toolbar:

| Toolbar Row | Behaviour | Representative Actions |
|---|---|---|
| **Row 1: Core tools** | Always visible | Select, Pan, Zoom In/Out, Fit View, Undo, Redo, Duplicate, Delete, Validate, Save Revision |
| **Row 2: Contextual tools** | Changes with the active mode (Site, Rack, Device, Connectivity, Installation) | Add Device, Install in RU, Move/Replace Device, Select Ports, Create/Remove Uplink, Change Patch, Change SFP, Change Cable Type/Length, Add Evidence |

### 14.3 Editor Navigation and Port Mapping Workflow

The editor interaction is a layered workflow that preserves complete navigational visibility:

1. Keep the complete building, floors and rooms visible but locked and faded in grey.
2. Activate the selected communication room and rack in Rackium blue.
3. Open the selected 42RU rack as a larger front-elevation overlay while keeping the site context visible.
4. Select the required device at its real RU position.
5. Open the authoritative switch face and select the source port.
6. Select the destination patch panel at its real RU position.
7. Open the authoritative patch-panel face and select the destination port.
8. Populate the right-side Source and Destination expander with room, rack, RU, source port, destination port, cable type, cable ID and status.
9. Validate the mapping, apply it and save a new revision.

**Example mapping:**

| Field | Example |
|---|---|
| Source device | E-DE-ERL-C01-B001-F001-001 |
| Source location | TR-11 / selected rack / RU40 |
| Source port | Gi1/0/12 |
| Destination device | PP-01 |
| Destination location | Same rack / RU42 |
| Destination port | Port 09 |
| Cable type | Cat6A |
| Cable ID | 10010012 (default 8-digit) or user-entered free-text |

### 14.4 NexAI Cable-Length Suggestion

The platform's cable-length suggestion considers:
- RU separation between source and destination
- Horizontal and vertical cable managers in the path
- Side routing requirements
- Bend radius at turns
- Front-to-rear travel where applicable
- Service loop allowance
- Maintenance allowance

**Three length values tracked per connection:**

| Length Type | Description |
|---|---|
| **Suggested Length** | NexAI-calculated recommendation based on routing factors |
| **Engineer Selected Length** | The standard cable length the engineer chooses (from available stock lengths) |
| **Installed Length** | The actual length recorded during deployment |

**Example calculation:**

| Factor | Value |
|---|---|
| Estimated routed distance | 1.35 m |
| Routing and service allowance | 0.45 m |
| Recommended standard cable | 2 m |
| Editor action | Change Length |
| Downstream effect | Accepted length updates draft BOM, installation record and CMDB |

---

## 15. What This Brief Does NOT Cover

Explicitly out of scope for this development phase:

- Offline PWA mode for mobile (browser offline + localStorage sync is sufficient for now)
- API for third-party integrations (future — NexOps, ServiceView, Zabbix, PRTG, ServiceNow, NetBox)
- QR code / barcode label generation and scanning (future — device scanner uses manual entry for now)
- Floor plan image upload and visual overlay mapping (future)
- VLAN / subnet / IP address management beyond documentation (future)
- Automated device discovery via SNMP/LLDP (never — not in scope)
- White-labeling for resellers (future)
- Mobile-native app (future — responsive browser is sufficient)
- Billing and subscription management (handled separately)
- Multi-language / localisation (future)
- IMO (Intermediate Mode of Operation) support (future — CMO and FMO are sufficient for now)
- Pricing in BOM (explicitly excluded — Rackium handles quantities, not prices)
- Live monitoring and configuration push (outside defined Rackium scope unless separately approved)

---

## 16. Development Sequencing

Build in this order. Each phase depends on the previous one.

**Phase A — Foundation (extend existing)**
1. Data model: implement project hierarchy (Org → Project → Country → SAL → Campus → Building → Floor → Room → Rack)
2. Project creation wizard and settings module
3. Navigation: left sidebar with project tree + phase navigation
4. Building overview dashboard with 9-phase pipeline
5. Catalogue system: device database with seeded data (Cisco first), SERVON import, admin panel
6. Role system: extend existing auth for Owner, Architect, Field Engineer, Reviewer, Procurement, Viewer
7. Network iconography library (SVG icon set including editor icons)
8. Security foundation: encryption at rest + in transit, session management, tenant isolation
9. Design system and component library (see Section 22)
10. Shared data model implementation (Section 13.4)

**Phase B — Survey**
1. Survey form builder (drag-drop field types, form templates)
2. CMO inventory upload and validation system
3. Device scanner field type with CMO auto-validation
4. NexAI-assisted rack capture workflow
5. Survey execution mobile interface (responsive, offline-capable)
6. Photo upload with GPS + timestamp + annotation
7. Survey progress tracking dashboard
8. Verification workflow (submit → verify → import)

**Phase C — HLD**
1. Interactive HLD canvas (drag-drop, connection drawing, colour-coded lines, bend points, snap-to-grid)
2. Site Blueprint Templates (S/M/L/XL with variants)
3. Device placement with role selection and equipment picker
4. NexAI-suggested HLD topology
5. Smart equipment suggestions from catalogue
6. Connection drawing with media/speed selection and SFP auto-suggestion
7. Stacking workflow (create stack → auto-add cables)
8. Power distribution visualisation (UPS → PDU → device chain)
9. Environmental elements (cooling, raised floor from survey)
10. Cable pathway routing with survey data linking
11. CMO overlay (ghost icons for existing devices)
12. Logical topology view with full object library
13. Canvas UX: layers, multi-page, properties panel, search, minimap, annotations, copy/paste, undo/redo
14. Stencil import (SVG, PNG, Visio .vssx)
15. Validation engine integration
16. Version control with save/diff/branch
17. Generate HLD export (PDF/PNG/SVG)

**Phase D — LLD + Rackium Editor**
1. Extend existing rack designer as "Rack elevations" with catalogue-accurate port layouts and authoritative device artwork
2. Physical connections view with cross-rack cable routing and port-level interaction
3. Rackium Editor: two-row toolbar, layered navigation, port mapping workflow (9-step)
4. Professional cable routing model (bundled, orthogonal, media-separated)
5. NexAI cable-length suggestion with three length values
6. Port-level management (per-port editing, VLAN, PoE)
7. Port schedule and cable schedule tables (auto-generated)
8. Connection detail panel (full hop-by-hop route visualisation)
9. Concurrent editing with port-level locking and WebSocket presence
10. MDF-to-IDF fields marked TBD for deployment

**Phase E — Solution Package**
1. Three-page structure (Suggested SP, Required Inputs, Validation & Approval Readiness)
2. Auto-compilation from design data
3. NexAI validation and reconciliation checks
4. Approval workflow with design freeze
5. Change request management post-approval
6. Word/PDF export

**Phase F — BOM**
1. Auto-generation from HLD + LLD data (including PSUs, SFPs, stack cables, power cables)
2. NexAI BOM analysis and validation
3. Source traceability tags
4. Procurement status tracking
5. SERVON product flagging
6. Export BOM (Excel)
7. Send for review workflow

**Phase G — Deployment**
1. Topology-based deployment view reusing established canvas
2. Deployment lifecycle states (Pending → Installed → Ready)
3. Per-device deployment record with serial/MAC/GPS capture
4. NexAI deviation detection (cable/SFP mismatches)
5. Installation checklist with DGUV step
6. MDF-to-IDF patching capture
7. Exception logging with photo evidence
8. Live progress updates (real-time stats)

**Phase H — CMDB + Handover**
1. Primary CMDB page: CI inventory with full detail view
2. Port Connectivity page with scrollable 48-port register
3. Professional cable routing visualisation (bundled model)
4. Cable matrix view with hop-by-hop detail
5. NexAI reconciliation (as-built vs design)
6. Lifecycle dashboard (warranty, refresh, DGUV)
7. Post-deployment edit capability
8. CMDB export (CSV, JSON, PDF)
9. Handover pre-compilation checklist
10. Handover document generation
11. Sign-off workflow with digital signature
12. Post-handover read-only lock

**Phase I — Platform Hardening & Project Management**
1. SSO/SAML integration
2. MFA enforcement
3. Penetration testing
4. GDPR compliance review
5. Export watermarking and download tracking
6. Notification system (in-app + email) including DGUV alerts
7. Task assignment system
8. Custom validation rules builder
9. Document generation engine (branded PDFs)
10. Version control diff visualisation
11. Timeline & milestone tracking with Gantt view
12. Resource allocation and workload management
13. Multi-level progress dashboards
14. Blockers & dependency tracking
15. SLA & deadline tracking with burn-down charts
16. Reporting & analytics engine
17. DGUV inspection tracking system
18. Configurable device naming convention with hover tooltips

---

## 17. Reference UI Specification

See the accompanying HTML file `rackium-reference-ui.html` for interactive reference implementations of:
1. Building Overview dashboard
2. HLD design canvas with floor-based topology, validation tooltips, and object library
3. LLD design with rack elevations, connection schedule, and uplink detail panel
4. BOM with source traceability and procurement tracking
5. Deployment with rack face view, installation checklist, and as-built capture

These reference UIs define the visual language, spacing, typography, and component design. They are the visual source of truth. The developer must match their look, feel, and interaction patterns.

**The HLD canvas must feel like Cisco Packet Tracer meets Ekahau — industry-standard network icons, drag-drop placement, colour-coded connections, real-time validation, and the polish that makes users never want to open Visio again.**

---

## 18. Contextual Field Help System (Inline Tooltips)

**Problem:** Engineers leave fields empty not because they don't have the data, but because they don't understand what's being asked.

**Solution:** Every field in Rackium has a contextual help tooltip — a small ⓘ icon next to the field label. Tap/hover to see:

1. **What this field means** — plain language explanation
2. **What to look for** — physical description of what to find on-site
3. **Example value** — a real example of a correct entry
4. **Reference photo** — a labelled image showing where to find this information
5. **Common mistakes** — what NOT to enter

**Reference image library:** The platform ships with reference photos for common equipment elements (power socket types, fibre connectors, cable categories, rack rail types, port types, LED colours, rack types, AP mounting, cable tray types).

**Admin customisation:** Organisation admins can edit tooltip text, upload custom reference photos, and add new fields with tooltips.

---

## 19. Auto Cable Length Calculation

### 19.1 Same Rack (Automatic — Zero Input)

```
Formula: cable_length = (|ru_source - ru_dest| × 0.045m) + slack_allowance
Where: 0.045m = standard RU height, slack_allowance = 0.5m

Example: Device A at RU 38, Device B at RU 22 → 16 RU → (16 × 0.045) + 0.5 = 1.22m → rounded to 1.5m
```

Standard cable lengths: 0.3m, 0.5m, 1m, 1.5m, 2m, 3m.

### 19.2 Same Room, Different Racks (Automatic — Survey Provides Input)

```
Formula: cable_length = (rack_spacing × |rack_sequence_source - rack_sequence_dest|) + 
                         vertical_routing + slack_allowance
Where: rack_spacing = default 0.8m, vertical_routing = 1.5m default, slack_allowance = 1m
```

### 19.3 Different Rooms / Different Floors (Survey Pathway Data)

```
cable_length = surveyed_pathway_length + entry_exit_allowance (2m)
```

If no surveyed pathway exists → system flags with info warning and uses straight-line estimate.

### 19.4 NexAI Enhanced Cable Length (Editor Integration)

When used within the Rackium Editor (Section 14), cable length calculation additionally considers:
- Horizontal and vertical cable manager positions
- Side routing requirements
- Bend radius at turns
- Front-to-rear travel
- Service loop and maintenance allowance

The result feeds into three tracked values: Suggested Length, Engineer Selected Length, and Installed Length (see Section 14.4).

### 19.5 How It Feeds the BOM

Every auto-calculated cable length flows into the BOM with correct specification, rounded to next standard length, with source tag "Auto-calculated from design." The BOM groups identical cables.

---

## 20. Complementary Fields & Quality-of-Life Features

### 20.1 Pre-fill / Validate / Capture Workflow

Every field has an origin tag:

| Origin | Badge | Who Fills | When |
|---|---|---|---|
| Pre-filled | 🔵 | Architect | Before survey |
| Validate | 🟣 | Engineer validates pre-filled data | During survey |
| Survey | 🟢 | Engineer captures new data | During survey |
| Post-survey | 🟠 | Architect | After survey |

### 20.2 Bulk Import from Existing Data Sources

- Switchport report import → auto-populates device hostnames, port statuses, MAC addresses
- Asset inventory import → auto-populates device models, serials, locations
- Floor plan import (PDF/image) → attached as reference overlay

### 20.3 Connection Traceability Status

| Status | Meaning | Visual |
|---|---|---|
| Fully traced | Source and destination physically verified | Solid line |
| Partially traced | Source verified, cable route not followed | Dashed line |
| Not traceable | Cable exists but route cannot be followed | Dotted line |
| Marker identified | Cable has physical marker but not traceable | Dotted + marker icon |
| Estimated | No physical verification, assumed from data | Light grey dotted |

### 20.4 LED Port Status Capture

During survey, for every port: Green (up/active), Amber (link/no traffic), Off (no connection), Blinking (activity). Simple colour-coded toggle button. Feeds validation against switchport report data.

### 20.5 Distance Between Devices

Simple number field in metres for WAN CPE and core switch connections. Used for cable length estimation and BOM calculation.

### 20.6 EOS/EOL Status Tracking

End of Sale date, End of Support date, EOS/EOL label visibility on device. Feeds CMDB lifecycle dashboard and BOM replacement flagging.

### 20.7 Floor Plan Attachment

Each floor can have an attached floor plan (PDF/image). Viewable as reference alongside HLD canvas. APs and endpoints can be roughly positioned. Future scope: interactive overlay mapping with Ekahau-style heatmaps.

### 20.8 Photo Organisation & Annotation

**Required photos:** Room overview, rack front/rear, device label, AP mounting, pathway, patch panel, PDU/UPS.

**Annotation tools (mobile):** Arrow, circle, text label, measurement line, auto-watermark (GPS + timestamp + surveyor + location).

**Photo gallery:** Organised by Floor → Room → Rack → Device. Searchable, filterable, exportable as ZIP.

### 20.9 DGUV Inspection Status Tracking

DGUV (Deutsche Gesetzliche Unfallversicherung) electrical safety inspections are mandatory for electrical equipment in German workplaces. Rackium tracks DGUV inspection validity at the device level and surfaces compliance status at every dashboard level.

#### 20.9.1 Device-Level Fields

| Field | Type | Description |
|---|---|---|
| `dguv_required` | Boolean | Whether this device requires DGUV inspection (default: true for active powered equipment) |
| `dguv_last_inspection_date` | Date | Date of most recent DGUV inspection |
| `dguv_next_inspection_date` | Date | Date when next inspection is due |
| `dguv_inspection_interval_months` | Integer | Inspection interval (default: 48 months, configurable) |
| `dguv_inspector` | String | Name/ID of the inspector or inspection company |
| `dguv_certificate_reference` | String | Reference number of the inspection certificate |
| `dguv_status` | Enum | `valid`, `expiring_soon`, `expired`, `not_inspected`, `exempt` |
| `dguv_evidence` | File[] | Uploaded certificates or photographs of inspection stickers |

#### 20.9.2 Automatic Status Calculation

- **Valid** — next inspection >90 days away
- **Expiring soon** — within 90 days (configurable)
- **Expired** — past due
- **Not inspected** — required but no date recorded
- **Exempt** — not required (with mandatory reason)

#### 20.9.3 Dashboard Aggregation

DGUV status rolls up at every level: device detail → rack elevation → room → floor → building → project.

#### 20.9.4 Notifications

| Trigger | Notification | Recipients |
|---|---|---|
| 90 days before expiry | "Device {hostname} DGUV inspection due on {date}" | PM, assigned technician |
| 30 days before expiry | Escalation — higher urgency | PM, site lead |
| On expiry date | "DGUV inspection EXPIRED for {hostname}" | PM, compliance officer |
| Bulk report | Weekly digest of upcoming/expired inspections | PM |

#### 20.9.5 Deployment Gate

During Deployment, the system warns (not blocks) if a device being installed has no DGUV inspection recorded. The deployment checklist includes a DGUV verification step.

#### 20.9.6 CMDB Integration

DGUV status is a first-class field in the CMDB device record. The lifecycle dashboard includes a DGUV compliance view.

### 20.10 Configurable Device Naming Convention

Rackium does not enforce a single device naming convention. Different clients, regions, and organisations follow different naming standards.

#### 20.10.1 Project-Level Naming Configuration

During project creation, the wizard includes a Naming Convention step where the user defines:

1. **Device role labels** — free-text role names and abbreviation codes
2. **Naming pattern** using placeholders: `{role}-{country}-{sal}-{campus}-{building}-{floor}-{seq}` plus `{room}`, `{rack}`, and `{custom1}` through `{custom3}`. Separator configurable (hyphen, underscore, dot, or none).
3. **Live preview** — "Your devices will be named like: `CS-DE-ERL-C01-B001-F02-004`"

#### 20.10.2 Hover Explanation

Everywhere a device name appears, hovering displays a tooltip breaking down each segment:
```
CS-DE-ERL-C01-B001-F02-004
├── CS     → Core Switch (role)
├── DE     → Germany (country)
├── ERL    → Erlangen (SAL code)
├── C01    → Campus 01
├── B001   → Building 001
├── F02    → Floor 02
└── 004    → Sequence 4
```

This tooltip is generated dynamically from the project's naming configuration.

#### 20.10.3 Auto-Naming

When a device is placed, the system auto-suggests a name based on role, location, and next sequence number. The user can accept or override. Manual naming is always allowed.

#### 20.10.4 Naming Validation

- Device names must be unique within a project
- Duplicates auto-increment sequence number with warning
- Devices deviating from convention flagged as informational (not blocking)

---

## 21. Project Management Suite

### 21.1 Phase Target Dates

For each building/SAL code scope, the project manager sets target completion dates for every phase:

| Phase | Target date | Actual completion | Status |
|---|---|---|---|
| Survey | 2026-10-15 | 2026-10-12 | ✅ Complete (3 days early) |
| HLD | 2026-10-30 | — | 🟡 In progress |
| LLD | 2026-11-15 | — | ⬜ Not started |
| Solution Package | 2026-11-22 | — | ⬜ Not started |
| BOM | 2026-11-30 | — | ⬜ Not started |
| Deployment | 2026-12-20 | — | ⬜ Not started |
| CMDB | 2026-12-31 | — | ⬜ Not started |
| Handover | 2027-01-10 | — | ⬜ Not started |

### 21.2 Gantt View

- All buildings in the project as rows
- Phase bars colour-coded by status
- Dependencies between phases
- Today marker
- Critical path highlighting
- Draggable phase bars for PM (others read-only)

### 21.3 Milestone Definitions

Standard milestones tied to phase transitions: Survey Complete, HLD Approved, LLD Approved, Solution Package Approved, BOM Approved, Materials Ordered, Materials Delivered, Installation Complete, CMDB Accepted, Handover Complete. Custom milestones can be added per project.

### 21.4 Risk Indicators

| Condition | Indicator | Rule |
|---|---|---|
| On track | 🟢 | Progress ahead of or on schedule |
| At risk | 🟡 | Within 80% of target date but <50% complete (configurable) |
| Overdue | 🔴 | Target date passed, phase not complete |
| Blocked | ⛔ | Dependency or blocker prevents progress |

### 21.5 Resource Allocation & Workload

**Team assignment roles:** Project Manager, Network Architect, Field Technician, Reviewer, Procurement — each with scope and capabilities.

**Building assignment:** Each building has primary architect and primary technician. Dashboard shows workload per person: buildings assigned, current phase, overdue items.

**Workload matrix view:** Team member × building with task counts and totals.

### 21.6 Multi-Level Progress Dashboards

**Project-level:** Buildings by phase (bar chart), overall progress %, overdue buildings, open validation errors, DGUV compliance, team utilisation.

**Country/Region rollup:** Country, SAL codes, buildings, avg progress, overdue count, BOM value.

**Organisation-level:** All active projects with client, buildings, progress, status; projects at risk; total BOM value; cross-project resource utilisation.

### 21.7 Blockers & Dependencies

**Phase dependencies:** Configurable per project — PM can allow parallel work but must explicitly enable.

**Blocker records:** Auto-ID, building, phase, category (`survey_incomplete`, `awaiting_client_info`, `awaiting_approval`, `technical_issue`, `procurement_delay`, `site_access`, `resource_unavailable`, `other`), description, assigned resolver, priority, status, resolution, dates.

**Visibility:** Red banner on building dashboard, hatched bar on Gantt view, summary on project dashboard, notifications for overdue blockers.

**Cross-building dependencies:** PM can create links between buildings (e.g. B001 must deploy before B002).

### 21.8 SLA & Deadline Tracking

**Project-level SLAs:** Contractual deadlines with status indicators.

**Risk alerts:**
- SLA at risk — linear projection will miss date → notification to PM
- SLA breached — date passed → escalation to PM and owner
- Phase overdue → notification to PM and assigned person

**Burn-down view:** Time vs remaining work items with ideal line and actual line.

### 21.9 Reporting & Analytics

**Standard reports:** Weekly Status, Resource Utilisation, BOM Summary, Survey Progress, Compliance, Design Change, Installation Progress.

**Delivery:** On-demand (PDF or in-platform), scheduled (weekly/monthly email), export (PDF, CSV/Excel).

**Analytics dashboard:** Phase duration averages, blocker frequency, BOM accuracy variance, survey completion rates by technician, approval turnaround times, trend lines.

---

## 22. UI/UX Design System

### 22.1 Design System & Component Library

Rackium must be built on a consistent design system. All UI components share the same visual language, spacing, typography, and interaction patterns.

**Core design tokens:**
- **Primary colour:** Rackium blue (#094F9A)
- **Text:** Black for all active text (per locked visual standard)
- **Status colours:** Green (complete/ready), Amber (pending/warning), Red (error/conflict), Grey (inactive/locked)
- **Typography:** System font stack (Inter or similar sans-serif), with consistent heading sizes, line heights, and weights
- **Spacing:** 4px base unit grid; margins and padding use multiples of 4
- **Border radius:** 4px for inputs and buttons, 8px for cards and panels
- **Shadows:** Subtle elevation (1px, 2px, 4px) for cards, modals, and overlays

**Component library (shared across all modules):**
- Buttons (primary, secondary, ghost, destructive, icon-only)
- Form inputs (text, number, dropdown, multi-select, checkbox, radio, date picker, search)
- Tables (sortable columns, filterable, row selection, bulk actions, export button)
- Cards (status cards with colour-coded indicators)
- Modal dialogs (confirm, form, full-screen for rack elevation)
- Side panels (collapsible right-side properties panel)
- Tabs (phase tabs, sub-tabs within modules)
- Tree views (project hierarchy, location tree, deployment tree)
- Progress indicators (linear, circular, step indicators)
- Badges (status, count, validation severity)
- Tooltips (field help, device name breakdown, validation messages)
- Toast notifications (success, error, warning, info)
- Empty states (per module — what to do when no data exists)

### 22.2 Responsive Breakpoints

| Breakpoint | Width | Target | Layout Behaviour |
|---|---|---|---|
| Desktop XL | ≥1440px | Primary architect workstation | Full layout with side panels |
| Desktop | ≥1024px | Standard desktop | Full layout, side panels collapsible |
| Tablet landscape | ≥768px | iPad / survey tablet | Simplified layout, side panel becomes bottom sheet |
| Tablet portrait | ≥600px | Tablet in portrait | Survey-focused layout, canvas disabled |
| Mobile | <600px | Phone / field engineer | Survey execution and deployment checklists only; no canvas editing |

The HLD/LLD canvas is desktop-only (≥1024px). Survey forms and deployment checklists must work at all breakpoints. The building dashboard must be readable on tablet.

### 22.3 Navigation Behaviour

**Left sidebar:** Collapsible project tree. Always visible on desktop, slide-out drawer on mobile/tablet. Shows: Organisation → Projects → Countries → SAL codes → Buildings. Current location highlighted. Breadcrumb trail at the top of the content area mirrors the tree selection.

**Top bar:** Phase tabs (Overview, Survey, HLD, LLD, Solution Package, BOM, Deployment, CMDB, Handover). Phase completion indicators on each tab. Active tab highlighted in Rackium blue.

**Keyboard navigation:** Tab through interactive elements. Enter to activate buttons and links. Escape to close modals and panels. Arrow keys for tree navigation.

### 22.4 Loading States and Empty States

**Loading states:**
- Skeleton screens (content-shaped placeholders) for initial page loads — not spinners
- Inline loading indicators for data refresh within an already-loaded page
- Progress bar for long operations (BOM generation, document compilation, bulk import)

**Empty states (per module):**
- Survey: "No survey forms created yet" + "Create survey form" button
- HLD: Empty canvas with centre prompt "Drag a device from the library to start designing" + object library visible
- LLD: "Import devices from HLD to begin" + import button
- BOM: "BOM will be generated from your approved design" + status of prerequisite phases
- Deployment: "Awaiting BOM delivery" + checklist of prerequisites
- CMDB: "CMDB will be populated from deployment records" + deployment progress
- Each empty state includes a brief explanation of what needs to happen first and a single clear action

### 22.5 Notification Centre UI

**Bell icon in top-right corner** with unread count badge.

**Notification panel (dropdown or side panel):**
- Tabs: All | Unread | Mentions
- Each notification: icon (type), title, description, timestamp, action link
- Mark as read (individual or all)
- Link to source (clicking a validation notification opens the specific device/connection)
- Grouped by day

**Notification types:** Survey submitted/reviewed, Design approved/rejected/changes requested, Task assigned/completed, Validation issue raised/resolved, BOM status changed, Deployment progress, DGUV expiry warning, Blocker raised/resolved, Comment/mention.

### 22.6 Table Interaction Patterns

All data tables across the platform follow consistent patterns:

- **Column sorting:** Click header to sort ascending/descending. Active sort column highlighted.
- **Column filtering:** Filter icon per column header. Text filter, dropdown for enums, date range for dates.
- **Global search:** Search bar above table searches across all visible columns.
- **Row selection:** Checkbox per row for bulk actions. Select all checkbox in header.
- **Bulk actions:** Toolbar appears above table when rows selected (export selected, assign, change status).
- **Pagination or infinite scroll:** Configurable. Default: 50 rows per page.
- **Column visibility:** Gear icon to show/hide columns. User preference saved.
- **Export:** Export button exports current filtered/sorted view as Excel or CSV.
- **Inline editing:** Double-click a cell to edit (where permitted). Save on blur or Enter. Escape to cancel.

### 22.7 Onboarding & First-Use Experience

**First project creation:**
- Guided wizard with progress indicator (3 steps — Identity, Structure, Team)
- Pre-filled example values in each field (greyed placeholder text showing what a valid entry looks like)
- "Skip for now" on optional steps (team invitation can happen later)

**First HLD canvas use:**
- One-time interactive overlay highlighting key areas: object library, canvas area, toolbar, properties panel
- Dismissible with "Got it" button and "Don't show again" checkbox
- Available again from Help menu

**First survey execution (mobile):**
- Brief walkthrough highlighting: photo capture, device scanner, offline indicator, save/submit buttons
- Dismissible

**Help menu:**
- "What's new" — changelog for recent updates
- "Keyboard shortcuts" — full list
- "Field Reference Guide" — visual dictionary of equipment (from Section 18)
- "Contact support" — link to Technonex support

---

## 23. Network Iconography — Source & Licensing

### 23.1 Icon Sources

~50-80 distinct network device icons needed. Three strategies in priority order:

1. **Custom SVG Icon Set (Recommended)** — own IP, clean modern flat design, 64×64px base with scalable SVG, two states per icon (filled + outlined), colour variants for all states. Using established 32×32 source grid, Rackium blue #094F9A, 1.65px rounded stroke.

2. **Open-Source Libraries** — Cisco Design Toolkit (free, industry standard), Material Design Icons (Apache 2.0), Lucide Icons (ISC), Tabler Icons (MIT)

3. **Commercial Libraries** — Noun Project, Flaticon, Iconfinder

### 23.2 Recommended Approach

Start with Cisco Design Toolkit for network devices, Lucide/Material Design for UI elements, then commission custom versions of the top 20 most-used icons in Rackium's brand style.

### 23.3 "Not Traceable" Visual Convention

- Dashed connection line = cable route not physically traced
- "Not traceable" badge on connection record
- Marker label field for physical markers
- Validation engine counts un-traced connections

---

## 24. Customisation Propagation Matrix

When the architect changes a project-level setting, the system must propagate the change consistently:

| Setting Changed | Propagation Scope | Behaviour |
|---|---|---|
| Device role renamed | All devices with that role across all buildings | Labels update everywhere (HLD, LLD, BOM, CMDB). Historical audit records retain the original name at time of action. |
| Connection type colour changed | All connections of that media type | Canvas lines re-colour. Existing PDFs are NOT regenerated — only new exports use new colours. |
| Naming convention pattern changed | Future devices only | Existing device names are NOT retroactively renamed. New devices use new pattern. User can manually trigger "re-apply convention" per building if desired. |
| Custom validation rule added | All buildings in the project from next validation run | Existing validation findings are not affected. New rule runs on next validation trigger and may surface new findings. |
| Cable length default changed (rack spacing, slack) | Future calculations only | Existing cable lengths are NOT recalculated. BOM quantities are NOT automatically updated. User can trigger "recalculate all cable lengths" per building. |
| Survey form template updated | Future survey submissions only | Existing submitted surveys are NOT affected. New form version applies only to rooms not yet submitted. |

---

*End of brief. Version 2.2 — 2026-09-28.*
*Rackium: Survey to Handover. One Platform. Zero Excel.*
