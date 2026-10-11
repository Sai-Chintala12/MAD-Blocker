// Runtime permission helper for extension pages (popup, options).
// chrome.permissions.request() only works directly inside a user click or
// change handler, so callers must await this FIRST in their handler.
import { POPUP_PERMISSION } from './popups.js';

export async function requestPopupPermission() {
  try {
    return await chrome.permissions.request({ permissions: [POPUP_PERMISSION] });
  } catch {
    return false;
  }
}
