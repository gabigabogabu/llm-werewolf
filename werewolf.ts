#!/usr/bin/env bun
/**
 * In this file, multiple LLMs will play the game of Werewolf.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/index.mjs';
import fs from 'fs';
import z from 'zod';
import shuffle from 'lodash/shuffle';
import yaml from 'yaml';
import path from 'path';

const env = z.object({
  OPEN_ROUTER_API_KEY: z.string(),
}).parse(process.env);

const LLMS = fs.readFileSync('llms.txt', 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 0);
const NAME_LIST = fs.readFileSync('names.txt', 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 0);

const openRouterClient = new OpenAI({
  apiKey: env.OPEN_ROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

// Types
enum Character {
  WEREWOLF = "WEREWOLF",
  VILLAGER = "VILLAGER",
  MODERATOR = "MODERATOR"
}

interface Message {
  from: string;
  to: string[];
  content: string;
  phase: 'night' | 'day' | 'intro';
  character?: Character;
}

interface Player {
  model: string;
  character?: Character;
  is_alive: boolean;
}

interface PlayerFilterOptions {
  isAlive?: boolean;
  character?: Character;
}

interface GameData {
  chat: Message[];
  players: Record<string, Player>;
  winner?: Character;
}

const getCompletion = async (chat: ChatCompletionMessageParam[], model: string): Promise<string> => {
  try {
    const completion = await openRouterClient.chat.completions.create({ model, messages: chat });
    return completion?.choices[0]?.message.content || '';
  } catch (error) {
    console.error(`Error with ${model}:`, error);
    return '<inaudible>';
  }
};

function printMessage(message: Message, players: Record<string, Player>): void {
  const content = message.content.replace(/\s+/g, ' ').replace(/\n/g, ' ');
  const author = message.from;

  if (author === Character.MODERATOR) {
    console.log(`\nModerator (to ${message.to.join(', ')}): ${content}`);
  } else {
    console.log(`\n${author} (${message.character}) (${players[author].model}): ${content}`);
  }
}

class Game {
  private chat: Message[];
  private players: Record<string, Player>;
  private winnerTeam: Character | undefined;
  private numWerewolves: number;
  /**
   * @param matchIdx - The index of the match
   * @param numWerewolves - The number of werewolves, if a number between 0 and 1, percentage of the total players, otherwise absolute number
   * @param numNightDiscussionRounds - The number of night discussion rounds
   * @param numDayDiscussionRounds - The number of day discussion rounds
   * @param llms - Map of model names to completion functions
   * @param maxPlayersPerGame - Maximum number of players per game, defaults to all available LLMs
   */
  constructor(
    private matchIdx: number,
    numWerewolves: number,
    private numNightDiscussionRounds: number,
    private numDayDiscussionRounds: number,
    private llms: string[],
    private maxPlayersPerGame: number,
  ) {
    this.chat = [];

    const playerCount = Math.min(this.maxPlayersPerGame, this.llms.length);
    const usedModels = shuffle(this.llms).slice(0, playerCount);
    const usedNames = shuffle(NAME_LIST).slice(0, playerCount);

    this.numWerewolves = numWerewolves < 1
      ? Math.floor(numWerewolves * usedNames.length)
      : numWerewolves as number;

    this.players = usedNames.reduce((players, name, i) => {
      players[name] = {
        model: usedModels[i],
        character: undefined,
        is_alive: true
      };
      return players;
    }, {} as Record<string, Player>);
  }

  private saveGame(): void {
    const gameData: GameData = {
      chat: this.chat,
      players: this.players,
      winner: this.winnerTeam,
    };

    const dir = './matches';
    const filename = `werewolf_match_${new Date().toISOString().split('T')[0]}_${this.matchIdx}.json`;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(gameData, null, 2));
  }

  private appendMessage({ from, to, phase, content }: Message): void {
    const message: Message = { from, to, phase, content, character: from === 'MODERATOR' ? Character.MODERATOR : this.players[from].character };
    this.chat.push(message);
    printMessage(message, this.players);
    this.saveGame();
  }

  private async getPlayerReply(playerName: string): Promise<string> {
    const chat = this.chat
      .filter(msg => msg.to.includes(playerName))
      .map(msg => {
        if (msg.from === 'MODERATOR')
          return {
            role: "system",
            content: msg.content,
            name: "Moderator"
          };
        if (msg.from === playerName)
          return {
            role: "assistant",
            content: msg.content,
            name: playerName
          };
        return {
          role: "user",
          content: msg.content,
          name: msg.from
        };
      }) as ChatCompletionMessageParam[];

    const model = this.players[playerName].model;
    try {
      let content = await getCompletion(chat, model);

      // Remove player name prefixes
      for (const name of Object.keys(this.players)) {
        const pattern = new RegExp(`^${name}(-You)?:? `, 'i');
        content = content.replace(pattern, '');
      }

      return content;
    } catch (error) {
      console.error(`Error getting completion for ${playerName} with model ${model}:`, error);
      console.error(`Chat:`, JSON.stringify(chat, null, 2));
      throw error;
    }
  }

  private async vote(phase: 'night' | 'day'): Promise<string | null> {
    // at night, only werewolves can vote, otherwise all players can vote
    const aliveVoters = this.getPlayerNames({ isAlive: true, character: phase === 'night' ? Character.WEREWOLF : undefined });
    const aliveCandidates = this.getPlayerNames({ isAlive: true });
    const votes = aliveCandidates.reduce((acc, candidate) => {
      acc[candidate] = 0;
      return acc;
    }, {} as Record<string, number>);

    const majorityThreshold = Math.floor(aliveVoters.length / 2) + 1;
    const shuffledVoters = shuffle(aliveVoters);

    this.appendMessage({
      from: 'MODERATOR',
      to: aliveVoters,
      phase: 'night',
      content: `${phase === 'night' ? 'Werewolves' : 'Everyone'}, it is time to vote. 
Please vote by naming the player you want to eliminate. 
Mention only the name of the player you want to eliminate. 
The first name you mention will be counted as your vote.`
    });

    for (const voter of shuffledVoters) {
      this.appendMessage({
        from: 'MODERATOR',
        to: [voter],
        phase: 'night',
        content: `${voter}, your turn`
      });

      const response = await this.getPlayerReply(voter);
      if (!response) continue;

      this.appendMessage({
        from: voter,
        to: aliveVoters,
        phase: 'night',
        content: response
      });

      let vote = undefined;
      for (const word of response.split(/\W+/)) {
        if (!word) continue;
        if (!aliveCandidates.includes(word)) continue;
        vote = word;
        break;
      }
      if (!vote) {
        this.appendMessage({
          from: 'MODERATOR',
          to: aliveVoters,
          phase: 'night',
          content: `${voter} abstained.`
        });
        continue;
      }
      votes[vote] = (votes[vote] || 0) + 1;
      this.appendMessage({
        from: 'MODERATOR',
        to: aliveVoters,
        phase: 'night',
        content: `${voter} has voted to eliminate ${vote}. The current tally is: ${yaml.stringify(votes)}`
      });
      if (votes[vote] >= majorityThreshold) {
        return vote;
      }
    }

    // Find candidate with most votes
    let maxVotes = 0;
    let maxCandidate: string | null = null;

    for (const [candidate, voteCount] of Object.entries(votes)) {
      if (voteCount > maxVotes) {
        maxVotes = voteCount;
        maxCandidate = candidate;
      }
    }

    return maxCandidate;
  }

  private getPlayerNames(options: PlayerFilterOptions = {}): string[] {
    return Object.entries(this.players)
      .filter(([name, player]) => {
        if (options.isAlive !== undefined && player.is_alive !== options.isAlive) return false;
        if (options.character !== undefined && player.character !== options.character) return false;
        return true;
      })
      .map(([name]) => name);
  }

  private gameHasWinner(): Character | undefined {
    const numAliveWerewolves = Object.keys(this.getPlayerNames({ isAlive: true, character: Character.WEREWOLF })).length;
    const numAliveVillagers = Object.keys(this.getPlayerNames({ isAlive: true, character: Character.VILLAGER })).length;

    if (numAliveWerewolves === 0) {
      return Character.VILLAGER;
    } else if (numAliveWerewolves >= numAliveVillagers) {
      return Character.WEREWOLF;
    }
  }

  private async getIntros() {
    const allPlayers = this.getPlayerNames();
    this.appendMessage({
      from: 'MODERATOR',
      to: allPlayers,
      phase: 'intro',
      content: `Welcome to a multi-player game of Werewolf! You are one of ${allPlayers.length} players, and you will be interacting with other players in this conversation. Each player has their own distinct personality and role.

GAME RULES:
- There are two teams: ${this.numWerewolves} Werewolves and ${allPlayers.length - this.numWerewolves} Villagers
- Werewolf's goal: Eliminate all Villagers
- Villagers' goal: Find and eliminate all Werewolves

GAME PHASES:
1. Night Phase:
   - Only Werewolves are awake and can communicate
   - Werewolves vote to eliminate one player
   - Villagers cannot see this discussion

2. Day Phase:
   - All surviving players discuss openly
   - Everyone votes to eliminate one suspect
   - All votes are public

Phases alternate and loop until one team wins.

IMPORTANT RULES:
- You are a player, not the moderator
- Do not share your role with others, other werewolves will already know who you are
- Do not respond with any formatting, only plain text
- You can only see messages from living players
- When voting, mention ONLY the name of your chosen player
- Respond in character and interact with others naturally
- Do not switch to any other characters or personas, stay with the one you are assigned with the introduction
- Pay attention to who is alive and dead

You will soon receive your specific role and team assignment. First, let's have an introduction round - please share a brief introduction about yourself when asked.

Remember: You are a player, not the moderator.`
    });
    for (const player of shuffle(allPlayers)) {
      this.appendMessage({
        from: 'MODERATOR',
        to: [player],
        phase: 'intro',
        content: `Your name is ${player}. Please give a short introduction of yourself.`
      });

      const response = await this.getPlayerReply(player);
      this.appendMessage({
        from: player,
        to: allPlayers,
        phase: 'intro',
        content: response
      });
    }
  }

  private assignCharacters() {
    const playerEntries = Object.entries(this.players);
    shuffle(playerEntries);

    playerEntries.forEach(([playerName, player], i) => {
      player.character = i < this.numWerewolves ? Character.WEREWOLF : Character.VILLAGER;
    });

    // Rebuild players object from shuffled entries
    this.players = {};
    for (const [name, player] of playerEntries) {
      this.players[name] = player;
    }
    playerEntries.forEach(([playerName, player]) => {
      let message = `${playerName}, you are a ${player.character}.`;
      if (player.character === Character.WEREWOLF) {
        const otherWerewolves = this.getPlayerNames({ character: Character.WEREWOLF }).filter(n => n !== playerName);
        message += ` Your fellow Werewolves are: ${otherWerewolves.join(', ')}. The other players are Villagers.`;
      }

      this.appendMessage({
        from: 'MODERATOR',
        to: [playerName],
        phase: 'intro',
        content: message
      });
    });
  }

  private async nightPhase() {
    const allPlayers = this.getPlayerNames();
    const werewolves = this.getPlayerNames({ isAlive: true, character: Character.WEREWOLF });
    this.appendMessage({
      from: 'MODERATOR',
      to: allPlayers,
      phase: 'night',
      content: "Night falls. Werewolves awaken. Only the Werewolves can hear each other. I, the moderator, will ask you to vote in a moment. Please discuss and coordinate your actions."
    });

    for (let round = 0; round < this.numNightDiscussionRounds; round++) {
      for (const werewolf of shuffle(werewolves)) {
        const response = await this.getPlayerReply(werewolf);
        this.appendMessage({
          from: werewolf,
          to: werewolves,
          phase: 'night',
          content: response
        });
      }
    }

    const target = await this.vote('night');
    if (target) {
      this.players[target].is_alive = false;
      this.appendMessage({
        from: 'MODERATOR',
        to: allPlayers,
        phase: 'night',
        content: `${target} was found dead.`
      });
    }
  }

  private async dayPhase() {
    const allPlayers = this.getPlayerNames();
    const alivePlayers = this.getPlayerNames({ isAlive: true });
    this.appendMessage({
      from: 'MODERATOR',
      to: allPlayers,
      phase: 'day',
      content: "Day breaks. I, the moderator, will ask you to vote in a moment. Please discuss and coordinate your actions. Discuss the night's events."
    });

    for (let round = 0; round < this.numDayDiscussionRounds; round++) {
      for (const player of shuffle(alivePlayers)) {
        const response = await this.getPlayerReply(player);
        if (response) {
          this.appendMessage({
            from: player,
            to: alivePlayers,
            phase: 'day',
            content: response
          });
        }
      }
    }

    const dayTarget = await this.vote('day');
    if (dayTarget) {
      this.players[dayTarget].is_alive = false;
      this.appendMessage({
        from: 'MODERATOR',
        to: allPlayers,
        phase: 'day',
        content: `${dayTarget} has been eliminated by vote.`
      });
    }
  }

  async play(): Promise<void> {
    console.log(`Match ${this.matchIdx} starting with ${Object.keys(this.players).length} players (${this.numWerewolves} werewolves)`);

    await this.getIntros();
    this.assignCharacters();

    // with 2 kills per loop, the game will end in playerCount / 2 loops
    for (let loop = 0; loop < Math.floor(Object.keys(this.players).length / 2); loop++) {
      await this.nightPhase();
      this.winnerTeam = this.gameHasWinner();
      if (this.winnerTeam) break;
      await this.dayPhase();
      this.winnerTeam = this.gameHasWinner();
      if (this.winnerTeam) break;
    }

    const allPlayers = this.getPlayerNames();
    const werewolfNames = this.getPlayerNames({ character: Character.WEREWOLF });
    this.appendMessage({
      from: 'MODERATOR',
      to: allPlayers,
      phase: 'day',
      content: `Game Over! The ${this.winnerTeam} win! The Werewolves were: ${werewolfNames.join(', ')}`
    });

    if (this.winnerTeam) this.saveGame();
  }
}

async function main(): Promise<void> {
  const gameStartStats = {
    numLlms: LLMS.length,
    numMatches: 1,
    numWerewolves: 1 / 3,
    numNightDiscussionRounds: 2,
    numDayDiscussionRounds: 2,
    maxPlayersPerGame: 10
  };

  for (let i = 0; i < gameStartStats.numMatches; i++) {
    const game = new Game(
      i,
      gameStartStats.numWerewolves,
      gameStartStats.numNightDiscussionRounds,
      gameStartStats.numDayDiscussionRounds,
      LLMS,
      gameStartStats.maxPlayersPerGame
    );
    await game.play();
  }
}

main().catch(error => {
  console.error("Error running Werewolf game:", error);
  process.exit(1);
}); 