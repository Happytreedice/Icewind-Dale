import IwdJournalSheet from "./journal-sheet.mjs";
import { ADVENTURE } from "./adventure/adventure.mjs";
import {
  renderAdventureImporter,
  onImport,
  openImporter,
  applyInitiativeTheme
} from "./adventure/importer.mjs";

/* dnd-icewind-dale-pc-game: Integrated Icewind Dale PC Game module.
   - Screen-aligned isometric background & sprite tiles
   - Door sounds and state-linked door tiles
   - Journal sheet theme
   - Full campaign import API (scenes, tokens, hint journals, playlists)
   - Adventure welcome & import screen
   - Initiative tracker backdrop
*/
const MODID = "dnd-icewind-dale-pc-game";
const ISO = "isometric-perspective";

// --- Door Sounds ---
Hooks.once("init", async () => {
  try {
    const res = await fetch(`modules/${MODID}/assets/doorsounds.json`);
    if (res.ok) {
      const sounds = await res.json();
      for (const [key, s] of Object.entries(sounds)) {
        CONFIG.Wall.doorSounds[key] = {
          label: s.label,
          open: s.open ? s.open.replace(/modules\/(icewind-dale-maps|dnd-icewind-dale-pack|icewind-dale-campaign)/, `modules/${MODID}`) : undefined,
          close: s.close ? s.close.replace(/modules\/(icewind-dale-maps|dnd-icewind-dale-pack|icewind-dale-campaign)/, `modules/${MODID}`) : undefined
        };
      }
    }
  } catch (e) {
    console.error(`${MODID} | door sounds failed to load:`, e);
  }

  // Register Journal Sheet
  DocumentSheetConfig.registerSheet(JournalEntry, MODID, IwdJournalSheet, {
    types: ["base"],
    label: "Icewind Dale — стиль игры",
    makeDefault: false
  });

  // Register Settings
  game.settings.register(MODID, "importOptions", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODID, "initiativeBackground", {
    name: "IWD.IMPORT.SetInitiativeBackground",
    hint: "Подложка трекера инициативы",
    scope: "world",
    config: true,
    type: String,
    default: `modules/${MODID}/assets/ui/initiative.avif`,
    onChange: value => applyInitiativeTheme(!!value)
  });
});

// --- Adventure Importer Hooks ---
Hooks.on("renderAdventureImporterV2", renderAdventureImporter);
Hooks.on("importAdventure", onImport);

// --- Babele Translation Support ---
Hooks.once("babele.init", (babele) => {
  babele.register({
    module: MODID,
    lang: "ru",
    dir: "languages/babele"
  });
});

// --- Door Tiles sync ---
Hooks.on("updateWall", async (wall, change) => {
  if (!("ds" in change) || game.user !== game.users.activeGM) return;
  const scene = wall.parent;
  if (!scene) return;
  const open = wall.ds === CONST.WALL_DOOR_STATES.OPEN;
  const updates = [];
  for (const t of scene.tiles) {
    const f = t.flags?.[MODID] || t.flags?.["icewind-dale-maps"];
    if (!f || f.doorWall !== wall.id) continue;
    const hidden = f.showsClosed ? open : !open;
    if (t.hidden !== hidden) updates.push({ _id: t.id, hidden });
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Tile", updates);
});

// --- Screen-aligned sprite tiles for Isometric Perspective ---
function alignTile(tile) {
  const doc = tile.document;
  const f = doc.flags?.[MODID] || doc.flags?.["icewind-dale-maps"];
  if (!f?.screenAligned || !tile.mesh || !canvas.scene) return;
  if (!canvas.scene.getFlag(ISO, "isometricEnabled") || !game.settings.get(ISO, "worldIsometricFlag")) {
    tile.mesh.anchor.set(0, 0);
    return;
  }
  const t = new PIXI.Transform();
  t.rotation = canvas.app.stage.rotation;
  t.skew.set(canvas.app.stage.skew.x, canvas.app.stage.skew.y);
  t.updateLocalTransform();
  const inv = t.localTransform.clone().invert();
  const m = tile.mesh;
  m.anchor.set(0, 0);
  m.transform.setFromMatrix(inv);
  m.position.set(doc.x, doc.y);
}

Hooks.once("ready", async () => {
  Hooks.on("refreshTile", alignTile);
  Hooks.on("canvasReady", () => canvas.tiles?.placeables?.forEach(alignTile));

  // Initiative theme setup
  const initBg = game.settings.get(MODID, "initiativeBackground");
  if ( initBg ) applyInitiativeTheme(true);

  // Automatic first-run welcome & import prompt for GM
  const imported = !!game.settings.get("core", "adventureImports")?.[ADVENTURE.adventureUuid];
  if ( !imported && game.user.isGM ) {
    const pack = game.packs.get(ADVENTURE.packId);
    if ( pack ) {
      const adventure = await pack.getDocument(ADVENTURE.adventureId);
      adventure?.sheet.render(true);
    }
  }
});

// --- Campaign Import API ---
async function ensureFolder(name, type, parent = null) {
  let f = game.folders.find(x => x.type === type && x.name === name && (x.folder?.id ?? null) === (parent?.id ?? null));
  return f ?? Folder.create({ name, type, folder: parent?.id ?? null, sorting: "a" });
}

async function importPlaylists(log) {
  const pp = game.packs.get(`${MODID}.playlists`);
  if (!pp) return {};
  const docs = await pp.getDocuments();
  const byArea = {};
  for (const d of docs) {
    let pl = game.playlists.get(d.id);
    if (!pl) {
      const root = await ensureFolder(d.folder?.folder?.name ?? d.folder?.name ?? "Icewind Dale — музыка", "Playlist");
      const f = d.folder?.folder ? await ensureFolder(d.folder.name, "Playlist", root) : root;
      const data = d.toObject();
      data.folder = f.id;
      pl = await Playlist.create(data, { keepId: true });
    }
    const areas = d.flags?.[MODID]?.areas ?? d.flags?.["icewind-dale-campaign"]?.areas ?? [];
    for (const a of areas) byArea[a] = pl.id;
  }
  log?.(`Плейлисты: ${docs.length}`);
  return byArea;
}

async function importArea(sceneDoc, { difficulty = "normal", replaceTokens = false, overwrite = false, log, playlists = null } = {}) {
  const f = sceneDoc.flags?.[MODID] || sceneDoc.flags?.["icewind-dale-maps"];
  if (!f?.area) return null;
  const code = f.area;
  if (overwrite) {
    const oldScenes = game.scenes.filter(s => s.id === sceneDoc.id || (s.flags?.[MODID]?.area || s.flags?.["icewind-dale-maps"]?.area) === code);
    if (oldScenes.length) await Scene.deleteDocuments(oldScenes.map(s => s.id));
    if (sceneDoc.journal && game.journal.get(sceneDoc.journal)) await JournalEntry.deleteDocuments([sceneDoc.journal]);
    const oldActors = game.actors.filter(a => (a.flags?.[MODID]?.area || a.flags?.["dnd-icewind-dale-pack"]?.area) === code);
    if (oldActors.length) await Actor.deleteDocuments(oldActors.map(a => a.id));
    log?.(`Перезапись ${code}: удалено сцен ${oldScenes.length}, существ ${oldActors.length}`);
    replaceTokens = true;
  }

  // 1) Scene
  let scene = game.scenes.get(sceneDoc.id) ?? game.scenes.find(s => (s.flags?.[MODID]?.area || s.flags?.["icewind-dale-maps"]?.area) === code);
  if (!scene) {
    const root = await ensureFolder("Icewind Dale", "Scene");
    const fRef = sceneDoc.folder;
    const fId = typeof fRef === "string" ? fRef : (fRef?.id ?? fRef?._id ?? null);
    const chapterName = fRef?.name ?? game.packs.get(`${MODID}.maps`)?.folders?.get(fId)?.name ?? "Прочее";
    const folder = await ensureFolder(chapterName, "Scene", root);
    const data = sceneDoc.toObject();
    data.folder = folder.id;
    delete data.ownership;
    scene = await Scene.create(data, { keepId: true });
    log?.(`Сцена создана: ${scene.name}`);
  } else {
    log?.(`Сцена уже есть: ${scene.name}`);
  }
  if (playlists?.[code] && scene.playlist?.id !== playlists[code]) {
    await scene.update({ playlist: playlists[code] });
  }

  // 2) Hint journal
  if (sceneDoc.journal && !game.journal.get(sceneDoc.journal)) {
    const jp = game.packs.get(`${MODID}.journal`);
    const je = await jp?.getDocument(sceneDoc.journal);
    if (je) {
      const jf = await ensureFolder("Icewind Dale — подсказки локаций", "JournalEntry");
      const d = je.toObject();
      d.folder = jf.id;
      await JournalEntry.create(d, { keepId: true });
      log?.(`Журнал подсказок: ${je.name}`);
    }
  }

  // 3) Creatures for this area
  const ap = game.packs.get(`${MODID}.actors`);
  if (!ap) {
    log?.("Пак существ не найден");
    return scene;
  }
  const index = await ap.getIndex({ fields: ["flags", "folder"] });
  const mine = index.filter(e => {
    const fl = e.flags?.[MODID] || e.flags?.["dnd-icewind-dale-pack"];
    return fl?.areas ? (code in fl.areas) : fl?.area === code;
  });

  const packFolders = ap.folders;
  const root = await ensureFolder("Icewind Dale — существа", "Actor");
  const typeFolderFor = (e) => {
    const ref = e.folder;
    const folderObj = packFolders.get(typeof ref === "string" ? ref : (ref?.id ?? ref?._id));
    return folderObj?.name ?? "Monstrosity";
  };

  const byCre = new Map();
  for (const e of mine) {
    let actor = game.actors.get(e._id);
    if (!actor) {
      const src = await ap.getDocument(e._id);
      const d = src.toObject();
      d.folder = (await ensureFolder(typeFolderFor(e), "Actor", root)).id;
      if (game.modules.get("isometric-perspective")?.active) {
        foundry.utils.setProperty(d, "prototypeToken.flags.isometric-perspective.scale", 0.7);
      }
      actor = await Actor.create(d, { keepId: true });
    }
    const creRef = e.flags?.[MODID]?.cre || e.flags?.["dnd-icewind-dale-pack"]?.cre;
    if (creRef) byCre.set(creRef, actor);
  }

  // 4) Tokens at original positions
  if (replaceTokens) {
    await scene.deleteEmbeddedDocuments("Token", scene.tokens.filter(t => t.flags?.[MODID] || t.flags?.["icewind-dale-campaign"]).map(t => t.id));
  } else if (scene.tokens.some(t => t.flags?.[MODID] || t.flags?.["icewind-dale-campaign"])) {
    log?.(`Токены уже расставлены: ${scene.name}`);
    return scene;
  }

  const specs = f.tokens ?? [];
  const tokens = [];
  for (const s of specs) {
    const actor = byCre.get(s.cre);
    if (!actor) continue;
    const td = await actor.getTokenDocument({ x: 0, y: 0 });
    const w = (td.width ?? 1) * scene.grid.size;
    const h = (td.height ?? 1) * scene.grid.size;
    const data = td.toObject();
    data.x = Math.round(s.x - w / 2);
    data.y = Math.round(s.y - h / 2);
    data.name = td.name || actor.name.split(" / ")[0];
    data.flags = { ...(data.flags ?? {}), [MODID]: { cre: s.cre, difficulty } };
    delete data._id;
    tokens.push(data);
  }
  if (tokens.length) await scene.createEmbeddedDocuments("Token", tokens);
  log?.(`${scene.name}: существ ${byCre.size}, токенов ${tokens.length}`);
  return scene;
}

async function importAll({ difficulty = "normal", areas = null, replaceTokens = false, overwrite = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn("Импорт доступен только Ведущему.");
  const pack = game.packs.get(`${MODID}.maps`);
  if (!pack) return ui.notifications.error(`Пак карт ${MODID}.maps не найден.`);
  const docs = await pack.getDocuments();
  const lines = [];
  const log = m => { lines.push(m); console.log(`${MODID} | ${m}`); };
  const playlists = await importPlaylists(log);
  ui.notifications.info(`Icewind Dale: импорт ${docs.length} локаций (сложность ${difficulty}${overwrite ? ", с перезаписью" : ""})…`);
  for (const d of docs) {
    const code = d.flags?.[MODID]?.area || d.flags?.["icewind-dale-maps"]?.area;
    if (areas && !areas.includes(code)) continue;
    try {
      await importArea(d, { difficulty, replaceTokens, overwrite, log, playlists });
    } catch (e) {
      console.error(e);
      log(`Ошибка ${d.name}: ${e.message}`);
    }
  }
  ChatMessage.create({ whisper: [game.user.id], content: `<h3>Импорт Icewind Dale (${difficulty})</h3><p>${lines.join("<br>")}</p>` });
  ui.notifications.info("Импорт Icewind Dale завершён.");
}

Hooks.once("init", () => {
  game.modules.get(MODID).api = {
    importAll,
    importArea,
    importPlaylists,
    openImporter,
    applyInitiativeTheme
  };
});
