/**
 * Setup Wizard
 * 
 * A multi-step dialog that guides first-time users through plugin configuration:
 * 1. Welcome and explanation
 * 2. Authorization mode selection (shared/personal)
 * 3. Credentials entry (personal mode only)
 * 4. Google authorization
 * 5. Sync folder configuration
 * 6. Completion confirmation
 */

import { SETTING_KEYS, getSettings, SettingItemType } from '../services/settings';
import { hasValidTokens } from '../services/oauthServer';
import { authorize } from './authorize';

export interface SetupWizardParams {
  j: any;
  installDir: string;
  dataDir: string;
}

export interface SetupWizardResult {
  completed: boolean;
  cancelled: boolean;
  message: string;
}

type WizardStep = 'welcome' | 'authMode' | 'credentials' | 'authorize' | 'syncFolder' | 'complete';

/**
 * Run the setup wizard
 */
export async function runSetupWizard(params: SetupWizardParams): Promise<SetupWizardResult> {
  const { j, installDir, dataDir } = params;
  
  let currentStep: WizardStep = 'welcome';
  let authMode: 'shared' | 'personal' = 'shared';
  let clientId = '';
  let clientSecret = '';
  
  while (true) {
    switch (currentStep) {
      case 'welcome': {
        const result = await showWelcomeStep(j);
        if (result === 'next') {
          currentStep = 'authMode';
        } else {
          return { completed: false, cancelled: true, message: 'Setup cancelled.' };
        }
        break;
      }
      
      case 'authMode': {
        const result = await showAuthModeStep(j);
        if (result === 'back') {
          currentStep = 'welcome';
        } else if (result === 'cancel') {
          return { completed: false, cancelled: true, message: 'Setup cancelled.' };
        } else {
          authMode = result;
          // Save auth mode to settings
          await j.settings.setValue(SETTING_KEYS.AUTH_MODE, authMode);
          
          if (authMode === 'personal') {
            currentStep = 'credentials';
          } else {
            currentStep = 'authorize';
          }
        }
        break;
      }
      
      case 'credentials': {
        const result = await showCredentialsStep(j, clientId, clientSecret);
        if (result === 'back') {
          currentStep = 'authMode';
        } else if (result === 'cancel') {
          return { completed: false, cancelled: true, message: 'Setup cancelled.' };
        } else {
          clientId = result.clientId;
          clientSecret = result.clientSecret;
          
          // Save credentials to settings
          await j.settings.setValue(SETTING_KEYS.CLIENT_ID, clientId);
          await j.settings.setValue(SETTING_KEYS.CLIENT_SECRET, clientSecret);
          
          currentStep = 'authorize';
        }
        break;
      }
      
      case 'authorize': {
        // Check if already authorized
        if (hasValidTokens(installDir)) {
          currentStep = 'syncFolder';
          break;
        }
        
        const result = await showAuthorizeStep(j, installDir, dataDir);
        if (result === 'back') {
          currentStep = authMode === 'personal' ? 'credentials' : 'authMode';
        } else if (result === 'cancel') {
          return { completed: false, cancelled: true, message: 'Setup cancelled.' };
        } else if (result === 'success') {
          currentStep = 'syncFolder';
        } else {
          // Authorization failed, stay on this step
          await j.views.dialogs.showMessageBox('Authorization failed. Please try again.');
        }
        break;
      }
      
      case 'syncFolder': {
        const result = await showSyncFolderStep(j);
        if (result === 'back') {
          currentStep = 'authorize';
        } else if (result === 'cancel') {
          return { completed: false, cancelled: true, message: 'Setup cancelled.' };
        } else {
          if (result.folderId) {
            await j.settings.setValue(SETTING_KEYS.SYNC_FOLDER_ID, result.folderId);
          }
          currentStep = 'complete';
        }
        break;
      }
      
      case 'complete': {
        await showCompleteStep(j);
        return {
          completed: true,
          cancelled: false,
          message: 'Setup complete! You can now sync notes with Google Docs.',
        };
      }
    }
  }
}

/**
 * Step 1: Welcome
 */
async function showWelcomeStep(j: any): Promise<'next' | 'cancel'> {
  const dialogId = 'gdocs-wizard-welcome-' + Date.now();
  const dialog = await j.views.dialogs.create(dialogId);
  
  const html = `
    <div style="padding: 20px; max-width: 500px;">
      <h2 style="margin: 0 0 16px 0; color: var(--joplin-color);">
        Welcome to Google Docs Sync
      </h2>
      
      <p style="line-height: 1.6; color: var(--joplin-color);">
        This wizard will help you set up synchronization between Joplin notes and Google Docs.
      </p>
      
      <div style="background: var(--joplin-background-color3); padding: 16px; border-radius: 8px; margin: 16px 0;">
        <h3 style="margin: 0 0 8px 0; font-size: 14px; color: var(--joplin-color);">What you'll be able to do:</h3>
        <ul style="margin: 0; padding-left: 20px; color: var(--joplin-color);">
          <li>Push Joplin notes to Google Docs</li>
          <li>Pull changes from Google Docs back to Joplin</li>
          <li>Keep formatting synchronized</li>
          <li>Export entire notebooks</li>
        </ul>
      </div>
      
      <p style="font-size: 13px; color: var(--joplin-color2);">
        Click "Next" to begin setup.
      </p>
    </div>
  `;
  
  await j.views.dialogs.setHtml(dialog, html);
  await j.views.dialogs.setButtons(dialog, [
    { id: 'next', title: 'Next →' },
    { id: 'cancel', title: 'Cancel' },
  ]);
  
  const result = await j.views.dialogs.open(dialog);
  return result?.id === 'next' ? 'next' : 'cancel';
}

/**
 * Step 2: Auth Mode Selection
 */
async function showAuthModeStep(j: any): Promise<'shared' | 'personal' | 'back' | 'cancel'> {
  const dialogId = 'gdocs-wizard-authmode-' + Date.now();
  const dialog = await j.views.dialogs.create(dialogId);
  
  const html = `
    <div style="padding: 20px; max-width: 500px;">
      <h2 style="margin: 0 0 16px 0; color: var(--joplin-color);">
        Choose Authorization Mode
      </h2>
      
      <form name="f">
        <div style="margin-bottom: 16px;">
          <label style="display: flex; align-items: flex-start; padding: 12px; border: 2px solid var(--joplin-divider-color); border-radius: 8px; cursor: pointer; margin-bottom: 8px;">
            <input type="radio" name="mode" value="shared" checked style="margin: 4px 12px 0 0;" />
            <div>
              <strong style="color: var(--joplin-color);">Shared Project (Recommended)</strong>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--joplin-color2);">
                Use pre-configured credentials from your organization. Just authorize with your Google account.
              </p>
            </div>
          </label>
          
          <label style="display: flex; align-items: flex-start; padding: 12px; border: 2px solid var(--joplin-divider-color); border-radius: 8px; cursor: pointer;">
            <input type="radio" name="mode" value="personal" style="margin: 4px 12px 0 0;" />
            <div>
              <strong style="color: var(--joplin-color);">Personal Project</strong>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--joplin-color2);">
                Use your own Google Cloud project. You'll need to create OAuth credentials.
              </p>
            </div>
          </label>
        </div>
      </form>
    </div>
  `;
  
  await j.views.dialogs.setHtml(dialog, html);
  await j.views.dialogs.setButtons(dialog, [
    { id: 'next', title: 'Next →' },
    { id: 'back', title: '← Back' },
    { id: 'cancel', title: 'Cancel' },
  ]);
  
  const result = await j.views.dialogs.open(dialog);
  
  if (result?.id === 'back') return 'back';
  if (result?.id === 'cancel' || !result) return 'cancel';
  
  const fd = result.formData?.f || {};
  return fd.mode === 'personal' ? 'personal' : 'shared';
}

/**
 * Step 3: Credentials Entry (personal mode)
 */
async function showCredentialsStep(
  j: any,
  currentClientId: string,
  currentClientSecret: string
): Promise<{ clientId: string; clientSecret: string } | 'back' | 'cancel'> {
  const dialogId = 'gdocs-wizard-credentials-' + Date.now();
  const dialog = await j.views.dialogs.create(dialogId);
  
  const html = `
    <div style="padding: 20px; max-width: 500px;">
      <h2 style="margin: 0 0 16px 0; color: var(--joplin-color);">
        Enter Google Cloud Credentials
      </h2>
      
      <div style="background: var(--joplin-background-color3); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
        <p style="margin: 0; font-size: 13px; color: var(--joplin-color2);">
          Create OAuth 2.0 credentials in the 
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" style="color: var(--joplin-url-color);">Google Cloud Console</a>.
          Enable the Drive API and Docs API.
        </p>
      </div>
      
      <form name="f">
        <div style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--joplin-color);">
            Client ID
          </label>
          <input 
            type="text" 
            name="clientId" 
            value="${escapeHtml(currentClientId)}"
            placeholder="123456789-abc.apps.googleusercontent.com"
            style="width: 100%; padding: 8px; border: 1px solid var(--joplin-divider-color); border-radius: 4px; background: var(--joplin-background-color); color: var(--joplin-color);"
          />
        </div>
        
        <div style="margin-bottom: 12px;">
          <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--joplin-color);">
            Client Secret
          </label>
          <input 
            type="password" 
            name="clientSecret" 
            value="${escapeHtml(currentClientSecret)}"
            placeholder="GOCSPX-..."
            style="width: 100%; padding: 8px; border: 1px solid var(--joplin-divider-color); border-radius: 4px; background: var(--joplin-background-color); color: var(--joplin-color);"
          />
        </div>
      </form>
    </div>
  `;
  
  await j.views.dialogs.setHtml(dialog, html);
  await j.views.dialogs.setButtons(dialog, [
    { id: 'next', title: 'Next →' },
    { id: 'back', title: '← Back' },
    { id: 'cancel', title: 'Cancel' },
  ]);
  
  const result = await j.views.dialogs.open(dialog);
  
  if (result?.id === 'back') return 'back';
  if (result?.id === 'cancel' || !result) return 'cancel';
  
  const fd = result.formData?.f || {};
  const clientId = (fd.clientId || '').trim();
  const clientSecret = (fd.clientSecret || '').trim();
  
  if (!clientId || !clientSecret) {
    await j.views.dialogs.showMessageBox('Please enter both Client ID and Client Secret.');
    return showCredentialsStep(j, clientId, clientSecret);
  }
  
  return { clientId, clientSecret };
}

/**
 * Step 4: Authorization
 */
async function showAuthorizeStep(
  j: any,
  installDir: string,
  dataDir: string
): Promise<'success' | 'back' | 'cancel'> {
  const dialogId = 'gdocs-wizard-authorize-' + Date.now();
  const dialog = await j.views.dialogs.create(dialogId);
  
  const html = `
    <div style="padding: 20px; max-width: 500px;">
      <h2 style="margin: 0 0 16px 0; color: var(--joplin-color);">
        Authorize with Google
      </h2>
      
      <p style="line-height: 1.6; color: var(--joplin-color);">
        Click "Authorize" to open Google's sign-in page in your browser.
        After granting permissions, you'll be redirected back automatically.
      </p>
      
      <div style="background: var(--joplin-background-color3); padding: 12px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0; font-size: 13px; color: var(--joplin-color2);">
          <strong>Permissions requested:</strong><br/>
          • Access to Google Drive files<br/>
          • Access to Google Docs
        </p>
      </div>
    </div>
  `;
  
  await j.views.dialogs.setHtml(dialog, html);
  await j.views.dialogs.setButtons(dialog, [
    { id: 'authorize', title: '🔐 Authorize' },
    { id: 'back', title: '← Back' },
    { id: 'cancel', title: 'Cancel' },
  ]);
  
  const result = await j.views.dialogs.open(dialog);
  
  if (result?.id === 'back') return 'back';
  if (result?.id === 'cancel' || !result) return 'cancel';
  
  // Run authorization
  const authResult = await authorize({ j, installDir, dataDir });
  
  if (authResult.success && !authResult.alreadyAuthorized) {
    return 'success';
  } else if (authResult.alreadyAuthorized) {
    return 'success';
  }
  
  return 'cancel';
}

/**
 * Step 5: Sync Folder Configuration
 */
async function showSyncFolderStep(j: any): Promise<{ folderId: string } | 'back' | 'cancel'> {
  const dialogId = 'gdocs-wizard-folder-' + Date.now();
  const dialog = await j.views.dialogs.create(dialogId);
  
  const html = `
    <div style="padding: 20px; max-width: 500px;">
      <h2 style="margin: 0 0 16px 0; color: var(--joplin-color);">
        Sync Folder Configuration
      </h2>
      
      <p style="line-height: 1.6; color: var(--joplin-color);">
        The plugin will create documents in a dedicated Google Drive folder.
      </p>
      
      <form name="f">
        <div style="margin: 16px 0;">
          <label style="display: flex; align-items: flex-start; padding: 12px; border: 2px solid var(--joplin-divider-color); border-radius: 8px; cursor: pointer; margin-bottom: 8px;">
            <input type="radio" name="folderOption" value="auto" checked style="margin: 4px 12px 0 0;" />
            <div>
              <strong style="color: var(--joplin-color);">Auto-create folder (Recommended)</strong>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--joplin-color2);">
                Creates "Joplin Google Docs Sync" folder in your Drive.
              </p>
            </div>
          </label>
          
          <label style="display: flex; align-items: flex-start; padding: 12px; border: 2px solid var(--joplin-divider-color); border-radius: 8px; cursor: pointer;">
            <input type="radio" name="folderOption" value="custom" style="margin: 4px 12px 0 0;" />
            <div>
              <strong style="color: var(--joplin-color);">Use existing folder</strong>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--joplin-color2);">
                Enter the folder ID from Google Drive.
              </p>
            </div>
          </label>
        </div>
        
        <div style="margin-top: 12px;">
          <label style="display: block; margin-bottom: 4px; font-weight: 500; color: var(--joplin-color);">
            Folder ID (optional)
          </label>
          <input 
            type="text" 
            name="folderId" 
            placeholder="Leave empty for auto-create"
            style="width: 100%; padding: 8px; border: 1px solid var(--joplin-divider-color); border-radius: 4px; background: var(--joplin-background-color); color: var(--joplin-color);"
          />
        </div>
      </form>
    </div>
  `;
  
  await j.views.dialogs.setHtml(dialog, html);
  await j.views.dialogs.setButtons(dialog, [
    { id: 'next', title: 'Next →' },
    { id: 'back', title: '← Back' },
    { id: 'cancel', title: 'Cancel' },
  ]);
  
  const result = await j.views.dialogs.open(dialog);
  
  if (result?.id === 'back') return 'back';
  if (result?.id === 'cancel' || !result) return 'cancel';
  
  const fd = result.formData?.f || {};
  const folderId = fd.folderOption === 'custom' ? (fd.folderId || '').trim() : '';
  
  return { folderId };
}

/**
 * Step 6: Completion
 */
async function showCompleteStep(j: any): Promise<void> {
  const dialogId = 'gdocs-wizard-complete-' + Date.now();
  const dialog = await j.views.dialogs.create(dialogId);
  
  const html = `
    <div style="padding: 20px; max-width: 500px; text-align: center;">
      <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
      
      <h2 style="margin: 0 0 16px 0; color: var(--joplin-color);">
        Setup Complete!
      </h2>
      
      <p style="line-height: 1.6; color: var(--joplin-color);">
        The Google Docs Sync plugin is now configured and ready to use.
      </p>
      
      <div style="background: var(--joplin-background-color3); padding: 16px; border-radius: 8px; margin: 16px 0; text-align: left;">
        <h3 style="margin: 0 0 8px 0; font-size: 14px; color: var(--joplin-color);">Quick Start:</h3>
        <ul style="margin: 0; padding-left: 20px; color: var(--joplin-color); font-size: 13px;">
          <li>Select a note and run <strong>Push (update Doc)</strong></li>
          <li>Right-click a notebook to <strong>Export to Drive</strong></li>
          <li>Use <strong>Import/Bind</strong> to import existing Docs</li>
        </ul>
      </div>
      
      <p style="font-size: 13px; color: var(--joplin-color2);">
        Access all commands from Tools → Command Palette (Ctrl+Shift+P)
      </p>
    </div>
  `;
  
  await j.views.dialogs.setHtml(dialog, html);
  await j.views.dialogs.setButtons(dialog, [{ id: 'ok', title: 'Get Started' }]);
  
  await j.views.dialogs.open(dialog);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Check if setup is needed (no valid tokens)
 */
export function isSetupNeeded(installDir: string): boolean {
  return !hasValidTokens(installDir);
}

