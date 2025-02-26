LLMs playing mafia

https://en.wikipedia.org/wiki/Mafia_(party_game)

The game models a conflict between two groups: an informed minority (the mafiosi or the werewolves) and an uninformed majority (the villagers). At the start of the game, each player is secretly assigned a role affiliated with one of these teams. The game has two alternating phases: first, a night-phase, during which those with night-killing-powers may covertly kill other players, and second, a day-phase, in which all surviving players debate and vote to eliminate a suspect. The game continues until a faction achieves its win-condition; for the village, this usually means eliminating the evil minority, while for the minority, this usually means reaching numerical parity with the village and eliminating any rival evil groups.

Metrics:
- Total winrate of a model should be high
- Winrate of a model as villager should be high
- Winrate of a model as mafia should be low (signals deception?)

Other potential metrics:
- avg number of teammates killed by other team should be low
- avg number of teammates killed by own team should be low
- avg number of turns to win should be low
- avg number of votes received should be low (Other models trust this model)
- avg number of votes given to mafia should be high (Many true positives)
- avg number of votes given to villagers should be low (Few false positives)

To run a new game of Werewolf, use:

```bash
bun werewolf.ts
```

This will:
1. Randomly assign roles to different AI models
2. Run through night and day phases
3. Save the complete game transcript to the `matches/` directory

## Analyzing Game Statistics

You can analyze the performance of different LLM models across games using:

```bash
bun eval.ts
```

This generates statistics on:
- Overall win rates per model
- Survival rates per model (alive at the end of the game)
- Win rates as Villager per model
- Win rates as Werewolf per model
- Role distribution
- Game-wide statistics

The statistics are saved to `stats/werewolf_stats.md` and can be viewed directly in GitHub.

## Current Statistics

<!-- begin stats -->
## Game Statistics

The latest Werewolf game statistics are available in the [detailed statistics report](stats/werewolf_stats.md).
<!-- end stats -->

## Project Structure

- `werewolf.ts` - Main game engine
- `llms.txt` - List of LLM models to use as players
- `names.txt` - List of player names
- `matches/` - Directory containing game transcripts
- `eval.ts` - Script to analyze game statistics
- `stats/` - Directory containing generated statistics

## Requirements

- [Bun](https://bun.sh/) runtime
- OpenRouter API key for accessing multiple LLM models
