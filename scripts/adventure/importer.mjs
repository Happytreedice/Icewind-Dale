import { ADVENTURE } from "./adventure.mjs";

/* -------------------------------------------- */
/*  Customize Import Form                       */
/* -------------------------------------------- */

/**
 * Append additional import options to the adventure importer.
 * @param {AdventureImporterV2} app  The importer application.
 * @param {HTMLElement} html         The importer's application window element.
 */
export function renderAdventureImporter(app, html) {
  if ( app.adventure.pack !== ADVENTURE.packId ) return;
  const controls = html.querySelector(".import-controls");
  if ( !controls ) return;

  const importOptions = game.settings.get(ADVENTURE.moduleName, "importOptions") || {};
  controls.insertAdjacentHTML("beforeend", `<h2>${game.i18n.localize("IWD.IMPORT.Options")}</h2>`);
  controls.append(...formatOptions({ importOptions }));
}

/**
 * Generate markup for additional import options.
 * @param {object} [options={}]
 * @param {object} [options.importOptions]  Previously used import options, if any.
 * @returns {HTMLElement[]}
 */
function formatOptions({ importOptions={} }={}) {
  return Object.entries(ADVENTURE.importOptions).map(([name, config]) => {
    const isDefault = typeof config.default === "function" ? config.default() : config.default;
    const initial = importOptions[name] ?? isDefault;
    const field = new foundry.data.fields.BooleanField({ initial, label: config.label });
    const element = field.toFormGroup(
      { localize: true },
      { name, value: initial }
    );
    const input = element.querySelector("input");
    const label = element.querySelector("label");
    if ( label && input ) {
      label.classList.add("checkbox");
      label.insertAdjacentElement("afterbegin", input);
    }
    element.querySelector(".form-fields")?.remove();

    // Validate option availability (e.g. check for module presence)
    const isAvailable = typeof config.validate === "function" ? config.validate() : true;
    if ( !isAvailable && input && label ) {
      input.disabled = true;
      input.checked = false;
      label.classList.add("disabled");
      label.style.opacity = "0.55";
      label.style.cursor = "not-allowed";
      input.style.cursor = "not-allowed";

      const hintKey = config.disabledHint || "IWD.IMPORT.ModuleMissing";
      const hintText = game.i18n.localize(hintKey);
      label.title = hintText;
      input.title = hintText;

      const hint = document.createElement("p");
      hint.className = "notes hint";
      hint.style.cssText = "margin: 2px 0 6px 24px; font-size: 0.82em; color: #e74c3c;";
      hint.textContent = `(${hintText})`;
      element.appendChild(hint);
    }

    return element;
  }).filter(Boolean);
}

/* -------------------------------------------- */
/*  Import Lifecycle Hooks                      */
/* -------------------------------------------- */

/**
 * Perform post-import tasks.
 * @param {Adventure} adventure  The adventure document.
 * @param {object} formData      The submitted adventure form data.
 */
export async function onImport(adventure, formData) {
  if ( adventure.pack !== ADVENTURE.packId ) return;
  globalThis._iwdImportFinished = false;
  const importOptions = {};
  for ( const [name, config] of Object.entries(ADVENTURE.importOptions) ) {
    const isAvailable = typeof config.validate === "function" ? config.validate() : true;
    const defaultValue = typeof config.default === "function" ? config.default() : Boolean(config.default);
    const isEnabled = isAvailable && (formData && (name in formData) ? Boolean(formData[name]) : defaultValue);
    importOptions[name] = isEnabled;
    let { handler, lifecycle } = config;
    if ( lifecycle !== "post" ) continue;
    if ( typeof handler === "function" ) {
      try {
        await handler(adventure, config, isEnabled, formData);
      } catch (err) {
        console.error(`${ADVENTURE.moduleName} | Handler ${name} failed:`, err);
      }
    }
  }
  await ensureSceneTokens(adventure);
  await game.settings.set(ADVENTURE.moduleName, "importOptions", importOptions);
  await game.settings.set(ADVENTURE.moduleName, "alreadyImported", true);
  try {
    const coreImports = game.settings.get("core", "adventureImports") || {};
    await game.settings.set("core", "adventureImports", { ...coreImports, [ADVENTURE.adventureUuid]: true });
  } catch (e) {
    // Ignore if core setting cannot be written directly
  }
  ui.notifications.success(game.i18n.localize("IWD.IMPORT.Finished"));
  globalThis._iwdImportFinished = true;
}

/* -------------------------------------------- */
/*  Action Handlers                             */
/* -------------------------------------------- */

/**
 * Activate the starting scene (AR1000 Easthaven).
 */
export async function activateScene(adventure, option, isEnabled=true) {
  if ( !isEnabled ) return;
  const code = option.sceneCode || "AR1000";
  const scene = game.scenes.find(s => {
    const a = s.flags?.[ADVENTURE.moduleName]?.area || s.flags?.["icewind-dale-maps"]?.area;
    return a === code || s.name.includes(code) || s.name.includes("Истхейвен");
  });
  if ( scene ) {
    await scene.activate();
    console.log(`${ADVENTURE.moduleName} | Activated starting scene "${scene.name}"`);
  }
}

/**
 * Display the main walkthrough/guide journal entry.
 */
export async function displayJournal(adventure, option, isEnabled=true) {
  if ( !isEnabled ) return;
  const journal = game.journal.find(j => {
    return j.name.includes("Истхейвен") || j.name.includes("Пролог") || j.name.includes("Руководство");
  });
  journal?.sheet.render(true);
}

/**
 * Customize the world description and background image.
 */
export async function customizeJoin(adventure, { background }={}, isEnabled=true) {
  if ( !isEnabled ) return;
  const bg = background || "modules/dnd-icewind-dale-pc-game/assets/ui/icewind-dale-logo.avif";
  const worldData = {
    background: bg,
    action: "editWorld",
    id: game.world.id,
    description: "Icewind Dale: Enhanced Edition — Полная кампания D&D 5e с поддержкой изометрического и стандартного 2D вида."
  };
  try {
    await foundry.utils.fetchJsonWithTimeout(foundry.utils.getRoute("setup"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(worldData)
    });
    game.world.updateSource(worldData);
    console.log(`${ADVENTURE.moduleName} | World cover updated to ${bg}`);
  } catch (err) {
    console.warn(`${ADVENTURE.moduleName} | Failed to update world cover:`, err);
  }
}

/**
 * Configure initiative tracker backdrop.
 */
export async function setInitiativeBackground(adventure, { background }={}, isEnabled=true) {
  if ( !isEnabled ) return;
  const bg = background || "modules/dnd-icewind-dale-pc-game/assets/ui/initiative.avif";

  // 1. Save setting
  await game.settings.set(ADVENTURE.moduleName, "initiativeBackground", bg);

  // 2. Set Combat Tracker Dock if present
  if ( game.settings.settings.has("combat-tracker-dock.portraitImageBackground") ) {
    try {
      await game.settings.set("combat-tracker-dock", "portraitImageBackground", bg);
      console.log(`${ADVENTURE.moduleName} | Configured combat-tracker-dock.portraitImageBackground = ${bg}`);
    } catch (e) {
      console.warn("Could not set combat-tracker-dock setting:", e);
    }
  }

  // 3. Apply CSS to Core Combat Tracker
  applyInitiativeTheme(true);
}

/**
 * Apply or remove the initiative backdrop theme on DOM.
 * @param {boolean} [enabled=true]
 */
export function applyInitiativeTheme(enabled=true) {
  document.body.classList.toggle("iwd-initiative-bg", enabled);
  const root = document.documentElement;
  if ( enabled ) {
    const bg = game.settings.get(ADVENTURE.moduleName, "initiativeBackground")
      || "modules/dnd-icewind-dale-pc-game/assets/ui/initiative.avif";
    root.style.setProperty("--iwd-initiative-bg", `url("/${bg.replace(/^\/+/, '')}")`);
  } else {
    root.style.removeProperty("--iwd-initiative-bg");
  }
}

// --- Isometric projection matrix (PIXI / isometric-perspective) ---
const ROT = -35 * Math.PI / 180;
const SKX = 20 * Math.PI / 180;
const SKY = 0.0;
const A = Math.cos(ROT + SKY);
const B = Math.sin(ROT + SKY);
const Cc = -Math.sin(ROT - SKX);
const D = Math.cos(ROT - SKX);
const DET = A * D - B * Cc;
const GRID = 50;

function minv(x, y) {
  return [(D * x - Cc * y) / DET, (-B * x + A * y) / DET];
}
function mforward(qx, qy) {
  return [A * qx + Cc * qy, B * qx + D * qy];
}

export class IsoMapper {
  constructor(W, H) {
    this.cx = W / 2;
    this.cy = H / 2;
    const qs = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => minv(x - this.cx, y - this.cy));
    const xs = qs.map(q => q[0]);
    const ys = qs.map(q => q[1]);
    this.sw = Math.ceil((Math.max(...xs) - Math.min(...xs)) / GRID) * GRID;
    this.sh = Math.ceil((Math.max(...ys) - Math.min(...ys)) / GRID) * GRID;
    this.W = W;
    this.H = H;
  }
  toIso(x2D, y2D) {
    const [qx, qy] = minv(x2D - this.cx, y2D - this.cy);
    return [Math.round(this.sw / 2 + qx), Math.round(this.sh / 2 + qy)];
  }
  to2D(xIso, yIso) {
    const qx = xIso - this.sw / 2;
    const qy = yIso - this.sh / 2;
    const [dx, dy] = mforward(qx, qy);
    return [Math.round(this.cx + dx), Math.round(this.cy + dy)];
  }
}

/**
 * Convert a single scene between Standard 2D and Isometric Perspective.
 * The World Map ("Карта мира") is always kept in pure 2D.
 *
 * @param {Scene} scene
 * @param {boolean} [toIsometric=true]
 */
export async function convertScenePerspective(scene, toIsometric = true) {
  const isIwd = scene.flags?.[ADVENTURE.moduleName] || scene.flags?.["icewind-dale-maps"];
  if (!isIwd) return;

  // Rule: World Map is ALWAYS pure 2D!
  if (scene.id === "iwdMapWorldMap01" || scene.flags?.[ADVENTURE.moduleName]?.isWorldMap) {
    if (scene.flags?.["isometric-perspective"]) {
      await scene.update({ "flags.-=isometric-perspective": null });
    }
    return;
  }

  const currentIsIso = Boolean(scene.flags?.[ADVENTURE.moduleName]?.isIsometric || scene.flags?.["isometric-perspective"]?.isometricEnabled);
  if (toIsometric === currentIsIso) return;

  const priorConverting = game._iwdConvertingPerspective;
  game._iwdConvertingPerspective = true;
  try {
    const [W, H] = scene.flags?.[ADVENTURE.moduleName]?.image || [scene.width, scene.height];
    const mp = new IsoMapper(W, H);

    // 1. Scene updates
    const sceneUpdates = {
      _id: scene.id,
      width: toIsometric ? mp.sw : W,
      height: toIsometric ? mp.sh : H,
      [`flags.${ADVENTURE.moduleName}.isIsometric`]: toIsometric
    };

    if (scene._source?.background?.src) {
      sceneUpdates["background.src"] = null;
    }

    if (toIsometric) {
      sceneUpdates["flags.isometric-perspective"] = {
        isometricEnabled: true,
        isIsometric: true,
        isometricBackground: false,
        screenAlignedBackground: true,
        projectionType: "Game: Planescape Torment"
      };
    } else {
      sceneUpdates["flags.-=isometric-perspective"] = null;
    }
    await scene.update(sceneUpdates);

    // 2. Walls
    const wallUpdates = [];
    for (const w of scene.walls) {
      const [c0, c1] = toIsometric ? mp.toIso(w.c[0], w.c[1]) : mp.to2D(w.c[0], w.c[1]);
      const [c2, c3] = toIsometric ? mp.toIso(w.c[2], w.c[3]) : mp.to2D(w.c[2], w.c[3]);
      const upd = { _id: w.id, c: [c0, c1, c2, c3] };
      if (!toIsometric && w.flags?.["isometric-perspective"]) {
        upd["flags.-=isometric-perspective"] = null;
      }
      wallUpdates.push(upd);
    }
    if (wallUpdates.length) await scene.updateEmbeddedDocuments("Wall", wallUpdates);

    // 3. Tiles
    const tileUpdates = [];
    for (const t of scene.tiles) {
      const isBg = t.flags?.[ADVENTURE.moduleName]?.isBackground || (t.flags?.[ADVENTURE.moduleName]?.img?.[0] === 0 && t.flags?.[ADVENTURE.moduleName]?.img?.[1] === 0 && t.width === W && t.height === H);
      const img = t.flags?.[ADVENTURE.moduleName]?.img;
      const upd = { _id: t.id };
      if (toIsometric) {
        const srcX = img ? img[0] : (isBg ? 0 : t.x);
        const srcY = img ? img[1] : (isBg ? 0 : t.y);
        const [tx, ty] = mp.toIso(srcX, srcY);
        upd.x = tx;
        upd.y = ty;
        upd["flags.isometric-perspective.isoTileDisabled"] = true;
        upd[`flags.${ADVENTURE.moduleName}.screenAligned`] = true;
      } else {
        if (isBg) {
          upd.x = 0;
          upd.y = 0;
          upd.width = W;
          upd.height = H;
        } else if (img && img.length === 4) {
          upd.x = img[0];
          upd.y = img[1];
          upd.width = img[2];
          upd.height = img[3];
        } else {
          const [tx, ty] = mp.to2D(t.x, t.y);
          upd.x = tx;
          upd.y = ty;
        }
        upd["flags.-=isometric-perspective"] = null;
        upd[`flags.${ADVENTURE.moduleName}.screenAligned`] = false;
      }
      tileUpdates.push(upd);
    }
    if (tileUpdates.length) await scene.updateEmbeddedDocuments("Tile", tileUpdates);

    // 4. Tokens
    const tokenUpdates = [];
    for (const token of scene.tokens) {
      const [tx, ty] = toIsometric ? mp.toIso(token.x, token.y) : mp.to2D(token.x, token.y);
      const size = token.actor?.system?.traits?.size;
      const targetScale = (size === "sm") ? 0.5 : (size === "tiny") ? 0.35 : 0.7;
      const upd = { _id: token.id, x: tx, y: ty };
      if (toIsometric) {
        upd["flags.isometric-perspective.scale"] = targetScale;
      } else {
        upd["flags.-=isometric-perspective"] = null;
      }
      tokenUpdates.push(upd);
    }
    if (tokenUpdates.length) await scene.updateEmbeddedDocuments("Token", tokenUpdates, { noHook: true, animate: false });

    // 5. Lights
    const lightUpdates = [];
    for (const l of scene.lights) {
      const [lx, ly] = toIsometric ? mp.toIso(l.x, l.y) : mp.to2D(l.x, l.y);
      lightUpdates.push({ _id: l.id, x: lx, y: ly });
    }
    if (lightUpdates.length) await scene.updateEmbeddedDocuments("AmbientLight", lightUpdates);

    // 6. Sounds
    const soundUpdates = [];
    for (const s of scene.sounds) {
      const [sx, sy] = toIsometric ? mp.toIso(s.x, s.y) : mp.to2D(s.x, s.y);
      soundUpdates.push({ _id: s.id, x: sx, y: sy });
    }
    if (soundUpdates.length) await scene.updateEmbeddedDocuments("AmbientSound", soundUpdates);

    // 7. Notes
    const noteUpdates = [];
    for (const n of scene.notes) {
      const [nx, ny] = toIsometric ? mp.toIso(n.x, n.y) : mp.to2D(n.x, n.y);
      noteUpdates.push({ _id: n.id, x: nx, y: ny });
    }
    if (noteUpdates.length) await scene.updateEmbeddedDocuments("Note", noteUpdates);

    // 8. Regions
    const regionUpdates = [];
    for (const r of scene.regions) {
      const shapes = foundry.utils.deepClone(r.shapes || []);
      let modified = false;
      for (const shape of shapes) {
        if (shape.points && shape.points.length >= 2) {
          const newPts = [];
          for (let i = 0; i < shape.points.length; i += 2) {
            const [px, py] = toIsometric ? mp.toIso(shape.points[i], shape.points[i + 1]) : mp.to2D(shape.points[i], shape.points[i + 1]);
            newPts.push(px, py);
          }
          shape.points = newPts;
          modified = true;
        }
      }
      if (modified) regionUpdates.push({ _id: r.id, shapes });
    }
    if (regionUpdates.length) await scene.updateEmbeddedDocuments("Region", regionUpdates);
  } finally {
    game._iwdConvertingPerspective = priorConverting;
  }
}

/**
 * Convert all Icewind Dale scenes to isometric or 2D.
 * @param {boolean} [useIsometric=true]
 */
export async function convertScenesToIsometric(useIsometric = true) {
  game._iwdConvertingPerspective = true;
  try {
    const scenes = Array.from(game.scenes);
    const BATCH_SIZE = 8;
    for (let i = 0; i < scenes.length; i += BATCH_SIZE) {
      const chunk = scenes.slice(i, i + BATCH_SIZE);
      await Promise.all(chunk.map(scene => convertScenePerspective(scene, useIsometric)));
    }
  } finally {
    game._iwdConvertingPerspective = false;
  }
}

/**
 * Configure scenes, tiles, tokens, and actors for either Isometric Perspective
 * or Standard 2D Foundry VTT format during adventure import.
 *
 * @param {Adventure} adventure
 * @param {object} config
 * @param {boolean} [isEnabled=true]
 * @param {object} [formData={}]
 */
export async function configureIsometricMaps(adventure, config, isEnabled=true, formData={}) {
  const hasModule = game.modules.has("isometric-perspective") || Boolean(game.modules.get("isometric-perspective"));
  if ( !hasModule ) {
    console.warn(`${ADVENTURE.moduleName} | Module 'isometric-perspective' is not present. Keeping standard 2D configuration.`);
    return;
  }
  const isModuleActive = Boolean(game.modules.get("isometric-perspective")?.active);
  const useIsometric = Boolean(isEnabled && isModuleActive);

  console.log(`${ADVENTURE.moduleName} | Configuring maps format: ${useIsometric ? "Isometric Perspective" : "Standard 2D"}`);
  await convertScenesToIsometric(useIsometric);
}

/**
 * Link imported scenes to their matching atmospheric playlists.
 */
export async function linkPlaylists(adventure, option, isEnabled=true) {
  if ( !isEnabled ) return;
  const playlistsByArea = {};
  for ( const pl of game.playlists ) {
    const areas = pl.flags?.[ADVENTURE.moduleName]?.areas || pl.flags?.["icewind-dale-campaign"]?.areas || [];
    for ( const a of areas ) playlistsByArea[a] = pl.id;
  }
  const sceneUpdates = [];
  for ( const scene of game.scenes ) {
    const code = scene.flags?.[ADVENTURE.moduleName]?.area || scene.flags?.["icewind-dale-maps"]?.area;
    if ( code && playlistsByArea[code] && scene.playlist?.id !== playlistsByArea[code] ) {
      sceneUpdates.push({ _id: scene.id, playlist: playlistsByArea[code] });
    }
  }
  if ( sceneUpdates.length ) {
    await Scene.updateDocuments(sceneUpdates);
    console.log(`${ADVENTURE.moduleName} | Linked playlists to ${sceneUpdates.length} scenes.`);
  }
}

/**
 * Programmatically open the Icewind Dale Adventure Importer sheet.
 */
export async function openImporter() {
  const pack = game.packs.get(ADVENTURE.packId);
  if ( !pack ) {
    ui.notifications.error(`Пак приключения ${ADVENTURE.packId} не найден.`);
    return;
  }
  const adventure = await pack.getDocument(ADVENTURE.adventureId);
  if ( !adventure ) {
    ui.notifications.error(`Документ приключения не найден.`);
    return;
  }
  adventure.sheet.render(true);
}

/**
 * Ensure all imported world scenes have their tokens populated.
 * If Adventure.import() already placed them, this gracefully skips.
 * @param {Adventure} adventure
 */
export async function ensureSceneTokens(adventure) {
  const actorsByCre = new Map();
  for ( const actor of game.actors ) {
    const cre = (actor.flags?.[ADVENTURE.moduleName]?.cre || actor.flags?.["dnd-icewind-dale-pack"]?.cre || "").toUpperCase();
    if ( cre ) actorsByCre.set(cre, actor);
  }

  for ( const scene of game.scenes ) {
    const specs = scene.flags?.[ADVENTURE.moduleName]?.tokens;
    if ( !specs || !specs.length ) continue;
    if ( scene.tokens.size > 0 ) continue; // Already has tokens!

    const tokenDocs = [];
    for ( const spec of specs ) {
      const cre = (spec.cre || "").toUpperCase();
      const actor = actorsByCre.get(cre);
      if ( !actor ) continue;
      const proto = actor.prototypeToken || {};
      const cleanTokenName = (proto.name || actor.name || "")
        .replace(/\[.*?\]|\(.*?\)/g, "")
        .replace(/\s*\d+$/, "")
        .trim();
      tokenDocs.push({
        name: cleanTokenName || actor.name,
        actorId: actor.id,
        actorLink: false,
        x: Math.round(spec.x),
        y: Math.round(spec.y),
        width: proto.width || 1,
        height: proto.height || 1,
        texture: {
          src: proto.texture?.src || actor.img,
          scaleX: proto.texture?.scaleX ?? 1,
          scaleY: proto.texture?.scaleY ?? 1,
          anchorX: proto.texture?.anchorX ?? 0.5,
          anchorY: proto.texture?.anchorY ?? 0.5,
          fit: proto.texture?.fit || "contain"
        },
        disposition: proto.disposition ?? -1,
        flags: foundry.utils.deepClone(proto.flags || {})
      });
    }

    if ( tokenDocs.length ) {
      try {
        await scene.createEmbeddedDocuments("Token", tokenDocs);
        console.log(`${ADVENTURE.moduleName} | Placed ${tokenDocs.length} tokens on scene "${scene.name}"`);
      } catch (err) {
        console.warn(`${ADVENTURE.moduleName} | Failed to create tokens on "${scene.name}":`, err);
      }
    }
  }
}
