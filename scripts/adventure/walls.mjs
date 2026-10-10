/**
 * Regenerate the wall/door embedded documents of imported IWD scenes from the
 * original game's search-map bitmap (SR). The map pack embeds a copy of each
 * scene, so update that copy rather than the compendium scene itself.
 */
const MODULE_ID = "dnd-icewind-dale-pc-game";
const DATA_URL = `modules/${MODULE_ID}/data/search-maps`;

const WALL = { light: 20, sight: 20, sound: 20, move: 20 };
const OBSTACLE = { light: 0, sight: 0, sound: 0, move: 20 };
const DOOR = { light: 20, sight: 20, sound: 20, move: 20 };
const CELL_W = 16;
const CELL_H = 12;
const WALKABLE = new Set([1, 2, 3, 4, 5, 6, 7, 9, 11, 12, 14, 15]);

function stableId(area, index) {
  // Foundry document IDs accept alphanumeric characters, 16 characters max.
  let hash = 2166136261;
  for (const c of `${area}:mask-wall:${index}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `iwd${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function makeWall(area, index, x0, y0, x1, y1, kind, doorName) {
  const props = kind === "door" ? DOOR : kind === "obstacle" ? OBSTACLE : WALL;
  const wall = {
    _id: stableId(area, index), c: [x0, y0, x1, y1], ...props,
    dir: 0, door: kind === "door" ? 1 : 0, ds: 0,
    threshold: { light: null, sight: null, sound: null, attenuation: false },
    animation: null, levels: [],
    flags: { [MODULE_ID]: { kind, ...(doorName ? { door: doorName } : {}) } }
  };
  return wall;
}

function scenePoint(scene, x, y) {
  const [imageWidth, imageHeight] = scene.flags?.[MODULE_ID]?.image ?? [scene.width, scene.height];
  const isIsometric = Boolean(scene.flags?.[MODULE_ID]?.isIsometric);
  if (!isIsometric) return [Math.round(x), Math.round(y)];
  const rotation = -35 * Math.PI / 180;
  const skewX = 20 * Math.PI / 180;
  const a = Math.cos(rotation), b = Math.sin(rotation);
  const c = -Math.sin(rotation - skewX), d = Math.cos(rotation - skewX);
  const det = a * d - b * c;
  const px = x - imageWidth / 2, py = y - imageHeight / 2;
  const qx = (d * px - c * py) / det;
  const qy = (-b * px + a * py) / det;
  const grid = 50;
  const corners = [[0, 0], [imageWidth, 0], [0, imageHeight], [imageWidth, imageHeight]].map(([cx, cy]) => {
    const dx = cx - imageWidth / 2, dy = cy - imageHeight / 2;
    return [(d * dx - c * dy) / det, (-b * dx + a * dy) / det];
  });
  const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  const width = Math.ceil((Math.max(...xs) - Math.min(...xs)) / grid) * grid;
  const height = Math.ceil((Math.max(...ys) - Math.min(...ys)) / grid) * grid;
  return [Math.round(width / 2 + qx), Math.round(height / 2 + qy)];
}

function areaCode(scene) {
  return scene.flags?.[MODULE_ID]?.area ?? scene.name?.match(/\((AR\w+)\)/)?.[1] ?? null;
}

function createWalls(scene, mask) {
  const { width, height, cells, doors = [] } = mask;
  const rows = Array.from({ length: height }, (_, y) => cells.slice(y * width, (y + 1) * width));
  const isWalkable = (x, y) => x >= 0 && y >= 0 && x < width && y < height && WALKABLE.has(rows[y][x]);

  // Boundary runs are traced on the pixel-aligned mask so corners and narrow
  // passages remain exact, unlike noisy contour approximation.
  const edgeMap = new Map();
  const key = (a, b) => a[1] === b[1] ? `h:${a[1]}:${Math.min(a[0], b[0])}` : `v:${a[0]}:${Math.min(a[1], b[1])}`;
  const pixelKind = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return "wall";
    return rows[y][x] === 0 || rows[y][x] === 10 ? "wall" : "obstacle";
  };

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!isWalkable(x, y)) continue;
    const add = (x0,y0,x1,y1,kind) => {
      const edgeKey = key([x0,y0],[x1,y1]);
      const previous = edgeMap.get(edgeKey);
      if (previous?.kind === "wall" || kind === "wall") kind = "wall";
      edgeMap.set(edgeKey, { a:[x0,y0], b:[x1,y1], kind });
    };
    if (!isWalkable(x, y - 1)) add(x, y, x + 1, y, pixelKind(x, y - 1));
    if (!isWalkable(x, y + 1)) add(x, y + 1, x + 1, y + 1, pixelKind(x, y + 1));
    if (!isWalkable(x - 1, y)) add(x, y, x, y + 1, pixelKind(x - 1, y));
    if (!isWalkable(x + 1, y)) add(x + 1, y, x + 1, y + 1, pixelKind(x + 1, y));
  }

  // Merge contiguous collinear edges of the same material into manageable walls.
  const horizontal = new Map(), vertical = new Map();
  for (const {a,b,kind} of edgeMap.values()) {
    const horizontalEdge = a[1] === b[1];
    const line = horizontalEdge ? a[1] : a[0];
    const start = horizontalEdge ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]);
    const group = `${kind}:${line}`;
    const map = horizontalEdge ? horizontal : vertical;
    if (!map.has(group)) map.set(group, new Set());
    map.get(group).add(start);
  }
  const walls = [];
  const appendRuns = (map, isHorizontal) => {
    for (const [group, positionSet] of map) {
      const [kind, lineText] = group.split(":");
      const line = Number(lineText);
      const positions = [...positionSet].sort((a,b) => a-b);
      let start = positions[0], end = start + 1;
      const flush = () => {
        const p0 = scenePoint(scene, (isHorizontal ? start : line) * CELL_W, (isHorizontal ? line : start) * CELL_H);
        const p1 = scenePoint(scene, (isHorizontal ? end : line) * CELL_W, (isHorizontal ? line : end) * CELL_H);
        walls.push(makeWall(areaCode(scene), walls.length, ...p0, ...p1, kind));
      };
      for (let i=1; i<positions.length; i++) {
        if (positions[i] === end) end++;
        else { flush(); start = positions[i]; end = start + 1; }
      }
      flush();
    }
  };
  appendRuns(horizontal, true);
  appendRuns(vertical, false);

  // Door outlines in ARE are authoritative: cut any mask walls intersecting
  // the opening and insert one operable wall at the door polygon's centerline.
  for (const d of doors) {
    const pts = d.closed?.length ? d.closed : d.open;
    if (!pts?.length) continue;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs) - 20, x1 = Math.max(...xs) + 20;
    const y0 = Math.min(...ys) - 20, y1 = Math.max(...ys) + 20;
    const box = [scenePoint(scene, x0, y0), scenePoint(scene, x1, y1)];
    const bx0 = Math.min(box[0][0], box[1][0]), bx1 = Math.max(box[0][0], box[1][0]);
    const by0 = Math.min(box[0][1], box[1][1]), by1 = Math.max(box[0][1], box[1][1]);
    const hit = walls.filter(w => w.flags[MODULE_ID].kind === "wall"
      && bx0 <= (w.c[0] + w.c[2]) / 2 && (w.c[0] + w.c[2]) / 2 <= bx1
      && by0 <= (w.c[1] + w.c[3]) / 2 && (w.c[1] + w.c[3]) / 2 <= by1);
    for (const w of hit) walls.splice(walls.indexOf(w), 1);
    // ARE door geometry is in map-pixel coordinates. Orient the wall on the
    // shorter axis of its bounding box, matching the previous extraction.
    const cx = xs.reduce((a,b)=>a+b,0) / xs.length, cy = ys.reduce((a,b)=>a+b,0) / ys.length;
    const coords = x1 - x0 >= y1 - y0 ? [Math.min(...xs), cy, Math.max(...xs), cy]
      : [cx, Math.min(...ys), cx, Math.max(...ys)];
    const p0 = scenePoint(scene, coords[0], coords[1]), p1 = scenePoint(scene, coords[2], coords[3]);
    walls.push(makeWall(areaCode(scene), walls.length, ...p0, ...p1, "door", d.name));
  }
  // Ensure IDs remain unique after doors append and removal.
  walls.forEach((w, i) => { w._id = stableId(areaCode(scene), i); });
  return walls;
}

/** Add/update scene collision and vision walls using its source SR bitmap. */
export async function regenerateSceneWalls(scene, { force = false } = {}) {
  const code = areaCode(scene);
  if (!code || scene.flags?.[MODULE_ID]?.isWorldMap) return false;
  if (!force && scene.flags?.[MODULE_ID]?.maskWallsVersion === 1) return false;
  const [imageWidth, imageHeight] = scene.flags?.[MODULE_ID]?.image ?? [scene.width, scene.height];
  // Search maps are at 16x12 px per cell; the source background can be a
  // different size than the mask due to overlay dimensions, so trust the mask
  // manifest dimensions after fetching by area.
  const response = await fetch(`${DATA_URL}/${encodeURIComponent(code)}.json`);
  if (!response.ok) throw new Error(`search mask ${code}: HTTP ${response.status}`);
  const mask = await response.json();
  if (!mask.width || !mask.height || !Array.isArray(mask.cells) || mask.cells.length !== mask.width * mask.height) {
    throw new Error(`search mask ${code} has invalid dimensions or cell data`);
  }
  const expectedWidth = Math.ceil(imageWidth / CELL_W), expectedHeight = Math.ceil(imageHeight / CELL_H);
  if (Math.abs(mask.width - expectedWidth) > 1 || Math.abs(mask.height - expectedHeight) > 1) {
    throw new Error(`search mask ${code} dimensions ${mask.width}x${mask.height} do not match scene image ${expectedWidth}x${expectedHeight}`);
  }
  const walls = createWalls(scene, mask);
  if (!walls.length) throw new Error(`No mask walls generated for ${code}`);
  const existing = scene.walls.contents;
  if (existing.length) await scene.deleteEmbeddedDocuments("Wall", existing.map(w => w.id));
  await scene.createEmbeddedDocuments("Wall", walls);
  await scene.update({ [`flags.${MODULE_ID}.maskWallsVersion`]: 1 });
  return true;
}
