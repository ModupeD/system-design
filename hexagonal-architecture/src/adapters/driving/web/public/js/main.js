// Page bootstrap: tabs, the running configuration, and the link between the
// Shop and the Architecture Explorer.

import * as api from "./api.js";
import { $, $$, el } from "./dom.js";
import { initExplorer } from "./explorer.js";
import { initShop } from "./shop.js";

const explorer = initExplorer();
const shop = initShop({
  onRun: (run) => explorer.setLastShopRun(run),
  onWatch: (run) => {
    showTab("explorer");
    explorer.playRun(run);
  },
});

function showTab(name) {
  for (const tab of $$('[role="tab"]')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  $("#view-shop").hidden = name !== "shop";
  $("#view-explorer").hidden = name !== "explorer";
  if (name === "explorer") explorer.onShow();
  history.replaceState(null, "", `#${name}`);
}

for (const tab of $$('[role="tab"]')) {
  tab.addEventListener("click", () => showTab(tab.dataset.tab));
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = $$('[role="tab"]');
    const next = tabs[(tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    showTab(next.dataset.tab);
  });
}
showTab(location.hash === "#explorer" ? "explorer" : "shop");

const config = await api.devConfig();
$("#config-chips").replaceChildren(
  ...(config
    ? [
        ["Storage", config.adapters.OrderRepository],
        ["Payments", config.adapters.PaymentGateway],
        ["Notifier", config.adapters.Notifier],
      ].map(([label, value]) => el("span", { class: "config-chip", title: `${label}: ${value}` }, el("span", { class: "muted" }, `${label} `), value))
    : []),
  el("span", { class: `config-chip ${config ? "on" : "off"}` }, config ? "Tracing on (dev)" : "Dev tools off"),
);
explorer.setConfig(config);
shop.setConfig(config);
