# GTA VI trophy earn-rate forecaster

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/cuoi00/gta6-forecast/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/cuoi00/gta6-forecast/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

Forecasts how many GTA VI players on PlayStation 5 will have earned each trophy one week after launch, from the history of Exophase's trophy-page reads. Entered on make.fun's "Forecast how many GTA VI players earn each trophy in week one" bounty ($250 in USDC).

## How it works

The page's earn rates get diluted as Exophase tracks more players while trophy earners stay fixed. The forecaster models that physics on the logit scale: it fits a damped exponential to the growth of tracked players, shifts each trophy's rate down by the dilution (with a partial repayment for common trophies), and reads five quantiles off a normal with an honest, wide spread. Pure Node builtins, no dependencies, runs in under a second per case.

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=jxr958z7&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
