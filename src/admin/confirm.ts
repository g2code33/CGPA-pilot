// Destructive operations in the admin console always require an explicit
// confirmation before applying.
export function confirmThen(message: string, action: () => void): void {
  if (typeof window !== 'undefined' && window.confirm(message)) {
    action();
  }
}
