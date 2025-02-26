#!/usr/bin/env bun
/**
 * In this file, multiple LLMs will play the game of Werewolf.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/index.mjs';
import fs from 'fs';
import z from 'zod';
import shuffle from 'lodash/shuffle';

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
  author: string;
  visible_to: string[];
  content: string;
  character?: Character;
}

interface FormattedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name: string;
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

interface ModelStats {
  total_games: number;
  total_wins: number;
  werewolf_games: number;
  werewolf_wins: number;
  villager_games: number;
  villager_wins: number;
}

interface Statistics {
  villager_winrate: number;
  werewolf_winrate: number;
  model_stats: Record<string, {
    total_winrate: number;
    werewolf_winrate: number;
    villager_winrate: number;
  }>;
}

interface Winner {
  winning_team: Character;
  winners: {
    name: string;
    model: string;
  }[];
}

interface GameData {
  chat: Message[];
  players: Record<string, Player>;
  winner: Winner | null;
}

type CompletionFunction = (chat: FormattedMessage[]) => Promise<string>;

const getChatCompletion = (
  model: string
): CompletionFunction => async (chat: FormattedMessage[]): Promise<string> => {
    const messages = chat.map(m => ({
      role: m.role,
      content: m.content,
      name: m.name
    })) as ChatCompletionMessageParam[];

    try {
      const completion = await openRouterClient.chat.completions.create({ model, messages });
      return completion.choices[0]?.message.content || '';
    } catch (error) {
      console.error(`Error with OpenRouter completion for ${model}:`, error);
      return '';
    }
  };

const availableLlms: Record<string, CompletionFunction> = LLMS.reduce((acc, model) => {
  acc[model] = getChatCompletion(model);
  return acc;
}, {} as Record<string, CompletionFunction>);

function printMessage(message: Message, players: Record<string, Player>): void {
  const content = message.content.replace(/\s+/g, ' ').replace(/\n/g, ' ');
  const author = message.author;

  if (author === Character.MODERATOR) {
    console.log(`Moderator: ${content}`);
  } else {
    console.log(`${author} (${message.character}) (${players[author].model}): ${content}`);
  }
  console.log();
}

function calculateStatistics(numMatches: number): Statistics {
  let totalMatches = 0;
  let villagerWins = 0;
  let werewolfWins = 0;
  const modelStats: Record<string, ModelStats> = {};

  for (let i = 0; i < numMatches; i++) {
    try {
      const data = fs.readFileSync(`werewolf_match_${i}.json`, 'utf8');
      const gameData: GameData = JSON.parse(data);

      if (!gameData.winner) continue;

      totalMatches++;
      const winnerTeam = gameData.winner.winning_team;
      if (winnerTeam === Character.VILLAGER) {
        villagerWins++;
      } else {
        werewolfWins++;
      }

      // Track model stats
      for (const [name, player] of Object.entries(gameData.players)) {
        const model = player.model;
        const isWerewolf = player.character === Character.WEREWOLF;
        const won = (isWerewolf && winnerTeam === Character.WEREWOLF) || (!isWerewolf && winnerTeam === Character.VILLAGER);

        if (!modelStats[model]) {
          modelStats[model] = {
            total_games: 0,
            total_wins: 0,
            werewolf_games: 0,
            werewolf_wins: 0,
            villager_games: 0,
            villager_wins: 0
          };
        }

        modelStats[model].total_games++;
        if (won) modelStats[model].total_wins++;

        if (isWerewolf) {
          modelStats[model].werewolf_games++;
          if (won) modelStats[model].werewolf_wins++;
        } else {
          modelStats[model].villager_games++;
          if (won) modelStats[model].villager_wins++;
        }
      }
    } catch (error) {
      continue;
    }
  }

  // Calculate percentages
  const stats: Statistics = {
    villager_winrate: totalMatches > 0 ? villagerWins / totalMatches : 0,
    werewolf_winrate: totalMatches > 0 ? werewolfWins / totalMatches : 0,
    model_stats: {}
  };

  for (const [model, data] of Object.entries(modelStats)) {
    stats.model_stats[model] = {
      total_winrate: data.total_games > 0 ? data.total_wins / data.total_games : 0,
      werewolf_winrate: data.werewolf_games > 0 ? data.werewolf_wins / data.werewolf_games : 0,
      villager_winrate: data.villager_games > 0 ? data.villager_wins / data.villager_games : 0
    };
  }

  return stats;
}

class Game {
  chat: Message[];
  players: Record<string, Player>;

  /**
   * @param matchIdx - The index of the match
   * @param numWerewolves - The number of werewolves, if a number between 0 and 1, percentage of the total players, otherwise absolute number
   * @param numNightDiscussionRounds - The number of night discussion rounds
   * @param numDayDiscussionRounds - The number of day discussion rounds
   * @param availableLlms - Map of model names to completion functions
   * @param maxPlayersPerGame - Maximum number of players per game, defaults to all available LLMs
   */
  constructor(
    private matchIdx: number,
    private numWerewolves: number,
    private numNightDiscussionRounds: number,
    private numDayDiscussionRounds: number,
    private availableLlms: Record<string, CompletionFunction>,
    private maxPlayersPerGame?: number
  ) {
    this.chat = [];

    const modelKeys = Object.keys(availableLlms);
    const playerCount = this.maxPlayersPerGame ? Math.min(this.maxPlayersPerGame, modelKeys.length) : modelKeys.length;
    const usedModels = shuffle(modelKeys).slice(0, playerCount);
    const usedNames = shuffle(NAME_LIST).slice(0, playerCount);

    this.numWerewolves = this.numWerewolves < 1
      ? Math.floor(this.numWerewolves * usedNames.length)
      : this.numWerewolves as number;

    this.players = usedNames.reduce((players, name, i) => {
      players[name] = {
        model: usedModels[i],
        character: undefined,
        is_alive: true
      };
      return players;
    }, {} as Record<string, Player>);
  }

  getWinnerStats(winnerTeam: Character): Winner {
    const winners = this.getPlayersByState({ character: winnerTeam });
    return {
      winning_team: winnerTeam,
      winners: Object.entries(winners).map(([name, player]) => ({
        name,
        model: player.model,
        character: player.character || ""
      }))
    };
  }

  saveGame(winnerTeam?: Character): void {
    const gameData: GameData = {
      chat: this.chat,
      players: this.players,
      winner: winnerTeam ? this.getWinnerStats(winnerTeam) : null
    };

    const filename = `werewolf_match_${this.matchIdx}.json`;
    fs.writeFileSync(filename, JSON.stringify(gameData, null, 2));
  }

  appendMessage(authorName: string, visibleToNames: string[], content: string): void {
    const message: Message = {
      author: authorName,
      visible_to: visibleToNames,
      content,
      character: authorName === 'MODERATOR' ? Character.MODERATOR : this.players[authorName].character
    };

    this.chat.push(message);
    printMessage(message, this.players);
    this.saveGame();
  }

  async letPlayerTalk(playerName: string): Promise<string> {
    const visibleMessages = this.chat.filter(msg => msg.visible_to.includes(playerName));
    const formattedMessages: FormattedMessage[] = [];

    for (const msg of visibleMessages) {
      if (msg.author === 'MODERATOR') {
        formattedMessages.push({
          role: "system",
          content: msg.content,
          name: "Moderator"
        });
      } else if (msg.author === playerName) {
        formattedMessages.push({
          role: "assistant",
          content: msg.content,
          name: playerName
        });
      } else {
        formattedMessages.push({
          role: "user",
          content: msg.content,
          name: msg.author
        });
      }
    }

    const model = this.players[playerName].model;
    try {
      let content = await this.availableLlms[model](formattedMessages);

      // Remove player name prefixes
      for (const name of Object.keys(this.players)) {
        const pattern = new RegExp(`^${name}(-You)?:? `, 'i');
        content = content.replace(pattern, '');
      }

      return content;
    } catch (error) {
      console.error(`Error getting completion for ${playerName} with model ${model}:`, error);
      console.error(`Chat:`, JSON.stringify(formattedMessages, null, 2));
      throw error;
    }
  }

  async processVotes(voters: string[], visibleTo: string[]): Promise<string | null> {
    const aliveVoters = voters.filter(v => this.players[v].is_alive);
    const aliveCandidates = Object.keys(this.players).filter(p => this.players[p].is_alive);
    const votes: Record<string, number> = {};

    for (const candidate of aliveCandidates) {
      votes[candidate] = 0;
    }

    const majorityThreshold = Math.floor(aliveVoters.length / 2) + 1;
    const shuffledVoters = shuffle(aliveVoters);

    for (const voter of shuffledVoters) {
      this.appendMessage(
        'MODERATOR',
        [voter],
        `${voter}, please vote by naming the player you want to eliminate.`
      );

      const response = await this.letPlayerTalk(voter);
      if (!response) continue;

      this.appendMessage(voter, visibleTo, response);

      const shuffledCandidates = shuffle(Object.keys(this.players));
      for (const candidate of shuffledCandidates) {
        if (response.includes(candidate)) {
          if (!aliveCandidates.includes(candidate)) {
            this.appendMessage(
              'MODERATOR',
              visibleTo,
              `${voter}'s vote for ${candidate} was ignored as they are already dead.`
            );
            break;
          }

          votes[candidate] = (votes[candidate] || 0) + 1;
          this.appendMessage(
            'MODERATOR',
            visibleTo,
            `${voter} has voted to eliminate ${candidate}. The current tally is: ${JSON.stringify(votes, null, 2)}`
          );

          if (votes[candidate] >= majorityThreshold) {
            return candidate;
          }
          break;
        }
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

  getPlayersByState(options: PlayerFilterOptions = {}): Record<string, Player> {
    const result: Record<string, Player> = {};
    const { isAlive, character } = options;

    for (const [name, player] of Object.entries(this.players)) {
      let include = true;

      if (isAlive !== undefined && player.is_alive !== isAlive) {
        include = false;
      }

      if (character !== undefined && player.character !== character) {
        include = false;
      }

      if (include) {
        result[name] = player;
      }
    }

    return result;
  }

  getPlayerNames(options: PlayerFilterOptions = {}): string[] {
    return Object.keys(this.getPlayersByState(options));
  }

  checkGameOver(): { gameOver: boolean, winner?: Character } {
    const aliveWerewolves = Object.keys(this.getPlayersByState({ isAlive: true, character: Character.WEREWOLF })).length;
    const aliveVillagers = Object.keys(this.getPlayersByState({ isAlive: true, character: Character.VILLAGER })).length;

    if (aliveWerewolves === 0) {
      return { gameOver: true, winner: Character.VILLAGER };
    } else if (aliveWerewolves >= aliveVillagers) {
      return { gameOver: true, winner: Character.WEREWOLF };
    }

    return { gameOver: false };
  }

  async play(): Promise<void> {
    console.log(`Match ${this.matchIdx} starting with ${Object.keys(this.players).length} players (${this.numWerewolves} werewolves)`);

    // Welcome and introductions
    const allPlayers = Object.keys(this.players);
    const welcomeMsg = `Welcome to a multi-player game of Werewolf! You are one of ${allPlayers.length} players, and you will be interacting with other players in this conversation. Each player has their own distinct personality and role.

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

Remember: You are a player, not the moderator.`;

    this.appendMessage('MODERATOR', allPlayers, welcomeMsg);

    // Get introductions
    for (const player of shuffle(allPlayers)) {
      this.appendMessage(
        'MODERATOR',
        [player],
        `Your name is ${player}. Please give a short introduction of yourself.`
      );

      const response = await this.letPlayerTalk(player);
      this.appendMessage(player, allPlayers, response);
    }

    // Assign roles
    const playerEntries = Object.entries(this.players);
    shuffle(playerEntries);

    for (let i = 0; i < playerEntries.length; i++) {
      const [playerName, player] = playerEntries[i];
      player.character = i < this.numWerewolves ? Character.WEREWOLF : Character.VILLAGER;
    }

    // Rebuild players object from shuffled entries
    this.players = {};
    for (const [name, player] of playerEntries) {
      this.players[name] = player;
    }

    // Reveal roles
    for (const [playerName, player] of playerEntries) {
      let message = `${playerName}, you are a ${player.character}.`;

      if (player.character === Character.WEREWOLF) {
        const otherWerewolves = this.getPlayerNames({ character: Character.WEREWOLF }).filter(n => n !== playerName);
        message += ` Your fellow Werewolves are: ${otherWerewolves.join(', ')}. The other players are Villagers.`;
      }

      this.appendMessage(Character.MODERATOR, [playerName], message);
    }

    // Game loop
    let gameOver = false;
    let winner: Character | undefined;

    for (let loop = 0; loop < Math.floor(Object.keys(this.players).length / 2); loop++) {
      if (gameOver) break;

      // Night phase
      const werewolves = this.getPlayerNames({ isAlive: true, character: Character.WEREWOLF });
      this.appendMessage(
        Character.MODERATOR,
        allPlayers,
        "Night falls. Werewolves awaken and discuss their target. Only the Werewolves can hear each other."
      );

      for (let round = 0; round < this.numNightDiscussionRounds; round++) {
        for (const werewolf of shuffle(werewolves)) {
          const response = await this.letPlayerTalk(werewolf);
          this.appendMessage(werewolf, werewolves, response);
        }
      }

      this.appendMessage(
        Character.MODERATOR,
        werewolves,
        "Werewolves, vote to eliminate one player. Mention only their name."
      );

      const target = await this.processVotes(werewolves, werewolves);
      if (target) {
        this.players[target].is_alive = false;
        this.appendMessage(
          Character.MODERATOR,
          allPlayers,
          `${target} was found dead.`
        );

        ({ gameOver, winner } = this.checkGameOver());
        if (gameOver) break;
      }

      // Day phase
      const alivePlayers = this.getPlayerNames({ isAlive: true });
      this.appendMessage(
        Character.MODERATOR,
        allPlayers,
        "Day breaks. Discuss the night's events."
      );

      for (let round = 0; round < this.numDayDiscussionRounds; round++) {
        for (const player of shuffle(alivePlayers)) {
          const response = await this.letPlayerTalk(player);
          if (response) {
            this.appendMessage(player, alivePlayers, response);
          }
        }
      }

      this.appendMessage(
        Character.MODERATOR,
        allPlayers,
        "Time to vote. Name the player you suspect is a Werewolf."
      );

      const dayTarget = await this.processVotes(allPlayers, allPlayers);
      if (dayTarget) {
        this.players[dayTarget].is_alive = false;
        this.appendMessage(
          Character.MODERATOR,
          allPlayers,
          `${dayTarget} has been eliminated by vote.`
        );

        ({ gameOver, winner } = this.checkGameOver());
      }
    }

    const werewolfNames = this.getPlayerNames({ character: Character.WEREWOLF });
    this.appendMessage(
      Character.MODERATOR,
      allPlayers,
      `Game Over! The ${winner} win! The Werewolves were: ${werewolfNames.join(', ')}`
    );

    if (winner) {
      this.saveGame(winner);
    }
  }
}

async function play({
  matchIdx,
  numWerewolves,
  numNightDiscussionRounds,
  numDayDiscussionRounds,
  maxPlayersPerGame
}: {
  matchIdx: number;
  numWerewolves: number;
  numNightDiscussionRounds: number;
  numDayDiscussionRounds: number;
    maxPlayersPerGame?: number;
}): Promise<void> {
  const game = new Game(matchIdx, numWerewolves, numNightDiscussionRounds, numDayDiscussionRounds, availableLlms, maxPlayersPerGame);
  await game.play();
}

async function main(): Promise<void> {
  const gameStartStats = {
    numMatches: 2,
    numWerewolves: 1 / 3,
    numNightDiscussionRounds: 2,
    numDayDiscussionRounds: 2,
    maxPlayersPerGame: undefined // Set to a number to limit players, undefined uses all available LLMs
  };

  for (let i = 0; i < gameStartStats.numMatches; i++) {
    await play({ ...gameStartStats, matchIdx: i });
  }

  const stats = calculateStatistics(gameStartStats.numMatches);
  console.log("\nGame Statistics:");
  console.log(`Villager Win Rate: ${(stats.villager_winrate * 100).toFixed(2)}%`);
  console.log(`Werewolf Win Rate: ${(stats.werewolf_winrate * 100).toFixed(2)}%`);
  console.log("\nModel Statistics:");

  for (const [model, data] of Object.entries(stats.model_stats)) {
    console.log(`\n${model}:`);
    console.log(`  Total Win Rate: ${(data.total_winrate * 100).toFixed(2)}%`);
    console.log(`  As Villager: ${(data.villager_winrate * 100).toFixed(2)}%`);
    console.log(`  As Werewolf: ${(data.werewolf_winrate * 100).toFixed(2)}%`);
  }
}

// Run the program
main().catch(error => {
  console.error("Error running Werewolf game:", error);
  process.exit(1);
}); 