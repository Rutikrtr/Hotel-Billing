import { Platform, Share } from 'react-native';
import { toast } from './toast';

/** Share text (WhatsApp etc.). In a computer browser without a share sheet, the text is copied instead. */
export async function shareText(message: string) {
  if (Platform.OS === 'web' && !(navigator as Navigator & { share?: unknown }).share) {
    try { await navigator.clipboard.writeText(message); toast('Copied · paste it in WhatsApp or a message'); }
    catch { toast('Could not share from this browser', true); }
    return;
  }
  try { await Share.share({ message }); } catch { /* closed */ }
}
