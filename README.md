# LLM-Werewolf: LLMs Playing Werewolf

This project simulates multiple AI language models playing the social deduction game Werewolf. Different AI models take on roles as either Villagers or Werewolves, and interact with each other to deduce who's who. Also known as Mafia.

[Mafia](https://en.wikipedia.org/wiki/Mafia_(party_game))

## TLDR

- Players are divided into two teams: Werewolves and Villagers
- Each night, Werewolves choose a Villager to eliminate
- Each day, all players discuss and vote to eliminate a suspected Werewolf
- Werewolves win if they equal or outnumber Villagers
- Villagers win if they eliminate all Werewolves

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

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Running a Game

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

<!-- begin stats -->
# Werewolf Game Statistics

*Last updated: 2025-02-26*

## Model Performance (Sorted by Win Rate)

| Model | Games | Win % | Survival % | Villager Games (% of total) | Villager Win Rate | Werewolf Games (% of total) | Werewolf Win Rate |
|-------|-------|-------|------------|-----------------------------|-------------------|-----------------------------|-------------------|
| x-ai/grok-2-vision-1212 | 1 | 100.0% | 0.0% | 0 (0.0%) | 0.0% | 1 (100.0%) | 100.0% |
| openai/gpt-4-turbo-preview | 1 | 100.0% | 100.0% | 0 (0.0%) | 0.0% | 1 (100.0%) | 100.0% |
| x-ai/grok-2-1212 | 1 | 100.0% | 100.0% | 0 (0.0%) | 0.0% | 1 (100.0%) | 100.0% |
| openai-gpt-4o | 9 | 33.3% | 44.4% | 6 (66.7%) | 0.0% | 3 (33.3%) | 100.0% |
| openai/chatgpt-4o-latest | 1 | 0.0% | 0.0% | 1 (100.0%) | 0.0% | 0 (0.0%) | 0.0% |
| aion-labs/aion-1.0 | 1 | 0.0% | 0.0% | 1 (100.0%) | 0.0% | 0 (0.0%) | 0.0% |
| deepseek/deepseek-r1-distill-qwen-1.5b | 1 | 0.0% | 0.0% | 1 (100.0%) | 0.0% | 0 (0.0%) | 0.0% |
| anthropic/claude-2.0 | 1 | 0.0% | 0.0% | 1 (100.0%) | 0.0% | 0 (0.0%) | 0.0% |
| cohere/command-r-03-2024 | 1 | 0.0% | 100.0% | 1 (100.0%) | 0.0% | 0 (0.0%) | 0.0% |
| qwen/qwen-2-72b-instruct | 1 | 0.0% | 100.0% | 1 (100.0%) | 0.0% | 0 (0.0%) | 0.0% |
| microsoft/phi-3-mini-128k-instruct | 1 | 0.0% | 0.0% | 1 (100.0%) | 0.0% | 0 (0.0%) | 0.0% |

## Game Summary

- **Total matches analyzed**: 2
- **Total players**: 19
- **Werewolves**: 6 (31.6%)
- **Villagers**: 13 (68.4%)
- **Werewolf team wins**: 2 (100.0%)
- **Villager team wins**: 0 (0.0%)

<!-- end stats -->
