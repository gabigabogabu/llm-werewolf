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
from openai import OpenAI
from anthropic import Anthropic

load_dotenv()

CHAT_FILE = os.getenv("MAFIA_CHAT_FILE") or "mafia_chat.txt"

openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# xai_client = OpenAI(api_key=os.getenv("XAI_API_KEY"), base_url='https://api.x.ai/v1')
# deepseek_client = OpenAI(api_key=os.getenv("DEEPSEEK_API_KEY"), base_url='https://api.deepseek.com')
# antropic_client = Anthropic(api_key=os.getenv("ANTROPIC_API_KEY"))

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
    # "xai-grok-2-1212": openai_sdk_chat_completion(xai_client, "grok-2-1212"),
    "openai-gpt-4o": openai_sdk_chat_completion(openai_client, "gpt-4o"),
    # "openai-gpt-4o-mini": openai_sdk_chat_completion(openai_client, "gpt-4o-mini"), # this model does not understand who it is playing as
    # "deepseek-deepseek-chat": openai_sdk_chat_completion(deepseek_client, "deepseek-chat"),
    # "deepseek-deepseek-reasoner": openai_sdk_chat_completion(deepseek_client, "deepseek-reasoner"),
    # "anthropic-claude-3-5-sonnet-20241022": antropic_sdk_chat_completion("claude-3-5-sonnet-20241022"),
}

def format_chat(chat, players):
    chat_str = ''
    for message in chat:
        content = re.sub(r'\s+', ' ', message["content"].replace('\n', ' '))
        if message["author"] == 'Moderator':
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

def save_game(chat, players, filename):
    with open(filename, 'w') as f:
        f.write(json.dumps({'chat': chat, 'players': players}, indent=2))

def get_completion(player_name, players, chat):
    """Get a completion from the LLM for the given player."""
    # Don't get completions for dead players
    if not players[player_name]["is_alive"]:
        return None
    visible_messages = [msg for msg in chat if player_name in msg["visible_to"]]
    formatted_messages = []
    for msg in visible_messages:
        if msg["author"] == 'Moderator':
            formatted_messages.append({
                "role": "system", 
                "content": msg["content"],
                "name": msg["author"]
            })
        elif msg["author"] == player_name:
            formatted_messages.append({
                "role": "assistant", 
                "content": f"{msg['content']}",
                "name": f"{msg['author']}-You"
            })
        else:
            formatted_messages.append({
                "role": "user", 
                "content": f"{msg['content']}",
                "name": msg["author"]
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
        pattern = re.compile(rf"^{n}(-You)?: ")
        content = pattern.sub('', content)
    # pdb.set_trace()
    return content

def process_votes(chat, players, voters, visible_to):
    votes = {}
    # Only consider alive voters
    alive_voters = [v for v in voters if players[v]["is_alive"]]
    for voter in random.sample(alive_voters, len(alive_voters)):
        response = get_completion(voter, players, chat)
        if response is None:  # Skip if player is dead
            continue
        append_message(chat, players, voter, visible_to, response)
        for candidate in random.sample(list(players.keys()), len(players)):
            if candidate in response:
                votes[candidate] = votes.get(candidate, 0) + 1
                append_message(chat, players, 'Moderator', visible_to, 
                    f"{voter} has voted to kill {candidate}."
                )
                print(f"Votes: {json.dumps(votes, indent=2)}")
                break
    # Filter votes to only include alive players
    votes = {p: v for p, v in votes.items() if p in players and players[p]["is_alive"]}
    return max(votes, key=votes.get) if votes else None

def append_message(chat, players, author, visible_to, content, author_alive=True):
    """Append a message to chat, print it, and optionally save the game state."""
    character = "moderator" if author == "Moderator" else players[author]["character"]
    message = {
        "author": author,
        "author_alive": author_alive,
        "visible_to": visible_to,
        "content": content,
        "character": character
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
        filtered = ((n, p) for n, p in filtered if (p["character"] == "mafioso") == is_mafia)
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
        return True, "Villagers"
    elif alive_mafiosi >= alive_villagers:
        return True, "Mafiosi"
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
            "character": "mafioso" if i < num_mafiosi else "villager",
            "is_alive": True
        } for i, (name, model) in enumerate(zip(selected_names, models))
    }

    chat = []
    append_message(chat, players, 'Moderator', selected_names,
        f"Welcome to the game of Mafia! In this game there are two teams: the Mafia and the Villagers. The Mafia's goal is to kill all the Villagers, while the Villagers' goal is to kill all the Mafiosi. The game is played in rounds. Each round consists of two phases: the Night phase and the Day phase. During the Night phase, only the Mafiosi are awake. They will choose one player to kill. All Mafiosi will see each other's choices, but the Villagers are asleep and do now know who voted for whom. The player with the most votes will be killed. During the Day phase, all players are awake. The players will discover who was killed during the night and will openly discuss the situation. After the discussion, all players will vote on which player to lynch. Every player can see the votes of all other players. WHEN ASKED TO VOTE FOR A PLAYER PLEASE RESPOND WITH THE NAME ONLY. The player with the most votes will be lynched. Living players can only hear other living players. Dead players can head both living and other dead players. The game ends when either all the Mafiosi are eliminated or the Mafiosi outnumber the Villagers. In this specific game there are {len(players)} players including yourself. {num_mafiosi} of which are Mafiosi. Let's first start with an introduction round, please say your name and a few words about yourself. Then each player will receive their character and we will start the game. Good luck!"
    )

    # Get introductions
    for player_name in random.sample(selected_names, len(selected_names)):
        append_message(chat, players, 'Moderator', [player_name],
            f"Your name is {player_name}. Please give a short introduction of yourself."
        )
        response = get_completion(player_name, players, chat)
        append_message(chat, players, player_name, selected_names, response)

    # Reveal characters
    for player_name, player in players.items():
        message = f"{player_name}, you are a {player['character']}."
        if player["character"] == "mafioso":
            other_mafiosi = [n for n in get_player_names(players, is_mafia=True) if n != player_name]
            message += f" Your fellow Mafiosi are: {', '.join(other_mafiosi)}. The other players are Villagers. The Villagers do not know who the Mafiosi are."
        append_message(chat, players, 'Moderator', [player_name], message)

    # Game loop
    game_over = False
    loops = 0
    max_loops = len(players) // 2
    while not game_over and loops <= max_loops:
        loops += 1

        # Night phase
        mafiosi = get_player_names(players, is_alive=True, is_mafia=True)
        all_names = list(players.keys())
        
        append_message(chat, players, 'Moderator', all_names,
            "It is now night time. Mafiosi, please awaken and discuss who to kill. Only the Mafiosi can hear each other."
        )

        # Mafia discussion
        for mafioso in random.choices(mafiosi, k=len(mafiosi) * 2):
            response = get_completion(mafioso, players, chat)
            append_message(chat, players, mafioso, mafiosi, response)

        append_message(chat, players, 'Moderator', mafiosi,
            "It is time for the Mafiosi to vote. Please vote by mentioning only the name of the player you want to kill. Mention no other names. The only name you mention will be counted as your vote. The most voted player will die."
        )
        target = process_votes(chat, players, mafiosi, mafiosi)
        if target:
            players[target]["is_alive"] = False
            game_over, winner = check_game_over(players)
            if game_over:
                break

        # Day phase
        alive_players = get_player_names(players, is_alive=True)
        dead_players = get_player_names(players, is_alive=False)
        append_message(chat, players, 'Moderator', all_names,
            f"It is now day time. {target} has been killed. Discuss."
        )

        # Discussion phase
        for player_name in random.choices(alive_players, k=len(alive_players) * 2):
            response = get_completion(player_name, players, chat)
            if response:  # Only add message if we got a response (player is alive)
                append_message(chat, players, player_name, alive_players, response,
                    author_alive=True
                )

        append_message(chat, players, 'Moderator', all_names,
            "The Day is coming to a close. It is time to vote on who to lynch. Please vote by mentioning only the name of the player you want to lynch and only the name. Mention no other names. The player with the most votes will be lynched."
        )
        target = process_votes(chat, players, all_names, all_names)
        if target:
            players[target]["is_alive"] = False
            game_over, winner = check_game_over(players)
            if not game_over:
                append_message(chat, players, 'Moderator', all_names, f"{target} has been lynched.")

    append_message(chat, players, 'Moderator', all_names,
        f"The game is over. The {winner} win!"
    )
        

if __name__ == "__main__":
    play()
