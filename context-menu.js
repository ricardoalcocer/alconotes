'use strict';

const { Menu, clipboard } = require('electron');

// Build the right-click menu template for the given `context-menu` params.
// Exported separately from the install step so it can be tested headlessly.
function buildTemplate(webContents, params) {
  const template = [];
  const flags = params.editFlags || {};

  // Spelling suggestions when right-clicking a misspelled word.
  if (params.misspelledWord) {
    const suggestions = (params.dictionarySuggestions || []).slice(0, 5);
    for (const s of suggestions) {
      template.push({ label: s, click: () => webContents.replaceMisspelling(s) });
    }
    if (!suggestions.length) template.push({ label: 'No Guesses Found', enabled: false });
    template.push(
      {
        label: 'Add to Dictionary',
        click: () => webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      },
      { type: 'separator' },
    );
  }

  // Right-clicking a link (e.g. in the preview pane).
  if (params.linkURL) {
    template.push(
      { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' },
    );
  }

  if (params.isEditable) {
    template.push(
      { role: 'cut', enabled: !!flags.canCut },
      { role: 'copy', enabled: !!flags.canCopy },
      { role: 'paste', enabled: !!flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: !!flags.canSelectAll },
    );
  } else {
    // Read-only surfaces (preview pane): just copy / select all.
    template.push(
      { role: 'copy', enabled: !!flags.canCopy },
      { type: 'separator' },
      { role: 'selectAll', enabled: !!flags.canSelectAll },
    );
  }
  return template;
}

function installContextMenu(win) {
  win.webContents.on('context-menu', (_event, params) => {
    Menu.buildFromTemplate(buildTemplate(win.webContents, params)).popup({ window: win });
  });
}

module.exports = { buildTemplate, installContextMenu };
