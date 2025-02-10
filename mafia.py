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
from mistralai import Mistral

class Role(Enum):
    MAFIOSO = "MAFIOSO"
    VILLAGER = "VILLAGER"
    MODERATOR = "MODERATOR"
    
    def __str__(self):
        return self.value

load_dotenv()

CHAT_FILE = os.getenv("MAFIA_CHAT_FILE") or "mafia_chat.json"
NAME_LIST = ["Alice", "Bob", "Charlie", "David", "Eve", "Frank", "Grace", "Hannah", "Isaac", "Jane", "Carlos", "Maria", "Luis", "Sofia", "Diego", "Carmen", "Miguel", "Isabella", "Wei", "Ming", "Yuki", "Hiroshi", "Jin", "Mei", "Kumar", "Priya", "Raj", "Ahmed", "Fatima", "Omar", "Leila", "Hassan", "Yasmin", "Zara", "Kwame", "Amara", "Zola", "Thabo", "Aisha", "Chioma", "Kofi", "Erik", "Astrid", "Lars", "Ingrid", "Magnus", "Freya", "Ivan", "Natasha", "Boris", "Katya", "Dmitri", "Olga", "Andreas", "Helena", "Stavros", "Sophia", "Theos"]

api_keys = {x: os.getenv(f'{x}_API_KEY') for x in ['OPENAI', 'XAI', 'DEEPSEEK', 'ANTHROPIC', 'MISTRAL', 'GOOGLE', 'ALIBABA']}

openai_client = OpenAI(api_key=api_keys['OPENAI']) if api_keys['OPENAI'] else None
xai_client = OpenAI(api_key=api_keys['XAI'], base_url="https://api.x.ai/v1") if api_keys['XAI'] else None
deepseek_client = OpenAI(api_key=api_keys['DEEPSEEK']) if api_keys['DEEPSEEK'] else None
anthropic_client = Anthropic(api_key=api_keys['ANTHROPIC']) if api_keys['ANTHROPIC'] else None
mistral_client = Mistral(api_key=api_keys['MISTRAL']) if api_keys['MISTRAL'] else None

def openai_sdk_chat_completion(client, model, systemAlias='system', non_user_has_name=True):
    def get_openai_completion(chat):
        messages = [{
            "role": systemAlias if m["role"] == "system" else m["role"],
            "content": m["content"],
            # xai only supports names for user messages
            "name": m["name"] if m["role"] == "user" or non_user_has_name else None
        } for m in chat]
        completion = client.chat.completions.create(
            model=model,
            messages=messages
        )
        if len(completion.choices) == 0:
            return ''
        return completion.choices[0].message.content
    return get_openai_completion

def anthropic_sdk_chat_completion(model, max_tokens=8192):
    def get_anthropic_completion(chat):
        messages = [{
            # moderator is system in chat, but not supported in anthropic, so we use user instead
            "role": m["role"] if m["role"] != "system" else "user",
            # name is not supported in anthropic, so we prepend the name to the content for non-ego messages
            "content": f'{m["name"]}: {m["content"]}' if m["role"] == "user" else m["content"],
        } for m in chat]
        completion = anthropic_client.messages.create(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
        )
        if len(completion.content) == 0:
            return ''
        return completion.content[0].text
    return get_anthropic_completion

def mistral_sdk_chat_completion(model):
    def get_mistral_completion(chat):
        messages = [{
            "role": m["role"],
            "content": m["content"],
            "name": m["name"]
        } for m in chat]
        completion = mistral_client.chat.complete(
            model=model,
            messages=messages
        )
        if len(completion.choices) == 0:
            return ''
        return completion.choices[0].message.content
    return get_mistral_completion

llms = {
    # openai
    'openai-o1-mini-2024-09-12': openai_sdk_chat_completion(openai_client, 'o1-mini-2024-09-12', systemAlias='user') if openai_client else None,
    'openai-o1-mini': openai_sdk_chat_completion(openai_client, 'o1-mini', systemAlias='user') if openai_client else None,
    'openai-o1-preview-2024-09-12': openai_sdk_chat_completion(openai_client, 'o1-preview-2024-09-12', systemAlias='user') if openai_client else None,
    'openai-o1-preview': openai_sdk_chat_completion(openai_client, 'o1-preview', systemAlias='user') if openai_client else None,
    'openai-chatgpt-4o-latest': openai_sdk_chat_completion(openai_client, 'chatgpt-4o-latest', systemAlias='developer') if openai_client else None,
    'openai-gpt-4o-2024-05-13': openai_sdk_chat_completion(openai_client, 'gpt-4o-2024-05-13', systemAlias='developer') if openai_client else None,
    'openai-gpt-4o-2024-08-06': openai_sdk_chat_completion(openai_client, 'gpt-4o-2024-08-06', systemAlias='developer') if openai_client else None,
    'openai-gpt-4o-2024-11-20': openai_sdk_chat_completion(openai_client, 'gpt-4o-2024-11-20', systemAlias='developer') if openai_client else None,
    "openai-gpt-4o": openai_sdk_chat_completion(openai_client, "gpt-4o", systemAlias='developer') if openai_client else None,
    # xai
    "xai-grok-2-1212": openai_sdk_chat_completion(xai_client, "grok-2-1212", non_user_has_name=False) if xai_client else None,
    # deepseek
    # "deepseek-deepseek-chat": openai_sdk_chat_completion(deepseek_client, "deepseek-chat") if deepseek_client else None,
    # "deepseek-deepseek-reasoner": openai_sdk_chat_completion(deepseek_client, "deepseek-reasoner") if deepseek_client else None,
    # anthropic
    "anthropic-claude-3-5-sonnet-20241022": anthropic_sdk_chat_completion("claude-3-5-sonnet-20241022") if anthropic_client else None,
    "anthropic-claude-3-5-haiku-20241022": anthropic_sdk_chat_completion("claude-3-5-haiku-20241022") if anthropic_client else None,
    "anthropic-claude-3-5-sonnet-20240620": anthropic_sdk_chat_completion("claude-3-5-sonnet-20240620") if anthropic_client else None,
    # mistral
    'mistral-mistral-large-2411': mistral_sdk_chat_completion('mistral-large-2411') if mistral_client else None,
    'mistral-ministral-3b-2410': mistral_sdk_chat_completion('ministral-3b-2410') if mistral_client else None,
    'mistral-ministral-8b-2410': mistral_sdk_chat_completion('ministral-8b-2410') if mistral_client else None,
    'mistral-open-mistral-nemo-2407': mistral_sdk_chat_completion('open-mistral-nemo-2407') if mistral_client else None,
}
llms = {k: v for k, v in llms.items() if v}

def format_chat(chat, players):
    chat_str = ''
    for message in chat:
        content = re.sub(r'\s+', ' ', message["content"].replace('\n', ' '))
        author = message["author"]
        if author == Role.MODERATOR.value:
            s = f"Moderator: {content}"
            chat_str += s + '\n'
            continue
        s = f"{author} ({message['character']}{'' if message['author_alive'] else ' - dead'}) ({players[author]['model']}): {content}"
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
                "name": player_name
            })
        else:
            formatted_messages.append({
                "role": "user",
                "content": msg["content"],
                "name": msg['author']
            })
    
    model = players[player_name]["model"]
    try:
        content = llms[model](formatted_messages)
    except Exception as e:
        print(f"Error getting completion for {player_name} with model {model}: {e}")
        print(f"Chat: {json.dumps(formatted_messages, indent=2)}")
        raise e
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
                    f"{voter} has voted to eliminate {candidate}. The current tally is: {json.dumps(votes, indent=2)}"
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

def play(players_per_model=1, num_mafiosi=1/3, num_night_discussion_rounds=2, num_day_discussion_rounds=2):
    print(f"{players_per_model=}, {num_mafiosi=}, {num_night_discussion_rounds=}, {num_day_discussion_rounds=}")
    
    used_names = random.sample(NAME_LIST, k=len(llms.keys()) * players_per_model)
    models = list(llms.keys()) * players_per_model
    num_mafiosi = int(num_mafiosi * len(used_names)) if num_mafiosi < 1 else num_mafiosi

    # Initialize players
    players = {
        name: {
            "model": model,
            "character": None,
            "is_alive": True
        } for i, (name, model) in enumerate(zip(used_names, models))
    }

    chat = []
    append_message(chat, players, Role.MODERATOR.value, used_names,
        f"""Welcome to a multi-player game of Mafia! You are one of {len(players)} players, and you will be interacting with other players in this conversation. Each player has their own distinct personality and role.

GAME RULES:
- There are two teams: {num_mafiosi} Mafiosi and {len(players) - num_mafiosi} Villagers
- Mafia's goal: Eliminate all Villagers
- Villagers' goal: Find and eliminate all Mafiosi

GAME PHASES:
1. Night Phase:
   - Only Mafiosi are awake and can communicate
   - Mafiosi vote to eliminate one player
   - Villagers cannot see this discussion

2. Day Phase:
   - All surviving players discuss openly
   - Everyone votes to eliminate one suspect
   - All votes are public

Phases alternate and loop until one team wins.

IMPORTANT RULES:
- You can only see messages from living players
- When voting, mention ONLY the name of your chosen player
- Respond in character and interact with others naturally
- Pay attention to who is alive and dead

You will soon receive your specific role and team assignment. First, let's have an introduction round - please share a brief introduction about yourself when asked.

Remember: You are a player, not the moderator."""
    )

    # Get introductions
    for player_name in random.sample(used_names, len(used_names)):
        append_message(chat, players, Role.MODERATOR.value, [player_name],
            f"Your name is {player_name}. Please give a short introduction of yourself."
        )
        response = get_completion(player_name, players, chat)
        append_message(chat, players, player_name, used_names, response)


    # Reveal characters
    player_list = list(players.items())
    random.shuffle(player_list)
    for i, (player_name, player) in enumerate(player_list):
        player["character"] = Role.MAFIOSO.value if i < num_mafiosi else Role.VILLAGER.value
        player["is_alive"] = True
    for i, (player_name, player) in enumerate(player_list):
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
        append_message(chat, players, Role.MODERATOR.value, used_names,
            "It is now night time. Mafiosi, please awaken and discuss who to eliminate. Only the Mafiosi can hear each other."
        )

        # Mafia discussion
        for _ in range(num_night_discussion_rounds):
            random.shuffle(mafiosi)
            for mafioso in mafiosi:
                response = get_completion(mafioso, players, chat)
                append_message(chat, players, mafioso, mafiosi, response)

        append_message(chat, players, Role.MODERATOR.value, mafiosi,
            "It is time for the Mafiosi to vote. Please vote by mentioning only the name of the player you want to eliminate. Mention no other names. The only name you mention will be counted as your vote. The most voted player will die."
        )
        target = process_votes(chat, players, mafiosi, mafiosi)
        if target:
            players[target]["is_alive"] = False
            append_message(chat, players, Role.MODERATOR.value, used_names, f"{target} has been eliminateed.")
            game_over, winner = check_game_over(players)
            if game_over:
                save_game(chat, players, CHAT_FILE, winner)
                break

        # Day phase
        alive_players = get_player_names(players, is_alive=True)
        append_message(chat, players, Role.MODERATOR.value, used_names,
            f"It is now day time. Discuss the events of the night."
        )

        # Discussion phase
        for _ in range(num_day_discussion_rounds):
            random.shuffle(alive_players)
            for player_name in alive_players:
                response = get_completion(player_name, players, chat)
                if response:
                    append_message(chat, players, player_name, alive_players, response,
                        author_alive=True
                    )

        append_message(chat, players, Role.MODERATOR.value, used_names,
            "The Day is coming to a close. It is time to vote on who to eliminate. Please vote by mentioning only the name of the player you want to eliminate and only the name. Mention no other names. The player with the most votes will be eliminateed."
        )
        target = process_votes(chat, players, used_names, used_names)
        if target:
            players[target]["is_alive"] = False
            append_message(chat, players, Role.MODERATOR.value, used_names, f"{target} has been eliminateed.")
            game_over, winner = check_game_over(players)

    append_message(chat, players, Role.MODERATOR.value, used_names,
        f"The match is over. The {winner} win! {', '.join(get_player_names(players, is_mafia=True))} were the mafiosi."
    )
    save_game(chat, players, CHAT_FILE, winner)
        

if __name__ == "__main__":
    play()
