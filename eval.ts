#!/usr/bin/env bun

import fs from 'fs';
import path from 'path';

// Types from the game
enum Character {
  WEREWOLF = "WEREWOLF",
  VILLAGER = "VILLAGER",
  MODERATOR = "MODERATOR"
}

interface Player {
  model: string;
  character?: Character;
  is_alive: boolean;
}

interface GameData {
  chat: any[]; // Not needed for our analysis
  players: Record<string, Player>;
  winner?: Character;
}

interface ModelStats {
  gamesPlayed: number;
  wins: number;
  survivals: number;
  villagerGames: number;
  villagerWins: number;
  werewolfGames: number;
  werewolfWins: number;
}

// Function to generate markdown content
function generateMarkdown(
  modelStats: Record<string, ModelStats>,
  totalMatches: number,
  totalPlayers: number,
  totalWerewolves: number,
  totalVillagers: number,
  werewolfWins: number,
  villagerWins: number
): string {

  let markdown = '# Werewolf Game Statistics\n\n';
  markdown += `*Last updated: ${new Date().toISOString().split('T')[0]}*\n\n`;

  // COMBINED STATS TABLE: MODEL PERFORMANCE WITH ROLE DISTRIBUTION
  markdown += '## Model Performance (Sorted by Win Rate)\n\n';

  // Sort models by win rate (descending)
  const modelsByWinRate = Object.entries(modelStats)
    .sort(([, statsA], [, statsB]) => {
      const winRateA = statsA.wins / statsA.gamesPlayed;
      const winRateB = statsB.wins / statsB.gamesPlayed;
      return winRateB - winRateA;
    });

  // Table header
  markdown += '| Model | Games | Win % | Survival % | Villager Games (% of total) | Villager Win Rate | Werewolf Games (% of total) | Werewolf Win Rate |\n';
  markdown += '|-------|-------|-------|------------|-----------------------------|-------------------|-----------------------------|-------------------|\n';

  // Table rows
  for (const [model, stats] of modelsByWinRate) {
    const winRate = (stats.wins / stats.gamesPlayed) * 100;
    const survivalRate = (stats.survivals / stats.gamesPlayed) * 100;

    const villagerPct = stats.villagerGames > 0
      ? (stats.villagerGames / stats.gamesPlayed * 100).toFixed(1) + "%"
      : "0.0%";

    const werewolfPct = stats.werewolfGames > 0
      ? (stats.werewolfGames / stats.gamesPlayed * 100).toFixed(1) + "%"
      : "0.0%";

    const villagerWinRate = stats.villagerGames > 0
      ? (stats.villagerWins / stats.villagerGames) * 100
      : 0;

    const werewolfWinRate = stats.werewolfGames > 0
      ? (stats.werewolfWins / stats.werewolfGames) * 100
      : 0;

    markdown += `| ${model} | ${stats.gamesPlayed} | ${winRate.toFixed(1)}% | ${survivalRate.toFixed(1)}% | ${stats.villagerGames} (${villagerPct}) | ${villagerWinRate.toFixed(1)}% | ${stats.werewolfGames} (${werewolfPct}) | ${werewolfWinRate.toFixed(1)}% |\n`;
  }

  // Game Summary
  markdown += '\n## Game Summary\n\n';

  markdown += `- **Total matches analyzed**: ${totalMatches}\n`;
  markdown += `- **Total players**: ${totalPlayers}\n`;
  markdown += `- **Werewolves**: ${totalWerewolves} (${(totalWerewolves / totalPlayers * 100).toFixed(1)}%)\n`;
  markdown += `- **Villagers**: ${totalVillagers} (${(totalVillagers / totalPlayers * 100).toFixed(1)}%)\n`;
  markdown += `- **Werewolf team wins**: ${werewolfWins} (${(werewolfWins / totalMatches * 100).toFixed(1)}%)\n`;
  markdown += `- **Villager team wins**: ${villagerWins} (${(villagerWins / totalMatches * 100).toFixed(1)}%)\n`;

  return markdown;
}

// Function to update the README with stats
function updateReadmeWithStats(statsContent: string): void {
  const readmePath = path.join(process.cwd(), 'README.md');

  // Check if README exists
  if (!fs.existsSync(readmePath)) {
    console.error("README.md not found!");
    return;
  }

  // Read current README
  let readmeContent = fs.readFileSync(readmePath, 'utf8');

  // Define markers for the stats section
  const beginMarker = '<!-- begin stats -->';
  const endMarker = '<!-- end stats -->';

  // Check if markers exist
  if (!readmeContent.includes(beginMarker) || !readmeContent.includes(endMarker)) {
    console.warn("Stats section markers not found in README. Adding stats at the end.");
    readmeContent += `\n\n${beginMarker}\n${statsContent}\n${endMarker}\n`;
  } else {
    // Replace content between markers
    const beforeStats = readmeContent.split(beginMarker)[0];
    const afterStats = readmeContent.split(endMarker)[1];
    readmeContent = beforeStats + beginMarker + '\n' + statsContent + '\n' + endMarker + afterStats;
  }

  // Write updated README
  fs.writeFileSync(readmePath, readmeContent);
  console.log("README.md updated with latest statistics");
}

async function main() {
  // Read all match files
  const matchesDir = path.join(process.cwd(), 'matches');

  if (!fs.existsSync(matchesDir)) {
    console.error("Matches directory not found!");
    process.exit(1);
  }

  const matchFiles = fs.readdirSync(matchesDir)
    .filter(file => file.startsWith('werewolf_match_') && file.endsWith('.json'));

  if (matchFiles.length === 0) {
    console.error("No match files found!");
    process.exit(1);
  }

  console.log(`Processing ${matchFiles.length} match files...`);

  // Initialize stats object to track per-model statistics
  const modelStats: Record<string, ModelStats> = {};

  // Process each match file
  for (const matchFile of matchFiles) {
    const filePath = path.join(matchesDir, matchFile);
    const gameData: GameData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Skip games without a winner
    if (!gameData.winner) {
      console.warn(`Match ${matchFile} has no winner, skipping.`);
      continue;
    }

    // Process each player in the game
    for (const [playerName, player] of Object.entries(gameData.players)) {
      const model = player.model;

      // Initialize stats for this model if not already present
      if (!modelStats[model]) {
        modelStats[model] = {
          gamesPlayed: 0,
          wins: 0,
          survivals: 0,
          villagerGames: 0,
          villagerWins: 0,
          werewolfGames: 0,
          werewolfWins: 0
        };
      }

      // Update statistics
      modelStats[model].gamesPlayed++;

      // Did the player survive?
      if (player.is_alive) {
        modelStats[model].survivals++;
      }

      // Did the player's team win?
      const playerWon = player.character === gameData.winner;
      if (playerWon) {
        modelStats[model].wins++;
      }

      // Role-specific wins and games
      if (player.character === Character.VILLAGER) {
        modelStats[model].villagerGames++;
        if (playerWon) {
          modelStats[model].villagerWins++;
        }
      } else if (player.character === Character.WEREWOLF) {
        modelStats[model].werewolfGames++;
        if (playerWon) {
          modelStats[model].werewolfWins++;
        }
      }
    }
  }

  // Sort models by win rate (descending)
  const modelsByWinRate = Object.entries(modelStats)
    .sort(([, statsA], [, statsB]) => {
      const winRateA = statsA.wins / statsA.gamesPlayed;
      const winRateB = statsB.wins / statsB.gamesPlayed;
      return winRateB - winRateA;
    });

  // Summarize the roles and outcomes
  let totalPlayers = 0;
  let totalWerewolves = 0;
  let totalVillagers = 0;
  let werewolfWins = 0;
  let villagerWins = 0;

  for (const matchFile of matchFiles) {
    const filePath = path.join(matchesDir, matchFile);
    const gameData: GameData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (!gameData.winner) continue;

    const playerCount = Object.keys(gameData.players).length;
    totalPlayers += playerCount;

    const werewolfCount = Object.values(gameData.players)
      .filter(p => p.character === Character.WEREWOLF).length;

    totalWerewolves += werewolfCount;
    totalVillagers += playerCount - werewolfCount;

    if (gameData.winner === Character.WEREWOLF) {
      werewolfWins++;
    } else if (gameData.winner === Character.VILLAGER) {
      villagerWins++;
    }
  }

  const markdown = generateMarkdown(
    modelStats,
    matchFiles.length,
    totalPlayers,
    totalWerewolves,
    totalVillagers,
    werewolfWins,
    villagerWins
  );

  updateReadmeWithStats(markdown);
}

main().catch(err => {
  console.error("Error analyzing matches:", err);
  process.exit(1);
}); 