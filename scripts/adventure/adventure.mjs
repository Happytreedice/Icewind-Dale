import * as handlers from "./importer.mjs";

/**
 * Configuration of the Icewind Dale adventure and import options.
 */
export const ADVENTURE = {
  moduleName: "dnd-icewind-dale-pc-game",
  packName: "adventures",
  packId: "dnd-icewind-dale-pc-game.adventures",
  adventureUuid: "Compendium.dnd-icewind-dale-pc-game.adventures.Adventure.iwdAdventure0001",
  adventureId: "iwdAdventure0001",

  cssClass: "iwd-adventure",

  description: `
    <aside class="notable">
      <p><strong>Добро пожаловать в Долину Ледяного Ветра!</strong></p>
      <p>Полная классическая кампания <em>Icewind Dale (2000 / Enhanced Edition)</em>, адаптированная для Foundry VTT с бесшовной поддержкой D&D 5e и изометрического вида.</p>
    </aside>
    <p>Ваш отряд отправляется на север Фаэруна, за Хребет Мира, где вечные метели сковали Десять Городов. Древнее зло пробуждается в глубинах ледников и заброшенных гномьих чертогах.</p>
    <h3>Особенности модуля:</h3>
    <ul>
      <li><strong>173 аутентичные локации</strong>: все главы с Пролога по «Сердце Зимы» и «Испытания Мастера Приманок» с изометрическим видом, точными стенами, дверьми и фоновыми звуками.</li>
      <li><strong>717 существ</strong>: сбалансированные противники с полным набором характеристик, атак и заклинаний D&D 5e, а также анимированными WebM-токенами по 8 направлениям.</li>
      <li><strong>757 предметов</strong>: аутентичное снаряжение, артефакты и зелья с оригинальными иконками.</li>
      <li><strong>Диалоги и журналы</strong>: 101 интерактивное дерево диалогов и 128 подробных руководств по прохождению.</li>
      <li><strong>Атмосферная музыка</strong>: 45 саундтреков от Джереми Соула, привязанных к соответствующим сценам.</li>
    </ul>
  `.trim(),

  importOptions: {
    activateScene: {
      label: "IWD.IMPORT.ActivateScene",
      default: true,
      handler: handlers.activateScene,
      lifecycle: "post",
      sceneCode: "AR1000"
    },
    displayJournal: {
      label: "IWD.IMPORT.DisplayJournal",
      default: true,
      handler: handlers.displayJournal,
      lifecycle: "post"
    },
    customizeJoin: {
      label: "IWD.IMPORT.CustomizeJoin",
      default: true,
      handler: handlers.customizeJoin,
      lifecycle: "post",
      background: "modules/dnd-icewind-dale-pc-game/assets/ui/icewind-dale-logo.avif"
    },
    setInitiativeBackground: {
      label: "IWD.IMPORT.SetInitiativeBackground",
      default: true,
      handler: handlers.setInitiativeBackground,
      lifecycle: "post",
      background: "modules/dnd-icewind-dale-pc-game/assets/ui/initiative.avif"
    },
    isometricMaps: {
      label: "IWD.IMPORT.IsometricMaps",
      default: () => Boolean(game.modules.get("isometric-perspective")?.active),
      handler: handlers.configureIsometricMaps,
      lifecycle: "post",
      validate: () => game.modules.has("isometric-perspective") || Boolean(game.modules.get("isometric-perspective")),
      disabledHint: "IWD.IMPORT.IsometricMissing"
    },
    linkPlaylists: {
      label: "IWD.IMPORT.LinkPlaylists",
      default: true,
      handler: handlers.linkPlaylists,
      lifecycle: "post"
    }
  }
};
