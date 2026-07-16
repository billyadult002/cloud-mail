# UNDO_SEND_REPORT

Status: PASS.

`UndoSendQueue` delays dispatch for 5 seconds. Undo cancels the pending task and saves the message as a draft. After the delay, the queue calls the existing `AppState.send` path; no fake Delivered state is introduced.
