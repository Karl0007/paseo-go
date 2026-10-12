#!/usr/bin/env bash
# Production cutover MUST run outside this agent session's process tree: the
# daemon we stop hosts the very session that would run the script (go.16
# incident — the child script died at Stop-ScheduledTask and the production
# daemon stayed down 13h; RELEASE.md). This wrapper registers the cutover .ps1
# as a one-shot Windows scheduled task (fully detached), then tails its log.
# If THIS watch dies, the cutover still completes — re-watch with WATCH_ONLY=1.
#
# usage: cutover-via-task.sh <script.ps1> <log-path> [task-name]
#        WATCH_ONLY=1 cutover-via-task.sh <script.ps1> <log-path> [task-name]
set -euo pipefail
PS1F="${1:?usage: cutover-via-task.sh <script.ps1> <log> [task]}"
LOG="${2:?usage: cutover-via-task.sh <script.ps1> <log> [task]}"
TASK="${3:-paseo-cutover-$(date +%Y%m%d%H%M)}"
PS1W=$(cygpath -w "$PS1F" 2>/dev/null || echo "$PS1F")
if [ "${WATCH_ONLY:-0}" != "1" ]; then
  powershell -NoProfile -Command "
    \$st=(Get-Date).AddSeconds(20)
    \$a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File \"$PS1W\"'
    Register-ScheduledTask -TaskName '$TASK' -Action \$a -Trigger (New-ScheduledTaskTrigger -Once -At \$st) -Force -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable) | Out-Null
    Start-ScheduledTask -TaskName '$TASK'
    Write-Output ('FIRED ' + '$TASK' + ' at ' + \$st.ToString('HH:mm:ss'))"
fi
echo "watching $LOG for DONE OK / ABORT / ROLLBACK (task runs even if this shell dies)"
rc=1
while true; do
  if [ -f "$LOG" ] && grep -qE "DONE OK|ABORT|ROLLBACK" "$LOG"; then
    tail -3 "$LOG"
    grep -q "DONE OK" "$LOG" && rc=0 || rc=1
    break
  fi
  sleep 20
done
[ "${WATCH_ONLY:-0}" != "1" ] && powershell -NoProfile -Command \
  "Unregister-ScheduledTask -TaskName '$TASK' -Confirm:\$false -ErrorAction SilentlyContinue" >/dev/null 2>&1 || true
[ "$rc" = 0 ] && echo "CUTOVER-DONE-OK" || echo "CUTOVER-FAILED (see log; auto-rollback should have restored the previous version)"
exit "$rc"
