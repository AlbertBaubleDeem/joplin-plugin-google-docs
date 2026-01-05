/**
 * Auth Error Handler
 * 
 * Detects authentication errors and prompts user to re-authorize.
 */

import { reauthorize } from '../commands/authorize';
import { showSuccessDialog, showErrorDialog } from './styledDialogs';

/**
 * Check if an error is an authentication/authorization error
 */
export function isAuthError(error: any): boolean {
  // Check for common auth error patterns
  const errorStr = (typeof error === 'string' ? error : JSON.stringify(error)).toLowerCase();
  const errorMsg = (error?.message || '').toLowerCase();
  const errorCode = error?.code || '';
  
  // Google OAuth errors
  if (errorStr.includes('invalid_grant')) return true;
  if (errorStr.includes('token has been expired')) return true;
  if (errorStr.includes('token has been revoked')) return true;
  if (errorStr.includes('invalid_token')) return true;
  if (errorStr.includes('no access')) return true;
  if (errorStr.includes('refresh token') && (errorStr.includes('no ') || errorStr.includes('missing'))) return true;
  if (errorStr.includes('refresh handler callback')) return true;
  if (errorMsg.includes('no access')) return true;
  if (errorMsg.includes('refresh token')) return true;
  
  // HTTP status codes
  if (error?.response?.status === 401) return true;
  if (error?.response?.status === 403 && errorStr.includes('token')) return true;
  if (error?.code === 401) return true;
  
  // Missing token file (ENOENT)
  if (errorCode === 'ENOENT' && errorStr.includes('token')) return true;
  if (errorMsg.includes('enoent') && errorMsg.includes('token')) return true;
  if (errorStr.includes('.token.json')) return true;
  
  // Google API specific
  if (error?.response?.data?.error === 'invalid_grant') return true;
  if (error?.response?.data?.error === 'invalid_token') return true;
  
  return false;
}

/**
 * Get a user-friendly message for auth errors
 */
export function getAuthErrorMessage(error: any): string {
  const errorStr = JSON.stringify(error).toLowerCase();
  
  if (errorStr.includes('expired')) {
    return 'Your authorization has expired.';
  }
  if (errorStr.includes('revoked')) {
    return 'Your authorization was revoked.';
  }
  if (errorStr.includes('invalid_grant')) {
    return 'Your authorization is no longer valid.';
  }
  
  return 'There was an authentication problem.';
}

/**
 * Handle auth errors with a prompt to re-authorize
 * 
 * @param j - Joplin API
 * @param error - The error that occurred
 * @param installDir - Plugin install directory
 * @param dataDir - Plugin data directory
 * @returns true if user chose to re-authorize, false otherwise
 */
export async function handleAuthError(
  j: any,
  error: any,
  installDir: string,
  dataDir: string
): Promise<boolean> {
  const message = getAuthErrorMessage(error);
  
  // Create a dialog asking user if they want to re-authorize
  const dialogId = 'gdocs-auth-error-' + Date.now();
  const dialog = await j.views.dialogs.create(dialogId);
  
  const html = `
    <style>#joplin-plugin-content { width: max-content; }</style>
    <div style="padding: 20px; min-width: 420px; box-sizing: border-box;">
      <div style="text-align: center; margin-bottom: 16px;">
        <span style="font-size: 36px;">🔑</span>
      </div>
      <h2 style="margin: 0 0 12px 0; color: var(--joplin-color); text-align: center;">
        Authorization Required
      </h2>
      <p style="line-height: 1.6; color: var(--joplin-color); text-align: center;">
        ${message}
      </p>
      <p style="line-height: 1.6; color: var(--joplin-color); text-align: center; font-size: 13px;">
        Click "Re-authorize" to sign in again with Google.
      </p>
    </div>
  `;
  
  await j.views.dialogs.setHtml(dialog, html);
  await j.views.dialogs.setButtons(dialog, [
    { id: 'reauth', title: '🔐 Re-authorize' },
    { id: 'cancel', title: 'Cancel' },
  ]);
  
  const result = await j.views.dialogs.open(dialog);
  
  if (result?.id === 'reauth') {
    // Trigger re-authorization
    try {
      const authResult = await reauthorize({ j, installDir, dataDir });
      
      if (authResult.success) {
        await showSuccessDialog(j, 'Re-authorization Successful', 'Please try your action again.');
        return true;
      } else {
        await showErrorDialog(j, 'Re-authorization Failed', authResult.message);
        return false;
      }
    } catch (e: any) {
      let msg = e.message || String(e);
      // Check for API compatibility issues (outdated Joplin)
      if (msg.includes('does not exist in "joplin.')) {
        msg += '\n\nThis may be caused by an outdated Joplin version. Please update Joplin to the latest version.';
      }
      await showErrorDialog(j, 'Re-authorization Error', msg);
      return false;
    }
  }
  
  return false;
}
