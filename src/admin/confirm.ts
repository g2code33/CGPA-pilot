// Destructive operations in the admin console always require an explicit
// confirmation before applying. Uses the app's own in-app dialog (never the
// native browser confirm), so the prompt looks like CGPA PILOT, not a browser
// tab alert.
import { appConfirm } from '../components/appDialog';

export async function confirmThen(message: string, action: () => void): Promise<void> {
  const ok = await appConfirm({ message, danger: true });
  if (ok) action();
}
