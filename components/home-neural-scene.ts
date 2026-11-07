const NS = "http://www.w3.org/2000/svg";
const COLUMNS = 8;
const ROWS = 16;
const CELLS_PER_PLANE = COLUMNS * ROWS;
const WIDTH = COLUMNS * 22;
const HEIGHT = ROWS * 20;
const COLORS = [
  "var(--accent)",
  "var(--accent-light)",
  "color-mix(in srgb,var(--accent) 38%,var(--paper))",
  "color-mix(in srgb,var(--ink) 24%,var(--paper))",
  "color-mix(in srgb,var(--ink) 65%,var(--paper))",
];

type ScreenPoint = { x: number; y: number; xy: string };
type Vertex = { x: number; y: number; z: number; screen: ScreenPoint };
type Cell = Vertex & {
  rect: SVGPathElement;
  layer: number;
  column: number;
  row: number;
  opacity: number;
  indices: [number, number, number, number];
};
type Plane = {
  vertices: Vertex[];
  side: SVGPathElement;
  face: SVGPathElement;
  grid: SVGPathElement;
  edge: SVGPathElement;
};
type Route = {
  a: Cell;
  b: Cell;
  wire: SVGPathElement;
  signal: SVGPathElement;
  dotA: SVGCircleElement;
  dotB: SVGCircleElement;
  parts: [SVGPathElement, SVGPathElement, SVGCircleElement, SVGCircleElement];
  alpha: [number, number, number, number];
};
type Link = { current: Route; previous: Route };

/** Mount the approved preview as a local SVG scene; React never renders animation frames. */
export function mountHomeNeuralScene(svg: SVGSVGElement, animated: boolean): () => void {
  let seed = 73129;
  function random() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }
  function node<Tag extends keyof SVGElementTagNameMap>(
    tag: Tag,
    attrs: Record<string, string | number>,
    parent: SVGElement = svg,
  ): SVGElementTagNameMap[Tag] {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    parent.append(element);
    return element;
  }

  const wireGroup = node("g", {});
  const signalGroup = node("g", {});
  const planesGroup = node("g", {});
  const dotGroup = node("g", {});
  const planes: Plane[] = [];
  const cells: Cell[] = [];
  const links: Link[] = [];
  const routes: Route[] = [];

  for (let layer = 0; layer < 3; layer++) {
    const group = node("g", { "data-layer": layer }, planesGroup);
    const side = node("path", { fill: "var(--ink)", opacity: 0.08 }, group);
    const face = node("path", { fill: "var(--paper)", "fill-opacity": 0.75 }, group);
    const vertices: Vertex[] = [];
    for (let row = 0; row <= ROWS; row++) for (let column = 0; column <= COLUMNS; column++) {
      vertices.push({
        x: (column / COLUMNS - 0.5) * WIDTH + (layer - 1) * 105,
        y: (row / ROWS - 0.5) * HEIGHT - (layer - 1) * 34,
        z: (layer - 1) * 185,
        screen: { x: 0, y: 0, xy: "" },
      });
    }
    for (let row = 0; row < ROWS; row++) for (let column = 0; column < COLUMNS; column++) {
      const fill = COLORS[Math.floor(random() * COLORS.length)];
      const opacity = random() < 0.26 ? 0.45 + random() * 0.4 : 0;
      const rect = node("path", { "data-part": "cell", fill, opacity }, group);
      rect.style.transitionDelay = `${Math.floor(random() * 110)}ms`;
      const a = row * (COLUMNS + 1) + column;
      cells.push({
        rect, layer, column, row, opacity,
        indices: [a, a + 1, a + COLUMNS + 2, a + COLUMNS + 1],
        x: (column + 0.5) * 22 - WIDTH / 2 + (layer - 1) * 105,
        y: (row + 0.5) * 20 - HEIGHT / 2 - (layer - 1) * 34,
        z: (layer - 1) * 185,
        screen: { x: 0, y: 0, xy: "" },
      });
    }
    const grid = node("path", { "data-part": "grid" }, group);
    const edge = node("path", { "data-part": "edge" }, group);
    planes.push({ vertices, side, face, grid, edge });
  }

  function makeRoute(a: Cell, b: Cell, active: boolean, ghost: boolean): Route {
    const alpha: Route["alpha"] = ghost ? [0, 0, 0, 0] : [active ? 0.56 : 0.12, active ? 0.8 : 0, active ? 0.7 : 0, active ? 0.7 : 0];
    const wire = node("path", { "data-part": "wire", "data-ghost": String(ghost), opacity: alpha[0] }, wireGroup);
    const signal = node("path", { "data-part": "signal", pathLength: 1, opacity: alpha[1] }, signalGroup);
    if (!ghost) signal.style.animationDelay = `${-random() * 2500}ms`;
    const dotA = node("circle", { "data-part": "terminal", r: 1.6, opacity: alpha[2] }, dotGroup);
    const dotB = node("circle", { "data-part": "terminal", r: 1.6, opacity: alpha[3] }, dotGroup);
    return { a, b, wire, signal, dotA, dotB, parts: [wire, signal, dotA, dotB], alpha };
  }
  for (let layer = 0; layer < 2; layer++) for (let index = 0; index < 25; index++) {
    const row = 1 + Math.floor(random() * 14), column = 2 + Math.floor(random() * 6);
    const targetRow = Math.max(0, Math.min(15, row + Math.floor(random() * 9) - 4));
    const targetColumn = Math.floor(random() * 6);
    const a = cells[layer * CELLS_PER_PLANE + row * COLUMNS + column];
    const b = cells[(layer + 1) * CELLS_PER_PLANE + targetRow * COLUMNS + targetColumn];
    const current = makeRoute(a, b, random() < 0.4, false);
    const previous = makeRoute(a, b, false, true);
    links.push({ current, previous });
    routes.push(previous, current);
  }

  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const print = matchMedia("print");
  const camera = { yaw: 0.62, pitch: -0.18, targetYaw: 0.62, targetPitch: -0.18 };
  const pointer = { active: false, x: 0, y: 0 };
  const back: ScreenPoint = { x: 0, y: 0, xy: "" };
  const litCells: Cell[][] = [[], [], []];
  const nearby: Cell[] = [];
  const cosR = Math.cos(-0.1), sinR = Math.sin(-0.1);
  let frame: number | null = null;
  let timer: number | undefined;
  let visible = true, disposed = false, running = false, epoch = 0;
  let hotCell: Cell | null = null;
  let cosY = 0, sinY = 0, cosP = 0, sinP = 0;

  function project(x: number, y: number, z: number, out: ScreenPoint) {
    const rx = x * cosY + z * sinY;
    const rz = z * cosY - x * sinY;
    const ry = y * cosP - rz * sinP;
    const depth = y * sinP + rz * cosP;
    const perspective = 950 / (950 - depth);
    out.x = 410 + (rx * cosR - ry * sinR) * perspective * 1.08;
    out.y = 280 + (rx * sinR + ry * cosR) * perspective * 1.08;
    out.xy = `${out.x.toFixed(2)} ${out.y.toFixed(2)}`;
  }
  function setHot(cell: Cell | null, force = false) {
    if (cell === hotCell && !force) return;
    hotCell = cell;
    for (const item of cells) item.rect.removeAttribute("data-hot");
    if (cell) cell.rect.dataset.hot = "true";
    for (const { current } of links) {
      const hot = Boolean(cell && (
        (current.a.layer === cell.layer && Math.abs(current.a.column - cell.column) + Math.abs(current.a.row - cell.row) <= 2) ||
        (current.b.layer === cell.layer && Math.abs(current.b.column - cell.column) + Math.abs(current.b.row - cell.row) <= 2)
      ));
      current.wire.dataset.hot = String(hot);
      current.dotA.dataset.hot = String(hot);
      current.dotB.dataset.hot = String(hot);
      if (hot) {
        current.a.rect.dataset.hot = "true";
        current.b.rect.dataset.hot = "true";
      }
    }
  }
  function updateLinks() {
    for (const route of routes) {
      const a = route.a.screen, b = route.b.screen;
      const bend = (b.x - a.x) * 0.38;
      const d = `M${a.xy}C${(a.x + bend).toFixed(2)} ${a.y.toFixed(2)},${(b.x - bend).toFixed(2)} ${b.y.toFixed(2)},${b.xy}`;
      route.wire.setAttribute("d", d); route.signal.setAttribute("d", d);
      route.dotA.setAttribute("cx", String(a.x)); route.dotA.setAttribute("cy", String(a.y));
      route.dotB.setAttribute("cx", String(b.x)); route.dotB.setAttribute("cy", String(b.y));
    }
  }
  function draw() {
    frame = null;
    if (disposed) return;
    if (running) {
      camera.yaw += (camera.targetYaw - camera.yaw) * 0.09;
      camera.pitch += (camera.targetPitch - camera.pitch) * 0.09;
    }
    cosY = Math.cos(camera.yaw); sinY = Math.sin(camera.yaw);
    cosP = Math.cos(camera.pitch); sinP = Math.sin(camera.pitch);
    for (const plane of planes) {
      for (const vertex of plane.vertices) project(vertex.x, vertex.y, vertex.z, vertex.screen);
      const points = plane.vertices;
      const topRight = points[COLUMNS], bottomRight = points[points.length - 1];
      const face = `M${points[0].screen.xy}L${topRight.screen.xy}L${bottomRight.screen.xy}L${points[ROWS * (COLUMNS + 1)].screen.xy}Z`;
      plane.face.setAttribute("d", face); plane.edge.setAttribute("d", face);
      project(bottomRight.x, bottomRight.y, bottomRight.z - 9, back);
      const backBottom = back.xy;
      project(topRight.x, topRight.y, topRight.z - 9, back);
      plane.side.setAttribute("d", `M${topRight.screen.xy}L${bottomRight.screen.xy}L${backBottom}L${back.xy}Z`);
      let grid = "";
      for (let col = 1; col < COLUMNS; col++) grid += `M${points[col].screen.xy}L${points[ROWS * (COLUMNS + 1) + col].screen.xy}`;
      for (let row = 1; row < ROWS; row++) grid += `M${points[row * (COLUMNS + 1)].screen.xy}L${points[row * (COLUMNS + 1) + COLUMNS].screen.xy}`;
      plane.grid.setAttribute("d", grid);
    }
    for (const cell of cells) {
      const vertices = planes[cell.layer].vertices, indices = cell.indices;
      cell.rect.setAttribute("d", `M${vertices[indices[0]].screen.xy}L${vertices[indices[1]].screen.xy}L${vertices[indices[2]].screen.xy}L${vertices[indices[3]].screen.xy}Z`);
      project(cell.x, cell.y, cell.z, cell.screen);
    }
    updateLinks();
    let nearest: Cell | null = null, distance = 1600;
    if (pointer.active) for (const cell of cells) {
      const d = (cell.screen.x - pointer.x) ** 2 + (cell.screen.y - pointer.y) ** 2;
      if (d < distance) { nearest = cell; distance = d; }
    }
    setHot(nearest);
    if (running && (Math.abs(camera.targetYaw - camera.yaw) > 0.0001 || Math.abs(camera.targetPitch - camera.pitch) > 0.0001)) frame = requestAnimationFrame(draw);
  }
  function requestDraw() {
    if (frame === null && running && !disposed) frame = requestAnimationFrame(draw);
  }
  function evolve() {
    for (const group of litCells) group.length = 0;
    for (const cell of cells) {
      if (random() < 0.3) {
        cell.rect.setAttribute("fill", COLORS[Math.floor(random() * COLORS.length)]);
        cell.opacity = random() < 0.46 ? 0.4 + random() * 0.45 : 0;
        cell.rect.setAttribute("opacity", String(cell.opacity));
      }
      if (cell.opacity >= 0.4) litCells[cell.layer].push(cell);
    }
    for (const { current, previous } of links) {
      const layer = current.a.layer;
      const rewire = random() < 0.3 && current.wire.dataset.hot !== "true" && litCells[layer].length > 0 && litCells[layer + 1].length > 0;
      if (rewire) {
        previous.a = current.a; previous.b = current.b;
        for (let i = 0; i < previous.parts.length; i++) {
          previous.parts[i].animate([{ opacity: current.alpha[i] }, { opacity: 0 }], { duration: 460, easing: "ease-in-out" });
        }
        current.a = litCells[layer][Math.floor(random() * litCells[layer].length)];
        nearby.length = 0;
        for (const cell of litCells[layer + 1]) if (Math.abs(cell.row - current.a.row) <= 4) nearby.push(cell);
        const targets = nearby.length ? nearby : litCells[layer + 1];
        current.b = targets[Math.floor(random() * targets.length)];
      }
      const active = rewire || random() < 0.4;
      current.alpha[0] = active ? 0.35 + random() * 0.28 : 0.12;
      current.alpha[1] = active ? 0.8 : 0;
      current.alpha[2] = current.alpha[3] = active ? 0.7 : 0;
      for (let i = 0; i < current.parts.length; i++) {
        current.parts[i].setAttribute("opacity", String(current.alpha[i]));
        if (rewire) current.parts[i].animate([{ opacity: 0 }, { opacity: current.alpha[i] }], { duration: 460, easing: "ease-in-out" });
      }
      if (active) {
        current.a.opacity = current.b.opacity = 0.65;
        current.a.rect.setAttribute("opacity", "0.65"); current.b.rect.setAttribute("opacity", "0.65");
      }
    }
    updateLinks();
    setHot(hotCell, true);
    svg.dataset.epoch = String(++epoch);
  }
  function syncActivity() {
    if (disposed) return;
    window.clearTimeout(timer);
    timer = undefined;
    running = animated && !motion.matches && !print.matches && !document.hidden && visible;
    svg.dataset.running = String(running);
    if (!running) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pointer.active = false; setHot(null);
      camera.targetYaw = 0.62; camera.targetPitch = -0.18;
      for (const animation of svg.getAnimations({ subtree: true })) {
        if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
      }
    } else {
      timer = window.setTimeout(() => { evolve(); syncActivity(); }, 950);
      if (Math.abs(camera.targetYaw - camera.yaw) > 0.0001 || Math.abs(camera.targetPitch - camera.pitch) > 0.0001) requestDraw();
    }
  }
  function pointerMove(event: PointerEvent) {
    if (!running || event.pointerType === "touch") return;
    const bounds = svg.getBoundingClientRect(), scale = Math.min(bounds.width / 817, bounds.height / 560);
    if (scale <= 0) return;
    pointer.x = (event.clientX - bounds.left - (bounds.width - 817 * scale) / 2) / scale;
    pointer.y = (event.clientY - bounds.top - (bounds.height - 560 * scale) / 2) / scale;
    pointer.active = true;
    camera.targetYaw = 0.62 + Math.max(-1, Math.min(1, (pointer.x - 410) / 360)) * 0.08;
    camera.targetPitch = -0.18 - Math.max(-1, Math.min(1, (pointer.y - 280) / 250)) * 0.055;
    requestDraw();
  }
  function pointerLeave() {
    pointer.active = false; setHot(null);
    camera.targetYaw = 0.62; camera.targetPitch = -0.18;
    requestDraw();
  }

  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncActivity(); });
  observer.observe(svg);
  svg.addEventListener("pointermove", pointerMove);
  svg.addEventListener("pointerleave", pointerLeave);
  document.addEventListener("visibilitychange", syncActivity);
  motion.addEventListener("change", syncActivity);
  print.addEventListener("change", syncActivity);
  svg.dataset.epoch = "0";
  draw(); syncActivity();

  return () => {
    disposed = true;
    window.clearTimeout(timer);
    if (frame !== null) cancelAnimationFrame(frame);
    observer.disconnect();
    svg.removeEventListener("pointermove", pointerMove);
    svg.removeEventListener("pointerleave", pointerLeave);
    document.removeEventListener("visibilitychange", syncActivity);
    motion.removeEventListener("change", syncActivity);
    print.removeEventListener("change", syncActivity);
    for (const animation of svg.getAnimations({ subtree: true })) animation.cancel();
    svg.replaceChildren();
    delete svg.dataset.epoch;
    delete svg.dataset.running;
  };
}
