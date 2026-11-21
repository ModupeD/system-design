// The Architecture Explorer: an interactive map of this project's components.
//   - boxes come from components.js
//   - "Source-code dependencies" arrows come from your real imports (/dev/imports)
//   - code excerpts come from your real files (/dev/source)
//   - the highlighted path after a request comes from the server's recorded trace

import * as api from "./api.js";
import { COLUMNS, COMPONENTS, LAYERS, RUNTIME_EDGES, STARTUP_EDGES, fileToNodeMap, isActiveAdapter } from "./components.js";
import { $, $$, el, fill, httpBadge, sleep, statusBadge, svgEl } from "./dom.js";
import { conceptualPlaceOrderSteps, toDisplaySteps } from "./trace.js";

const SOURCE_LABEL = {
  browser: "browser",
  recorded: "recorded",
  inferred: "inferred",
  conceptual: "conceptual",
  missing: "not recorded",
};

const MODE_TEXT = {
  runtime: [
    el("strong", {}, "Runtime flow: "),
    "arrows show who CALLS whom while a request is handled. The map itself is conceptual; after you run a scenario, the highlighted path and the numbered steps are the ",
    el("em", {}, "recorded"),
    " calls. Notice the direction on the right-hand side: PlaceOrderService → PaymentGateway → FakePaymentGateway. Calls travel OUT of the core, through an output port, into an adapter. Faded dashed arrows lead to adapters that exist but aren't plugged in right now.",
  ],
  source: [
    el("strong", {}, "Source-code dependencies: "),
    "arrows show ",
    el("code", {}, "import"),
    " statements, read live from your src/ folder. Every arrow points TOWARD the core: adapters import ports, services import ports and the domain, and the domain imports nothing outside itself. Compare the right-hand side with Runtime flow: FakePaymentGateway → PaymentGateway is reversed. That reversal is dependency inversion. Select buildApp() to see the one file that imports the concrete adapters.",
  ],
};

const SCENARIOS = [
  {
    id: "paid",
    title: "Successful payment",
    expect: "PAID",
    body: { customerId: "alice", items: [{ sku: "BOOK", quantity: 2 }] },
    about: "alice buys 2 × BOOK. $30 is under the fake gateway's $500 limit.",
    explain:
      "The full happy path. Watch the order get saved as PENDING BEFORE PaymentGateway.charge() runs, then saved again as PAID, then the Notifier is called. FakePaymentGateway answered because PAYMENTS=fake. With PAYMENTS=stripe-test the same PaymentGateway call would reach StripePaymentGateway, and nothing in the core would change.",
  },
  {
    id: "declined",
    title: "Declined payment",
    expect: "PAYMENT_FAILED",
    body: { customerId: "bob", items: [{ sku: "TV", quantity: 1 }] },
    about: "bob buys a TV ($800). The fake gateway declines anything over $500.",
    explain:
      "The decline is decided by the driven adapter (FakePaymentGateway), reported through the port as { status: \"declined\" }, and turned into a status change by the domain's markPaymentFailed(). The order is still saved: a decline is a valid, final outcome, not a crash, so HTTP answers 201 with status PAYMENT_FAILED.",
  },
  {
    id: "unknown",
    title: "Unknown payment outcome",
    expect: "PENDING → retry",
    body: { customerId: "timeout", items: [{ sku: "PEN", quantity: 1 }] },
    about: "Customer \"timeout\" makes the fake gateway simulate a lost connection on the first attempt.",
    explain:
      "The gateway can't tell whether money moved, so it returns { status: \"unknown\" }. PlaceOrderService does NOT call markPaymentFailed(); the order stays PENDING (it was saved before charging) and HTTP answers 202. Then press “Retry with the same Idempotency-Key”: the service finds the order with findByIdempotencyKey() and charges the SAME order id again, so a real provider could deduplicate the charge.",
  },
  {
    id: "invalid",
    title: "Invalid order (domain rule)",
    expect: "400",
    body: { customerId: "dave", items: [{ sku: "BOOK", quantity: 0 }] },
    about: "Quantity 0. The HTTP adapter accepts the SHAPE (it's a number); the domain rejects the VALUE.",
    explain:
      "The HTTP adapter only checks the shape. The rule “quantity must be a positive whole number” lives in createOrder() in src/domain/Order.ts, which throws a DomainError. Nothing is saved and PaymentGateway is never called. The HTTP adapter maps DomainError → 400; the CLI maps the same error to exit code 1.",
  },
  {
    id: "unknown-product",
    title: "Unknown product (server-side pricing)",
    expect: "400",
    body: { customerId: "erin", items: [{ sku: "CAR", quantity: 1 }] },
    about: "SKU CAR isn't in the catalog. A client can't invent products or prices.",
    explain:
      "PlaceOrderService asks the ProductCatalog port for each price. InMemoryProductCatalog has no CAR and returns undefined, so the service throws a DomainError before anything is saved or charged.",
  },
  {
    id: "idempotent",
    title: "Repeated request (idempotency)",
    expect: "same order, 1 charge",
    body: { customerId: "frank", items: [{ sku: "MUG", quantity: 1 }] },
    repeat: 2,
    about: "The identical request is sent twice with the same Idempotency-Key, like a client retrying after a dropped response.",
    explain:
      "Request 1 creates and charges the order. Request 2 calls OrderRepository.findByIdempotencyKey(), finds that order and returns it, with no createOrder(), no save and no PaymentGateway.charge(). Count the PaymentGateway steps in the timeline: there's exactly one, and both responses carry the same order id.",
  },
];

const DIP_EXCERPTS = [
  { file: "src/application/services/PlaceOrderService.ts", find: "import type { PaymentGateway }", lines: 1, caption: "① The use case imports the INTERFACE (arrow points inward)" },
  { file: "src/application/services/PlaceOrderService.ts", find: "const result = await payments.charge({", lines: 5, caption: "② …and calls it. At runtime this call goes OUT to an adapter" },
  { file: "src/application/ports/out/PaymentGateway.ts", find: "export interface PaymentGateway", lines: 4, caption: "③ The interface is defined and owned by the core" },
  { file: "src/adapters/driven/payment/FakePaymentGateway.ts", find: "import type { ChargeRequest", lines: 1, caption: "④ The adapter imports the core's interface (arrow points inward)" },
  { file: "src/adapters/driven/payment/FakePaymentGateway.ts", find: "export class FakePaymentGateway implements PaymentGateway", lines: 1, caption: "⑤ …and implements it" },
  { file: "src/composition/container.ts", find: 'payments: port(payments, "PaymentGateway"),', lines: 1, caption: "⑥ The composition root plugs the concrete adapter into the port" },
];

export function initExplorer() {
  const state = {
    mode: "runtime",
    selected: null,
    config: null,
    sourceEdges: undefined, // undefined = not loaded yet, null = unavailable
    run: null,
    steps: [],
    flowEdges: new Set(),
    visited: new Map(),
    playToken: 0,
    speed: 700,
    lastShopRun: null,
  };

  // ── Diagram ────────────────────────────────────────────────────────────
  const nodeEl = (id) => $(`.node[data-node="${id}"]`);

  function nodeButton(id) {
    const c = COMPONENTS[id];
    const isInterface = c.kind === "interface";
    return el(
      "button",
      {
        type: "button",
        class: `node layer-${c.layer}${isInterface ? " is-interface" : ""}`,
        "data-node": id,
        "aria-pressed": "false",
        "aria-label": `${c.title}, ${isInterface ? "interface" : c.kind}, ${LAYERS[c.layer].label}. Show details.`,
        onclick: () => select(id),
      },
      el("span", { class: "node-kind" }, isInterface ? "«interface»" : c.kind),
      el("span", { class: "node-title" }, breakable(c.title)),
      el("span", { class: "node-file", title: c.file }, c.file.split("/").pop()),
      el("span", { class: "node-status" }),
      el("span", { class: "node-steps", "aria-hidden": "true" }),
    );
  }

  const colHead = (title, subtitle) => el("div", { class: "col-head" }, el("span", { class: "col-title" }, title), el("span", { class: "col-sub" }, subtitle));

  fill($("#diagram"), 
    el("div", { class: "col col-driving" }, colHead("Driving adapters", "call into the app"), COLUMNS.driving.map(nodeButton)),
    el(
      "div",
      { class: "core" },
      el("div", { class: "core-label" }, "Application core: imports nothing from outside"),
      el(
        "div",
        { class: "core-cols" },
        COLUMNS.core.map((col) => el("div", { class: `col col-${col.layer}` }, colHead(col.title, col.subtitle), col.nodes.map(nodeButton))),
      ),
    ),
    el("div", { class: "col col-driven" }, colHead("Driven adapters", "implement output ports"), COLUMNS.driven.map(nodeButton)),
  );
  fill($("#composition-row"), 
    el("div", { class: "composition-label" }, "Outside the hexagon: composition root and entry points, which wire everything together"),
    el("div", { class: "composition-nodes" }, COLUMNS.composition.map(nodeButton)),
  );

  function edgeList() {
    const compositionSelected = state.selected && COMPONENTS[state.selected].layer === "composition";
    if (state.mode === "runtime") {
      const edges = RUNTIME_EDGES.map(([from, to, label]) => ({
        from,
        to,
        label,
        optional: COMPONENTS[to].layer === "driven" && isActiveAdapter(to, state.config) === false,
        network: from === "webUi",
      }));
      if (compositionSelected) edges.push(...STARTUP_EDGES.map(([from, to, label]) => ({ from, to, label, startup: true })));
      return edges;
    }
    if (!state.sourceEdges) return [];
    return [
      ...state.sourceEdges.filter((e) => compositionSelected || COMPONENTS[e.from].layer !== "composition"),
      { from: "webUi", to: "httpServer", label: "HTTP over the network (not an import)", network: true },
    ];
  }

  function drawEdges() {
    const wrap = $("#diagram-wrap");
    const svg = $("#edges");
    if (!wrap || wrap.offsetParent === null) return; // hidden tab: nothing to measure
    const box = wrap.getBoundingClientRect();
    svg.setAttribute("width", String(box.width));
    svg.setAttribute("height", String(box.height));
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);

    let layer = svg.querySelector("g.edges");
    if (!layer) layer = svg.appendChild(svgEl("g", { class: "edges" }));
    fill(layer);

    const sel = state.selected;
    const drawn = edgeList().map((e) => {
      const key = `${e.from}>${e.to}`;
      const touches = Boolean(sel && (e.from === sel || e.to === sel));
      const flow = state.flowEdges.has(key);
      return { ...e, touches, flow, weight: flow ? 2 : touches ? 1 : 0 };
    });
    drawn.sort((a, b) => a.weight - b.weight);

    for (const e of drawn) {
      const a = nodeEl(e.from);
      const b = nodeEl(e.to);
      if (!a || !b) continue;
      const cls = [
        "edge",
        e.optional && "edge-optional",
        e.startup && "edge-startup",
        e.network && "edge-network",
        e.touches && "edge-hl",
        e.flow && "edge-flow",
        (sel || state.flowEdges.size) && !e.touches && !e.flow && "edge-dim",
      ]
        .filter(Boolean)
        .join(" ");
      const path = svgEl("path", {
        d: pathBetween(rel(a.getBoundingClientRect(), box), rel(b.getBoundingClientRect(), box)),
        class: cls,
        "marker-end": `url(#arrow${e.flow ? "-flow" : e.touches ? "-hl" : ""})`,
      });
      if (e.label) {
        const title = svgEl("title");
        title.textContent = e.label;
        path.append(title);
      }
      layer.append(path);
    }
  }

  new ResizeObserver(() => drawEdges()).observe($("#diagram-wrap"));

  // ── Selection + details panel ──────────────────────────────────────────
  function select(id) {
    state.selected = state.selected === id ? null : id;
    for (const n of $$(".node")) n.setAttribute("aria-pressed", String(n.dataset.node === state.selected));
    renderDetails();
    drawEdges();
    if (state.selected && window.matchMedia("(max-width: 1200px)").matches) $("#details").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function relations(id) {
    const runtime = [...RUNTIME_EDGES, ...STARTUP_EDGES];
    const uniq = (xs) => [...new Set(xs)];
    const src = state.sourceEdges;
    return {
      imports: src ? uniq(src.filter((e) => e.from === id).map((e) => e.to)) : null,
      importedBy: src ? uniq(src.filter((e) => e.to === id).map((e) => e.from)) : null,
      calls: uniq(runtime.filter(([f]) => f === id).map(([, t]) => t)),
      calledBy: uniq(runtime.filter(([, t]) => t === id).map(([f]) => f)),
    };
  }

  const chip = (id) => el("button", { type: "button", class: `chip layer-${COMPONENTS[id].layer}`, onclick: () => select(id) }, COMPONENTS[id].title);

  function relationRow(label, ids, unavailableText) {
    return el(
      "div",
      { class: "rel-row" },
      el("span", { class: "rel-label" }, label),
      ids === null
        ? el("span", { class: "muted" }, unavailableText)
        : ids.length
          ? el("span", { class: "chips" }, ids.map(chip))
          : el("span", { class: "muted" }, "nothing"),
    );
  }

  const field = (label, ...content) => el("section", { class: "field" }, el("h3", {}, label), el("div", { class: "field-body" }, ...content));

  function renderDetails() {
    const panel = $("#details");
    const id = state.selected;
    if (!id) {
      fill(panel, 
        el("h2", {}, "Click any box"),
        el("p", {}, "Each box is a real file in this project. Click one to see what it does, which layer it's in and why, its methods, what it depends on, what depends on it, and real code from the file."),
        el("ul", { class: "legend-list" },
          el("li", {}, el("span", { class: "legend-swatch is-interface" }), " Dashed border and «interface»: an abstraction (a port)"),
          el("li", {}, el("span", { class: "legend-swatch" }), " Solid border: concrete code (a class, function or module)"),
          el("li", {}, el("span", { class: "legend-swatch is-active" }), " Green dot: the adapter plugged in right now"),
        ),
        el("p", {}, "Good first click: ", chip("PaymentGateway"), " then ", chip("FakePaymentGateway"), "."),
      );
      return;
    }

    const c = COMPONENTS[id];
    const active = c.layer === "driven" ? isActiveAdapter(id, state.config) : null;
    const r = relations(id);
    const noGraph = "needs dev tools (/dev/imports)";
    const excerptBox = el("div", { class: "excerpts" }, el("p", { class: "muted" }, "Loading code from your project…"));

    fill(panel, 
      el(
        "div",
        { class: "panel-tags" },
        el("span", { class: `tag layer-${c.layer}` }, LAYERS[c.layer].label),
        el("span", { class: `tag ${c.kind === "interface" ? "tag-interface" : "tag-impl"}` }, c.kind === "interface" ? "Interface (abstraction)" : "Concrete code"),
        active === true && el("span", { class: "tag tag-active" }, "● Plugged in now"),
        active === false && el("span", { class: "tag" }, "○ Available, not plugged in"),
        c.port && el("button", { type: "button", class: "tag tag-link", onclick: () => select(c.port) }, `implements ${COMPONENTS[c.port].title}`),
      ),
      el("h2", {}, c.title),
      field("1. What it does", el("p", {}, c.what)),
      field("2. Architectural layer", el("p", {}, el("strong", {}, LAYERS[c.layer].label), ". ", LAYERS[c.layer].text), c.layerNote && el("p", {}, c.layerNote)),
      field("3. Why it belongs there", el("p", {}, c.why)),
      field("4. Source file", el("div", { class: "files" }, [c.file, ...(c.alsoFiles ?? [])].map((f) => el("code", { class: "file" }, f)))),
      field("5. Important methods and types", el("ul", { class: "members" }, c.members.map((m) => el("li", {}, el("code", {}, m))))),
      field("6. What it depends on", relationRow("Imports (source code)", r.imports, noGraph), relationRow("Calls at runtime", r.calls)),
      field("7. What depends on it", relationRow("Imported by", r.importedBy, noGraph), relationRow("Called by at runtime", r.calledBy)),
      field("8. If it broke the dependency rule", el("p", {}, c.violation)),
      field("Code from your project", excerptBox),
    );
    loadExcerpts(id, excerptBox);
  }

  async function loadExcerpts(id, box) {
    const c = COMPONENTS[id];
    const figures = [];
    for (const ex of c.excerpts ?? []) {
      const file = ex.file ?? c.file;
      const text = await api.devSource(file);
      if (state.selected !== id) return;
      if (text == null) {
        fill(box, el("p", { class: "muted" }, "Code excerpts are read live from src/ through /dev/source, which is only available when dev tools are on (the default for npm start; DEV_TOOLS=off disables it)."));
        return;
      }
      figures.push(excerptFigure(file, text, ex));
    }
    const full = await api.devSource(c.file);
    if (state.selected !== id) return;
    fill(box, 
      ...figures,
      full && el("details", { class: "full-file" }, el("summary", {}, `Show the whole file (${c.file.split("/").pop()})`), codeBlock(full.replace(/\n$/, "").split("\n"), 1)),
    );
  }

  // ── Modes ──────────────────────────────────────────────────────────────
  async function setMode(mode) {
    state.mode = mode;
    for (const b of $$("[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    fill($("#mode-explainer"), ...MODE_TEXT[mode].map((n) => (n instanceof Node ? n.cloneNode(true) : n)));
    if (mode === "source" && state.sourceEdges === undefined) await loadSourceEdges();
    if (mode === "source" && state.sourceEdges === null) {
      $("#mode-explainer").append(el("p", { class: "notice" }, "The import graph is read from /dev/imports, which is off (DEV_TOOLS=off or NODE_ENV=production). Restart with plain `npm start` to see it."));
    }
    drawEdges();
  }
  for (const b of $$("[data-mode]")) b.addEventListener("click", () => setMode(b.dataset.mode));

  async function loadSourceEdges() {
    const graph = await api.devImports();
    if (!graph) {
      state.sourceEdges = null;
      return;
    }
    const fileToNode = fileToNodeMap();
    const edges = new Map();
    for (const { from, to } of graph.imports) {
      const a = fileToNode.get(from);
      const b = fileToNode.get(to);
      if (a && b && a !== b) edges.set(`${a}>${b}`, { from: a, to: b, label: `${from}\n  imports ${to}` });
    }
    state.sourceEdges = [...edges.values()];
  }

  // ── Scenarios ──────────────────────────────────────────────────────────
  fill($("#scenario-list"), 
    ...SCENARIOS.map((s) =>
      el(
        "button",
        { type: "button", class: "scenario", "data-scenario": s.id, onclick: () => runScenario(s) },
        el("span", { class: "scenario-title" }, s.title),
        el("span", { class: "scenario-expect" }, `expect: ${s.expect}`),
        el("span", { class: "scenario-about" }, s.about),
      ),
    ),
  );

  async function runScenario(s) {
    setBusy(true);
    const key = api.newIdempotencyKey();
    const results = [];
    try {
      for (let i = 0; i < (s.repeat ?? 1); i++) results.push(await api.placeOrder(s.body, key));
    } finally {
      setBusy(false);
    }
    playRun({ title: s.title, scenario: s, results, body: s.body, key });
  }

  function setBusy(busy) {
    for (const b of $$(".scenario, #run-retry")) b.disabled = busy;
    $("#scenario-status").textContent = busy ? "Sending real requests to the server…" : "";
  }

  // ── Runs: response, timeline, animation ────────────────────────────────
  function flattenSteps(run) {
    if (run.conceptualSteps) return run.conceptualSteps.map((s, i) => ({ ...s, n: i + 1 }));
    const out = [];
    let n = 0;
    run.results.forEach((result, i) => {
      if (run.results.length > 1) out.push({ separator: `Request ${i + 1} of ${run.results.length}`, requestIndex: i });
      for (const step of toDisplaySteps(result)) out.push({ ...step, n: ++n, requestIndex: i });
    });
    return out;
  }

  function playRun(run, fromRequest = 0) {
    state.run = run;
    state.steps = flattenSteps(run);
    if (state.mode !== "runtime") setMode("runtime");
    renderRun();
    const fromIndex = Math.max(0, state.steps.findIndex((s) => s.requestIndex === fromRequest));
    $("#run-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
    replay(fromIndex);
  }

  function renderRun() {
    const run = state.run;
    $("#run-panel").hidden = false;
    $("#run-title").textContent = run.title;
    fill($("#run-kind"), 
      run.conceptualSteps
        ? el("span", { class: "src src-conceptual" }, "CONCEPTUAL: not a recorded execution")
        : el("span", { class: "src src-recorded" }, run.results.some((r) => r.trace) ? "RECORDED from the running server" : "No trace available"),
    );

    const requests = run.conceptualSteps
      ? [el("p", { class: "muted" }, "This is the textbook path through the adapters currently plugged in. Run a scenario to see what actually executes.")]
      : run.results.map((r, i) =>
          el(
            "div",
            { class: "req" },
            el("div", { class: "req-head" }, el("strong", {}, run.results.length > 1 ? `Request ${i + 1}` : "Response"), httpBadge(r.status), r.body?.status && statusBadge(r.body.status)),
            el("pre", { class: "json" }, JSON.stringify(r.body, null, 2)),
          ),
        );
    const last = run.results?.at(-1);
    const retry =
      last?.status === 202 && run.body
        ? el("button", { type: "button", id: "run-retry", class: "btn btn-primary", onclick: retryRun }, "Retry with the same Idempotency-Key")
        : null;
    fill($("#run-requests"), ...requests, retry ?? "");

    const involved = [];
    for (const s of state.steps) for (const id of s.nodes ?? []) if (!involved.includes(id)) involved.push(id);
    fill($("#run-explain"), 
      el("p", {}, run.scenario?.explain ?? (run.conceptualSteps ? "Use this as a reading guide, then compare it with a recorded run." : "This request came from the Shop tab. Every recorded step below really ran on the server.")),
      el("div", { class: "rel-row" }, el("span", { class: "rel-label" }, "Components that handled it"), el("span", { class: "chips" }, involved.map(chip))),
    );

    fill($("#timeline"), 
      ...state.steps.map((s, index) =>
        s.separator
          ? el("li", { class: "step-separator" }, s.separator)
          : el(
              "li",
              {
                class: `step src-${s.source}${s.error ? " step-error" : ""}`,
                style: `--depth:${Math.min(s.depth ?? 0, 4)}`,
                "data-index": String(index),
                tabindex: "0",
                onclick: () => jumpTo(index),
                onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), jumpTo(index)),
              },
              el("span", { class: "step-n" }, String(s.n)),
              el("span", { class: `src src-${s.source}` }, SOURCE_LABEL[s.source]),
              el(
                "div",
                { class: "step-body" },
                el("div", { class: "step-title" }, s.title),
                s.kindNote && el("div", { class: "step-note" }, s.kindNote),
                s.detail && el("pre", { class: "step-detail" }, s.detail),
              ),
              s.durationMs != null && el("span", { class: "step-ms" }, `${s.durationMs} ms`),
            ),
      ),
    );
  }

  async function retryRun() {
    const run = state.run;
    setBusy(true);
    try {
      run.results.push(await api.placeOrder(run.body, run.key));
    } finally {
      setBusy(false);
    }
    playRun(run, run.results.length - 1);
  }

  function resetHighlights() {
    state.flowEdges.clear();
    state.visited.clear();
    for (const n of $$(".node")) {
      n.classList.remove("is-visited", "is-current");
      n.querySelector(".node-steps").textContent = "";
    }
    for (const li of $$("#timeline li")) li.classList.remove("is-current", "is-done");
  }

  function mark(index) {
    const s = state.steps[index];
    if (!s || s.separator) return;
    for (const n of $$(".node.is-current")) n.classList.remove("is-current");
    for (const id of s.nodes ?? []) {
      const n = nodeEl(id);
      if (!n) continue;
      n.classList.add("is-visited", "is-current");
      const list = state.visited.get(id) ?? [];
      list.push(s.n);
      state.visited.set(id, list);
      n.querySelector(".node-steps").textContent = list.length > 3 ? `${list.slice(0, 2).join(",")}…${list.at(-1)}` : list.join(",");
    }
    for (const [a, b] of s.edges ?? []) if (a && b) state.flowEdges.add(`${a}>${b}`);
    for (const li of $$("#timeline li")) {
      const i = Number(li.dataset.index);
      li.classList.toggle("is-current", i === index);
      li.classList.toggle("is-done", i < index);
    }
    const current = $(`#timeline li[data-index="${index}"]`);
    const list = $("#timeline");
    if (current && list) {
      const top = current.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - current.offsetHeight) list.scrollTop = top - 40;
    }
    drawEdges();
  }

  async function replay(fromIndex = 0) {
    const token = ++state.playToken;
    resetHighlights();
    for (let i = 0; i < state.steps.length; i++) {
      if (token !== state.playToken) return;
      mark(i);
      if (i >= fromIndex && !state.steps[i].separator) await sleep(state.speed);
    }
    if (token === state.playToken) for (const n of $$(".node.is-current")) n.classList.remove("is-current");
  }

  function jumpTo(index) {
    state.playToken++;
    resetHighlights();
    for (let i = 0; i <= index; i++) mark(i);
    const target = state.steps[index].nodes?.at(-1);
    if (target && state.selected !== target) select(target);
  }

  $("#run-replay").addEventListener("click", () => state.run && replay(0));
  $("#run-speed").addEventListener("change", (e) => (state.speed = Number(e.target.value)));
  $("#show-conceptual").addEventListener("click", () =>
    playRun({ title: "Conceptual place-order flow", conceptualSteps: conceptualPlaceOrderSteps(state.config) }),
  );
  $("#play-last-shop").addEventListener("click", () => state.lastShopRun && playRun(state.lastShopRun));
  $("#clear-highlights").addEventListener("click", () => {
    state.playToken++;
    resetHighlights();
    drawEdges();
  });

  // ── Dependency inversion, with real code ───────────────────────────────
  async function renderDip() {
    const box = $("#dip-excerpts");
    const figures = [];
    for (const ex of DIP_EXCERPTS) {
      const text = await api.devSource(ex.file);
      if (text == null) {
        fill(box, el("p", { class: "muted" }, "Code excerpts need dev tools (/dev/source). Run `npm start` without DEV_TOOLS=off."));
        return;
      }
      figures.push(excerptFigure(ex.file, text, ex));
    }
    fill(box, ...figures);
  }

  // ── Public API (used by main.js) ───────────────────────────────────────
  function setConfig(config) {
    state.config = config;
    for (const id of COLUMNS.driven) {
      const n = nodeEl(id);
      const active = isActiveAdapter(id, config);
      n.classList.toggle("is-active", active === true);
      n.classList.toggle("is-inactive", active === false);
      n.querySelector(".node-status").textContent = active === true ? "● plugged in" : active === false ? "○ available" : "";
    }
    fill($("#explorer-config"), 
      config
        ? el(
            "dl",
            { class: "config-list" },
            Object.entries(config.adapters).flatMap(([port, adapter]) => [el("dt", {}, port), el("dd", {}, adapter)]),
          )
        : el("p", { class: "muted" }, "Dev tools are off, so the running configuration and tracing aren't available. Scenarios still run against the real server, but without recorded steps."),
    );
    renderDetails();
    drawEdges();
  }

  setMode("runtime");
  renderDetails();
  loadSourceEdges().then(() => {
    renderDetails();
    drawEdges();
  });
  renderDip();

  return {
    setConfig,
    playRun,
    setLastShopRun(run) {
      state.lastShopRun = run;
      $("#play-last-shop").disabled = false;
    },
    onShow: () => requestAnimationFrame(() => drawEdges()),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** "PlaceOrderService" → "Place·Order·Service" with invisible line-break opportunities, so long names wrap between words. */
function breakable(name) {
  return name.split(/(?<=[a-z])(?=[A-Z])/).flatMap((part, i) => (i === 0 ? [part] : [el("wbr"), part]));
}

function rel(r, box) {
  return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
}

function pathBetween(a, b) {
  const acx = a.x + a.w / 2;
  const bcx = b.x + b.w / 2;
  const y1 = a.y + a.h / 2;
  const y2 = b.y + b.h / 2;
  if (Math.abs(acx - bcx) < 30) {
    // Same column: bulge out to the right.
    const x1 = a.x + a.w;
    const x2 = b.x + b.w + 4;
    const bulge = 24 + Math.min(70, Math.abs(y2 - y1) / 4);
    return `M${x1},${y1} C${x1 + bulge},${y1} ${x2 + bulge},${y2} ${x2},${y2}`;
  }
  const forward = bcx > acx;
  const x1 = forward ? a.x + a.w : a.x;
  const x2 = forward ? b.x - 4 : b.x + b.w + 4;
  const dx = (x2 - x1) / 2;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

function excerptFigure(file, text, ex) {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.includes(ex.find));
  if (index === -1) return el("p", { class: "muted" }, `Couldn't find “${ex.find}” in ${file}; the file may have changed.`);
  return el(
    "figure",
    { class: "excerpt" },
    el("figcaption", {}, el("code", {}, `${file}:${index + 1}`), ex.caption ? el("span", {}, ` ${ex.caption}`) : null),
    codeBlock(lines.slice(index, index + (ex.lines ?? 8)), index + 1),
  );
}

function codeBlock(lines, firstLine) {
  return el(
    "pre",
    { class: "code" },
    el("code", {}, lines.map((line, k) => el("span", { class: "line" }, el("span", { class: "ln", "aria-hidden": "true" }, String(firstLine + k)), `${line}\n`))),
  );
}
