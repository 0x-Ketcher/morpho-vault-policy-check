# Updating the app

This is the runbook for refreshing the app. It is written for whoever runs it, an agent such as Claude Code or a
person; the steps are the same. Nothing runs on a schedule. The tests-on-push check in GitHub is the only automation.

Checking one vault reads everything about that vault live: chain state, the Morpho API, the Safe signers of its role
addresses, and the exposure and TVL numbers in the picker. Four things are baked into the page at build time and
change only through this runbook:

1. The label tables: the Prime address registries, the Atlas, Morpho's curator registry, and the Safe-signer table
   used to recognise who is behind an address (`labels/*.json`).
2. The Sky vault list in the picker, with each vault's status (`config/sky-vaults.json`).
3. The human-readable tables generated from those files (`docs/POLICY.md`, `ADDRESS_BOOK.md`, `SAFES.md`, `VAULTS.md`).
4. The pending-spell entries (`config/vault-overrides.json`), which come from the forum, step 1 below.

## When to run it

- A spell onboards or offboards a Sky Morpho vault.
- The page shows the banner "Address ownership data may be out of date": a registry or Atlas commit landed since the
  last update.
- Before sending anyone a report.
- Once a month regardless, so the tables never drift far.

## Step 1: the forum, for pending spells

Spell proposals are posted on the Sky forum with titles like "[September 10, 2026] Proposed Changes to Spark for
Upcoming Spell", one per Prime, in the Prime's category. The forum is a Discourse site and serves JSON:

- Search: `https://forum.skyeco.com/search.json?q=%22Upcoming%20Spell%22%20order%3Alatest` returns the latest
  matching topics with id, title and date.
- A topic: `https://forum.skyeco.com/t/<id>.json`; `post_stream.posts[0].cooked` is the proposal as HTML, later
  posts are the discussion (a risk reply saying the configuration is compliant is worth quoting in the entry).
- Categories: `https://forum.skyeco.com/categories.json` (Spark Prime 84, Grove Prime 103, Keel Prime 104,
  Skybase Prime 107, Osero Prime 109 at the time of writing).

Read every spell proposal newer than the last update (the `date` fields in `config/vault-overrides.json` and the
git log tell you when that was). In each, look for a Morpho vault that a Prime will start or stop allocating to:
a vault address next to words like "Morpho", "vault", "onboard", "rate limit", "deposit limit", "offboard",
"set to zero". Then:

- Onboarding, spell not yet executed: add a `pending` entry with `chainId`, `address`, `prime`, a one-sentence
  `reason` in the proposal's own terms (limit and refill rate), the topic URL as `source`, and today's `date`. The
  vault then shows as "pending spell" in the picker until the chain shows its rate limit.
- Offboarding: nothing to type. The update sees the zeroed limit on-chain and drops the vault unless a Prime still
  holds a position.
- An entry the update reports as stale (step 2) means that spell has executed: delete the entry.

A forgotten or wrong entry changes nothing on-chain; the vault shows its real status.

## Step 2: run the update

```bash
npm run update
```

It runs the four refreshes in order (labels, vault list, Safe signers, docs) and ends with a summary saying, for
each, whether anything changed. About three minutes. It needs the git-ignored `.env` with `ETHERSCAN_API_KEY` for
the fallback chain provider and picks up a GitHub token from the `gh` CLI if one is logged in (without it the
anonymous GitHub limit is 60 calls an hour, usually enough).

Read the summary:

- `labels: CHANGED`: an address gained, lost or changed a label. `git diff labels/` must match the source commit it
  cites; every label in this repo comes from a public source, never from memory.
- `vault list: CHANGED`: a vault entered or left the picker or changed status; `git diff config/sky-vaults.json`
  and `docs/VAULTS.md` show which. Make sure every change is explained by a spell, a position, or a Skybase vault.
- "a pending spell has executed": delete that entry in `config/vault-overrides.json` and run the update again.
- A failed step stops the run; nothing after it ran and nothing should be committed. Run it again later. A failed
  on-chain read is never written as "no rate limit".

## Step 3: test, commit, push, deploy

```bash
npm test
git add -A
git commit -m "update: <what changed, or 'nothing changed, pins moved'>"
git push
```

Then deploy: pushing alone does not change the live page. With the Railway connector or CLI available, trigger a
deployment of the latest commit of the connected branch; otherwise ask a person to open the Railway project, press
Cmd+K and choose "Deploy Latest Commit". Check that the deployment finishes green and that the page loads.

Repository rules that apply to every commit: entity and role names only, no personal names anywhere; no key or
token in any file (the Etherscan key lives only in the git-ignored `.env` and in Railway's service variables);
every address label cites its public source.

## Optional: the on-chain cross-check

```bash
npm run verify:rate-limits
```

The update asks the chain about every vault the Morpho API knows. The cross-check works the other way round: it
collects every rate limit each Prime contract ever set, from the contracts' own event logs, and checks that every
live deposit limit for a Morpho vault points at a vault on the list. That covers the one thing the update cannot
see: a vault the Morpho API does not index. About four minutes; needs `ETHERSCAN_API_KEY`. Exit 0 is clean, exit 1
means the list is missing a vault, exit 10 means an explorer would not serve one contract's logs and the result line
names it. Run it when a spell changed the list or before a report that leans on the list being complete.
