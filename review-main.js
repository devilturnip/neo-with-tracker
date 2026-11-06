// litrpg-tracker fork — the main-process half of reader comments: the
// file picker and the read of a .docx or .odt review copy (review-core.js
// does the parsing). The review copies themselves go out through NEO's
// own export:save.
//
// Required by one line in main.js:
//   require('./review-main.js')({ ipcMain, dialog, BrowserWindow, logError })
'use strict';

const fs = require('fs');
const path = require('path');
const { readComments } = require('./review-core.js');

module.exports = function installReview({ ipcMain, dialog, BrowserWindow, logError }) {
  ipcMain.handle('review:import', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import reader comments',
      properties: ['openFile'],
      filters: [{ name: 'Word or LibreOffice', extensions: ['docx', 'odt'] }],
    });
    if (canceled || !filePaths.length) return null;
    const file = filePaths[0];
    try {
      const comments = await readComments(require('jszip'), fs.readFileSync(file), path.extname(file).toLowerCase());
      return { file: path.basename(file), comments };
    } catch (err) {
      logError('review import', err);
      throw new Error("Couldn't read the comments: " + ((err && err.message) || err));
    }
  });
};
