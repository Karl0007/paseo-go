// Size label for the shell's file cards/rows (C6): same B/KB/MB bands the official
// file pane uses — kept here because both the official copies are module-private.
export function formatShellFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
