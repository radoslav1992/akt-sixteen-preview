// Hover/focus tooltips for server-rendered SVG charts. Any element with data-tip inside [data-chart] gets one.
let initialised = false;

export function initChartTips(): void {
  if (initialised) return;
  initialised = true;
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;

  const show = (target: Element, clientX?: number, clientY?: number) => {
    const wrap = target.closest<HTMLElement>("[data-chart]");
    if (!wrap) return;
    if (tip.parentElement !== wrap) wrap.append(tip);
    tip.innerHTML = (target as HTMLElement).dataset.tip ?? target.getAttribute("data-tip") ?? "";
    tip.hidden = false;
    const box = wrap.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const px = (clientX ?? rect.left + rect.width / 2) - box.left;
    const py = (clientY ?? rect.top) - box.top;
    const left = Math.min(Math.max(px + 12, 4), box.width - tip.offsetWidth - 4);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(py - tip.offsetHeight - 10, 4)}px`;
    const svg = target.closest("svg");
    const cross = svg?.querySelector<SVGLineElement>(".chart__crosshair");
    const dataX = target.getAttribute("data-x");
    if (cross && dataX) {
      cross.setAttribute("x1", dataX);
      cross.setAttribute("x2", dataX);
      cross.setAttribute("opacity", "0.5");
    }
  };
  const hide = (target: Element) => {
    tip.hidden = true;
    target.closest("svg")?.querySelector(".chart__crosshair")?.setAttribute("opacity", "0");
  };

  document.addEventListener("pointermove", (e) => {
    const target = (e.target as Element)?.closest?.("[data-chart] [data-tip]");
    if (target) show(target, e.clientX, e.clientY);
    else if (!tip.hidden) hide(tip);
  });
  document.addEventListener("focusin", (e) => {
    const target = (e.target as Element)?.closest?.("[data-chart] [data-tip]");
    if (target) show(target);
  });
  document.addEventListener("focusout", (e) => {
    const target = (e.target as Element)?.closest?.("[data-chart] [data-tip]");
    if (target) hide(target);
  });
}
