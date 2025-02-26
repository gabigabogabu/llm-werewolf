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
const openai_client = API_KEYS['OPENAI'] ? new OpenAI({ apiKey: API_KEYS['OPENAI'] }) : null;
const xai_client = API_KEYS['XAI'] ? new OpenAI({ apiKey: API_KEYS['XAI'], baseURL: "https://api.x.ai/v1" }) : null;
const anthropic_client = API_KEYS['ANTHROPIC'] ? new Anthropic({ apiKey: API_KEYS['ANTHROPIC'] }) : null;
const mistral_client = API_KEYS['MISTRAL'] ? new Mistral({ apiKey: API_KEYS['MISTRAL'] }) : null;

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
const openai_sdk_chat_completion = (
  client: OpenAI,
  model: string,
  systemAlias: ChatCompletionMessageParam['role'] = 'system',
  non_user_has_name: boolean = true
): CompletionFunction => async (chat: FormattedMessage[]): Promise<string> => {
    const messages = chat.map(m => ({
      role: m.role === "system" ? systemAlias : m.role,
      content: m.content,
      name: m.role === "user" || non_user_has_name ? m.name : undefined
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

const anthropic_sdk_chat_completion = (
  client: Anthropic,
  model: string,
  max_tokens: number = 8192
): CompletionFunction => async (chat: FormattedMessage[]): Promise<string> => {
    const messages = chat.map(m => ({
      role: m.role !== "system" ? m.role : "user",
      content: m.role === "user" ? `${m.name}: ${m.content}` : m.content,
    }));

    try {
      const completion = await client.messages.create({
        model,
        messages,
        max_tokens,
      });

      return completion.content.filter(block => block.type === 'text')
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('') || '';
    } catch (error) {
      console.error(`Error with Anthropic completion for ${model}:`, error);
      return '';
    }
  };

const mistral_sdk_chat_completion = (
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
  'openai/o1-mini-2024-09-12': openai_client ? openai_sdk_chat_completion(openai_client, 'o1-mini-2024-09-12', 'user') : null,
  'openai/o1-mini': openai_client ? openai_sdk_chat_completion(openai_client, 'o1-mini', 'user') : null,
  'openai/o1-preview-2024-09-12': openai_client ? openai_sdk_chat_completion(openai_client, 'o1-preview-2024-09-12', 'user') : null,
  'openai/o1-preview': openai_client ? openai_sdk_chat_completion(openai_client, 'o1-preview', 'user') : null,
  'openai/chatgpt-4o-latest': openai_client ? openai_sdk_chat_completion(openai_client, 'chatgpt-4o-latest', 'developer') : null,
  'openai/gpt-4o-2024-05-13': openai_client ? openai_sdk_chat_completion(openai_client, 'gpt-4o-2024-05-13', 'developer') : null,
  'openai/gpt-4o-2024-08-06': openai_client ? openai_sdk_chat_completion(openai_client, 'gpt-4o-2024-08-06', 'developer') : null,
  'openai/gpt-4o-2024-11-20': openai_client ? openai_sdk_chat_completion(openai_client, 'gpt-4o-2024-11-20', 'developer') : null,
  'openai/gpt-4o': openai_client ? openai_sdk_chat_completion(openai_client, 'gpt-4o', 'developer') : null,

  // XAI
  'xai/grok-2-1212': xai_client ? openai_sdk_chat_completion(xai_client, 'grok-2-1212', 'system', false) : null,

  // Anthropic
  'anthropic/claude-3-5-sonnet-20241022': anthropic_client ? anthropic_sdk_chat_completion(anthropic_client, 'claude-3-5-sonnet-20241022') : null,
  'anthropic/claude-3-5-haiku-20241022': anthropic_client ? anthropic_sdk_chat_completion(anthropic_client, 'claude-3-5-haiku-20241022') : null,
  'anthropic/claude-3-5-sonnet-20240620': anthropic_client ? anthropic_sdk_chat_completion(anthropic_client, 'claude-3-5-sonnet-20240620') : null,

  // Mistral
  'mistral/mistral-large-2411': mistral_client ? mistral_sdk_chat_completion(mistral_client, 'mistral-large-2411') : null,
  'mistral/ministral-3b-2410': mistral_client ? mistral_sdk_chat_completion(mistral_client, 'ministral-3b-2410') : null,
  'mistral/ministral-8b-2410': mistral_client ? mistral_sdk_chat_completion(mistral_client, 'ministral-8b-2410') : null,
  'mistral/open-mistral-nemo-2407': mistral_client ? mistral_sdk_chat_completion(mistral_client, 'open-mistral-nemo-2407') : null,
};

// Filter out null values
const availableLlms: Record<string, CompletionFunction> = {};
for (const [key, value] of Object.entries(llms)) {
  if (value) availableLlms[key] = value;
}

function print_last_message(chat: Message[], players: Record<string, Player>): void {
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

function calculate_statistics(num_matches: number): Statistics {
  let total_matches = 0;
  let villager_wins = 0;
  let werewolf_wins = 0;
  const model_stats: Record<string, ModelStats> = {};

  for (let i = 0; i < num_matches; i++) {
    try {
      const data = fs.readFileSync(`werewolf_match_${i}.json`, 'utf8');
      const game_data: GameData = JSON.parse(data);

      if (!game_data.winner) continue;

      total_matches++;
      const winner_team = game_data.winner.winning_team;
      if (winner_team === "VILLAGERS") {
        villager_wins++;
      } else {
        werewolf_wins++;
      }

      // Track model stats
      for (const [name, player] of Object.entries(game_data.players)) {
        const model = player.model;
        const is_werewolf = player.character === "WEREWOLF";
        const won = (is_werewolf && winner_team === "WEREWOLVES") || (!is_werewolf && winner_team === "VILLAGERS");

        if (!model_stats[model]) {
          model_stats[model] = {
            total_games: 0,
            total_wins: 0,
            werewolf_games: 0,
            werewolf_wins: 0,
            villager_games: 0,
            villager_wins: 0
          };
        }

        model_stats[model].total_games++;
        if (won) model_stats[model].total_wins++;

        if (is_werewolf) {
          model_stats[model].werewolf_games++;
          if (won) model_stats[model].werewolf_wins++;
        } else {
          model_stats[model].villager_games++;
          if (won) model_stats[model].villager_wins++;
        }
      }
    } catch (error) {
      continue;
    }
  }

  // Calculate percentages
  const stats: Statistics = {
    villager_winrate: total_matches > 0 ? villager_wins / total_matches : 0,
    werewolf_winrate: total_matches > 0 ? werewolf_wins / total_matches : 0,
    model_stats: {}
  };

  for (const [model, data] of Object.entries(model_stats)) {
    stats.model_stats[model] = {
      total_winrate: data.total_games > 0 ? data.total_wins / data.total_games : 0,
      werewolf_winrate: data.werewolf_games > 0 ? data.werewolf_wins / data.werewolf_games : 0,
      villager_winrate: data.villager_games > 0 ? data.villager_wins / data.villager_games : 0
    };
  }

  return stats;
}

class Game {
  match_idx: number;
  chat: Message[];
  players: Record<string, Player>;
  num_werewolves: number;
  num_rounds: { night: number; day: number };

  constructor(
    match_idx: number,
    players_per_model: number = 1,
    num_werewolves: number = 1 / 3,
    num_night_discussion_rounds: number = 2,
    num_day_discussion_rounds: number = 2
  ) {
    this.match_idx = match_idx;
    this.chat = [];

    const modelKeys = Object.keys(availableLlms);
    const used_names = this.shuffle(NAME_LIST).slice(0, modelKeys.length * players_per_model);
    const models = Array(players_per_model).fill(modelKeys).flat();

    this.num_werewolves = num_werewolves < 1
      ? Math.floor(num_werewolves * used_names.length)
      : num_werewolves as number;

    this.num_rounds = {
      night: num_night_discussion_rounds,
      day: num_day_discussion_rounds
    };

    this.players = {};
    for (let i = 0; i < used_names.length; i++) {
      this.players[used_names[i]] = {
        model: models[i],
        character: null,
        is_alive: true
      };
    }
  }

  shuffle<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  }

  get_winner_stats(winner_team: string): Winner {
    const winners = this.get_players_by_state({ is_werewolf: winner_team === "WEREWOLVES" });
    return {
      winning_team: winner_team,
      winners: Object.entries(winners).map(([name, player]) => ({
        name,
        model: player.model,
        character: player.character || ""
      }))
    };
  }

  save_game(winner_team?: string): void {
    const game_data: GameData = {
      chat: this.chat,
      players: this.players,
      winner: winner_team ? this.get_winner_stats(winner_team) : null
    };

    const filename = `werewolf_match_${this.match_idx}.json`;
    fs.writeFileSync(filename, JSON.stringify(game_data, null, 2));
  }

  append_message(author: string, visible_to: string[], content: string, author_alive: boolean = true): void {
    const message: Message = {
      author,
      author_alive,
      visible_to,
      content,
      character: author === Role.MODERATOR ? Role.MODERATOR : this.players[author].character || ""
    };

    this.chat.push(message);
    print_last_message(this.chat, this.players);
    this.save_game();
  }

  async let_player_talk(player_name: string): Promise<string> {
    const visible_messages = this.chat.filter(msg => msg.visible_to.includes(player_name));
    const formatted_messages: FormattedMessage[] = [];

    for (const msg of visible_messages) {
      if (msg.author === Role.MODERATOR) {
        formatted_messages.push({
          role: "system",
          content: msg.content,
          name: "Moderator"
        });
      } else if (msg.author === player_name) {
        formatted_messages.push({
          role: "assistant",
          content: msg.content,
          name: player_name
        });
      } else {
        formatted_messages.push({
          role: "user",
          content: msg.content,
          name: msg.author
        });
      }
    }

    const model = this.players[player_name].model;
    try {
      let content = await availableLlms[model](formatted_messages);

      // Remove player name prefixes
      for (const name of Object.keys(this.players)) {
        const pattern = new RegExp(`^${name}(-You)?:? `, 'i');
        content = content.replace(pattern, '');
      }

      return content;
    } catch (error) {
      console.error(`Error getting completion for ${player_name} with model ${model}:`, error);
      console.error(`Chat:`, JSON.stringify(formatted_messages, null, 2));
      throw error;
    }
  }

  async process_votes(voters: string[], visible_to: string[]): Promise<string | null> {
    const alive_voters = voters.filter(v => this.players[v].is_alive);
    const alive_candidates = Object.keys(this.players).filter(p => this.players[p].is_alive);
    const votes: Record<string, number> = {};

    for (const candidate of alive_candidates) {
      votes[candidate] = 0;
    }

    const majority_threshold = Math.floor(alive_voters.length / 2) + 1;
    const shuffled_voters = this.shuffle(alive_voters);

    for (const voter of shuffled_voters) {
      this.append_message(
        Role.MODERATOR,
        [voter],
        `${voter}, please vote by naming the player you want to eliminate.`
      );

      const response = await this.let_player_talk(voter);
      if (!response) continue;

      this.append_message(voter, visible_to, response);

      const shuffled_candidates = this.shuffle(Object.keys(this.players));
      for (const candidate of shuffled_candidates) {
        if (response.includes(candidate)) {
          if (!alive_candidates.includes(candidate)) {
            this.append_message(
              Role.MODERATOR,
              visible_to,
              `${voter}'s vote for ${candidate} was ignored as they are already dead.`
            );
            break;
          }

          votes[candidate] = (votes[candidate] || 0) + 1;
          this.append_message(
            Role.MODERATOR,
            visible_to,
            `${voter} has voted to eliminate ${candidate}. The current tally is: ${JSON.stringify(votes, null, 2)}`
          );

          if (votes[candidate] >= majority_threshold) {
            return candidate;
          }
          break;
        }
      }
    }

    // Find candidate with most votes
    let max_votes = 0;
    let max_candidate: string | null = null;

    for (const [candidate, vote_count] of Object.entries(votes)) {
      if (vote_count > max_votes) {
        max_votes = vote_count;
        max_candidate = candidate;
      }
    }

    return max_candidate;
  }

  get_players_by_state({ is_alive, is_werewolf }: { is_alive?: boolean; is_werewolf?: boolean } = {}): Record<string, Player> {
    const result: Record<string, Player> = {};

    for (const [name, player] of Object.entries(this.players)) {
      let include = true;

      if (is_alive !== undefined && player.is_alive !== is_alive) {
        include = false;
      }

      if (is_werewolf !== undefined && (player.character === Role.WEREWOLF) !== is_werewolf) {
        include = false;
      }

      if (include) {
        result[name] = player;
      }
    }

    return result;
  }

  get_player_names(options: { is_alive?: boolean; is_werewolf?: boolean } = {}): string[] {
    return Object.keys(this.get_players_by_state(options));
  }

  check_game_over(): [boolean, string | null] {
    const alive_werewolves = Object.keys(this.get_players_by_state({ is_alive: true, is_werewolf: true })).length;
    const alive_villagers = Object.keys(this.get_players_by_state({ is_alive: true, is_werewolf: false })).length;

    if (alive_werewolves === 0) {
      return [true, "VILLAGERS"];
    } else if (alive_werewolves >= alive_villagers) {
      return [true, "WEREWOLVES"];
    }

    return [false, null];
  }

  async play(): Promise<void> {
    console.log(`Match ${this.match_idx} starting with ${Object.keys(this.players).length} players (${this.num_werewolves} werewolves)`);

    // Welcome and introductions
    const all_players = Object.keys(this.players);
    const welcome_msg = `Welcome to a multi-player game of Werewolf! You are one of ${all_players.length} players, and you will be interacting with other players in this conversation. Each player has their own distinct personality and role.

GAME RULES:
- There are two teams: ${this.num_werewolves} Werewolves and ${all_players.length - this.num_werewolves} Villagers
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

    this.append_message(Role.MODERATOR, all_players, welcome_msg);

    // Get introductions
    for (const player of this.shuffle(all_players)) {
      this.append_message(
        Role.MODERATOR,
        [player],
        `Your name is ${player}. Please give a short introduction of yourself.`
      );

      const response = await this.let_player_talk(player);
      this.append_message(player, all_players, response);
    }

    // Assign roles
    const player_entries = Object.entries(this.players);
    this.shuffle(player_entries);

    for (let i = 0; i < player_entries.length; i++) {
      const [player_name, player] = player_entries[i];
      player.character = i < this.num_werewolves ? Role.WEREWOLF : Role.VILLAGER;
    }

    // Rebuild players object from shuffled entries
    this.players = {};
    for (const [name, player] of player_entries) {
      this.players[name] = player;
    }

    // Reveal roles
    for (const [player_name, player] of player_entries) {
      let message = `${player_name}, you are a ${player.character}.`;

      if (player.character === Role.WEREWOLF) {
        const other_werewolves = this.get_player_names({ is_werewolf: true }).filter(n => n !== player_name);
        message += ` Your fellow Werewolves are: ${other_werewolves.join(', ')}. The other players are Villagers.`;
      }

      this.append_message(Role.MODERATOR, [player_name], message);
    }

    // Game loop
    let game_over = false;
    let winner: string | null = null;

    for (let loop = 0; loop < Math.floor(Object.keys(this.players).length / 2); loop++) {
      if (game_over) break;

      // Night phase
      const werewolves = this.get_player_names({ is_alive: true, is_werewolf: true });
      this.append_message(
        Role.MODERATOR,
        all_players,
        "Night falls. Werewolves awaken and discuss their target. Only the Werewolves can hear each other."
      );

      for (let round = 0; round < this.num_rounds.night; round++) {
        for (const werewolf of this.shuffle(werewolves)) {
          const response = await this.let_player_talk(werewolf);
          this.append_message(werewolf, werewolves, response);
        }
      }

      this.append_message(
        Role.MODERATOR,
        werewolves,
        "Werewolves, vote to eliminate one player. Mention only their name."
      );

      const target = await this.process_votes(werewolves, werewolves);
      if (target) {
        this.players[target].is_alive = false;
        this.append_message(
          Role.MODERATOR,
          all_players,
          `${target} was found dead.`
        );

        [game_over, winner] = this.check_game_over();
        if (game_over) break;
      }

      // Day phase
      const alive_players = this.get_player_names({ is_alive: true });
      this.append_message(
        Role.MODERATOR,
        all_players,
        "Day breaks. Discuss the night's events."
      );

      for (let round = 0; round < this.num_rounds.day; round++) {
        for (const player of this.shuffle(alive_players)) {
          const response = await this.let_player_talk(player);
          if (response) {
            this.append_message(player, alive_players, response);
          }
        }
      }

      this.append_message(
        Role.MODERATOR,
        all_players,
        "Time to vote. Name the player you suspect is a Werewolf."
      );

      const day_target = await this.process_votes(all_players, all_players);
      if (day_target) {
        this.players[day_target].is_alive = false;
        this.append_message(
          Role.MODERATOR,
          all_players,
          `${day_target} has been eliminated by vote.`
        );

        [game_over, winner] = this.check_game_over();
      }
    }

    const werewolf_names = this.get_player_names({ is_werewolf: true });
    this.append_message(
      Role.MODERATOR,
      all_players,
      `Game Over! The ${winner} win! The Werewolves were: ${werewolf_names.join(', ')}`
    );

    if (winner) {
      this.save_game(winner);
    }
  }
}

async function play(match_idx: number, options: any = {}): Promise<void> {
  const game = new Game(match_idx, options.players_per_model, options.num_werewolves,
    options.num_night_discussion_rounds, options.num_day_discussion_rounds);
  await game.play();
}

async function main(): Promise<void> {
  const num_matches = 2;

  for (let i = 0; i < num_matches; i++) {
    await play(i);
  }

  const stats = calculate_statistics(num_matches);
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