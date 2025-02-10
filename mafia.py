#! /usr/bin/env python3
'''
In this file, multiple LLMs will play the game of Mafia.
'''

import pdb
import json
from dotenv import load_dotenv
import os
import random
import re
from enum import Enum
from openai import OpenAI
from anthropic import Anthropic

class Role(Enum):
    MAFIOSO = "MAFIOSO"
    VILLAGER = "VILLAGER"
    MODERATOR = "MODERATOR"
    
    def __str__(self):
        return self.value

load_dotenv()

CHAT_FILE = os.getenv("MAFIA_CHAT_FILE") or "mafia_chat.json"
tokens = {x: os.getenv(f'{x}_API_KEY') for x in ['OPENAI', 'XAI', 'DEEPSEEK', 'ANTROPIC', 'MISTRAL', 'GOOGLE', 'ALIBABA']}

openai_client = OpenAI(api_key=tokens['OPENAI']) if tokens['OPENAI'] else None
xai_client = OpenAI(api_key=tokens['XAI']) if tokens['XAI'] else None
deepseek_client = OpenAI(api_key=tokens['DEEPSEEK']) if tokens['DEEPSEEK'] else None
antropic_client = Anthropic(api_key=tokens['ANTROPIC']) if tokens['ANTROPIC'] else None
mistral_client = OpenAI(api_key=tokens['MISTRAL'], base_url="https://api.mistral.ai/v1") if tokens['MISTRAL'] else None

def openai_sdk_chat_completion(client, model):
    def get_openai_completion(chat):
        return client.chat.completions.create(
            model=model,
            messages=chat
        )
    return get_openai_completion

def antropic_sdk_chat_completion(model):
    def get_antropic_completion(chat):
        return antropic_client.messages.create(
            model=model,
            messages=chat
        )
    return get_antropic_completion

llms = {
    "openai-gpt-4o": openai_sdk_chat_completion(openai_client, "gpt-4o"),
    # "openai-gpt-4o-mini": openai_sdk_chat_completion(openai_client, "gpt-4o-mini"), # this model does not understand who it is playing as
    "xai-grok-2-1212": openai_sdk_chat_completion(xai_client, "grok-2-1212") if xai_client else None,
    "deepseek-deepseek-chat": openai_sdk_chat_completion(deepseek_client, "deepseek-chat") if deepseek_client else None,
    "deepseek-deepseek-reasoner": openai_sdk_chat_completion(deepseek_client, "deepseek-reasoner") if deepseek_client else None,
    "anthropic-claude-3-5-sonnet-20241022": antropic_sdk_chat_completion("claude-3-5-sonnet-20241022") if antropic_client else None,
}
llms = {k: v for k, v in llms.items() if v}

def format_chat(chat, players):
    chat_str = ''
    for message in chat:
        content = re.sub(r'\s+', ' ', message["content"].replace('\n', ' '))
        if message["author"] == Role.MODERATOR.value:
            s = f"Moderator: {content}"
            chat_str += s + '\n'
            continue
        s = f"{message['author']} ({message['character']}{'' if message['author_alive'] else ' - dead'}): {content}"
        chat_str += s + '\n'
    return chat_str

def print_chat(chat, players):
    print(format_chat(chat, players))

def print_last_message(chat, players):
    print(format_chat(chat[-1:], players))

def get_winner_stats(players, winner_team):
    """Gather statistics about the winning team."""
    winners = get_players_by_state(players, is_mafia=(winner_team == "MAFIOSI"))
    return {
        "winning_team": winner_team,
        "winners": [
            {
                "name": name,
                "model": player["model"],
                "character": player["character"]
            }
            for name, player in winners.items()
        ]
    }

def save_game(chat, players, filename, winner_team=None):
    """Save the game state and winner information."""
    game_data = {
        'chat': chat,
        'players': players,
        'winner': get_winner_stats(players, winner_team) if winner_team else None,
    }
    with open(filename, 'w') as f:
        f.write(json.dumps(game_data, indent=2))

def get_completion(player_name, players, chat):
    """Get a completion from the LLM for the given player."""
    visible_messages = [msg for msg in chat if player_name in msg["visible_to"]]
    formatted_messages = []
    for msg in visible_messages:
        if msg["author"] == Role.MODERATOR.value:
            formatted_messages.append({
                "role": "system",
                "content": msg["content"],
                "name": "Moderator"
            })
        elif msg["author"] == player_name:
            formatted_messages.append({
                "role": "assistant",
                "content": msg["content"],
                "name": f"{player_name}"
            })
        else:
            if formatted_messages[-1]["role"] == "user":
                formatted_messages[-1]["content"] += f"\n{msg['author']}: {msg['content']}"
            else:
                formatted_messages.append({
                    "role": "user",
                    "content": f"{msg['author']} {msg['content']}",
                })
    
    model = players[player_name]["model"]
    try:
        completion = llms[model](formatted_messages)
    except Exception as e:
        print(f"Error getting completion for {player_name} with model {model}: {e}")
        print(f"Chat: {json.dumps(formatted_messages, indent=2)}")
        raise e
    content = completion.choices[0].message.content
    # remove leading `Name: ` from the completion
    for n in players.keys():
        pattern = re.compile(rf"^{n}(-You)?:? ")
        content = pattern.sub('', content)
    return content

def process_votes(chat, players, voters, visible_to):
    votes = {}
    # Only consider alive voters
    alive_voters = [v for v in voters if players[v]["is_alive"]]
    for voter in random.sample(alive_voters, len(alive_voters)):
        response = get_completion(voter, players, chat)
        if response is None:
            continue
        append_message(chat, players, voter, visible_to, response)
        for candidate in random.sample(list(players.keys()), len(players)):
            if candidate in response:
                votes[candidate] = votes.get(candidate, 0) + 1
                append_message(chat, players, Role.MODERATOR.value, visible_to, 
                    f"{voter} has voted to kill {candidate}. The current tally is: {json.dumps(votes, indent=2)}"
                )
                break
    # Filter votes to only include alive players
    votes = {p: v for p, v in votes.items() if p in players and players[p]["is_alive"]}
    return max(votes, key=votes.get) if votes else None

def append_message(chat, players, author, visible_to, content, author_alive=True):
    """Append a message to chat, print it, and optionally save the game state."""
    message = {
        "author": author,
        "author_alive": author_alive,
        "visible_to": visible_to,
        "content": content,
        "character": Role.MODERATOR.value if author == Role.MODERATOR.value else players[author]["character"]
    }
    chat.append(message)
    print_last_message(chat, players)
    save_game(chat, players, CHAT_FILE)

def get_players_by_state(players, is_alive=None, is_mafia=None):
    """Filter players by alive status and/or mafia status."""
    filtered = players.items()
    if is_alive is not None:
        filtered = ((n, p) for n, p in filtered if p["is_alive"] == is_alive)
    if is_mafia is not None:
        filtered = ((n, p) for n, p in filtered if (p["character"] == Role.MAFIOSO.value) == is_mafia)
    return dict(filtered)

def get_player_names(players, **kwargs):
    """Get list of player names matching the given criteria."""
    return list(get_players_by_state(players, **kwargs).keys())

def check_game_over(players):
    """Check if the game is over and return (is_over, winner)."""
    alive_mafiosi = len(get_players_by_state(players, is_alive=True, is_mafia=True))
    alive_villagers = len(get_players_by_state(players, is_alive=True, is_mafia=False))
    print(f"Alive Mafiosi: {alive_mafiosi}, Alive Villagers: {alive_villagers}")
    print(f"Players: {json.dumps(players, indent=2)}")
    
    if alive_mafiosi == 0:
        return True, "VILLAGERS"
    elif alive_mafiosi >= alive_villagers:
        return True, "MAFIOSI"
    return False, None

def play():
    players_per_model = 9
    all_names = ["Alice", "Bob", "Charlie", "David", "Eve", "Frank", "Grace", "Hannah", "Isaac", "Jane"]
    selected_names = random.sample(all_names, k=len(llms.keys()) * players_per_model)
    models = list(llms.keys()) * players_per_model
    num_mafiosi = len(selected_names) // 3

    # Initialize players
    players = {
        name: {
            "model": model,
            "character": Role.MAFIOSO.value if i < num_mafiosi else Role.VILLAGER.value,
            "is_alive": True
        } for i, (name, model) in enumerate(zip(selected_names, models))
    }

    chat = []
    append_message(chat, players, Role.MODERATOR.value, selected_names,
        f"""Welcome to a multi-player game of Mafia! You are one of {len(players)} players, and you will be interacting with other AI players in this conversation. Each player has their own distinct personality and role.

GAME RULES:
- There are two teams: {num_mafiosi} Mafiosi and {len(players) - num_mafiosi} Villagers
- Mafia's goal: Eliminate all Villagers
- Villagers' goal: Find and eliminate all Mafiosi

GAME PHASES:
1. Night Phase:
   - Only Mafiosi are awake and can communicate
   - Mafiosi vote to kill one player
   - Villagers cannot see this discussion

2. Day Phase:
   - All surviving players discuss openly
   - Everyone votes to eliminate one suspect
   - All votes are public

IMPORTANT RULES:
- You can only see messages from living players
- When voting, mention ONLY the name of your chosen player
- Respond in character and interact with others naturally
- Pay attention to who is alive and dead

You will soon receive your specific role and team assignment. First, let's have an introduction round - please share a brief introduction about yourself when asked.

Remember: You are a player, not the moderator. Good luck!"""
    )

    # Get introductions
    for player_name in random.sample(selected_names, len(selected_names)):
        append_message(chat, players, Role.MODERATOR.value, [player_name],
            f"Your name is {player_name}. Please give a short introduction of yourself."
        )
        response = get_completion(player_name, players, chat)
        append_message(chat, players, player_name, selected_names, response)

    # Reveal characters
    for player_name, player in players.items():
        message = f"{player_name}, you are a {player['character']}."
        if player["character"] == Role.MAFIOSO.value:
            other_mafiosi = [n for n in get_player_names(players, is_mafia=True) if n != player_name]
            message += f" Your fellow Mafiosi are: {', '.join(other_mafiosi)}. The other players are Villagers. The Villagers do not know who the Mafiosi are."
        append_message(chat, players, Role.MODERATOR.value, [player_name], message)

    # Game loop
    game_over = False
    loops = 0
    max_loops = len(players) // 2
    while not game_over and loops <= max_loops:
        loops += 1

        # Night phase
        mafiosi = get_player_names(players, is_alive=True, is_mafia=True)
        all_names = list(players.keys())
        
        append_message(chat, players, Role.MODERATOR.value, all_names,
            "It is now night time. Mafiosi, please awaken and discuss who to kill. Only the Mafiosi can hear each other."
        )

        # Mafia discussion
        for _ in range(2):
            for mafioso in random.choices(mafiosi, k=len(mafiosi)):
                response = get_completion(mafioso, players, chat)
                append_message(chat, players, mafioso, mafiosi, response)

        append_message(chat, players, Role.MODERATOR.value, mafiosi,
            "It is time for the Mafiosi to vote. Please vote by mentioning only the name of the player you want to kill. Mention no other names. The only name you mention will be counted as your vote. The most voted player will die."
        )
        target = process_votes(chat, players, mafiosi, mafiosi)
        if target:
            players[target]["is_alive"] = False
            game_over, winner = check_game_over(players)
            if game_over:
                save_game(chat, players, CHAT_FILE, winner)
                break

        # Day phase
        alive_players = get_player_names(players, is_alive=True)
        append_message(chat, players, Role.MODERATOR.value, all_names,
            f"It is now day time. {target} has been killed. Discuss."
        )

        # Discussion phase
        for _ in range(2):
            for player_name in random.choices(alive_players, k=len(alive_players)):
                response = get_completion(player_name, players, chat)
                if response:
                    append_message(chat, players, player_name, alive_players, response,
                        author_alive=True
                    )

        append_message(chat, players, Role.MODERATOR.value, all_names,
            "The Day is coming to a close. It is time to vote on who to kill. Please vote by mentioning only the name of the player you want to kill and only the name. Mention no other names. The player with the most votes will be killed."
        )
        target = process_votes(chat, players, all_names, all_names)
        if target:
            players[target]["is_alive"] = False
            append_message(chat, players, Role.MODERATOR.value, all_names, f"{target} has been killed.")
            game_over, winner = check_game_over(players)

    append_message(chat, players, Role.MODERATOR.value, all_names,
        f"The game is over. The {winner} win!"
    )
    save_game(chat, players, CHAT_FILE, winner)
        

if __name__ == "__main__":
    play()
