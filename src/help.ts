/** `litti help` text, shared by main.ts (no side effects) and cli.ts. Keep docs/guide/cli.md in sync. */
export function helpText(urlBase = (process.env.LITTI_URL || `http://127.0.0.1:${process.env.APPROVAL_SERVER_PORT || 3847}`).replace(/\/$/, '')): string {
  return `litti — proof that a human read what they approved

Run Litti:
  litti [start] [--port N] [--no-open]
                                      Start Litti and open the inbox in your browser (default port 3847)
  litti demo [--port N] [--no-open]   Try it with sample reviews (fresh demo data each run)
  litti --version                     Print the version
  litti help | --help | -h            Show this help
  (--port=N works too)

Commands for a running Litti:
  litti propose <file.json | ->       Ask for approval. JSON: action, description, diff, touchedPaths[]
  litti review <id> --as <name>       Get a personal, signed review link for one reviewer
  litti status <id>                   Show whether an action is approved
  litti pending                       List actions waiting for reviewers
  litti verify                        Check the receipt chain for tampering
  litti stats                         Reviewer attention scores and rubber-stamps
  litti notes [--all]                 Reviewer notes on the working-tree diff (open only by default)
  litti reply <note-id> <text…>       Answer a note as the agent
  litti resolve <note-id>             Close a thread once it's handled
  litti submit [description…]         Send the current working-tree diff for review
  litti install <claude|codex|opencode|all> [--dir <project>] [--global]
                                      Make risky agent commands need a Litti review

Settings: LITTI_URL (default ${urlBase}), LITTI_API_KEY, LITTI_ADMIN_KEY (for review)`;
}
