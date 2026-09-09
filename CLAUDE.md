# Working in this repository

- To refresh the app (labels, the Sky vault list, Safe signers, generated docs, pending spells), follow `docs/UPDATE.md` step by step. It is the whole update process; nothing runs on a schedule.
- Public sources only: every address label cites a Prime address registry, the Atlas, Morpho's curator registry, or an on-chain read. Never label an address from memory.
- Entity and role names only. No personal names in any file, commit message or document.
- No secrets in the repo: the Etherscan key lives in the git-ignored `.env` locally and in Railway's service variables; the scrub test enforces this.
- Every check keeps two methods (chain state and the Morpho API or Safe service) and shows disagreements instead of resolving them. Do not add a third source to a check without a reason written in `docs/CHECKS.md`.
- Keep additions minimal; the people maintaining this want to understand every piece. Prefer one command and one page of instructions over automation.
- Commands: `npm test`, `npm run typecheck`, `npm run check -- check <vault>`, `npm run update`, `npm run verify:rate-limits` (optional cross-check).
