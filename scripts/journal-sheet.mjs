/** Icewind Dale journal sheet: dnd5e journal sheet with the module's visual theme. */
export default class IwdJournalSheet extends dnd5e.applications.journal.JournalEntrySheet5e {
  /** @override */
  static DEFAULT_OPTIONS = { classes: ["iwd"] };

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // clicking a Scene link views the scene (GM), like the Phandelver Below sheet
    if (!game.user.isGM) return;
    for (const link of this.element.querySelectorAll('.content-link[data-type="Scene"]')) {
      link.addEventListener("click", ev => { ev.stopImmediatePropagation(); game.scenes.get(ev.currentTarget.dataset.id)?.view(); });
    }
  }
}
