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
  const importOptions = {};
  for ( const [name, config] of Object.entries(ADVENTURE.importOptions) ) {
    const isEnabled = Boolean(formData[name]);
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
  ui.notifications.success(game.i18n.localize("IWD.IMPORT.Finished"));
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
    root.style.setProperty("--iwd-initiative-bg", `url("${bg}")`);
  } else {
    root.style.removeProperty("--iwd-initiative-bg");
  }
}

/**
 * Configure scenes, tiles, tokens, and actors for either Isometric Perspective
 * or Standard 2D Foundry VTT format (without extra keys/flags).
 *
 * @param {Adventure} adventure
 * @param {object} config
 * @param {boolean} [isEnabled=true]
 * @param {object} [formData={}]
 */
export async function configureIsometricMaps(adventure, config, isEnabled=true, formData={}) {
  const hasModule = Boolean(game.modules.get("isometric-perspective")?.active);
  const useIsometric = Boolean(isEnabled && hasModule);

  console.log(`${ADVENTURE.moduleName} | Configuring maps format: ${useIsometric ? "Isometric Perspective" : "Standard 2D"}`);

  // 1. Update Scenes in game.scenes
  for ( const scene of game.scenes ) {
    const isIwd = scene.flags?.[ADVENTURE.moduleName] || scene.flags?.["icewind-dale-maps"];
    if ( !isIwd ) continue;

    const sceneUpdates = { _id: scene.id };

    if ( useIsometric ) {
      sceneUpdates["flags.isometric-perspective"] = {
        isometricEnabled: true,
        isometricBackground: false,
        screenAlignedBackground: true,
        projectionType: "Game: Planescape Torment"
      };
    } else {
      // Standard 2D mode: ensure background.src is set and remove isometric-perspective flags
      const area = scene.flags?.[ADVENTURE.moduleName]?.area || scene.flags?.["icewind-dale-maps"]?.area;
      if ( area && !scene.background?.src ) {
        sceneUpdates["background.src"] = `modules/${ADVENTURE.moduleName}/assets/maps/${area}.avif`;
      }
      sceneUpdates["flags.-=isometric-perspective"] = null;
    }
    await scene.update(sceneUpdates);

    // 2. Update Tiles on this Scene
    const tileUpdates = [];
    for ( const tile of scene.tiles ) {
      if ( useIsometric ) {
        if ( !tile.flags?.["isometric-perspective"]?.isoTileDisabled ) {
          tileUpdates.push({
            _id: tile.id,
            "flags.isometric-perspective.isoTileDisabled": true
          });
        }
      } else {
        if ( tile.flags?.["isometric-perspective"] ) {
          tileUpdates.push({
            _id: tile.id,
            "flags.-=isometric-perspective": null
          });
        }
      }
    }
    if ( tileUpdates.length ) await scene.updateEmbeddedDocuments("Tile", tileUpdates);

    // 3. Update Placed Tokens on this Scene
    const tokenUpdates = [];
    for ( const token of scene.tokens ) {
      const size = token.actor?.system?.traits?.size;
      const targetScale = (size === "sm") ? 0.5 : (size === "tiny") ? 0.35 : 0.7;
      if ( useIsometric ) {
        if ( token.flags?.["isometric-perspective"]?.scale !== targetScale ) {
          tokenUpdates.push({
            _id: token.id,
            "flags.isometric-perspective.scale": targetScale
          });
        }
      } else {
        if ( token.flags?.["isometric-perspective"] ) {
          tokenUpdates.push({
            _id: token.id,
            "flags.-=isometric-perspective": null
          });
        }
      }
    }
    if ( tokenUpdates.length ) await scene.updateEmbeddedDocuments("Token", tokenUpdates);
  }

  // 4. Update Actors in game.actors
  const actorUpdates = [];
  for ( const actor of game.actors ) {
    const size = actor.system?.traits?.size;
    const targetScale = (size === "sm") ? 0.5 : (size === "tiny") ? 0.35 : 0.7;
    if ( useIsometric ) {
      if ( actor.prototypeToken?.flags?.["isometric-perspective"]?.scale !== targetScale ) {
        actorUpdates.push({
          _id: actor.id,
          "prototypeToken.flags.isometric-perspective.scale": targetScale
        });
      }
    } else {
      if ( actor.prototypeToken?.flags?.["isometric-perspective"] ) {
        actorUpdates.push({
          _id: actor.id,
          "prototypeToken.flags.-=isometric-perspective": null
        });
      }
    }
  }
  if ( actorUpdates.length ) await Actor.updateDocuments(actorUpdates);
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
      tokenDocs.push({
        name: spec.name || actor.name,
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
