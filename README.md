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

Todos and issues:
- [x] Integrate openrouter
- [x] Models tend to mis-understand their role, they randomly switch to moderators or impersonate other players
- [ ] Play multiple games in separate chats to average out true character from outliers