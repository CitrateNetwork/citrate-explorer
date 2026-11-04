---
created: 2026-11-04T02:30:00Z
branch: feat/indexer-lag-guard
author: Claude Opus 5.5 (EXPLORER lane) for Larry Klosowski
sprint: EXP-S0 (planset r1007-v060)
status: active
---

# Indexer lag guard

On the indexer host, a systemd timer runs `lag-guard.mjs` once a minute. Each run reads the local
node's head block (`eth_getBlockByNumber("latest")`) and compares its timestamp with the clock.

- **Stale check:** the head is more than **60 s** old, or the RPC does not answer.
- **Fresh check:** resets the streak to 0.
- **After 5 consecutive stale checks:** if `citratescan-indexer.service` is active, the guard runs
  `systemctl stop citratescan-indexer.service` and logs why, for example
  `[lag-guard] stopping citratescan-indexer.service: head 406701 is 312 s old (> 60 s); 5 consecutive stale check(s), limit 5. The node is not touched.`

**It never starts or restarts anything, and it never touches the node.**
- The only systemctl calls it makes are `is-active` and `stop`, both on the indexer unit.
- `LAG_GUARD_UNIT` must match `citratescan-indexer*.service`; anything else is refused at start.
- Starting the indexer again is a human decision (see "After a stop").

Why: an indexer that keeps polling a node that is behind adds load to that node and slows its
catch-up. It also indexes a stale view. EXP-S0 asks for the indexer to run behind this guard.

## Files

| File | Install to |
|---|---|
| `lag-guard.mjs` | `/opt/citratescan/lag-guard/lag-guard.mjs` |
| `citratescan-indexer-lag-guard.service` | `/etc/systemd/system/` |
| `citratescan-indexer-lag-guard.timer` | `/etc/systemd/system/` |

`lag-guard.mjs` needs only Node 18 or later (global `fetch`) and has no dependencies.

## Configuration

These are environment variables in the service unit. Override them with
`systemctl edit citratescan-indexer-lag-guard.service`.

| Var | Default | Meaning |
|---|---|---|
| `LAG_GUARD_RPC_URL` | `http://127.0.0.1:8545` | The local node's JSON-RPC. Point it at the node the indexer reads. |
| `LAG_GUARD_MAX_AGE_SEC` | `60` | A head older than this is stale. |
| `LAG_GUARD_CONSECUTIVE` | `5` | Stale checks in a row before the stop. |
| `LAG_GUARD_UNIT` | `citratescan-indexer.service` | The indexer unit. It must match `citratescan-indexer*.service`. |
| `LAG_GUARD_STATE_FILE` | `/var/lib/citratescan-lag-guard/state.json` | The streak, kept between runs. |
| `LAG_GUARD_TIMEOUT_MS` | `10000` | RPC timeout per check. |

## Install (the lead runs this on the indexer host)

```bash
# from a checkout of this repo on the indexer host
sudo install -D -m 0755 deploy/indexer-lag-guard/lag-guard.mjs /opt/citratescan/lag-guard/lag-guard.mjs
sudo install -m 0644 deploy/indexer-lag-guard/citratescan-indexer-lag-guard.service /etc/systemd/system/
sudo install -m 0644 deploy/indexer-lag-guard/citratescan-indexer-lag-guard.timer /etc/systemd/system/
command -v node && node --version          # must be >= 18; if node is not at /usr/bin, put its
                                           # absolute path in ExecStart via `systemctl edit`
sudo systemctl edit citratescan-indexer-lag-guard.service   # set LAG_GUARD_RPC_URL if not :8545
sudo systemctl daemon-reload

# one check by hand first; it should log "head N is K s old; fresh"
sudo systemctl start citratescan-indexer-lag-guard.service
journalctl -u citratescan-indexer-lag-guard.service -n 5 --no-pager

sudo systemctl enable --now citratescan-indexer-lag-guard.timer
systemctl list-timers citratescan-indexer-lag-guard.timer
```

## Operate

- **Watch:** `journalctl -u citratescan-indexer-lag-guard.service -f` shows one line per minute.
- **Current streak:** `sudo cat /var/lib/citratescan-lag-guard/state.json`.
- **After a stop:**
  1. Let the node catch up. `journalctl` shows `fresh` again.
  2. Start the indexer yourself: `sudo systemctl start citratescan-indexer.service`.
  3. The guard never restarts it. Resume is gap-free (DEPLOY.md §4).
- **Pause the guard:** `sudo systemctl stop citratescan-indexer-lag-guard.timer`.
- **Remove:**
  `sudo systemctl disable --now citratescan-indexer-lag-guard.timer`, then delete the three
  installed files and `/var/lib/citratescan-lag-guard`, then run `sudo systemctl daemon-reload`.

## Tests

`src/lib/ops/lagGuard.test.ts` (in `pnpm test`) covers:
- the streak, the threshold boundary (exactly 60 s is fresh) and RPC errors;
- stopping only an active indexer;
- the unit allowlist;
- a property: the only systemctl calls are `is-active` and `stop` on the indexer unit.
