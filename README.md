# Covenant v0 Foundry Skeleton

Minimal proof for:

> Execution requires authorization.

Contains:
- `CovenantAuthorizationRegistry`
- `CovenantSpotSettlement`
- `MockERC20`
- tests for happy-path settlement, revocation, and partial fill accounting

## Run

```bash
forge install foundry-rs/forge-std
forge test -vvv
```

## Invariant

Offchain matching never creates authority. Settlement consumes valid authorization.
# covenant
# covenant
# covenant
