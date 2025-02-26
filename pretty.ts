#!/usr/bin/env bun
import fs from 'fs';
import path from 'path';

interface ChatMessage {
  from: string;
  author_alive: boolean;
  to?: string[];
  content: string;
  character?: string;
}

interface MatchData {
  chat: ChatMessage[];
}

const main = async () => {
  const matchesDir = path.join(process.cwd(), 'matches');
  const outputDir = path.join(process.cwd(), 'transcripts');

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  const matches = fs.readdirSync(matchesDir);

  for (const matchFile of matches) {
    // Only process files matching the pattern werewolf_match_*.json
    if (!matchFile.startsWith('werewolf_match_') || !matchFile.endsWith('.json')) {
      continue;
    }

    console.log(`Processing ${matchFile}...`);

    try {
      // Extract date and ID from filename
      const fileNameMatch = matchFile.match(/werewolf_match_(\d{4}-\d{2}-\d{2})_(\d+)\.json/);
      if (!fileNameMatch) {
        console.error(`Invalid file name format: ${matchFile}`);
        continue;
      }

      const [_, date, id] = fileNameMatch;
      const matchData = JSON.parse(fs.readFileSync(path.join(matchesDir, matchFile), 'utf-8')) as MatchData;

      // Create markdown content
      let markdown = `# Werewolf Match Transcript - ${date} (Game ${id})\n\n`;

      // Process each chat message - condensed format
      for (const message of matchData.chat) {
        const visibleTo = message.to && Array.isArray(message.to) ? `(to: ${message.to.join(', ')})` : '';

        // Player messages
        const characterInfo = message.character ? ` - ${message.character}` : '';
        markdown += `**${message.from} ${visibleTo}${characterInfo}**: ${message.content || ''}\n`;
        markdown += '\n';
      }

      // Write markdown to file
      const outputFileName = `werewolf_transcript_${date}_${id}.md`;
      fs.writeFileSync(path.join(outputDir, outputFileName), markdown);

      console.log(`Created transcript: ${outputFileName}`);
    } catch (error) {
      console.error(`Error processing ${matchFile}:`, error);
    }
  }

  console.log('All transcripts created successfully!');
};

main().catch((error) => {
  console.error('An error occurred:', error);
  process.exit(1);
});