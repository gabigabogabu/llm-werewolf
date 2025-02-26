#!/usr/bin/env bun
/**
 * In this file, multiple LLMs will play the game of Werewolf.
 */

import { Anthropic } from '@anthropic-ai/sdk';
import { Mistral } from '@mistralai/mistralai';
import fs from 'fs';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/index.mjs';
import z from 'zod';
import shuffle from 'lodash/shuffle';

// Load environment variables
const env = z.object({
  OPENAI_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
}).parse(process.env);

enum Role {
  WEREWOLF = "WEREWOLF",
  VILLAGER = "VILLAGER",
  MODERATOR = "MODERATOR"
}

// Configuration
const NAME_LIST = ["Alice", "Bob", "Charlie", "David", "Eve", "Frank", "Grace", "Hannah", "Isaac", "Jane", "Carlos", "Maria", "Luis", "Sofia", "Diego", "Carmen", "Miguel", "Isabella", "Wei", "Ming", "Yuki", "Hiroshi", "Jin", "Mei", "Kumar", "Priya", "Raj", "Ahmed", "Fatima", "Omar", "Leila", "Hassan", "Yasmin", "Zara", "Kwame", "Amara", "Zola", "Thabo", "Aisha", "Chioma", "Kofi", "Erik", "Astrid", "Lars", "Ingrid", "Magnus", "Freya", "Ivan", "Natasha", "Boris", "Katya", "Dmitri", "Olga", "Andreas", "Helena", "Stavros", "Sophia", "Theos"];
const LLM_ORGS = ['OPENAI', 'XAI', 'ANTHROPIC', 'MISTRAL'];

// API keys
const API_KEYS: Record<string, string | undefined> = {};
for (const org of LLM_ORGS) {
  API_KEYS[org] = env[`${org}_API_KEY` as keyof typeof env];
}

// Initialize API clients
const openaiClient = API_KEYS['OPENAI'] ? new OpenAI({ apiKey: API_KEYS['OPENAI'] }) : null;
const xaiClient = API_KEYS['XAI'] ? new OpenAI({ apiKey: API_KEYS['XAI'], baseURL: "https://api.x.ai/v1" }) : null;
const anthropicClient = API_KEYS['ANTHROPIC'] ? new Anthropic({ apiKey: API_KEYS['ANTHROPIC'] }) : null;
const mistralClient = API_KEYS['MISTRAL'] ? new Mistral({ apiKey: API_KEYS['MISTRAL'] }) : null;

// Types
interface Message {
  author: string;
  author_alive: boolean;
  visible_to: string[];
  content: string;
  character: string;
}

interface FormattedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name: string;
}

interface Player {
  model: string;
  character: string | null;
  is_alive: boolean;
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
  winning_team: string;
  winners: {
    name: string;
    model: string;
    character: string;
  }[];
}

interface GameData {
  chat: Message[];
  players: Record<string, Player>;
  winner: Winner | null;
}

type CompletionFunction = (chat: FormattedMessage[]) => Promise<string>;

// LLM chat completion functions
const openaiSdkChatCompletion = (
  client: OpenAI,
  model: string,
  systemAlias: ChatCompletionMessageParam['role'] = 'system',
  nonUserHasName: boolean = true
): CompletionFunction => async (chat: FormattedMessage[]): Promise<string> => {
    const messages = chat.map(m => ({
      role: m.role === "system" ? systemAlias : m.role,
      content: m.content,
      name: m.role === "user" || nonUserHasName ? m.name : undefined
    })) as ChatCompletionMessageParam[];

    try {
      const completion = await client.chat.completions.create({
        model,
        messages
      });

      return completion.choices[0]?.message.content || '';
    } catch (error) {
      console.error(`Error with OpenAI completion for ${model}:`, error);
      return '';
    }
  };

const anthropicSdkChatCompletion = (
  client: Anthropic,
  model: string,
  maxTokens: number = 8192
): CompletionFunction => async (chat: FormattedMessage[]): Promise<string> => {
    const messages = chat.map(m => ({
      role: m.role !== "system" ? m.role : "user",
      content: m.role === "user" ? `${m.name}: ${m.content}` : m.content,
    }));

    try {
      const completion = await client.messages.create({
        model,
        messages,
        max_tokens: maxTokens,
      });

      return completion.content.filter(block => block.type === 'text')
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('') || '';
    } catch (error) {
      console.error(`Error with Anthropic completion for ${model}:`, error);
      return '';
    }
  };

const mistralSdkChatCompletion = (
  client: Mistral,
  model: string,
  systemAlias: 'system' | 'user' = 'user'
): CompletionFunction => async (chat: FormattedMessage[]): Promise<string> => {
    const messages = chat.map(m => ({
      role: m.role === "system" ? systemAlias : m.role,
      content: m.content,
      name: m.name
    }));

    try {
      const completion = await client.chat.complete({
        model,
        messages
      });

      const content = completion.choices?.[0]?.message.content;
      if (Array.isArray(content)) {
        return content.map(chunk => typeof chunk === 'string' ? chunk : '').join('') || '';
      }
      return content || '';
    } catch (error) {
      console.error(`Error with Mistral completion for ${model}:`, error);
      return '';
    }
  };

// Initialize available LLMs
const llms: Record<string, CompletionFunction | null> = {
  // OpenAI
  'openai/o1-mini-2024-09-12': openaiClient ? openaiSdkChatCompletion(openaiClient, 'o1-mini-2024-09-12', 'user') : null,
  'openai/o1-mini': openaiClient ? openaiSdkChatCompletion(openaiClient, 'o1-mini', 'user') : null,
  'openai/o1-preview-2024-09-12': openaiClient ? openaiSdkChatCompletion(openaiClient, 'o1-preview-2024-09-12', 'user') : null,
  'openai/o1-preview': openaiClient ? openaiSdkChatCompletion(openaiClient, 'o1-preview', 'user') : null,
  'openai/chatgpt-4o-latest': openaiClient ? openaiSdkChatCompletion(openaiClient, 'chatgpt-4o-latest', 'developer') : null,
  'openai/gpt-4o-2024-05-13': openaiClient ? openaiSdkChatCompletion(openaiClient, 'gpt-4o-2024-05-13', 'developer') : null,
  'openai/gpt-4o-2024-08-06': openaiClient ? openaiSdkChatCompletion(openaiClient, 'gpt-4o-2024-08-06', 'developer') : null,
  'openai/gpt-4o-2024-11-20': openaiClient ? openaiSdkChatCompletion(openaiClient, 'gpt-4o-2024-11-20', 'developer') : null,
  'openai/gpt-4o': openaiClient ? openaiSdkChatCompletion(openaiClient, 'gpt-4o', 'developer') : null,

  // XAI
  'xai/grok-2-1212': xaiClient ? openaiSdkChatCompletion(xaiClient, 'grok-2-1212', 'system', false) : null,

  // Anthropic
  'anthropic/claude-3-5-sonnet-20241022': anthropicClient ? anthropicSdkChatCompletion(anthropicClient, 'claude-3-5-sonnet-20241022') : null,
  'anthropic/claude-3-5-haiku-20241022': anthropicClient ? anthropicSdkChatCompletion(anthropicClient, 'claude-3-5-haiku-20241022') : null,
  'anthropic/claude-3-5-sonnet-20240620': anthropicClient ? anthropicSdkChatCompletion(anthropicClient, 'claude-3-5-sonnet-20240620') : null,

  // Mistral
  'mistral/mistral-large-2411': mistralClient ? mistralSdkChatCompletion(mistralClient, 'mistral-large-2411') : null,
  'mistral/ministral-3b-2410': mistralClient ? mistralSdkChatCompletion(mistralClient, 'ministral-3b-2410') : null,
  'mistral/ministral-8b-2410': mistralClient ? mistralSdkChatCompletion(mistralClient, 'ministral-8b-2410') : null,
  'mistral/open-mistral-nemo-2407': mistralClient ? mistralSdkChatCompletion(mistralClient, 'open-mistral-nemo-2407') : null,
};

// Filter out null values
const availableLlms: Record<string, CompletionFunction> = {};
for (const [key, value] of Object.entries(llms)) {
  if (value) availableLlms[key] = value;
}

function printLastMessage(chat: Message[], players: Record<string, Player>): void {
  const message = chat[chat.length - 1];
  const content = message.content.replace(/\s+/g, ' ').replace(/\n/g, ' ');
  const author = message.author;

  if (author === Role.MODERATOR) {
    console.log(`Moderator: ${content}`);
  } else {
    console.log(`${author} (${message.character}${message.author_alive ? '' : ' - dead'}) (${players[author].model}): ${content}`);
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
      if (winnerTeam === "VILLAGERS") {
        villagerWins++;
      } else {
        werewolfWins++;
      }

      // Track model stats
      for (const [name, player] of Object.entries(gameData.players)) {
        const model = player.model;
        const isWerewolf = player.character === "WEREWOLF";
        const won = (isWerewolf && winnerTeam === "WEREWOLVES") || (!isWerewolf && winnerTeam === "VILLAGERS");

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
  matchIdx: number;
  chat: Message[];
  players: Record<string, Player>;
  numWerewolves: number;
  numRounds: { night: number; day: number };

  constructor(
    matchIdx: number,
    playersPerModel: number = 1,
    numWerewolves: number = 1 / 3,
    numNightDiscussionRounds: number = 2,
    numDayDiscussionRounds: number = 2
  ) {
    this.matchIdx = matchIdx;
    this.chat = [];

    const modelKeys = Object.keys(availableLlms);
    const usedNames = shuffle(NAME_LIST).slice(0, modelKeys.length * playersPerModel);
    const models = Array(playersPerModel).fill(modelKeys).flat();

    this.numWerewolves = numWerewolves < 1
      ? Math.floor(numWerewolves * usedNames.length)
      : numWerewolves as number;

    this.numRounds = {
      night: numNightDiscussionRounds,
      day: numDayDiscussionRounds
    };

    this.players = {};
    for (let i = 0; i < usedNames.length; i++) {
      this.players[usedNames[i]] = {
        model: models[i],
        character: null,
        is_alive: true
      };
    }
  }

  getWinnerStats(winnerTeam: string): Winner {
    const winners = this.getPlayersByState({ isWerewolf: winnerTeam === "WEREWOLVES" });
    return {
      winning_team: winnerTeam,
      winners: Object.entries(winners).map(([name, player]) => ({
        name,
        model: player.model,
        character: player.character || ""
      }))
    };
  }

  saveGame(winnerTeam?: string): void {
    const gameData: GameData = {
      chat: this.chat,
      players: this.players,
      winner: winnerTeam ? this.getWinnerStats(winnerTeam) : null
    };

    const filename = `werewolf_match_${this.matchIdx}.json`;
    fs.writeFileSync(filename, JSON.stringify(gameData, null, 2));
  }

  appendMessage(author: string, visibleTo: string[], content: string, authorAlive: boolean = true): void {
    const message: Message = {
      author,
      author_alive: authorAlive,
      visible_to: visibleTo,
      content,
      character: author === Role.MODERATOR ? Role.MODERATOR : this.players[author].character || ""
    };

    this.chat.push(message);
    printLastMessage(this.chat, this.players);
    this.saveGame();
  }

  async letPlayerTalk(playerName: string): Promise<string> {
    const visibleMessages = this.chat.filter(msg => msg.visible_to.includes(playerName));
    const formattedMessages: FormattedMessage[] = [];

    for (const msg of visibleMessages) {
      if (msg.author === Role.MODERATOR) {
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
      let content = await availableLlms[model](formattedMessages);

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
        Role.MODERATOR,
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
              Role.MODERATOR,
              visibleTo,
              `${voter}'s vote for ${candidate} was ignored as they are already dead.`
            );
            break;
          }

          votes[candidate] = (votes[candidate] || 0) + 1;
          this.appendMessage(
            Role.MODERATOR,
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

  getPlayersByState({ isAlive, isWerewolf }: { isAlive?: boolean; isWerewolf?: boolean } = {}): Record<string, Player> {
    const result: Record<string, Player> = {};

    for (const [name, player] of Object.entries(this.players)) {
      let include = true;

      if (isAlive !== undefined && player.is_alive !== isAlive) {
        include = false;
      }

      if (isWerewolf !== undefined && (player.character === Role.WEREWOLF) !== isWerewolf) {
        include = false;
      }

      if (include) {
        result[name] = player;
      }
    }

    return result;
  }

  getPlayerNames(options: { isAlive?: boolean; isWerewolf?: boolean } = {}): string[] {
    return Object.keys(this.getPlayersByState(options));
  }

  checkGameOver(): [boolean, string | null] {
    const aliveWerewolves = Object.keys(this.getPlayersByState({ isAlive: true, isWerewolf: true })).length;
    const aliveVillagers = Object.keys(this.getPlayersByState({ isAlive: true, isWerewolf: false })).length;

    if (aliveWerewolves === 0) {
      return [true, "VILLAGERS"];
    } else if (aliveWerewolves >= aliveVillagers) {
      return [true, "WEREWOLVES"];
    }

    return [false, null];
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

    this.appendMessage(Role.MODERATOR, allPlayers, welcomeMsg);

    // Get introductions
    for (const player of shuffle(allPlayers)) {
      this.appendMessage(
        Role.MODERATOR,
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
      player.character = i < this.numWerewolves ? Role.WEREWOLF : Role.VILLAGER;
    }

    // Rebuild players object from shuffled entries
    this.players = {};
    for (const [name, player] of playerEntries) {
      this.players[name] = player;
    }

    // Reveal roles
    for (const [playerName, player] of playerEntries) {
      let message = `${playerName}, you are a ${player.character}.`;

      if (player.character === Role.WEREWOLF) {
        const otherWerewolves = this.getPlayerNames({ isWerewolf: true }).filter(n => n !== playerName);
        message += ` Your fellow Werewolves are: ${otherWerewolves.join(', ')}. The other players are Villagers.`;
      }

      this.appendMessage(Role.MODERATOR, [playerName], message);
    }

    // Game loop
    let gameOver = false;
    let winner: string | null = null;

    for (let loop = 0; loop < Math.floor(Object.keys(this.players).length / 2); loop++) {
      if (gameOver) break;

      // Night phase
      const werewolves = this.getPlayerNames({ isAlive: true, isWerewolf: true });
      this.appendMessage(
        Role.MODERATOR,
        allPlayers,
        "Night falls. Werewolves awaken and discuss their target. Only the Werewolves can hear each other."
      );

      for (let round = 0; round < this.numRounds.night; round++) {
        for (const werewolf of shuffle(werewolves)) {
          const response = await this.letPlayerTalk(werewolf);
          this.appendMessage(werewolf, werewolves, response);
        }
      }

      this.appendMessage(
        Role.MODERATOR,
        werewolves,
        "Werewolves, vote to eliminate one player. Mention only their name."
      );

      const target = await this.processVotes(werewolves, werewolves);
      if (target) {
        this.players[target].is_alive = false;
        this.appendMessage(
          Role.MODERATOR,
          allPlayers,
          `${target} was found dead.`
        );

        [gameOver, winner] = this.checkGameOver();
        if (gameOver) break;
      }

      // Day phase
      const alivePlayers = this.getPlayerNames({ isAlive: true });
      this.appendMessage(
        Role.MODERATOR,
        allPlayers,
        "Day breaks. Discuss the night's events."
      );

      for (let round = 0; round < this.numRounds.day; round++) {
        for (const player of shuffle(alivePlayers)) {
          const response = await this.letPlayerTalk(player);
          if (response) {
            this.appendMessage(player, alivePlayers, response);
          }
        }
      }

      this.appendMessage(
        Role.MODERATOR,
        allPlayers,
        "Time to vote. Name the player you suspect is a Werewolf."
      );

      const dayTarget = await this.processVotes(allPlayers, allPlayers);
      if (dayTarget) {
        this.players[dayTarget].is_alive = false;
        this.appendMessage(
          Role.MODERATOR,
          allPlayers,
          `${dayTarget} has been eliminated by vote.`
        );

        [gameOver, winner] = this.checkGameOver();
      }
    }

    const werewolfNames = this.getPlayerNames({ isWerewolf: true });
    this.appendMessage(
      Role.MODERATOR,
      allPlayers,
      `Game Over! The ${winner} win! The Werewolves were: ${werewolfNames.join(', ')}`
    );

    if (winner) {
      this.saveGame(winner);
    }
  }
}

async function play(matchIdx: number, options: any = {}): Promise<void> {
  const game = new Game(matchIdx, options.playersPerModel, options.numWerewolves,
    options.numNightDiscussionRounds, options.numDayDiscussionRounds);
  await game.play();
}

async function main(): Promise<void> {
  const numMatches = 2;

  for (let i = 0; i < numMatches; i++) {
    await play(i);
  }

  const stats = calculateStatistics(numMatches);
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