'use strict';
const assert = require('node:assert/strict');

// Runs inside the existing Electron UI suite after photos have been imported.
module.exports = async function verifyRendererInteractions(page) {
  const result = await page.evaluate(async () => {
    const root = document.getElementById('slots');
    const originalCard = root.firstElementChild;
    document.getElementById('start').dispatchEvent(new Event('input'));
    const configKeepsCards = root.firstElementChild === originalCard;
    originalCard.focus();
    originalCard.click();
    const selectionKeepsFocus = document.activeElement === originalCard;

    const locks = [];
    for (const operation of [
      'photoExport',
      'photoImport',
      'videoExport',
      'videoImport'
    ]) {
      busy = operation === 'photoExport';
      loading = operation === 'photoImport';
      videoBusy = operation === 'videoExport';
      videoLoading = operation === 'videoImport';
      controls();
      const currentMode = mode;
      setMode('video');
      locks.push({
        operation,
        modeLocked: mode === currentMode,
        buttonsLocked: [...document.querySelectorAll('.slot button')].every(
          (button) => button.disabled
        ),
        draggingLocked: [...document.querySelectorAll('.slot')].every(
          (card) => !card.draggable
        ),
        updaterLocked: document.getElementById('updateButton').disabled,
        settingsLocked:
          document.getElementById('start').disabled &&
          document.getElementById('videoDate').disabled
      });
      // These calls must return before trying to pass invalid objects through IPC.
      await addVideoFiles([{}], 0);
      await importSequential([{}], 0, () => {
        throw Error('Import ran while locked');
      });
    }
    busy = loading = videoBusy = videoLoading = false;
    controls();

    // Intercept just the import entry points to check clipboard routing.
    const originalPhotoImport = addFiles;
    const originalVideoImport = addVideoFiles;
    const routed = [];
    addFiles = async () => routed.push('photo');
    addVideoFiles = async () => routed.push('video');
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File(['test'], 'clip.mp4', { type: 'video/mp4' })
    );
    try {
      setMode('video');
      document.body.focus();
      document.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true })
      );
      videoBusy = true;
      document.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true })
      );
      document.body.dispatchEvent(
        new DragEvent('drop', { dataTransfer: clipboardData, bubbles: true })
      );
      videoBusy = false;
      setMode('photo');
      document.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData, bubbles: true })
      );
    } finally {
      addFiles = originalPhotoImport;
      addVideoFiles = originalVideoImport;
      busy = loading = videoBusy = videoLoading = false;
      setMode('photo');
      controls();
    }
    return { configKeepsCards, selectionKeepsFocus, locks, routed };
  });
  assert.equal(
    result.configKeepsCards,
    true,
    'config edits should retain existing thumbnails'
  );
  assert.equal(
    result.selectionKeepsFocus,
    true,
    'selecting a photo should preserve its DOM node and focus'
  );
  for (const lock of result.locks) {
    for (const [name, value] of Object.entries(lock)) {
      if (name !== 'operation')
        assert.equal(value, true, `${lock.operation}: ${name}`);
    }
  }
  assert.deepEqual(
    result.routed,
    ['video', 'photo'],
    'clipboard follows active mode and busy operations reject new drops'
  );
  console.log(
    'RENDERER PASS: stable thumbnails, focus, import/export locks and clipboard routing.'
  );
};
