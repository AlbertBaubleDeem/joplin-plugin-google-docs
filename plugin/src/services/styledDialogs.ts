/**
 * Styled Dialogs
 * 
 * Utility functions for showing consistent, theme-aware dialogs.
 * Uses the width: max-content pattern for proper sizing.
 */

export interface InfoDialogOptions {
  title: string;
  message: string;
  details?: string;
  icon?: string;
  buttonLabel?: string;
}

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  details?: string;
  icon?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Show an info dialog with a single OK button
 */
export async function showInfoDialog(j: any, options: InfoDialogOptions): Promise<void> {
  const {
    title,
    message,
    details,
    icon = 'ℹ️',
    buttonLabel = 'OK',
  } = options;

  const dialogId = 'gdocs-info-' + Date.now();
  const dialog = await j.views.dialogs.create(dialogId);

  const detailsHtml = details 
    ? `<p style="line-height: 1.6; color: var(--joplin-color); font-size: 13px;">${escapeHtml(details)}</p>`
    : '';

  const dialogHtml = `
    <style>#joplin-plugin-content { width: max-content; max-width: 420px; }</style>
    <div style="padding: 20px; min-width: 320px; max-width: 420px; box-sizing: border-box;">
      <div style="text-align: center; margin-bottom: 16px;">
        <span style="font-size: 36px;">${icon}</span>
      </div>
      <h2 style="margin: 0 0 12px 0; color: var(--joplin-color); text-align: center;">
        ${escapeHtml(title)}
      </h2>
      <p style="line-height: 1.6; color: var(--joplin-color); text-align: center; max-width: 420px; word-wrap: break-word;">
        ${escapeHtml(message)}
      </p>
      ${detailsHtml}
    </div>
  `;

  await j.views.dialogs.setHtml(dialog, dialogHtml);
  await j.views.dialogs.setButtons(dialog, [
    { id: 'ok', title: buttonLabel },
  ]);

  await j.views.dialogs.open(dialog);
}

/**
 * Show a success dialog
 */
export async function showSuccessDialog(j: any, title: string, message: string): Promise<void> {
  await showInfoDialog(j, { title, message, icon: '🗹' });
}

/**
 * Show an error dialog
 */
export async function showErrorDialog(j: any, title: string, message: string): Promise<void> {
  await showInfoDialog(j, { title, message, icon: '❌' });
}

/**
 * Show a warning dialog
 */
export async function showWarningDialog(j: any, title: string, message: string): Promise<void> {
  await showInfoDialog(j, { title, message, icon: '⚠️' });
}

/**
 * Show a confirmation dialog with OK/Cancel buttons
 * Returns true if user confirmed, false otherwise
 */
export async function showConfirmDialog(j: any, options: ConfirmDialogOptions): Promise<boolean> {
  const {
    title,
    message,
    details,
    icon = '❓',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
  } = options;

  const dialogId = 'gdocs-confirm-' + Date.now();
  const dialog = await j.views.dialogs.create(dialogId);

  const detailsHtml = details 
    ? `<p style="line-height: 1.6; color: var(--joplin-color); font-size: 13px;">${escapeHtml(details)}</p>`
    : '';

  const dialogHtml = `
    <style>#joplin-plugin-content { width: max-content; }</style>
    <div style="padding: 20px; min-width: 420px; box-sizing: border-box;">
      <div style="text-align: center; margin-bottom: 16px;">
        <span style="font-size: 36px;">${icon}</span>
      </div>
      <h2 style="margin: 0 0 12px 0; color: var(--joplin-color); text-align: center;">
        ${escapeHtml(title)}
      </h2>
      <p style="line-height: 1.6; color: var(--joplin-color); text-align: center;">
        ${escapeHtml(message)}
      </p>
      ${detailsHtml}
    </div>
  `;

  await j.views.dialogs.setHtml(dialog, dialogHtml);
  await j.views.dialogs.setButtons(dialog, [
    { id: 'cancel', title: cancelLabel },
    { id: 'ok', title: confirmLabel },
  ]);

  const result = await j.views.dialogs.open(dialog);
  return result?.id === 'ok';
}

/**
 * Show authorization instructions dialog
 */
export async function showAuthInstructionsDialog(j: any): Promise<boolean> {
  const dialogId = 'gdocs-auth-instructions-' + Date.now();
  const dialog = await j.views.dialogs.create(dialogId);

  const dialogHtml = `
    <style>#joplin-plugin-content { width: max-content; }</style>
    <div style="padding: 20px; min-width: 420px; box-sizing: border-box;">
      <div style="text-align: center; margin-bottom: 16px;">
        <span style="font-size: 36px;">🔐</span>
      </div>
      <h2 style="margin: 0 0 16px 0; color: var(--joplin-color); text-align: center;">
        Google Authorization
      </h2>
      <p style="line-height: 1.6; color: var(--joplin-color);">
        Authorization will open in your browser.
      </p>
      <div style="background: var(--joplin-background-color3); padding: 12px; border-radius: 8px; margin: 12px 0;">
        <ol style="margin: 0; padding-left: 20px; color: var(--joplin-color);">
          <li>Sign in with your Google account</li>
          <li>Grant the requested permissions</li>
          <li>You'll be redirected back automatically</li>
        </ol>
      </div>
      <p style="font-size: 13px; color: var(--joplin-color); text-align: center;">
        Click "Continue" to open the authorization page.
      </p>
    </div>
  `;

  await j.views.dialogs.setHtml(dialog, dialogHtml);
  await j.views.dialogs.setButtons(dialog, [
    { id: 'cancel', title: 'Cancel' },
    { id: 'ok', title: 'Continue →' },
  ]);

  const result = await j.views.dialogs.open(dialog);
  return result?.id === 'ok';
}

const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br/>');
};

